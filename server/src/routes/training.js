const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const { localDateString } = require("../cycleTimeAlerts");

// Staff training (migrations/037). Office staff and managers keep each person's courses for
// the year; scheduling one adds a Training appointment to the calendar (and so to the
// morning meeting sheet and Google Calendar). Everyone sees their own list in the app.
const router = express.Router();
router.use(requireAuth);

const MANAGE_ROLES = ["office", "manager", "admin", "owner"];
const canManage = (u) => MANAGE_ROLES.includes(String((u && u.role) || "").toLowerCase());
const who = (req) => req.user.fullName || req.user.username;
const httpError = (status, message) => Object.assign(Error(message), { status });
function fail(res, e) {
  if (!e.status) console.error("Training request:", e.message);
  return res.status(e.status || 400).json({ error: e.message });
}
const requireManager = (req) => { if (!canManage(req.user)) throw httpError(403, "Only office staff and managers can change training."); };
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

// ------------------------------------------------------------------ Pace
// Where a person stands for the year. Courses due this year should be finished at an even
// pace: by today, about (share of the year gone) x (courses due this year). Anything past
// its own due date is overdue.
function yearShare(today) {
  const y = Number(today.slice(0, 4));
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1), now = Date.parse(`${today}T00:00:00Z`);
  return (now - start) / (end - start);
}
function trainingStatus(courses, today) {
  const year = today.slice(0, 4);
  const thisYear = courses.filter((c) => day(c.due_date).slice(0, 4) === year);
  const done = thisYear.filter((c) => c.completed_on).length;
  const expected = Math.floor(thisYear.length * yearShare(today));
  const overdue = courses.filter((c) => !c.completed_on && day(c.due_date) < today);
  const status = overdue.length ? "overdue" : done < expected ? "behind" : thisYear.length && done === thisYear.length ? "done" : "on track";
  return { status, total: thisYear.length, done, expected, behindBy: Math.max(0, expected - done), overdue: overdue.length };
}

function courseOut(c) {
  return {
    id: c.id, userId: c.user_id, name: c.full_name, course: c.course, provider: c.provider,
    dueDate: day(c.due_date), scheduledDate: day(c.scheduled_date), scheduledTime: c.scheduled_time ? String(c.scheduled_time).slice(0, 5) : null,
    duration: c.duration, location: c.location || "", completedOn: day(c.completed_on), notes: c.notes || "", appointmentId: c.appointment_id,
  };
}

async function loadCourses(where = "", args = []) {
  return (await pool.query(
    `SELECT t.*, u.full_name FROM training_courses t JOIN users u ON u.id = t.user_id ${where} ORDER BY u.full_name, t.due_date, t.course`, args)).rows;
}

// ------------------------------------------------------------------ Calendar
const apptTitle = (c, name) => `${name} – ${c.provider ? `${c.provider}: ` : ""}${c.course}`;

// Keep the course's Training appointment in step with its scheduled date: create, move, or
// remove it. Runs inside the caller's transaction.
async function syncAppointment(db, course, name, by) {
  if (!course.scheduled_date) {
    if (course.appointment_id) await db.query("DELETE FROM appointments WHERE id = $1", [course.appointment_id]);
    return null;
  }
  const values = [apptTitle(course, name), day(course.scheduled_date), course.scheduled_time || "08:00", course.duration || 240, course.location || course.provider || "Training", course.notes || null, by];
  if (course.appointment_id) {
    const r = await db.query(
      `UPDATE appointments SET title=$1, appointment_type='Training', appointment_date=$2, appointment_time=$3, duration=$4, location=$5, notes=$6, updated_by=$7, updated_at=now()
       WHERE id=$8 RETURNING id`, [...values, course.appointment_id]);
    if (r.rows.length) return course.appointment_id;
  }
  return (await db.query(
    `INSERT INTO appointments(title, appointment_type, appointment_date, appointment_time, duration, location, notes, created_by, updated_by)
     VALUES($1, 'Training', $2, $3, $4, $5, $6, $7, $7) RETURNING id`, values)).rows[0].id;
}

function readCourse(body, existing = {}) {
  const b = body || {};
  const pick = (k, fallback) => (b[k] === undefined ? fallback : b[k]);
  const c = {
    course: clean(pick("course", existing.course), 200),
    provider: clean(pick("provider", existing.provider ?? "I-CAR"), 60),
    due_date: pick("due_date", day(existing.due_date)),
    scheduled_date: pick("scheduled_date", day(existing.scheduled_date)) || null,
    scheduled_time: pick("scheduled_time", existing.scheduled_time ? String(existing.scheduled_time).slice(0, 5) : null) || null,
    duration: Number(pick("duration", existing.duration ?? 240)),
    location: clean(pick("location", existing.location), 200) || null,
    completed_on: pick("completed_on", day(existing.completed_on)) || null,
    notes: clean(pick("notes", existing.notes), 2000) || null,
    appointment_id: existing.appointment_id || null,
  };
  if (!c.course) throw httpError(400, "Name the course.");
  if (!isDate(c.due_date)) throw httpError(400, "Pick the date it has to be done by.");
  if (c.scheduled_date && !isDate(c.scheduled_date)) throw httpError(400, "That scheduled date isn't valid.");
  if (c.scheduled_time && !isTime(c.scheduled_time)) throw httpError(400, "That start time isn't valid.");
  if (c.completed_on && !isDate(c.completed_on)) throw httpError(400, "That completed date isn't valid.");
  if (!Number.isInteger(c.duration) || c.duration < 15 || c.duration > 1440) throw httpError(400, "Length must be between 15 minutes and 24 hours.");
  return c;
}

