const { pool } = require("./db");
const { sendTaskEmail } = require("./mailer");

const EXCLUDED_STAGES = new Set(["delivered", "total loss"]);

function cycleTierDays(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (n < 2000) return 2;
  if (n < 4000) return 4;
  if (n < 10000) return 8;
  return 15;
}

function cycleTierLabel(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  if (n < 2000) return "$0 - $2,000";
  if (n < 4000) return "$2,000 - $4,000";
  if (n < 10000) return "$4,000 - $10,000";
  return "$10,000+";
}

function localDateString(date = new Date()) {
  const timeZone = process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cycleTargetDate(job) {
  const days = cycleTierDays(job.ro_amount);
  if (days == null || !job.created_at) return null;
  const intakeDate = localDateString(new Date(job.created_at));
  return addDays(intakeDate, days);
}

async function activeUserEmails() {
  const result = await pool.query(
    "SELECT email FROM users WHERE active = TRUE AND email IS NOT NULL AND email <> ''"
  );
  return result.rows.map(r => r.email);
}

function jobLines(job, targetDate, prefix) {
  return [
    prefix,
    `RO: ${job.ro_number || ""}`,
    `Customer: ${job.customer_name || ""}`,
    `Vehicle: ${job.vehicle || ""}`,
    job.ro_amount != null ? `Amount: $${Number(job.ro_amount).toFixed(2)}` : "",
    `Cycle time tier: ${cycleTierLabel(job.ro_amount)}`,
    `Cycle time target date: ${targetDate}`,
    `Current stage: ${job.current_stage || ""}`,
    job.location ? `Location: ${job.location}` : "",
  ].filter(Boolean);
}

async function checkCycleTimeAlerts() {
  const result = await pool.query(
    `SELECT * FROM daily_go_list
     WHERE lower(coalesce(current_stage, '')) NOT IN ('delivered', 'total loss')
       AND ro_amount IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 500`
  );

  const today = localDateString();
  let sentReminders = 0;
  let sentPastDue = 0;
  let recipients = null;

  for (const job of result.rows) {
    if (EXCLUDED_STAGES.has(String(job.current_stage || "").trim().toLowerCase())) continue;

    const targetDate = cycleTargetDate(job);
    if (!targetDate) continue;

    const reminderDate = addDays(targetDate, -1);

    if (today >= reminderDate && today < targetDate && !job.cycle_24h_reminder_sent_at) {
      if (recipients === null) recipients = await activeUserEmails();
      if (recipients.length) {
        const emailResult = await sendTaskEmail({
          to: recipients.join(","),
          subject: `Delivery due tomorrow: RO ${job.ro_number || ""} - ${job.customer_name || ""}`,
          title: "Cycle Time: Delivery Due Tomorrow",
          bodyLines: jobLines(job, targetDate, "This vehicle needs to be delivered within 24 hours to hit its cycle time target."),
        });
        if (emailResult.sent) {
          await pool.query("UPDATE daily_go_list SET cycle_24h_reminder_sent_at = now() WHERE id = $1", [job.id]);
          sentReminders++;
        }
      }
      continue;
    }

    if (today > targetDate && !job.cycle_past_due_sent_at) {
      if (recipients === null) recipients = await activeUserEmails();
      if (recipients.length) {
        const emailResult = await sendTaskEmail({
          to: recipients.join(","),
          subject: `PAST DUE cycle time: RO ${job.ro_number || ""} - ${job.customer_name || ""}`,
          title: "Cycle Time: Past Due",
          bodyLines: jobLines(job, targetDate, "This vehicle has missed its cycle time target and has not been delivered."),
        });
        if (emailResult.sent) {
          await pool.query("UPDATE daily_go_list SET cycle_past_due_sent_at = now() WHERE id = $1", [job.id]);
          sentPastDue++;
        }
      }
    }
  }

  return { checked: true, sentReminders, sentPastDue };
}

let cycleAlertTimer = null;

function startCycleAlertScheduler() {
  const enabled = String(process.env.CYCLE_ALERT_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) {
    console.log("Cycle time alert scheduler disabled.");
    return;
  }

  const intervalMs = Number(process.env.CYCLE_ALERT_SCAN_MS || 900000);
  console.log(`Cycle time alert scheduler enabled. Interval: ${intervalMs}ms`);
  checkCycleTimeAlerts().catch(err => console.error("Initial cycle time alert check failed:", err));
  cycleAlertTimer = setInterval(() => {
    checkCycleTimeAlerts().catch(err => console.error("Cycle time alert check failed:", err));
  }, intervalMs);
}

function stopCycleAlertScheduler() {
  if (cycleAlertTimer) clearInterval(cycleAlertTimer);
  cycleAlertTimer = null;
}

module.exports = {
  checkCycleTimeAlerts,
  startCycleAlertScheduler,
  stopCycleAlertScheduler,
  cycleTierDays,
  cycleTierLabel,
  cycleTargetDate,
};
