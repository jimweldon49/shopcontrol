const { pool } = require("./db");
const { sendTaskEmail } = require("./mailer");
const { checkCaptureOpportunityAlerts } = require("./captureOpportunityAlerts");
const { cycleTier, cycleDays, isDrp } = require("../../client/shared");

// Cycle time emails (target = intake date + the RO amount's tier days, plus one day for
// non-DRP jobs; rules in client/shared.js):
//   - One email at 6:00 AM each weekday listing every car past due, due today and due
//     tomorrow. Sent once a day (cycle_digest_days).
//   - A car marked hot on the Tech Board is left out of that list and gets its own email
//     instead, as soon as it's due tomorrow and again when it goes past due (once each).
const EXCLUDED_STAGES = new Set(["delivered", "total loss"]);
const DIGEST_AT = { hour: 6, minute: 0 };
const DIGEST_WEEKDAYS = [1, 2, 3, 4, 5];
const TZ = () => process.env.BUSINESS_TIMEZONE || "America/Los_Angeles";

function cycleTierDays(amount, flags) {
  return cycleDays(amount, flags);
}

function cycleTierLabel(amount) {
  return cycleTier(amount)?.label || "";
}

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isDigestTime(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ(), weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return DIGEST_WEEKDAYS.includes(day) && Number(p.hour) * 60 + Number(p.minute) >= DIGEST_AT.hour * 60 + DIGEST_AT.minute;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cycleTargetDate(job) {
  const days = cycleDays(job.ro_amount, job.board_flags);
  if (days == null || !job.created_at) return null;
  const intakeDate = localDateString(new Date(job.created_at));
  return addDays(intakeDate, days);
}

// "pastDue" | "dueToday" | "dueTomorrow" | null
function cycleStatus(targetDate, today) {
  if (!targetDate) return null;
  if (today > targetDate) return "pastDue";
  if (today === targetDate) return "dueToday";
  if (today === addDays(targetDate, -1)) return "dueTomorrow";
  return null;
}

async function activeUserEmails() {
  const result = await pool.query(
    "SELECT email FROM users WHERE active = TRUE AND receives_notifications = TRUE AND email IS NOT NULL AND email <> ''"
  );
  return result.rows.map(r => r.email);
}

const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function jobLines(job, targetDate, prefix) {
  return [
    prefix,
    `RO: ${job.ro_number || ""}`,
    `Customer: ${job.customer_name || ""}`,
    `Vehicle: ${job.vehicle || ""}`,
    job.ro_amount != null ? `Amount: ${money(job.ro_amount)}` : "",
    `Cycle time tier: ${cycleTierLabel(job.ro_amount)} (${isDrp(job.board_flags) ? "DRP" : "non-DRP"}, ${cycleDays(job.ro_amount, job.board_flags)} days)`,
    `Cycle time target date: ${targetDate}`,
    `Current stage: ${job.current_stage || ""}`,
    job.location ? `Location: ${job.location}` : "",
  ].filter(Boolean);
}

// One line per car in the morning email.
function digestLine(c) {
  const vehicle = String(c.job.vehicle || "").split(" / ")[0];
  return `RO ${c.job.ro_number || ""} · ${c.job.customer_name || ""} · ${vehicle} · ${c.job.ro_amount != null ? money(c.job.ro_amount) : ""} ${isDrp(c.job.board_flags) ? "DRP" : "non-DRP"} · due ${c.target} · ${c.job.current_stage || ""}`;
}

async function loadCycleJobs() {
  const result = await pool.query(
    `SELECT d.*, coalesce(t.hot, false) AS tech_board_hot
     FROM daily_go_list d LEFT JOIN tech_board_jobs t ON t.job_id = d.id
     WHERE lower(coalesce(d.current_stage, '')) NOT IN ('delivered', 'total loss')
       AND d.ro_amount IS NOT NULL
       AND d.job_kind = 'active' AND d.merged_into IS NULL -- no RO yet: capture opportunity, not cycle time
     ORDER BY d.created_at ASC
     LIMIT 500`
  );
  return result.rows.filter(job => !EXCLUDED_STAGES.has(String(job.current_stage || "").trim().toLowerCase()));
}

// Hot cars: their own email, once when due tomorrow and once when past due.
async function sendHotCarEmails(cars, getRecipients) {
  let sentReminders = 0, sentPastDue = 0;
  for (const { job, target, status } of cars) {
    const kind = status === "pastDue" ? "pastDue" : status === "dueTomorrow" ? "dueTomorrow" : null;
    if (!kind) continue;
    if (kind === "dueTomorrow" && job.cycle_24h_reminder_sent_at) continue;
    if (kind === "pastDue" && job.cycle_past_due_sent_at) continue;
    const recipients = await getRecipients();
    if (!recipients.length) return { sentReminders, sentPastDue };
    const pastDue = kind === "pastDue";
    const emailResult = await sendTaskEmail({
      to: recipients.join(","),
      subject: `HOT · ${pastDue ? "PAST DUE cycle time" : "Delivery due tomorrow"}: RO ${job.ro_number || ""} - ${job.customer_name || ""}`,
      title: pastDue ? "Hot car: cycle time past due" : "Hot car: delivery due tomorrow",
      bodyLines: jobLines(job, target, pastDue
        ? "This hot car has missed its cycle time target and has not been delivered."
        : "This hot car needs to be delivered within 24 hours to hit its cycle time target."),
    });
    if (!emailResult.sent) continue;
    await pool.query(`UPDATE daily_go_list SET ${pastDue ? "cycle_past_due_sent_at" : "cycle_24h_reminder_sent_at"} = now() WHERE id = $1`, [job.id]);
    if (pastDue) sentPastDue++; else sentReminders++;
  }
  return { sentReminders, sentPastDue };
}

async function sendMorningDigest(cars, today, getRecipients) {
  const lists = {
    pastDue: cars.filter(c => c.status === "pastDue").sort((a, b) => a.target.localeCompare(b.target)),
    dueToday: cars.filter(c => c.status === "dueToday"),
    dueTomorrow: cars.filter(c => c.status === "dueTomorrow"),
  };
  const total = lists.pastDue.length + lists.dueToday.length + lists.dueTomorrow.length;
  // Claim the day first so a restart or a second server can't send it twice.
  const claimed = (await pool.query(
    "INSERT INTO cycle_digest_days(day, cars) VALUES($1, $2) ON CONFLICT DO NOTHING RETURNING day", [today, total])).rows.length;
  if (!claimed || !total) return 0;
  const recipients = await getRecipients();
  if (!recipients.length) return 0;
  const section = (title, list) => list.length ? [`${title} (${list.length})`, ...list.map(c => `   ${digestLine(c)}`), ""] : [];
  const counts = [
    lists.pastDue.length && `${lists.pastDue.length} past due`,
    lists.dueToday.length && `${lists.dueToday.length} due today`,
    lists.dueTomorrow.length && `${lists.dueTomorrow.length} due tomorrow`,
  ].filter(Boolean).join(", ");
  const result = await sendTaskEmail({
    to: recipients.join(","),
    subject: `Cycle time for ${today}: ${counts}`,
    title: "Cycle Time: Today's List",
    bodyLines: [
      "Cars that have missed or are about to hit their cycle time target. DRP jobs get the tier's days; all other jobs get one extra day. Hot cars on the Tech Board get their own emails and aren't listed here.",
      "",
      ...section("PAST DUE", lists.pastDue),
      ...section("DUE TODAY", lists.dueToday),
      ...section("DUE TOMORROW", lists.dueTomorrow),
      "Open ShopControl → Cycle Time to see each tier.",
    ],
  });
  return result.sent ? 1 : 0;
}

async function checkCycleTimeAlerts(now = new Date()) {
  const today = localDateString(now);
  const cars = (await loadCycleJobs()).map(job => {
    const target = cycleTargetDate(job);
    return { job, target, status: cycleStatus(target, today) };
  }).filter(c => c.status);

  let recipients = null;
  const getRecipients = async () => (recipients ??= await activeUserEmails());

  const hot = await sendHotCarEmails(cars.filter(c => c.job.tech_board_hot), getRecipients);
  let sentDigest = 0;
  if (isDigestTime(now)) {
    const alreadySent = (await pool.query("SELECT 1 FROM cycle_digest_days WHERE day = $1", [today])).rows.length;
    if (!alreadySent) sentDigest = await sendMorningDigest(cars.filter(c => !c.job.tech_board_hot), today, getRecipients);
  }
  return { checked: true, ...hot, sentDigest };
}

let cycleAlertTimer = null;

function startCycleAlertScheduler() {
  const enabled = String(process.env.CYCLE_ALERT_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) {
    console.log("Cycle time alert scheduler disabled.");
    return;
  }

  const intervalMs = Number(process.env.CYCLE_ALERT_SCAN_MS || 900000);
  console.log(`Cycle time and capture opportunity alerts enabled. Interval: ${intervalMs}ms; cycle time list weekdays at 6:00 AM.`);
  const run = () => {
    checkCycleTimeAlerts().catch(err => console.error("Cycle time alert check failed:", err));
    checkCaptureOpportunityAlerts().catch(err => console.error("Capture opportunity alert check failed:", err));
  };
  run();
  cycleAlertTimer = setInterval(run, intervalMs);
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
  cycleStatus,
  isDigestTime,
  localDateString,
  addDays,
};
