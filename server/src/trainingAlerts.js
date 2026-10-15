const { pool } = require("./db");
const { sendTaskEmail, smtpConfigured } = require("./mailer");
const { trainingStatus, loadCourses } = require("./routes/training");
const { localDateString, addDays } = require("./cycleTimeAlerts");

// Every Monday from 7:00 AM (shop time), once a week: anyone behind pace on this year's
// training, or with a course past its due date, gets an email listing what's left; managers
// get one summary of everyone who's behind. Pace rules: routes/training.js trainingStatus.
const SEND_AT = { day: 1, hour: 7 };
const MANAGER_ROLES = ["manager", "admin", "owner"];
const TZ = () => process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";

function shopNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ(), weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: Number(p.hour) };
}
const isSendTime = (now) => { const c = shopNow(now); return c.day === SEND_AT.day && c.hour >= SEND_AT.hour; };
const fmt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

function courseLine(c, today) {
  const due = day(c.due_date);
  const late = due < today ? " – OVERDUE" : "";
  const sched = c.scheduled_date ? ` · scheduled ${fmt(day(c.scheduled_date))}` : " · not scheduled yet";
  return `${c.provider ? `${c.provider}: ` : ""}${c.course} – due ${fmt(due)}${late}${sched}`;
}

function summaryLine(s) {
  if (s.overdue) return `${s.overdue} course${s.overdue === 1 ? "" : "s"} past due; ${s.done} of ${s.total} done this year`;
  return `${s.done} of ${s.total} done this year; should be about ${s.expected} by now`;
}

async function checkTrainingAlerts(now = new Date()) {
  if (!isSendTime(now) || !smtpConfigured()) return { sent: 0 };
  const today = localDateString(now);
  const weekStart = addDays(today, -((shopNow(now).day + 6) % 7));
  if ((await pool.query("SELECT 1 FROM training_alert_weeks WHERE week_start = $1", [weekStart])).rows.length) return { sent: 0 };

  const rows = await loadCourses("WHERE u.active = true");
  const people = new Map();
  for (const r of rows) {
    if (!people.has(r.user_id)) people.set(r.user_id, { userId: r.user_id, name: r.full_name, courses: [] });
    people.get(r.user_id).courses.push(r);
  }
  const behind = [...people.values()]
    .map((p) => ({ ...p, s: trainingStatus(p.courses, today) }))
    .filter((p) => p.s.status === "overdue" || p.s.status === "behind");

  // Claim the week first so a restart or a second server can't send it twice.
  const claimed = (await pool.query(
    "INSERT INTO training_alert_weeks(week_start, people) VALUES($1, $2) ON CONFLICT DO NOTHING RETURNING week_start", [weekStart, behind.length])).rows.length;
  if (!claimed || !behind.length) return { sent: 0 };

  const users = (await pool.query(
    "SELECT id, email, role FROM users WHERE active = true AND receives_notifications = true AND email IS NOT NULL AND email <> ''")).rows;
  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  let sent = 0;
  for (const p of behind) {
    const to = emailOf.get(p.userId);
    if (!to) continue;
    const left = p.courses.filter((c) => !c.completed_on).sort((a, b) => day(a.due_date).localeCompare(day(b.due_date)));
    try {
      const r = await sendTaskEmail({
        to, subject: `Training: you're falling behind (${summaryLine(p.s)})`, title: "You're falling behind on training",
        bodyLines: [
          `Hi ${p.name.split(" ")[0]}, you've finished ${p.s.done} of your ${p.s.total} training courses for this year. To finish without a rush at the end of the year you should have about ${p.s.expected} done by now.`,
          "",
          "Still to do:",
          ...left.map((c) => `   ${courseLine(c, today)}`),
          "",
          "Talk to the office to get the next one scheduled. You can see your list in the employee app under Staff Hub → My training.",
        ],
      });
      if (r.sent) sent++;
    } catch (e) { console.error("Training reminder failed:", e.message); }
  }

  const managers = users.filter((u) => MANAGER_ROLES.includes(String(u.role || "").toLowerCase())).map((u) => u.email);
  if (managers.length) {
    try {
      const r = await sendTaskEmail({
        to: managers.join(","), subject: `Training: ${behind.length} ${behind.length === 1 ? "person is" : "people are"} behind`,
        title: "Staff behind on training",
        bodyLines: [
          "Each of these people got their own reminder this morning.",
          "",
          ...behind.flatMap((p) => [`${p.name} – ${summaryLine(p.s)}`, ...p.courses.filter((c) => !c.completed_on && day(c.due_date) < today).map((c) => `   ${courseLine(c, today)}`)]),
          "",
          "Open ShopControl → Training to schedule courses.",
        ],
      });
      if (r.sent) sent++;
    } catch (e) { console.error("Training summary failed:", e.message); }
  }
  console.log(`Training: ${behind.length} behind, sent ${sent} email(s).`);
  return { sent, behind: behind.length };
}

function startTrainingAlerts() {
  if (String(process.env.TRAINING_ALERTS_ENABLED || "true").toLowerCase() === "false") {
    console.log("Training reminders disabled.");
    return;
  }
  const run = () => checkTrainingAlerts().catch((e) => console.error("Training reminder check failed:", e.message));
  setInterval(run, 15 * 60 * 1000);
  setTimeout(run, 45 * 1000);
  console.log("Training reminders enabled: Mondays at 7:00 AM.");
}

module.exports = { startTrainingAlerts, checkTrainingAlerts, isSendTime, courseLine };
