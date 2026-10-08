const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const { sendTaskEmail } = require("../mailer");
const { names: QC_DEPARTMENTS } = require("../../../client/qcChecklists");

// Staff hub: time-off requests, internal messages and company info (migrations/020).
const router = express.Router();
router.use(requireAuth);

const TIME_OFF_TYPES = ["Sick", "Vacation", "Bereavement", "Time off without pay", "Military", "Jury duty", "Maternity/Paternity", "Other"];
// Get new time-off requests and can see everyone's; can message anyone.
const OFFICE_ROLES = ["office", "manager", "admin", "owner"];
// Only these can approve or deny time off.
const APPROVER_ROLES = ["admin", "owner"];

const role = (u) => String((u && u.role) || "").toLowerCase();
const isOffice = (u) => OFFICE_ROLES.includes(role(u));
const isApprover = (u) => APPROVER_ROLES.includes(role(u));
const who = (req) => req.user.fullName || req.user.username;

function fail(res, e) {
  if (!e.status) console.error("Staff hub request:", e.message);
  return res.status(e.status || 400).json({ error: e.message });
}
function httpError(status, message) { return Object.assign(Error(message), { status }); }

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

function describeDates(r) {
  const fmt = (d) => new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const start = String(r.start_date).slice(0, 10), end = String(r.end_date).slice(0, 10);
  let s = start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  if (r.partial_day && r.start_time && r.end_time) s += ` (${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)})`;
  return s;
}
const typeLabel = (r) => (r.request_type === "Other" ? `Other: ${r.other_reason}` : r.request_type);

async function emailUsers(users, subject, title, lines) {
  const to = [...new Set(users.map((u) => u.email).filter(Boolean))];
  if (!to.length) return;
  try { await sendTaskEmail({ to: to.join(", "), subject, title, bodyLines: lines }); }
  catch (e) { console.error("Staff hub email failed:", e.message); }
}

async function notifyUsers(db, users, title, message) {
  for (const u of users) {
    await db.query("INSERT INTO employee_notifications(user_id, title, message) VALUES($1,$2,$3)", [u.id, title, message]);
  }
}

// ---------------------------------------------------------------- Time off
function validateTimeOff(b) {
  if (!TIME_OFF_TYPES.includes(b.request_type)) throw Error("Choose the type of absence.");
  if (b.request_type === "Other" && !clean(b.other_reason, 300)) throw Error("Write in the reason for your absence.");
  if (!isDate(b.start_date) || !isDate(b.end_date)) throw Error("Choose the start and end dates.");
  if (b.end_date < b.start_date) throw Error("The end date can't be before the start date.");
  if (b.partial_day) {
    if (b.start_date !== b.end_date) throw Error("A partial day must start and end on the same date.");
    if (!isTime(b.start_time) || !isTime(b.end_time)) throw Error("Enter the from and to times for a partial day.");
    if (b.end_time <= b.start_time) throw Error("The end time must be after the start time.");
  }
}

