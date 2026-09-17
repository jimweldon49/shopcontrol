const { pool } = require("./db");
const { sendTaskEmail, smtpConfigured } = require("./mailer");

const ONSITE_EXCLUDED_STATUSES = ["Complete", "Returned", "Credit Pending"];
const AGE_DAYS = Number(process.env.PARTS_AGING_ALERT_DAYS || 25);

// Reuses the existing coreRecipients setting (Settings -> Core alert recipients) rather than a
// new recipient group -- it already maps "office staff" to real employee accounts, with the
// same owner/admin/office/parts role fallback used by core-return alerts.
async function resolveOfficeRecipients() {
  const config = (await pool.query("SELECT data FROM board_settings WHERE id=1")).rows[0]?.data || {};
  const ids = config.coreRecipients || [];
  const r = await pool.query(
    `SELECT id, email, full_name FROM users WHERE active=true AND receives_notifications=true AND email IS NOT NULL AND
     (id::text=ANY($1::text[]) OR (cardinality($1::text[])=0 AND role IN ('owner','admin','office','parts')))`,
    [ids]
  );
  return r.rows;
}

async function checkPartsAging() {
  if (!smtpConfigured()) return { checked: false, reason: "smtp_not_configured" };

  const overdue = (await pool.query(
    `SELECT * FROM parts
     WHERE part_aging_alert_sent_at IS NULL
       AND part_status NOT IN ('${ONSITE_EXCLUDED_STATUSES.join("','")}')
       AND part_received_date IS NOT NULL
       AND part_received_date <= (CURRENT_DATE - $1::int)
     ORDER BY part_received_date ASC LIMIT 200`,
    [AGE_DAYS]
  )).rows;

  if (!overdue.length) return { checked: true, alerted: 0 };

  const recipients = await resolveOfficeRecipients();
  if (!recipients.length) {
    await pool.query(
      "INSERT INTO activity_log(resource,action,summary) VALUES('parts','aging_alert_skipped',$1)",
      [`${overdue.length} part(s) have been on site ${AGE_DAYS}+ days but no core alert recipients are configured in Settings.`]
    );
    return { checked: true, alerted: 0, skipped: overdue.length };
  }

  const title = `Review ${overdue.length} part(s) on site ${AGE_DAYS}+ days`;
  const bodyLines = overdue.map(p =>
    `RO ${p.parts_ro_number} · ${p.part_description}${p.part_cost ? ` · Est. value $${(Number(p.part_cost) * Number(p.part_qty || 1)).toFixed(2)}` : ""} · received ${p.part_received_date}`
  );

  let sent = 0;
  for (const user of recipients) {
    try {
      const result = await sendTaskEmail({ to: user.email, subject: title, title, bodyLines });
      if (result.sent) sent++;
    } catch (err) {
      console.error("Parts aging alert email failed:", err.message);
    }
  }

  await pool.query(`UPDATE parts SET part_aging_alert_sent_at=now() WHERE id=ANY($1::uuid[])`, [overdue.map(p => p.id)]);
  return { checked: true, alerted: overdue.length, emailed: sent };
}

let timer = null;

function startPartsAgingAlerts() {
  const enabled = String(process.env.PARTS_AGING_ALERT_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) {
    console.log("Parts aging alert scheduler disabled.");
    return;
  }
  const intervalMs = Number(process.env.PARTS_AGING_ALERT_SCAN_MS || 900000);
  console.log(`Parts aging alert scheduler enabled. Interval: ${intervalMs}ms`);
  checkPartsAging().catch(err => console.error("Parts aging check failed:", err.message));
  timer = setInterval(() => {
    checkPartsAging().catch(err => console.error("Parts aging check failed:", err.message));
  }, intervalMs);
}

function stopPartsAgingAlerts() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { checkPartsAging, startPartsAgingAlerts, stopPartsAgingAlerts };