// ------------------------------------------------------------------ Routes

// Office: everyone's courses, and where each person stands for the year.
router.get("/", async (req, res) => {
  try {
    requireManager(req);
    const today = localDateString();
    const rows = await loadCourses();
    const people = new Map();
    for (const r of rows) {
      if (!people.has(r.user_id)) people.set(r.user_id, { userId: r.user_id, name: r.full_name, courses: [] });
      people.get(r.user_id).courses.push(r);
    }
    res.json({
      today,
      people: [...people.values()].map((p) => ({ userId: p.userId, name: p.name, ...trainingStatus(p.courses, today), courses: p.courses.map(courseOut) })),
    });
  } catch (e) { fail(res, e); }
});

// Anyone: their own courses.
router.get("/mine", async (req, res) => {
  try {
    const today = localDateString();
    const rows = await loadCourses("WHERE t.user_id = $1", [req.user.id]);
    res.json({ today, ...trainingStatus(rows, today), courses: rows.map(courseOut) });
  } catch (e) { fail(res, e); }
});

// Office: add a course for one or more people (e.g. the same I-CAR class for every tech).
router.post("/", async (req, res) => {
  const db = await pool.connect();
  try {
    requireManager(req);
    const userIds = Array.isArray(req.body && req.body.user_ids) ? [...new Set(req.body.user_ids.filter((x) => typeof x === "string"))] : [];
    if (!userIds.length) throw httpError(400, "Pick at least one person.");
    const c = readCourse(req.body);
    const users = (await db.query("SELECT id, full_name FROM users WHERE id = ANY($1::uuid[]) AND active = true", [userIds])).rows;
    if (users.length !== userIds.length) throw httpError(400, "One of those people isn't an active employee.");
    await db.query("BEGIN");
    const created = [];
    for (const u of users) {
      const appointmentId = await syncAppointment(db, c, u.full_name, who(req));
      created.push((await db.query(
        `INSERT INTO training_courses(user_id, course, provider, due_date, scheduled_date, scheduled_time, duration, location, appointment_id, completed_on, notes, created_by, updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
        [u.id, c.course, c.provider, c.due_date, c.scheduled_date, c.scheduled_time, c.duration, c.location, appointmentId, c.completed_on, c.notes, who(req)])).rows[0]);
    }
    await db.query("COMMIT");
    await logActivity({ req, resource: "training", recordId: null, action: "create", summary: `Added training "${c.course}" for ${users.map((u) => u.full_name).join(", ")}` });
    res.status(201).json({ created: created.length });
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

router.put("/:id", async (req, res) => {
  const db = await pool.connect();
  try {
    requireManager(req);
    const before = (await db.query("SELECT t.*, u.full_name FROM training_courses t JOIN users u ON u.id = t.user_id WHERE t.id = $1", [req.params.id])).rows[0];
    if (!before) throw httpError(404, "That course is gone.");
    const c = readCourse(req.body, before);
    await db.query("BEGIN");
    const appointmentId = await syncAppointment(db, c, before.full_name, who(req));
    const row = (await db.query(
      `UPDATE training_courses SET course=$1, provider=$2, due_date=$3, scheduled_date=$4, scheduled_time=$5, duration=$6, location=$7,
         appointment_id=$8, completed_on=$9, notes=$10, updated_by=$11, updated_at=now() WHERE id=$12 RETURNING *`,
      [c.course, c.provider, c.due_date, c.scheduled_date, c.scheduled_time, c.duration, c.location, appointmentId, c.completed_on, c.notes, who(req), req.params.id])).rows[0];
    await db.query("COMMIT");
    await logActivity({ req, resource: "training", recordId: row.id, action: "update", before, after: row,
      summary: c.completed_on && !before.completed_on ? `Marked "${c.course}" done for ${before.full_name}` : `Updated training "${c.course}" for ${before.full_name}` });
    res.json(courseOut({ ...row, full_name: before.full_name }));
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

router.delete("/:id", async (req, res) => {
  const db = await pool.connect();
  try {
    requireManager(req);
    await db.query("BEGIN");
    const row = (await db.query("DELETE FROM training_courses WHERE id = $1 RETURNING *", [req.params.id])).rows[0];
    if (!row) throw httpError(404, "That course is gone.");
    if (row.appointment_id) await db.query("DELETE FROM appointments WHERE id = $1", [row.appointment_id]);
    await db.query("COMMIT");
    await logActivity({ req, resource: "training", recordId: row.id, action: "delete", before: row, summary: `Removed training "${row.course}"` });
    res.json({ removed: 1 });
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

module.exports = router;
module.exports.trainingStatus = trainingStatus;
module.exports.loadCourses = loadCourses;
