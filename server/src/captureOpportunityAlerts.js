const { pool } = require("./db");
const { sendTaskEmail } = require("./mailer");
const { isBusinessHours } = require("./taskEmails");

// Capture opportunities are jobs without a five-digit RO. Office staff get at most
// MAX_ALERTS reminders to call the customer, ALERT_GAP_DAYS apart, counted from the
// job's creation or the last reminder, whichever is later; a logged call pushes the
// next reminder ALERT_GAP_DAYS past the call. After the last reminder they stop for good.
// "Customer declined" also stops them. Each reminder is its own email.
const MAX_ALERTS = 3;
const ALERT_GAP_DAYS = 2;
const CLOSED_STAGES = ["No Show", "Delivered", "Total Loss"];
const CALL_OUTCOMES = ["Reached customer", "Left voicemail", "No answer", "Customer scheduled", "Customer declined"];
const OFFICE_ROLES = ["owner", "admin", "manager", "office"];

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", { timeZone: process.env.BUSINESS_TIMEZONE || "America/Los_Angeles" });
}

async function dueOpportunities() {
  return (await pool.query(
    `SELECT d.id, d.ro_number, d.customer_name, d.vehicle, d.ro_amount, d.estimator, d.created_at,
            coalesce(s.alerts_sent, 0) AS alerts_sent, c.called_at AS last_call_at, c.called_by AS last_call_by,
            c.outcome AS last_call_outcome
     FROM daily_go_list d
     LEFT JOIN capture_alert_state s ON s.job_id = d.id
     LEFT JOIN LATERAL (SELECT called_at, called_by, outcome FROM capture_calls WHERE job_id = d.id ORDER BY called_at DESC LIMIT 1) c ON true
     WHERE d.job_kind = 'opportunity' AND d.merged_into IS NULL AND NOT (d.current_stage = ANY($1))
       AND coalesce(s.alerts_sent, 0) < $2
       AND NOT EXISTS (SELECT 1 FROM capture_calls x WHERE x.job_id = d.id AND x.outcome = 'Customer declined')
       AND greatest(coalesce(s.last_alert_at, d.created_at), coalesce(c.called_at, d.created_at)) <= now() - make_interval(days => $3)
     ORDER BY d.created_at ASC
     LIMIT 200`,
    [CLOSED_STAGES, MAX_ALERTS, ALERT_GAP_DAYS]
  )).rows;
}

async function officeEmails() {
  return (await pool.query(
    `SELECT email FROM users WHERE active = TRUE AND receives_notifications = TRUE AND email IS NOT NULL AND email <> ''
     AND role = ANY($1)`,
    [OFFICE_ROLES]
  )).rows.map(r => r.email);
}

function opportunitySubject(job) {
  const n = Number(job.alerts_sent) + 1;
  return `CAPTURE OPPORTUNITY (call ${n} of ${MAX_ALERTS}${n === MAX_ALERTS ? ", last" : ""}): ${job.customer_name || "Unknown customer"} - ${job.vehicle || "vehicle not set"}`;
}

function opportunityLines(job) {
  const n = Number(job.alerts_sent) + 1;
  const base = (process.env.PUBLIC_CLIENT_URL || "").replace(/\/$/, "");
  return [
    "This estimate doesn't have an RO yet. Call the customer, then log the call under Opportunities.",
    `Customer: ${job.customer_name || ""}`,
    `Vehicle: ${job.vehicle || ""}`,
    `File: ${job.ro_number || "no number"}`,
    job.ro_amount != null ? `Estimate: $${Number(job.ro_amount).toFixed(2)}` : "",
    job.estimator ? `Estimator: ${job.estimator}` : "",
    `Estimate written: ${formatDate(job.created_at)}`,
    job.last_call_at ? `Last call: ${formatDate(job.last_call_at)} by ${job.last_call_by} (${job.last_call_outcome})` : "No calls logged yet",
    n === MAX_ALERTS
      ? "This is the last reminder for this customer."
      : `Reminder ${n} of ${MAX_ALERTS}. Logging a call pushes the next reminder ${ALERT_GAP_DAYS} days out.`,
    base ? `Open Opportunities: ${base}/` : "",
  ].filter(Boolean);
}

// One email per opportunity; a reminder only counts once its email has gone out.
async function checkCaptureOpportunityAlerts() {
  if (!isBusinessHours()) return { checked: false, reason: "outside_business_hours" };
  const due = await dueOpportunities();
  if (!due.length) return { checked: true, sent: 0 };
  const recipients = await officeEmails();
  if (!recipients.length) return { checked: true, sent: 0, reason: "no_recipients" };

  let sent = 0;
  for (const job of due) {
    const result = await sendTaskEmail({
      to: recipients.join(","),
      subject: opportunitySubject(job),
      title: "Capture Opportunity: Call This Customer",
      bodyLines: opportunityLines(job),
    });
    if (!result.sent) continue;
    await pool.query(
      `INSERT INTO capture_alert_state(job_id, alerts_sent, last_alert_at) VALUES($1, 1, now())
       ON CONFLICT (job_id) DO UPDATE SET alerts_sent = capture_alert_state.alerts_sent + 1, last_alert_at = now()`,
      [job.id]
    );
    sent++;
  }
  return { checked: true, sent };
}

module.exports = { checkCaptureOpportunityAlerts, CALL_OUTCOMES, MAX_ALERTS, ALERT_GAP_DAYS };
