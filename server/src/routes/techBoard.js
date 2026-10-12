const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const qcChecklists = require("../../../client/qcChecklists");

// Tech Board (migrations/029): the office drags cars onto TODAY and picks which
// departments and techs work on each one ("Any Tech" = everyone in the department).
// Each tech's phone shows their list: hot cars first, then cars carried over from earlier
// days, then the office's order. A department's assignment stays on the list until its QC
// checklist for the car is fully checked and signed after it was assigned.
const router = express.Router();
const OFFICE_ROLES = ["office", "manager", "admin", "owner"];
const CLOSED_STAGES = ["Delivered", "Total Loss", "No Show"];
const DEPARTMENTS = qcChecklists.names;

const isOffice = (u) => OFFICE_ROLES.includes(String((u && u.role) || "").toLowerCase());
const who = (req) => req.user.fullName || req.user.username;
const shopDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: process.env.BUSINESS_TIMEZONE || "America/Los_Angeles" });
const dayOf = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || "").slice(0, 10));
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function fail(res, e) {
  if (!e.status) console.error("Tech board error:", e);
  res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong with the Tech Board." });
}
function requireOffice(req) { if (!isOffice(req.user)) throw httpError(403, "Only office staff can change the Tech Board."); }

// Employees' roles that mean a department, for anyone without a QC department set.
const ROLE_DEPARTMENT = { body: "Body", paint: "Paint", qc: "Final QC" };

// The departments an employee works in, from Employees: their QC department, their role
// (a body tech is in Body, a painter in Paint), what those always come with (Body ->
// Reassy, Check-In -> Final QC) and any extra checklists set on their account.
function techDepartments(u) {
  const extras = u.extraDepartments || u.extra_departments || [];
  const fromRole = ROLE_DEPARTMENT[String(u.role || "").toLowerCase()];
  return [...new Set([...qcChecklists.departmentsFor(u.department, extras), ...qcChecklists.departmentsFor(fromRole, [])])];
}

// Active employees for each department.
async function techsByDepartment(db = pool) {
  const users = (await db.query(
    `SELECT id, full_name, username, role, department, extra_departments FROM users
     WHERE active = true AND (department IS NOT NULL OR cardinality(extra_departments) > 0 OR lower(role) = ANY($1::text[]))
     ORDER BY full_name`, [Object.keys(ROLE_DEPARTMENT)])).rows;
  const out = Object.fromEntries(DEPARTMENTS.map((d) => [d, []]));
  for (const u of users) {
    for (const d of techDepartments(u)) out[d].push({ id: u.id, name: u.full_name || u.username });
  }
  return out;
}

// Whether a department is finished with a car: its latest QC checklist for the RO is
// fully checked and was signed at or after `since` (when the work was assigned).
function departmentStatus(records, department, since) {
  const rec = records.filter((r) => r.qc_department === department)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  const progress = qcChecklists.progress(department, rec && rec.qc_checklist);
  const sigs = qcChecklists.signatures(rec).filter((s) => s.at && new Date(s.at) >= new Date(since));
  const done = progress.complete && sigs.length > 0;
  return { progress, done, doneAt: done ? sigs[sigs.length - 1].at : null, signedBy: sigs.map((s) => s.by) };
}

