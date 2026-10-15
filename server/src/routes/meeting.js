const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const { isDrp, cycleDays } = require("../../../client/shared");
const { cycleTargetDate, cycleStatus, localDateString, addDays } = require("../cycleTimeAlerts");

// Morning meeting (migrations/036): anyone posts a topic during the day; office staff and
// managers open Morning Meeting, proofread, and print one sheet that pulls together the
// topics, time off, today's Meeting/Training calendar entries, teardowns, past-due cycle
// times (DRP and non-DRP), the out lists for today and the next work day, and parts issues.
const router = express.Router();
router.use(requireAuth);

// Review topics and build the notes (same roles that see everyone's time off).
const MEETING_ROLES = ["office", "manager", "admin", "owner"];
const canRun = (u) => MEETING_ROLES.includes(String((u && u.role) || "").toLowerCase());
const who = (req) => req.user.fullName || req.user.username;
const TOPIC_MAX = 500;
const MEETING_TYPES = ["Meeting", "Training"];
// "Teardowns needed": arrived (Check-In counts as on site) and not past Tear Down yet.
const TEARDOWN_STAGES = ["Check-In", "Tear Down"];
const LATE_DONE = ["Received", "Mirror Matched", "Complete", "Returned"];
const PROBLEM_STATUSES = ["Need to Order", "Backordered", "Wrong Part", "Return Needed", "Credit Pending"];

function fail(res, e) {
  if (!e.status) console.error("Morning meeting request:", e.message);
  return res.status(e.status || 400).json({ error: e.message });
}
const httpError = (status, message) => Object.assign(Error(message), { status });
const requireRunner = (req) => { if (!canRun(req.user)) throw httpError(403, "Only office staff and managers can do that."); };
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const cleanText = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX);
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10));
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const vehicleName = (v) => String(v || "").split(" / ")[0].trim();

function topicOut(t) {
  return { id: t.id, text: t.text, by: t.submitted_by_name, anonymous: t.anonymous === true, byId: t.submitted_by_id, status: t.status, coveredOn: t.covered_on ? day(t.covered_on) : null, createdAt: t.created_at, editedBy: t.edited_by || null };
}

// The next shop day after `date` (Friday -> Monday).
function nextWorkDay(date) {
  let d = addDays(date, 1);
  while ([0, 6].includes(dow(d))) d = addDays(d, 1);
  return d;
}

// -------------------------------------------------------------------- Topics

router.post("/topics", async (req, res) => {
  try {
    const text = cleanText(req.body && req.body.text);
    if (!text) throw httpError(400, "Write the topic first.");
    // Anonymous topics print as "Anonymous"; the office still sees who sent them.
    const anonymous = req.body.anonymous === true;
    const row = (await pool.query(
      "INSERT INTO meeting_topics(text, submitted_by_id, submitted_by_name, anonymous) VALUES($1, $2, $3, $4) RETURNING *",
      [text, req.user.id, who(req), anonymous])).rows[0];
    await logActivity({ req, resource: "meeting", recordId: row.id, action: "create", after: row, summary: `Added a morning meeting topic` });
    res.status(201).json(topicOut(row));
  } catch (e) { fail(res, e); }
});

// Your own topics from the last 30 days, so you can see whether yours was covered.
router.get("/topics/mine", async (req, res) => {
  try {
    const rows = (await pool.query(
      "SELECT * FROM meeting_topics WHERE submitted_by_id = $1 AND created_at > now() - interval '30 days' ORDER BY created_at DESC",
      [req.user.id])).rows;
    res.json(rows.map(topicOut));
  } catch (e) { fail(res, e); }
});

// Office: topics not yet covered, plus anything removed or covered in the last 2 weeks.
router.get("/topics", async (req, res) => {
  try {
    requireRunner(req);
    const rows = (await pool.query(
      `SELECT * FROM meeting_topics WHERE status = 'open' OR updated_at > now() - interval '14 days'
       ORDER BY (status = 'open') DESC, created_at ASC`)).rows;
    res.json(rows.map(topicOut));
  } catch (e) { fail(res, e); }
});

