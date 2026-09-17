const { pool } = require("./db");
const { sendTaskEmail, smtpConfigured } = require("./mailer");
const { isBusinessHours } = require("./taskEmails");

const OPEN_STATUSES_EXCLUDED = ["Returned / resolved", "Closed — no callback needed"];

function linkFor(id) {
  const base = (process.env.PUBLIC_CLIENT_URL || "").replace(/\/$/, "");
  return base ? `Open in Shop Control: ${base}/#missedCalls:${id}` : `Missed call ID: ${id}`;
}

function formatWhen(date) {
  return new Date(date).toLocaleString("en-US", { timeZone: process.env.BUSINESS_TIMEZONE || "America/Los_Angeles" });
}

async function resolveAssignedOrEscalationRecipients(call) {
  if (call.assigned_to) {
    const r = await pool.query(
      `SELECT id, email, full_name FROM users WHERE id=$1 AND active=true AND receives_notifications=true AND email IS NOT NULL`,
      [call.assigned_to]
    );
    return r.rows;
  }
  const config = (await pool.query("SELECT data FROM board_settings WHERE id=1")).rows[0]?.data || {};
  const ids = config.missedCallEscalation || [];
  const r = await pool.query(
    `SELECT id, email, full_name FROM users WHERE active=true AND receives_notifications=true AND email IS NOT NULL AND
     (id::text=ANY($1::text[]) OR (cardinality($1::text[])=0 AND role IN ('owner','admin','office','parts')))`,
    [ids]
  );
  return r.rows;
}

async function deliverToRecipients(eventId, recipients, title, bodyLines) {
  let sentCount = 0;
  for (const user of recipients) {
    const notif = await pool.query(
      `INSERT INTO missed_call_notifications(event_id,user_id,title,message) VALUES($1,$2,$3,$4)
       ON CONFLICT(event_id,user_id) DO NOTHING RETURNING id`,
      [eventId, user.id, title, bodyLines.join("\n")]
    );
    if (!notif.rows[0]) continue;
    const notifId = notif.rows[0].id;
    await pool.query(
      "UPDATE missed_call_notifications SET email_attempts=email_attempts+1, email_attempted_at=now() WHERE id=$1",
      [notifId]
    );
    try {
      const result = await sendTaskEmail({ to: user.email, subject: title, title, bodyLines });
      if (result.sent) {
        await pool.query("UPDATE missed_call_notifications SET email_sent_at=now() WHERE id=$1", [notifId]);
        sentCount++;
      }
    } catch (err) {
      console.error("Missed call email failed:", err.message);
    }
  }
  await pool.query("UPDATE missed_call_events SET recipients_created=true WHERE id=$1", [eventId]);
  return sentCount;
}

// Immediate alert on create/reassign. Best-effort synchronous send; unsent rows are
// picked up by processMissedCallNotifications() so nothing is silently dropped.
async function sendMissedCallAlert(call, reason = "created") {
  const recipients = await resolveAssignedOrEscalationRecipients(call);
  if (!recipients.length) return { sent: 0, recipients: 0 };

  const eventResult = await pool.query(
    "INSERT INTO missed_call_events(missed_call_id, event_type) VALUES($1,$2) RETURNING id",
    [call.id, reason]
  );
  const eventId = eventResult.rows[0].id;
  const deadline = new Date(new Date(call.created_at).getTime() + 3600000);
  const title = reason === "reassigned"
    ? `Callback reassigned to you: ${call.caller_name}`
    : `New callback request: ${call.caller_name}`;
  const bodyLines = [
    `Caller: ${call.caller_name}`,
    `Callback number: ${call.callback_phone}`,
    `Reason: ${call.reason}`,
    `Priority: ${call.priority}`,
    `Assigned to: ${call.assigned_to ? recipients.map(r => r.full_name).join(", ") : "Unassigned / Needs routing"}`,
    `Callback deadline: ${formatWhen(deadline)}`,
    call.ro_number ? `RO: ${call.ro_number}` : "",
    `Message: ${call.message}`,
    linkFor(call.id),
  ].filter(Boolean);

  const sentCount = await deliverToRecipients(eventId, recipients, title, bodyLines);
  return { sent: sentCount, recipients: recipients.length };
}

async function sendEscalationAlert(call) {
  const config = (await pool.query("SELECT data FROM board_settings WHERE id=1")).rows[0]?.data || {};
  const ids = config.missedCallEscalation || [];
  if (!ids.length) {
    await pool.query("UPDATE missed_calls SET escalation_sent_at=now() WHERE id=$1", [call.id]);
    await pool.query(
      "INSERT INTO activity_log(resource,action,summary) VALUES('missed_calls','escalation_skipped',$1)",
      [`Overdue callback for ${call.caller_name} (${call.callback_phone}) could not be escalated: no Missed Call Escalation recipients configured in Settings.`]
    );
    return false;
  }

  const users = (await pool.query(
    `SELECT id, email, full_name FROM users WHERE active=true AND receives_notifications=true AND email IS NOT NULL AND id::text=ANY($1::text[])`,
    [ids]
  )).rows;

  const eventResult = await pool.query(
    "INSERT INTO missed_call_events(missed_call_id, event_type) VALUES($1,'escalation') RETURNING id",
    [call.id]
  );
  const eventId = eventResult.rows[0].id;
  const ageMinutes = Math.round((Date.now() - new Date(call.created_at).getTime()) / 60000);
  const title = `OVERDUE CALLBACK: ${call.caller_name}`;
  const bodyLines = [
    `Caller: ${call.caller_name}`,
    `Callback number: ${call.callback_phone}`,
    `Assigned to: ${call.assigned_to ? "See Missed Calls tab" : "Unassigned / Needs routing"}`,
    `Reason: ${call.reason}`,
    `Priority: ${call.priority}`,
    `Received: ${formatWhen(call.created_at)}`,
    `Outstanding for: ${ageMinutes} minutes with no logged callback attempt`,
    linkFor(call.id),
  ];

  const sentCount = await deliverToRecipients(eventId, users, title, bodyLines);
  await pool.query("UPDATE missed_calls SET escalation_sent_at=now() WHERE id=$1", [call.id]);
  return sentCount > 0;
}