// Every car on the board with its departments, techs and progress. Closed jobs drop off,
// and so do cars finished before today.
async function loadBoard(db = pool) {
  const today = shopDate();
  const jobs = (await db.query(
    `SELECT b.job_id, b.hot, b.position, b.added_on, d.ro_number, d.customer_name, d.vehicle, d.vehicle_type, d.vehicle_color,
            d.current_stage, d.target_delivery_date, d.merged_into
     FROM tech_board_jobs b JOIN daily_go_list d ON d.id = b.job_id
     ORDER BY b.position, b.created_at`)).rows
    .filter((j) => !j.merged_into && !CLOSED_STAGES.includes(j.current_stage));
  if (!jobs.length) return { today, jobs: [] };
  const ids = jobs.map((j) => j.job_id);
  const assignments = (await db.query(
    `SELECT a.*, u.full_name, u.username FROM tech_assignments a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.job_id = ANY($1::uuid[]) ORDER BY a.created_at`, [ids])).rows;
  const ros = [...new Set(jobs.map((j) => String(j.ro_number || "").trim()).filter(Boolean))];
  const qc = ros.length ? (await db.query(
    "SELECT qc_ro_number, qc_department, qc_checklist, qc_signatures, qc_signature_data, qc_signed_at, qc_performed_by, qc_final_status, qc_rework_needed, updated_at FROM qc_records WHERE btrim(qc_ro_number) = ANY($1::text[]) AND qc_department IS NOT NULL",
    [ros])).rows : [];

  const out = [];
  for (const j of jobs) {
    const ro = String(j.ro_number || "").trim();
    const records = qc.filter((r) => String(r.qc_ro_number || "").trim() === ro);
    const mine = assignments.filter((a) => a.job_id === j.job_id);
    const departments = DEPARTMENTS.filter((d) => mine.some((a) => a.department === d)).map((d) => {
      const rows = mine.filter((a) => a.department === d);
      const since = rows.reduce((m, a) => (new Date(a.created_at) < m ? new Date(a.created_at) : m), new Date(rows[0].created_at));
      return {
        department: d,
        anyTech: rows.some((a) => !a.user_id),
        users: rows.filter((a) => a.user_id).map((a) => ({ id: a.user_id, name: a.full_name || a.username })),
        assignedAt: since.toISOString(),
        ...departmentStatus(records, d, since),
      };
    });
    const done = departments.length > 0 && departments.every((d) => d.done);
    const finishedOn = done ? shopDate(new Date(departments.map((d) => d.doneAt).sort().pop())) : null;
    if (done && finishedOn < today) continue;
    out.push({
      jobId: j.job_id, roNumber: ro, customerName: j.customer_name, vehicle: j.vehicle, vehicleType: j.vehicle_type, vehicleColor: j.vehicle_color,
      stage: j.current_stage, targetDeliveryDate: j.target_delivery_date ? dayOf(j.target_delivery_date) : null,
      hot: j.hot, position: j.position, addedOn: dayOf(j.added_on), carriedOver: dayOf(j.added_on) < today,
      daysOver: Math.round((new Date(today + "T12:00:00Z") - new Date(dayOf(j.added_on) + "T12:00:00Z")) / 864e5), done, departments,
    });
  }
  return { today, jobs: out };
}

// A tech's list: every unfinished department on a car that names them or is "Any Tech"
// in one of their departments. Hot first, then carried over, then the office's order.
function listFor(user, board) {
  const myDepts = techDepartments(user);
  const items = [];
  for (const j of board.jobs) {
    for (const d of j.departments) {
      if (d.done) continue;
      const named = d.users.some((u) => u.id === user.id);
      if (!named && !(d.anyTech && myDepts.includes(d.department))) continue;
      items.push({ ...j, departments: undefined, department: d.department, anyTech: !named, progress: d.progress, others: d.users.filter((u) => u.id !== user.id).map((u) => u.name) });
    }
  }
  return items.sort((a, b) => (b.hot - a.hot) || (b.carriedOver - a.carriedOver) || (a.position - b.position));
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const [board, techs] = await Promise.all([loadBoard(), techsByDepartment()]);
    res.json({ ...board, techs, canEdit: isOffice(req.user) });
  } catch (e) { fail(res, e); }
});

router.get("/mine", async (req, res) => {
  try { res.json(listFor(req.user, await loadBoard())); }
  catch (e) { fail(res, e); }
});