router.get("/time-off/mine", async (req, res) => {
  try {
    res.json((await pool.query("SELECT * FROM time_off_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.user.id])).rows);
  } catch (e) { fail(res, e); }
});

router.get("/time-off", async (req, res) => {
  try {
    if (!isOffice(req.user)) throw httpError(403, "Only office staff and admins can view all time-off requests.");
    const status = ["Pending", "Approved", "Denied", "Cancelled"].includes(req.query.status) ? req.query.status : null;
    const rows = (await pool.query(
      `SELECT * FROM time_off_requests WHERE ($1::text IS NULL OR status=$1)
       ORDER BY (status='Pending') DESC, start_date DESC, created_at DESC LIMIT 500`, [status])).rows;
    res.json(rows);
  } catch (e) { fail(res, e); }
});

router.post("/time-off", async (req, res) => {
  const db = await pool.connect();
  try {
    const b = req.body || {};
    validateTimeOff(b);
    await db.query("BEGIN");
    const row = (await db.query(
      `INSERT INTO time_off_requests(user_id, full_name, request_type, other_reason, start_date, end_date, partial_day, start_time, end_time, notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, who(req), b.request_type, b.request_type === "Other" ? clean(b.other_reason, 300) : null, b.start_date, b.end_date,
        !!b.partial_day, b.partial_day ? b.start_time : null, b.partial_day ? b.end_time : null, clean(b.notes, 2000) || null])).rows[0];
    const office = (await db.query(
      `SELECT id, email FROM users WHERE active=true AND role = ANY($1) AND id <> $2`, [OFFICE_ROLES, req.user.id])).rows;
    const title = `Time-off request · ${row.full_name}`;
    const summary = `${typeLabel(row)} · ${describeDates(row)}`;
    await notifyUsers(db, office, title, `${summary}. Open Time Off in Shop Control to review.`);
    await db.query("COMMIT");
    await logActivity({ req, resource: "timeOff", recordId: row.id, action: "create", after: row, summary: `Requested time off: ${summary}` });
    emailUsers(office, title, `Time-off request from ${row.full_name}`, [
      `Type: ${typeLabel(row)}`, `Dates: ${describeDates(row)}`, row.notes ? `Notes: ${row.notes}` : "",
      "An admin can approve or deny it under Time Off in Shop Control.",
    ].filter(Boolean));
    res.status(201).json(row);
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

router.post("/time-off/:id/cancel", async (req, res) => {
  try {
    const row = (await pool.query(
      "UPDATE time_off_requests SET status='Cancelled', updated_at=now() WHERE id=$1 AND user_id=$2 AND status='Pending' RETURNING *",
      [req.params.id, req.user.id])).rows[0];
    if (!row) throw httpError(409, "Only your own pending requests can be cancelled.");
    await logActivity({ req, resource: "timeOff", recordId: row.id, action: "update", after: row, summary: "Cancelled time-off request" });
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.post("/time-off/:id/decision", async (req, res) => {
  const db = await pool.connect();
  try {
    if (!isApprover(req.user)) throw httpError(403, "Only admins can approve or deny time off.");
    const decision = req.body && req.body.decision;
    if (!["Approved", "Denied"].includes(decision)) throw Error("Choose approve or deny.");
    const note = clean(req.body.note, 1000) || null;
    await db.query("BEGIN");
    const row = (await db.query(
      `UPDATE time_off_requests SET status=$1, decision_note=$2, decided_by=$3, decided_at=now(), updated_at=now()
       WHERE id=$4 AND status='Pending' RETURNING *`, [decision, note, who(req), req.params.id])).rows[0];
    if (!row) throw httpError(409, "This request was already decided or cancelled. Refresh and check.");
    const requester = (await db.query("SELECT id, email, full_name FROM users WHERE id=$1", [row.user_id])).rows[0];
    const subject = `Time off ${decision.toUpperCase()}: ${typeLabel(row)}`;
    const body = `Your time-off request (${typeLabel(row)}, ${describeDates(row)}) was ${decision.toLowerCase()} by ${who(req)}.${note ? `\n\nNote: ${note}` : ""}`;
    if (requester) {
      await db.query(
        `INSERT INTO staff_messages(sender_id, sender_name, recipient_id, audience, subject, body) VALUES($1,$2,$3,'Time Off',$4,$5)`,
        [req.user.id, who(req), requester.id, subject, body]);
    }
    // The office hears about every decision too; the requester gets their own email below, so skip them here.
    const office = (await db.query(
      `SELECT id, email FROM users WHERE active=true AND role = ANY($1) AND id <> $2`, [OFFICE_ROLES, row.user_id])).rows;
    await db.query("COMMIT");
    await logActivity({ req, resource: "timeOff", recordId: row.id, action: "update", after: row, summary: `${decision} time off for ${row.full_name}` });
    const details = [
      `Type: ${typeLabel(row)}`, `Dates: ${describeDates(row)}`, `Decided by: ${who(req)}`, note ? `Note: ${note}` : "",
    ].filter(Boolean);
    if (requester) emailUsers([requester], subject, `Your time off was ${decision.toLowerCase()}`, details);
    emailUsers(office, `Time-off request ${decision.toUpperCase()} · ${row.full_name}`,
      `Time off ${decision.toLowerCase()} for ${row.full_name}`, [`Employee: ${row.full_name}`, ...details]);
    res.json(row);
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

// ---------------------------------------------------------------- Missed punch
// The paper missed punch slip (migrations/024). Payroll runs Thursday to Wednesday.
const hhmm = (t) => {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
function payWeek(date) {
  const d = new Date(String(date).slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 3) % 7)); // back to Thursday
  const end = new Date(d); end.setDate(d.getDate() + 6);
  const fmt = (x) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(d)} – ${fmt(end)}`;
}
function describePunch(r) {
  const day = new Date(String(r.punch_date).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return `${day}: in ${hhmm(r.time_in)}${`, lunch ${hhmm(r.lunch_out)}–${hhmm(r.lunch_in)}`}, out ${hhmm(r.time_out)}`;
}
const punchLines = (r) => [
  `Date: ${new Date(String(r.punch_date).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}`,
  `Time in: ${hhmm(r.time_in)}`,
  `Time out (lunch): ${hhmm(r.lunch_out)}`,
  `Time in (lunch): ${hhmm(r.lunch_in)}`,
  `Time out: ${hhmm(r.time_out)}`,
  `Payroll week: ${payWeek(r.punch_date)} (Thu–Wed)`,
  `Initials: ${r.initials}`,
  r.notes ? `Notes: ${r.notes}` : "",
].filter(Boolean);

function validatePunch(b) {
  if (!isDate(b.punch_date)) throw Error("Choose the date of the missed punch.");
  if (b.punch_date > new Date().toLocaleDateString("en-CA")) throw Error("The date can't be in the future.");
  // Everyone takes a lunch, so all four times are required.
  const order = [b.time_in, b.lunch_out, b.lunch_in, b.time_out];
  if (!order.every(isTime)) throw Error("Enter all four times: in, lunch out, lunch in and out.");
  if (order.some((t, i) => i && t <= order[i - 1])) throw Error("The times must be in order: in, lunch out, lunch in, out.");
  if (!/^[A-Za-z][A-Za-z. -]{0,7}$/.test(clean(b.initials, 8))) throw Error("Type your initials.");
}

router.get("/missed-punch/mine", async (req, res) => {
  try {
    res.json((await pool.query("SELECT * FROM missed_punch_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.user.id])).rows);
  } catch (e) { fail(res, e); }
});

router.get("/missed-punch", async (req, res) => {
  try {
    if (!isOffice(req.user)) throw httpError(403, "Only office staff and admins can view all missed punch slips.");
    const status = ["Pending", "Approved", "Denied", "Cancelled"].includes(req.query.status) ? req.query.status : null;
    res.json((await pool.query(
      `SELECT * FROM missed_punch_requests WHERE ($1::text IS NULL OR status=$1)
       ORDER BY (status='Pending') DESC, punch_date DESC, created_at DESC LIMIT 500`, [status])).rows);
  } catch (e) { fail(res, e); }
});

router.post("/missed-punch", async (req, res) => {
  const db = await pool.connect();
  try {
    const b = req.body || {};
    validatePunch(b);
    const dup = (await db.query(
      "SELECT 1 FROM missed_punch_requests WHERE user_id=$1 AND punch_date=$2 AND status IN ('Pending','Approved')", [req.user.id, b.punch_date])).rows[0];
    if (dup) throw httpError(409, "You already sent a missed punch slip for that day. Cancel it under My requests to send a new one.");
    await db.query("BEGIN");
    const row = (await db.query(
      `INSERT INTO missed_punch_requests(user_id, full_name, punch_date, time_in, lunch_out, lunch_in, time_out, initials, notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, who(req), b.punch_date, b.time_in, b.lunch_out, b.lunch_in, b.time_out,
        clean(b.initials, 8).toUpperCase(), clean(b.notes, 2000) || null])).rows[0];
    const office = (await db.query(
      `SELECT id, email FROM users WHERE active=true AND role = ANY($1) AND id <> $2`, [OFFICE_ROLES, req.user.id])).rows;
    const title = `Missed punch · ${row.full_name}`;
    await notifyUsers(db, office, title, `${describePunch(row)}. Open Time Off in Shop Control to review.`);
    await db.query("COMMIT");
    await logActivity({ req, resource: "missedPunch", recordId: row.id, action: "create", after: row, summary: `Missed punch slip: ${describePunch(row)}` });
    emailUsers(office, title, `Missed punch slip from ${row.full_name}`, [
      ...punchLines(row), "An admin can approve or deny it under Time Off in Shop Control.",
    ]);
    res.status(201).json(row);
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

router.post("/missed-punch/:id/cancel", async (req, res) => {
  try {
    const row = (await pool.query(
      "UPDATE missed_punch_requests SET status='Cancelled', updated_at=now() WHERE id=$1 AND user_id=$2 AND status='Pending' RETURNING *",
      [req.params.id, req.user.id])).rows[0];
    if (!row) throw httpError(409, "Only your own pending slips can be cancelled.");
    await logActivity({ req, resource: "missedPunch", recordId: row.id, action: "update", after: row, summary: "Cancelled missed punch slip" });
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.post("/missed-punch/:id/decision", async (req, res) => {
  const db = await pool.connect();
  try {
    if (!isApprover(req.user)) throw httpError(403, "Only admins can approve or deny missed punches.");
    const decision = req.body && req.body.decision;
    if (!["Approved", "Denied"].includes(decision)) throw Error("Choose approve or deny.");
    const note = clean(req.body.note, 1000) || null;
    await db.query("BEGIN");
    const row = (await db.query(
      `UPDATE missed_punch_requests SET status=$1, decision_note=$2, decided_by=$3, decided_at=now(), updated_at=now()
       WHERE id=$4 AND status='Pending' RETURNING *`, [decision, note, who(req), req.params.id])).rows[0];
    if (!row) throw httpError(409, "This slip was already decided or cancelled. Refresh and check.");
    const requester = (await db.query("SELECT id, email, full_name FROM users WHERE id=$1", [row.user_id])).rows[0];
    const subject = `Missed punch ${decision.toUpperCase()}: ${describePunch(row).split(":")[0]}`;
    const body = `Your missed punch slip (${describePunch(row)}) was ${decision.toLowerCase()} by ${who(req)}.${note ? `\n\nNote: ${note}` : ""}`;
    if (requester) {
      await db.query(
        `INSERT INTO staff_messages(sender_id, sender_name, recipient_id, audience, subject, body) VALUES($1,$2,$3,'Missed Punch',$4,$5)`,
        [req.user.id, who(req), requester.id, subject, body]);
    }
    const office = (await db.query(
      `SELECT id, email FROM users WHERE active=true AND role = ANY($1) AND id <> $2`, [OFFICE_ROLES, row.user_id])).rows;
    await db.query("COMMIT");
    await logActivity({ req, resource: "missedPunch", recordId: row.id, action: "update", after: row, summary: `${decision} missed punch for ${row.full_name}` });
    const details = [...punchLines(row), `Decided by: ${who(req)}`, note ? `Decision note: ${note}` : ""].filter(Boolean);
    if (requester) emailUsers([requester], subject, `Your missed punch was ${decision.toLowerCase()}`, details);
    emailUsers(office, `Missed punch ${decision.toUpperCase()} · ${row.full_name}`,
      `Missed punch ${decision.toLowerCase()} for ${row.full_name}`, [`Employee: ${row.full_name}`, ...details]);
    res.json(row);
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

// ---------------------------------------------------------------- Payroll correction
// Page 1 of the paper Payroll Correction Form (migrations/025). An admin's approval
// stands in for the supervisor's signature.
const PAYOUTS = ["Next payroll", "Separate check"];
const fmtDay = (d) => new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const hoursLabel = (n) => `${Number(n)} ${Number(n) === 1 ? "hour" : "hours"}`;
const correctionDates = (r) => r.days.map((d) => fmtDay(d.date).replace(/, \d{4}$/, "")).join(" & ");
const correctionLines = (r) => [
  `Employee #: ${r.employee_number || "—"}`,
  `Phone: ${r.phone}`,
  `Payroll date(s) in question: ${correctionDates(r)}`,
  `Number of hours in question: ${Number(r.total_hours)}`,
  r.programs ? `Program(s): ${r.programs}` : "",
  ...r.days.map((d) => `${fmtDay(d.date)}: worked ${hhmm(d.from)}–${hhmm(d.to)}, ${hoursLabel(d.hours)}`),
  `Why: ${r.explanation}`,
  `Correction paid by: ${r.payout === "Separate check" ? "a separate check" : "adjusting the next payroll check"}`,
  `Signed: ${r.signature}`,
].filter(Boolean);

function validateCorrection(b) {
  const phone = clean(b.phone, 40);
  if ((phone.match(/\d/g) || []).length < 7) throw Error("Enter a phone number where the office can reach you.");
  if (!Array.isArray(b.days) || !b.days.length) throw Error("Add at least one date in question.");
  if (b.days.length > 5) throw Error("Up to 5 dates per form. Send another form for more.");
  const today = new Date().toLocaleDateString("en-CA");
  const days = b.days.map((d) => {
    if (!d || !isDate(d.date)) throw Error("Choose the date for each day in question.");
    if (d.date > today) throw Error("Dates in question can't be in the future.");
    if (!isTime(d.from) || !isTime(d.to)) throw Error("Enter the hours you actually worked for each day (from and to).");
    if (d.to <= d.from) throw Error("Each day's end time must be after its start time.");
    const hours = Math.round(Number(d.hours) * 100) / 100;
    if (!(hours > 0 && hours <= 24)) throw Error("Enter the total number of hours for each day.");
    return { date: d.date, from: d.from, to: d.to, hours };
  });
  if (new Set(days.map((d) => d.date)).size !== days.length) throw Error("Each date should only be listed once.");
  days.sort((x, y) => x.date.localeCompare(y.date));
  const explanation = clean(b.explanation, 2000);
  if (!explanation) throw Error("Explain why you feel the error was made.");
  if (!PAYOUTS.includes(b.payout)) throw Error("Choose how you'd like the correction paid.");
  const signature = clean(b.signature, 120);
  if (!signature) throw Error("Type your full name to sign.");
  return {
    phone, days, explanation, signature, payout: b.payout,
    employee_number: clean(b.employee_number, 20) || null,
    programs: clean(b.programs, 200) || null,
    total_hours: Math.round(days.reduce((s, d) => s + d.hours, 0) * 100) / 100,
  };
}

router.get("/payroll-corrections/mine", async (req, res) => {
  try {
    res.json((await pool.query("SELECT * FROM payroll_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.user.id])).rows);
  } catch (e) { fail(res, e); }
});

router.get("/payroll-corrections", async (req, res) => {
  try {
    if (!isOffice(req.user)) throw httpError(403, "Only office staff and admins can view all payroll corrections.");
    const status = ["Pending", "Approved", "Denied", "Cancelled"].includes(req.query.status) ? req.query.status : null;
    res.json((await pool.query(
      `SELECT * FROM payroll_corrections WHERE ($1::text IS NULL OR status=$1)
       ORDER BY (status='Pending') DESC, created_at DESC LIMIT 500`, [status])).rows);
  } catch (e) { fail(res, e); }
});

router.post("/payroll-corrections", async (req, res) => {
  const db = await pool.connect();
  try {
    const v = validateCorrection(req.body || {});
    await db.query("BEGIN");
    const row = (await db.query(
      `INSERT INTO payroll_corrections(user_id, full_name, employee_number, phone, days, total_hours, programs, explanation, payout, signature)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, who(req), v.employee_number, v.phone, JSON.stringify(v.days), v.total_hours, v.programs, v.explanation, v.payout, v.signature])).rows[0];
    const office = (await db.query(
      `SELECT id, email FROM users WHERE active=true AND role = ANY($1) AND id <> $2`, [OFFICE_ROLES, req.user.id])).rows;
    const title = `Payroll correction · ${row.full_name}`;
    await notifyUsers(db, office, title, `${hoursLabel(row.total_hours)} on ${correctionDates(row)}. Open Time Off in Shop Control to review.`);
    await db.query("COMMIT");
    await logActivity({ req, resource: "payrollCorrection", recordId: row.id, action: "create", after: row, summary: `Payroll correction: ${hoursLabel(row.total_hours)} on ${correctionDates(row)}` });
    emailUsers(office, title, `Payroll correction from ${row.full_name}`, [
      ...correctionLines(row), "An admin can approve or deny it under Time Off in Shop Control.",
    ]);
    res.status(201).json(row);
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

router.post("/payroll-corrections/:id/cancel", async (req, res) => {
  try {
    const row = (await pool.query(
      "UPDATE payroll_corrections SET status='Cancelled', updated_at=now() WHERE id=$1 AND user_id=$2 AND status='Pending' RETURNING *",
      [req.params.id, req.user.id])).rows[0];
    if (!row) throw httpError(409, "Only your own pending forms can be cancelled.");
    await logActivity({ req, resource: "payrollCorrection", recordId: row.id, action: "update", after: row, summary: "Cancelled payroll correction" });
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.post("/payroll-corrections/:id/decision", async (req, res) => {
  const db = await pool.connect();
  try {
    if (!isApprover(req.user)) throw httpError(403, "Only admins can approve or deny payroll corrections.");
    const decision = req.body && req.body.decision;
    if (!["Approved", "Denied"].includes(decision)) throw Error("Choose approve or deny.");
    const note = clean(req.body.note, 1000) || null;
    await db.query("BEGIN");
    const row = (await db.query(
      `UPDATE payroll_corrections SET status=$1, decision_note=$2, decided_by=$3, decided_at=now(), updated_at=now()
       WHERE id=$4 AND status='Pending' RETURNING *`, [decision, note, who(req), req.params.id])).rows[0];
    if (!row) throw httpError(409, "This form was already decided or cancelled. Refresh and check.");
    const requester = (await db.query("SELECT id, email, full_name FROM users WHERE id=$1", [row.user_id])).rows[0];
    const subject = `Payroll correction ${decision.toUpperCase()}: ${correctionDates(row)}`;
    const body = `Your payroll correction (${hoursLabel(row.total_hours)} on ${correctionDates(row)}) was ${decision.toLowerCase()} by ${who(req)}.${note ? `\n\nNote: ${note}` : ""}`;
    if (requester) {
      await db.query(
        `INSERT INTO staff_messages(sender_id, sender_name, recipient_id, audience, subject, body) VALUES($1,$2,$3,'Payroll Correction',$4,$5)`,
        [req.user.id, who(req), requester.id, subject, body]);
    }
    const office = (await db.query(
      `SELECT id, email FROM users WHERE active=true AND role = ANY($1) AND id <> $2`, [OFFICE_ROLES, row.user_id])).rows;
    await db.query("COMMIT");
    await logActivity({ req, resource: "payrollCorrection", recordId: row.id, action: "update", after: row, summary: `${decision} payroll correction for ${row.full_name}` });
    const details = [...correctionLines(row), `Decided by: ${who(req)}`, note ? `Decision note: ${note}` : ""].filter(Boolean);
    if (requester) emailUsers([requester], subject, `Your payroll correction was ${decision.toLowerCase()}`, details);
    emailUsers(office, `Payroll correction ${decision.toUpperCase()} · ${row.full_name}`,
      `Payroll correction ${decision.toLowerCase()} for ${row.full_name}`, [`Employee: ${row.full_name}`, ...details]);
    res.json(row);
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

// ---------------------------------------------------------------- Messages
router.get("/recipients", async (req, res) => {
  try {
    res.json((await pool.query(
      "SELECT id, full_name, role, department, job_title FROM users WHERE active=true AND role NOT IN ('display', 'shopboard') ORDER BY full_name")).rows);
  } catch (e) { fail(res, e); }
});

router.get("/messages", async (req, res) => {
  try {
    res.json((await pool.query(
      "SELECT * FROM staff_messages WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 200", [req.user.id])).rows);
  } catch (e) { fail(res, e); }
});

router.get("/messages/sent", async (req, res) => {
  try {
    // One row per send: a message to a group lists every recipient's name.
    res.json((await pool.query(
      `SELECT m.group_id, min(m.subject) subject, min(m.body) body, min(m.audience) audience, min(m.created_at) created_at,
              array_agg(u.full_name ORDER BY u.full_name) recipients, count(m.read_at) read_count, count(*) total
       FROM staff_messages m JOIN users u ON u.id=m.recipient_id
       WHERE m.sender_id=$1 GROUP BY m.group_id ORDER BY min(m.created_at) DESC LIMIT 100`, [req.user.id])).rows);
  } catch (e) { fail(res, e); }
});

router.get("/messages/unread-count", async (req, res) => {
  try {
    res.json({ count: Number((await pool.query("SELECT count(*) FROM staff_messages WHERE recipient_id=$1 AND read_at IS NULL", [req.user.id])).rows[0].count) });
  } catch (e) { fail(res, e); }
});

router.put("/messages/:id/read", async (req, res) => {
  try {
    const row = (await pool.query(
      "UPDATE staff_messages SET read_at=coalesce(read_at, now()) WHERE id=$1 AND recipient_id=$2 RETURNING id, read_at", [req.params.id, req.user.id])).rows[0];
    if (!row) throw httpError(404, "Message not found.");
    res.json(row);
  } catch (e) { fail(res, e); }
});

// Office/admins can message anyone, a department, the office, or everyone. Everyone
// else can message the office, or reply to a message they received.
router.post("/messages", async (req, res) => {
  const db = await pool.connect();
  try {
    const b = req.body || {};
    const subject = clean(b.subject, 200), body = clean(b.body, 5000);
    if (!body) throw Error("Write a message.");
    const active = "active=true AND role NOT IN ('display', 'shopboard')";
    let recipients = [], audience = null, replyTo = null;

    if (b.reply_to) {
      const original = (await db.query("SELECT * FROM staff_messages WHERE id=$1 AND recipient_id=$2", [b.reply_to, req.user.id])).rows[0];
      if (!original) throw httpError(404, "The message you're replying to wasn't found.");
      if (!original.sender_id) throw Error("That message can't be replied to.");
      recipients = (await db.query(`SELECT id FROM users WHERE id=$1 AND ${active}`, [original.sender_id])).rows;
      replyTo = original.id;
      audience = "Reply";
    } else if (b.audience === "office") {
      recipients = (await db.query(`SELECT id FROM users WHERE ${active} AND role = ANY($1)`, [OFFICE_ROLES])).rows;
      audience = "Office";
    } else {
      if (!isOffice(req.user)) throw httpError(403, "You can message the office or reply to messages you receive.");
      if (b.audience === "everyone") {
        recipients = (await db.query(`SELECT id FROM users WHERE ${active}`)).rows;
        audience = "Everyone";
      } else if (typeof b.audience === "string" && b.audience.startsWith("dept:")) {
        const dept = b.audience.slice(5);
        if (!QC_DEPARTMENTS.includes(dept)) throw Error("Choose a valid department.");
        recipients = (await db.query(`SELECT id FROM users WHERE ${active} AND department=$1`, [dept])).rows;
        audience = dept;
      } else if (Array.isArray(b.recipient_ids) && b.recipient_ids.length) {
        recipients = (await db.query(`SELECT id FROM users WHERE ${active} AND id::text = ANY($1)`, [b.recipient_ids.map(String)])).rows;
      } else throw Error("Choose who the message is for.");
    }
    recipients = recipients.filter((r) => r.id !== req.user.id);
    if (!recipients.length) throw Error("Nobody to send that to.");

    await db.query("BEGIN");
    const groupId = (await db.query("SELECT gen_random_uuid() id")).rows[0].id;
    for (const r of recipients) {
      await db.query(
        `INSERT INTO staff_messages(group_id, sender_id, sender_name, recipient_id, audience, subject, body, reply_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [groupId, req.user.id, who(req), r.id, audience, subject || "(no subject)", body, replyTo]);
    }
    await db.query("COMMIT");
    res.status(201).json({ sent: recipients.length, group_id: groupId });
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

// ---------------------------------------------------------------- Company info
router.get("/company-info", async (req, res) => {
  try { res.json((await pool.query("SELECT * FROM company_info ORDER BY sort_order, title")).rows); }
  catch (e) { fail(res, e); }
});

function requireApprover(req) { if (!isApprover(req.user)) throw httpError(403, "Only admins can edit company info."); }
function validateInfo(b) {
  const title = clean(b.title, 120), body = clean(b.body, 20000);
  if (!title) throw Error("Give this section a title.");
  const sort = Number.isInteger(b.sort_order) ? b.sort_order : 0;
  return { title, body, sort };
}

router.post("/company-info", async (req, res) => {
  try {
    requireApprover(req);
    const v = validateInfo(req.body || {});
    const row = (await pool.query("INSERT INTO company_info(title, body, sort_order, updated_by) VALUES($1,$2,$3,$4) RETURNING *", [v.title, v.body, v.sort, who(req)])).rows[0];
    res.status(201).json(row);
  } catch (e) { fail(res, e); }
});

router.put("/company-info/:id", async (req, res) => {
  try {
    requireApprover(req);
    const v = validateInfo(req.body || {});
    const row = (await pool.query("UPDATE company_info SET title=$1, body=$2, sort_order=$3, updated_by=$4, updated_at=now() WHERE id=$5 RETURNING *", [v.title, v.body, v.sort, who(req), req.params.id])).rows[0];
    if (!row) throw httpError(404, "Section not found.");
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.delete("/company-info/:id", async (req, res) => {
  try {
    requireApprover(req);
    const row = (await pool.query("DELETE FROM company_info WHERE id=$1 RETURNING id", [req.params.id])).rows[0];
    if (!row) throw httpError(404, "Section not found.");
    res.json({ deleted: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
module.exports.TIME_OFF_TYPES = TIME_OFF_TYPES;
