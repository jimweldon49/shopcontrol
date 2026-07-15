const { pool } = require("./db");
const { sendTaskEmail } = require("./mailer");

const COMPLETE_STATUSES = new Set(["completed", "complete", "done", "cancelled", "canceled"]);

function isTaskComplete(task) {
  const status = String(task.task_status || "").trim().toLowerCase();
  return COMPLETE_STATUSES.has(status) || !!task.completed_date;
}

function businessNowParts(date = new Date()) {
  const timeZone = process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find(p => p.type === type)?.value;
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { weekday, hour, minute, timeZone };
}

function isBusinessHours(date = new Date()) {
  const { weekday, hour } = businessNowParts(date);
  const openHour = Number(process.env.BUSINESS_START_HOUR || 8);
  const closeHour = Number(process.env.BUSINESS_END_HOUR || 17);
  if (["Sat", "Sun"].includes(weekday)) return false;
  return hour >= openHour && hour < closeHour;
}

async function findUserForTask(task) {
  const assigned = String(task.task_assigned_to || "").trim();
  if (!assigned) return null;

  const result = await pool.query(
    `SELECT id, username, full_name, email
     FROM users
     WHERE active = TRUE
       AND email IS NOT NULL
       AND (
         lower(full_name) = lower($1)
         OR lower(username) = lower($1)
         OR lower(email) = lower($1)
         OR lower(split_part(full_name, ' ', 1)) = lower($1)
       )
     ORDER BY
       CASE
         WHEN lower(full_name) = lower($1) THEN 1
         WHEN lower(username) = lower($1) THEN 2
         WHEN lower(email) = lower($1) THEN 3
         ELSE 4
       END
     LIMIT 1`,
    [assigned]
  );
  return result.rows[0] || null;
}

function taskLines(task, prefix) {
  return [
    prefix,
    `Task: ${task.task_name || ""}`,
    `Assigned to: ${task.task_assigned_to || ""}`,
    task.task_assigned_by ? `Assigned by: ${task.task_assigned_by}` : "",
    task.task_due_date ? `Due date: ${task.task_due_date}` : "",
    task.task_priority ? `Priority: ${task.task_priority}` : "",
    task.task_waiting_on ? `Waiting on: ${task.task_waiting_on}` : "",
    task.task_notes ? `Notes: ${task.task_notes}` : "",
  ].filter(Boolean);
}

async function sendAssignmentEmail(task, reason = "assigned") {
  if (!task || isTaskComplete(task)) return { sent: false, reason: "complete_or_missing" };

  const user = await findUserForTask(task);
  if (!user || !user.email) return { sent: false, reason: "no_matching_user_email" };

  const subject = reason === "reassigned"
    ? `Updated task assigned to you: ${task.task_name || "Concept task"}`
    : `New task assigned to you: ${task.task_name || "Concept task"}`;

  const result = await sendTaskEmail({
    to: user.email,
    subject,
    title: reason === "reassigned" ? "Updated Task Assignment" : "New Task Assignment",
    bodyLines: taskLines(task, "A task has been assigned to you in Concept Shop Control."),
  });

  if (result.sent) {
    await pool.query(
      "UPDATE tasks SET task_assigned_email_sent_at = now() WHERE id = $1",
      [task.id]
    );
  }

  return result;
}

async function sendReminderEmail(task, level) {
  if (!task || isTaskComplete(task)) return { sent: false, reason: "complete_or_missing" };
  if (!isBusinessHours()) return { sent: false, reason: "outside_business_hours" };

  const user = await findUserForTask(task);
  if (!user || !user.email) return { sent: false, reason: "no_matching_user_email" };

  const urgent = level === "3h";
  const cc = urgent ? (process.env.TASK_URGENT_CC || process.env.OWNER_EMAIL || "") : "";
  const subject = urgent
    ? `URGENT task reminder: ${task.task_name || "Concept task"}`
    : `Task reminder: ${task.task_name || "Concept task"}`;

  const result = await sendTaskEmail({
    to: user.email,
    cc,
    subject,
    title: urgent ? "Urgent Task Reminder" : "Task Reminder",
    bodyLines: taskLines(task, urgent
      ? "This task has been open for 3 hours or more during shop hours and needs attention."
      : "This task has been open for at least 1 hour and is not completed yet."),
  });

  if (result.sent) {
    const col = urgent ? "task_reminder_3h_sent_at" : "task_reminder_1h_sent_at";
    await pool.query(`UPDATE tasks SET ${col} = now() WHERE id = $1`, [task.id]);
  }

  return result;
}

async function checkTaskReminders() {
  if (!isBusinessHours()) return { checked: false, reason: "outside_business_hours" };

  const result = await pool.query(
    `SELECT *
     FROM tasks
     WHERE (completed_date IS NULL)
       AND lower(coalesce(task_status, '')) NOT IN ('completed', 'complete', 'done', 'cancelled', 'canceled')
       AND task_assigned_to IS NOT NULL
       AND task_assigned_to <> ''
       AND created_at <= now() - interval '1 hour'
     ORDER BY created_at ASC
     LIMIT 200`
  );

  let sent1h = 0;
  let sent3h = 0;

  for (const task of result.rows) {
    const ageMs = Date.now() - new Date(task.created_at).getTime();
    const hours = ageMs / 36e5;

    if (hours >= 3 && !task.task_reminder_3h_sent_at) {
      const sent = await sendReminderEmail(task, "3h");
      if (sent.sent) sent3h++;
      continue;
    }

    if (hours >= 1 && !task.task_reminder_1h_sent_at) {
      const sent = await sendReminderEmail(task, "1h");
      if (sent.sent) sent1h++;
    }
  }

  return { checked: true, sent1h, sent3h };
}

let taskReminderTimer = null;

function startTaskReminderScheduler() {
  const enabled = String(process.env.TASK_EMAIL_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) {
    console.log("Task email/reminder scheduler disabled.");
    return;
  }

  const intervalMs = Number(process.env.TASK_REMINDER_SCAN_MS || 600000);
  console.log(`Task email/reminder scheduler enabled. Interval: ${intervalMs}ms`);
  checkTaskReminders().catch(err => console.error("Initial task reminder check failed:", err));
  taskReminderTimer = setInterval(() => {
    checkTaskReminders().catch(err => console.error("Task reminder check failed:", err));
  }, intervalMs);
}

function stopTaskReminderScheduler() {
  if (taskReminderTimer) clearInterval(taskReminderTimer);
  taskReminderTimer = null;
}

module.exports = {
  sendAssignmentEmail,
  sendReminderEmail,
  checkTaskReminders,
  startTaskReminderScheduler,
  stopTaskReminderScheduler,
  isBusinessHours,
};