// Put a car on TODAY, or change who works on it. `departments` replaces what was there:
// [{ department, anyTech, userIds }]. A department that already finished and is chosen
// again starts over (it needs a new QC sign-off). An empty list takes the car off.
router.put("/jobs/:jobId", async (req, res) => {
  const db = await pool.connect();
  try {
    requireOffice(req);
    const wanted = Array.isArray(req.body && req.body.departments) ? req.body.departments : null;
    if (!wanted) throw httpError(400, "Choose the departments for this car.");
    const job = (await db.query("SELECT id, ro_number, current_stage FROM daily_go_list WHERE id = $1", [req.params.jobId])).rows[0];
    if (!job) throw httpError(404, "That job wasn't found.");
    if (!/^\d{5}$/.test(String(job.ro_number || "").trim())) throw httpError(400, "Give this job its five-digit RO before putting it on the Tech Board.");
    const techs = await techsByDepartment(db);
    const plan = [];
    for (const w of wanted) {
      if (!DEPARTMENTS.includes(w && w.department)) throw httpError(400, "Choose a valid department.");
      const userIds = [...new Set(Array.isArray(w.userIds) ? w.userIds : [])];
      for (const id of userIds) if (!techs[w.department].some((t) => t.id === id)) throw httpError(400, `That person isn't in ${w.department}.`);
      if (!w.anyTech && !userIds.length) continue;
      plan.push({ department: w.department, anyTech: !!w.anyTech, userIds });
    }

    const before = (await loadBoard(db)).jobs.find((j) => j.jobId === job.id);
    await db.query("BEGIN");
    if (!plan.length) {
      await db.query("DELETE FROM tech_board_jobs WHERE job_id = $1", [job.id]);
    } else {
      // A car coming (back) onto the board goes to the end of today's order.
      const fresh = !before || before.done;
      if (fresh) {
        await db.query(
          `INSERT INTO tech_board_jobs(job_id, position, added_on, added_by)
           VALUES($1, (SELECT coalesce(max(position), 0) + 1 FROM tech_board_jobs), $2, $3)
           ON CONFLICT (job_id) DO UPDATE SET position = EXCLUDED.position, added_on = EXCLUDED.added_on, added_by = EXCLUDED.added_by, hot = false, updated_at = now()`,
          [job.id, shopDate(), who(req)]);
      }
      const finished = new Set(((before && before.departments) || []).filter((d) => d.done).map((d) => d.department));
      await db.query("DELETE FROM tech_assignments WHERE job_id = $1 AND NOT (department = ANY($2::text[]))", [job.id, plan.map((p) => p.department)]);
      for (const p of plan) {
        if (finished.has(p.department)) await db.query("DELETE FROM tech_assignments WHERE job_id = $1 AND department = $2", [job.id, p.department]);
        await db.query(
          `DELETE FROM tech_assignments WHERE job_id = $1 AND department = $2
             AND NOT (coalesce(user_id::text, 'any') = ANY($3::text[]))`,
          [job.id, p.department, [...p.userIds, ...(p.anyTech ? ["any"] : [])]]);
        for (const userId of [...p.userIds, ...(p.anyTech ? [null] : [])]) {
          await db.query(
            `INSERT INTO tech_assignments(job_id, department, user_id, assigned_by) VALUES($1, $2, $3, $4)
             ON CONFLICT (job_id, department, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING`,
            [job.id, p.department, userId, who(req)]);
        }
      }
    }
    await db.query("COMMIT");
    const summary = plan.length
      ? `Tech Board RO ${job.ro_number}: ${plan.map((p) => `${p.department} (${[...(p.anyTech ? ["Any Tech"] : []), ...p.userIds.map((id) => techs[p.department].find((t) => t.id === id).name)].join(", ")})`).join("; ")}`
      : `Took RO ${job.ro_number} off the Tech Board`;
    await logActivity({ req, resource: "techBoard", recordId: job.id, action: "update", after: { departments: plan }, summary });
    const board = await loadBoard();
    res.json(board.jobs.find((j) => j.jobId === job.id) || null);
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

// Hot cars jump to the top of every tech's list.
router.patch("/jobs/:jobId", async (req, res) => {
  try {
    requireOffice(req);
    if (typeof (req.body && req.body.hot) !== "boolean") throw httpError(400, "Say whether the car is hot.");
    const row = (await pool.query("UPDATE tech_board_jobs SET hot = $1, updated_at = now() WHERE job_id = $2 RETURNING *", [req.body.hot, req.params.jobId])).rows[0];
    if (!row) throw httpError(404, "That car isn't on the Tech Board.");
    await logActivity({ req, resource: "techBoard", recordId: req.params.jobId, action: "update", after: row, summary: req.body.hot ? "Marked a car hot on the Tech Board" : "Took hot off a car on the Tech Board" });
    res.json(row);
  } catch (e) { fail(res, e); }
});

// The office's order for the cars on the board (first = first on everyone's list).
router.put("/order", async (req, res) => {
  const db = await pool.connect();
  try {
    requireOffice(req);
    const ids = Array.isArray(req.body && req.body.jobIds) ? req.body.jobIds.filter((x) => typeof x === "string") : null;
    if (!ids || !ids.length) throw httpError(400, "Send the cars in order.");
    await db.query("BEGIN");
    for (let i = 0; i < ids.length; i++) await db.query("UPDATE tech_board_jobs SET position = $1, updated_at = now() WHERE job_id = $2", [i + 1, ids[i]]);
    await db.query("COMMIT");
    res.json({ ok: true });
  } catch (e) { await db.query("ROLLBACK").catch(() => {}); fail(res, e); }
  finally { db.release(); }
});

module.exports = router;
module.exports.listFor = listFor;
module.exports.departmentStatus = departmentStatus;
module.exports.techDepartments = techDepartments;
module.exports.loadBoard = loadBoard;
module.exports.techsByDepartment = techsByDepartment;
module.exports.shopDate = shopDate;