// Retry scan for anything sendMissedCallAlert/sendEscalationAlert couldn't deliver inline.
async function processMissedCallNotifications() {
  if (!smtpConfigured()) return;
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(840220) AS locked")).rows[0].locked;
    if (!locked) return;

    const pending = (await db.query(
      `SELECT n.*, u.email FROM missed_call_notifications n JOIN users u ON u.id=n.user_id
       WHERE n.email_sent_at IS NULL AND n.email_attempts<10 AND u.active=true AND u.receives_notifications=true AND u.email IS NOT NULL
       AND (n.email_attempted_at IS NULL OR n.email_attempted_at<now()-interval '5 minutes')
       ORDER BY n.created_at LIMIT 50`
    )).rows;

    for (const n of pending) {
      await db.query(
        "UPDATE missed_call_notifications SET email_attempts=email_attempts+1, email_attempted_at=now() WHERE id=$1",
        [n.id]
      );
      try {
        const result = await sendTaskEmail({ to: n.email, subject: n.title, title: n.title, bodyLines: n.message.split("\n") });
        if (result.sent) await db.query("UPDATE missed_call_notifications SET email_sent_at=now() WHERE id=$1", [n.id]);
      } catch (err) {
        console.error("Missed call notification retry failed:", err.message);
      }
    }

    const failed = (await db.query(
      `SELECT n.id, n.title, u.full_name FROM missed_call_notifications n LEFT JOIN users u ON u.id=n.user_id
       WHERE n.email_sent_at IS NULL AND n.email_attempts>=10 AND n.admin_flagged=false`
    )).rows;
    for (const f of failed) {
      await db.query(
        "INSERT INTO activity_log(resource,action,summary) VALUES('missed_calls','email_failed',$1)",
        [`Persistent email failure delivering "${f.title}" to ${f.full_name || "an employee"} after 10 attempts.`]
      );
      await db.query("UPDATE missed_call_notifications SET admin_flagged=true WHERE id=$1", [f.id]);
    }
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock(840220)");
    db.release();
  }
}

// 1-hour-overdue scan. A callback_attempts row logged before the 1-hour mark satisfies
// the requirement with no email; otherwise the whole missedCallEscalation group is paged.
// escalation_sent_at is set exactly once per call and is never touched anywhere else, so
// reassignment/status/note edits never reset this timer.
async function checkMissedCallEscalation() {
  if (!isBusinessHours()) return { checked: false, reason: "outside_business_hours" };
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(840221) AS locked")).rows[0].locked;
    if (!locked) return { checked: false, reason: "locked" };

    const result = await db.query(
      `SELECT * FROM missed_calls
       WHERE escalation_sent_at IS NULL
         AND status NOT IN ('${OPEN_STATUSES_EXCLUDED.join("','")}')
         AND created_at <= now() - interval '1 hour'
       ORDER BY created_at ASC LIMIT 200`
    );

    let escalated = 0, satisfied = 0;
    for (const call of result.rows) {
      const attempt = await db.query(
        `SELECT 1 FROM callback_attempts WHERE missed_call_id=$1 AND attempted_at <= $2::timestamptz + interval '1 hour' LIMIT 1`,
        [call.id, call.created_at]
      );
      if (attempt.rows.length) {
        await db.query("UPDATE missed_calls SET escalation_sent_at=now() WHERE id=$1", [call.id]);
        satisfied++;
        continue;
      }
      if (await sendEscalationAlert(call)) escalated++;
    }
    return { checked: true, escalated, satisfied };
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock(840221)");
    db.release();
  }
}

let notifyTimer = null;
let escalationTimer = null;

function startMissedCallScheduler() {
  const enabled = String(process.env.MISSED_CALL_ALERTS_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) {
    console.log("Missed call alert scheduler disabled.");
    return;
  }
  const notifyMs = Number(process.env.MISSED_CALL_NOTIFY_SCAN_MS || 30000);
  const escalationMs = Number(process.env.MISSED_CALL_ESCALATION_SCAN_MS || 300000);
  console.log(`Missed call alert scheduler enabled. Notify interval: ${notifyMs}ms, escalation interval: ${escalationMs}ms`);
  processMissedCallNotifications().catch(err => console.error("Missed call notification scan failed:", err.message));
  checkMissedCallEscalation().catch(err => console.error("Missed call escalation check failed:", err.message));
  notifyTimer = setInterval(() => {
    processMissedCallNotifications().catch(err => console.error("Missed call notification scan failed:", err.message));
  }, notifyMs);
  escalationTimer = setInterval(() => {
    checkMissedCallEscalation().catch(err => console.error("Missed call escalation check failed:", err.message));
  }, escalationMs);
}

function stopMissedCallScheduler() {
  if (notifyTimer) clearInterval(notifyTimer);
  if (escalationTimer) clearInterval(escalationTimer);
  notifyTimer = null;
  escalationTimer = null;
}

module.exports = {
  sendMissedCallAlert,
  processMissedCallNotifications,
  checkMissedCallEscalation,
  startMissedCallScheduler,
  stopMissedCallScheduler,
};