// Office: proofread (edit the wording), remove ('hidden'), or put back ('open').
router.put("/topics/:id", async (req, res) => {
  try {
    requireRunner(req);
    const before = (await pool.query("SELECT * FROM meeting_topics WHERE id = $1", [req.params.id])).rows[0];
    if (!before) throw httpError(404, "That topic is gone.");
    const body = req.body || {};
    const text = body.text === undefined ? before.text : cleanText(body.text);
    if (!text) throw httpError(400, "A topic can't be empty. Remove it instead.");
    const status = body.status === undefined ? before.status : body.status;
    const anonymous = typeof body.anonymous === "boolean" ? body.anonymous : before.anonymous;
    if (!["open", "hidden"].includes(status) && status !== before.status) throw httpError(400, "Unknown topic status.");
    const row = (await pool.query(
      `UPDATE meeting_topics SET text = $1, status = $2, covered_on = CASE WHEN $2 = 'open' THEN NULL ELSE covered_on END,
         edited_by = CASE WHEN $1 <> text THEN $3 ELSE edited_by END, anonymous = $5, updated_at = now()
       WHERE id = $4 RETURNING *`, [text, status, who(req), req.params.id, anonymous])).rows[0];
    await logActivity({ req, resource: "meeting", recordId: row.id, action: "update", before, after: row,
      summary: status === "hidden" && before.status !== "hidden" ? "Removed a morning meeting topic" : "Edited a morning meeting topic" });
    res.json(topicOut(row));
  } catch (e) { fail(res, e); }
});

// Office: after the meeting, the topics that were on the sheet are covered and drop off.
router.post("/covered", async (req, res) => {
  try {
    requireRunner(req);
    const date = req.body && req.body.date;
    const ids = Array.isArray(req.body && req.body.topicIds) ? req.body.topicIds.filter((x) => typeof x === "string") : [];
    if (!isDate(date)) throw httpError(400, "Pick the meeting date.");
    const rows = ids.length ? (await pool.query(
      "UPDATE meeting_topics SET status = 'covered', covered_on = $1, updated_at = now() WHERE id = ANY($2::uuid[]) AND status = 'open' RETURNING id",
      [date, ids])).rows : [];
    if (rows.length) await logActivity({ req, resource: "meeting", recordId: null, action: "update", summary: `Marked ${rows.length} morning meeting topic(s) covered for ${date}` });
    res.json({ covered: rows.length });
  } catch (e) { fail(res, e); }
});

// -------------------------------------------------------------------- Notes

// Parts problems per job, using the same rules as Parts → Parts Problems: late against the
// ETA, need to order / backordered / wrong / returns / credits, or received but not mirror
// matched (only once the car is on site).
async function partsIssuesByJob(jobs, date) {
  const keyToJob = new Map();
  for (const j of jobs) {
    for (const k of [j.ro_number, j.ccc_estfile_id]) if (k && String(k).trim()) keyToJob.set(String(k).trim(), j);
  }
  const counts = new Map();
  if (!keyToJob.size) return counts;
  const parts = (await pool.query(
    "SELECT parts_ro_number, part_status, part_eta, part_mirror_matched FROM parts WHERE btrim(parts_ro_number) = ANY($1) AND coalesce(part_status, '') <> 'Complete'",
    [[...keyToJob.keys()]])).rows;
  for (const p of parts) {
    const job = keyToJob.get(String(p.parts_ro_number).trim());
    const status = p.part_status || "";
    const late = p.part_eta && day(p.part_eta) < date && !LATE_DONE.includes(status);
    const mirror = status === "Received" && p.part_mirror_matched !== "Yes" && onSite(job);
    if (late || PROBLEM_STATUSES.includes(status) || mirror) counts.set(job.id, (counts.get(job.id) || 0) + 1);
  }
  return counts;
}

const onSite = (j) => (j.onsite === true || j.current_stage === "Check-In") && j.current_stage !== "On the Road" && j.current_stage !== "Scheduled";

// "Luis Soto – Vacation, out through Fri 10/23" or "Mickey – Vacation, Mon 10/19 – Fri 10/23".
// The request's notes aren't printed (they can be private); the manager adds detail by hand.
function absenceLine(r, date) {
  const fmt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" }).replace(",", "");
  const start = day(r.start_date), end = day(r.end_date);
  const kind = r.request_type === "Other" ? (r.other_reason || "Out") : r.request_type;
  const time = r.partial_day && r.start_time ? ` ${clock(r.start_time)}–${clock(r.end_time)}` : "";
  const outNow = start <= date;
  const when = outNow ? (end === date ? `out today${time}` : `out through ${fmt(end)}`) : (start === end ? `${fmt(start)}${time}` : `${fmt(start)} – ${fmt(end)}`);
  return { name: r.full_name, text: `${r.full_name} – ${kind}, ${when}`, outNow };
}

function clock(t) {
  const [h, m] = String(t || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

async function buildNotes(date) {
  const nextDay = nextWorkDay(date);
  const [topics, absences, meetings, jobs] = await Promise.all([
    pool.query("SELECT * FROM meeting_topics WHERE status = 'open' OR (status = 'covered' AND covered_on = $1) ORDER BY created_at ASC", [date]).then((r) => r.rows),
    pool.query(
      `SELECT * FROM time_off_requests WHERE status = 'Approved' AND end_date >= $1 AND start_date <= $2::date + 13
       ORDER BY start_date, full_name`, [date, date]).then((r) => r.rows),
    pool.query(
      "SELECT * FROM appointments WHERE appointment_date = $1 AND appointment_type = ANY($2) ORDER BY appointment_time",
      [date, MEETING_TYPES]).then((r) => r.rows),
    pool.query(
      `SELECT * FROM daily_go_list
       WHERE merged_into IS NULL AND job_kind = 'active'
         AND lower(coalesce(current_stage, '')) NOT IN ('delivered', 'total loss', 'no show')
       ORDER BY ro_number`).then((r) => r.rows),
  ]);

  const teardowns = jobs.filter((j) => TEARDOWN_STAGES.includes(j.current_stage) && onSite(j));
  const pastDue = jobs.filter((j) => j.ro_amount != null && cycleStatus(cycleTargetDate(j), date) === "pastDue")
    .sort((a, b) => cycleTargetDate(a).localeCompare(cycleTargetDate(b)));
  const outToday = jobs.filter((j) => j.target_delivery_date && day(j.target_delivery_date) === date);
  const outNext = jobs.filter((j) => j.target_delivery_date && day(j.target_delivery_date) === nextDay);
  const issues = await partsIssuesByJob([...new Set([...teardowns, ...pastDue, ...outToday, ...outNext])], date);

  const car = (j) => ({
    id: j.id, ro: j.ro_number, vehicle: vehicleName(j.vehicle), customer: j.customer_name || "",
    stage: j.current_stage || "", insurance: j.insurance || "", amount: j.ro_amount == null ? null : Number(j.ro_amount),
    drp: isDrp(j.board_flags), partsIssues: issues.get(j.id) || 0, target: cycleTargetDate(j), cycleDays: cycleDays(j.ro_amount, j.board_flags),
  });
  const total = (list) => list.reduce((s, j) => s + Number(j.ro_amount || 0), 0);
  const absenceLines = absences.map((r) => absenceLine(r, date));

  return {
    date, nextDay,
    housekeeping: topics.map(topicOut),
    absences: { now: absenceLines.filter((a) => a.outNow), upcoming: absenceLines.filter((a) => !a.outNow) },
    meetings: meetings.map((m) => ({ id: m.id, time: clock(m.appointment_time), title: m.title, type: m.appointment_type, location: m.location || "", duration: m.duration })),
    teardowns: teardowns.map(car),
    drpPastDue: pastDue.filter((j) => isDrp(j.board_flags)).map(car),
    nonDrpPastDue: pastDue.filter((j) => !isDrp(j.board_flags)).map(car),
    outToday: { cars: outToday.map(car), total: total(outToday) },
    outNext: { cars: outNext.map(car), total: total(outNext) },
  };
}

// -------------------------------------------------------------------- Publishing
// Nothing reaches the employee app until someone in the office publishes the day's sheet,
// exactly as they edited it. Dollar amounts and totals are taken out first.
const MAX_SECTIONS = 40, MAX_LINES = 300, LINE_MAX = 600;
const stripMoney = (t) => t.replace(/\s*[–-]\s*\$[\d,]+(?:\.\d{1,2})?/g, "").replace(/\$[\d,]+(?:\.\d{1,2})?/g, "").replace(/\s{2,}/g, " ").trim();
function cleanSheet(sections) {
  if (!Array.isArray(sections) || !sections.length) throw httpError(400, "The sheet is empty.");
  let lines = 0;
  return sections.slice(0, MAX_SECTIONS).map((sec) => {
    const title = String((sec && sec.title) || "").trim().slice(0, 120);
    const items = (Array.isArray(sec && sec.lines) ? sec.lines : [])
      .map((l) => stripMoney(String(l || "").replace(/\s+/g, " ").trim().slice(0, LINE_MAX)))
      .filter((l) => l && !/^total\b/i.test(l));
    lines += items.length;
    if (lines > MAX_LINES) throw httpError(400, "The sheet is too long to publish.");
    return { title, level: sec && sec.level === 3 ? 3 : 2, lines: items };
  }).filter((sec) => sec.title || sec.lines.length);
}

router.post("/publish", async (req, res) => {
  try {
    requireRunner(req);
    const date = req.body && req.body.date;
    if (!isDate(date)) throw httpError(400, "Pick the meeting date.");
    const sections = cleanSheet(req.body.sections);
    const row = (await pool.query(
      `INSERT INTO meeting_published(day, sections, published_by) VALUES($1, $2, $3)
       ON CONFLICT (day) DO UPDATE SET sections = EXCLUDED.sections, published_by = EXCLUDED.published_by, published_at = now()
       RETURNING *`, [date, JSON.stringify(sections), who(req)])).rows[0];
    await logActivity({ req, resource: "meeting", recordId: null, action: "update", summary: `Published the morning meeting notes for ${date} to the employee app` });
    res.json(publishedOut(row));
  } catch (e) { fail(res, e); }
});

router.delete("/publish/:date", async (req, res) => {
  try {
    requireRunner(req);
    if (!isDate(req.params.date)) throw httpError(400, "Pick the meeting date.");
    const r = await pool.query("DELETE FROM meeting_published WHERE day = $1 RETURNING day", [req.params.date]);
    if (r.rows.length) await logActivity({ req, resource: "meeting", recordId: null, action: "delete", summary: `Took the morning meeting notes for ${req.params.date} off the employee app` });
    res.json({ removed: r.rows.length });
  } catch (e) { fail(res, e); }
});

const publishedOut = (r) => (r ? { date: day(r.day), sections: r.sections, publishedBy: r.published_by, publishedAt: r.published_at } : null);

// Anyone: the published sheet for a day (today by default).
router.get("/published", async (req, res) => {
  try {
    const date = req.query.date || localDateString();
    if (!isDate(date)) throw httpError(400, "Pick a date.");
    res.json(publishedOut((await pool.query("SELECT * FROM meeting_published WHERE day = $1", [date])).rows[0]));
  } catch (e) { fail(res, e); }
});

router.get("/notes", async (req, res) => {
  try {
    requireRunner(req);
    const date = req.query.date || localDateString();
    if (!isDate(date)) throw httpError(400, "Pick a date.");
    res.json(await buildNotes(date));
  } catch (e) { fail(res, e); }
});

module.exports = router;
module.exports.buildNotes = buildNotes;
module.exports.nextWorkDay = nextWorkDay;
module.exports.cleanSheet = cleanSheet;
