// Completed Jobs: everything ShopControl knows about a job after it's delivered, pulled
// back together in one place: the job itself, its trip through production (from the
// activity log), every part (including ones removed along the way), QC checklists,
// photos, appointments and cores. Jobs deleted by hand are rebuilt from the activity log.
const express = require("express");
const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requirePermission("daily", "list"));

const { COMPLETED_STAGES } = require("../completedJobs");

// Fields worth showing in a job's change history (the rest is internal bookkeeping).
const HISTORY_FIELDS = {
  current_stage: "Stage", ro_number: "RO", customer_name: "Customer", vehicle: "Vehicle", ro_amount: "Repair value",
  insurance: "Insurance", pay_type: "Pay type", estimator: "Estimator", body_techs: "Body techs", painters: "Painters",
  support_techs: "Prep / assembly / detail", onsite: "On site", in_date: "In date", target_delivery_date: "Target out",
  actual_delivered_date: "Delivered date", hold_up_reason: "Hold-up reason", supplement_needed: "Supplement needed",
  supplement_submitted: "Supplement submitted", supplement_approved: "Supplement approved", supplement_completed: "Supplement completed",
  follow_up_notes: "Follow-up notes", todays_goal: "Today's goal", management_issue: "Management issue", delivery_stage: "Delivery board",
  location: "Location", assigned_to: "Assigned to", priority: "Priority", parts_status: "Parts status", commercial: "Commercial",
  customer_updated_at: "Customer updated",
};

function fail(res, e) {
  console.error("Job history request:", e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : "Could not load the job history." });
}

function jobRos(job) {
  return [...new Set([job.ro_number, job.ccc_estfile_id].map((v) => String(v || "").trim()).filter(Boolean))];
}

// Completed jobs, plus jobs that were deleted by hand (kept in the activity log).
router.get("/completed", async (req, res) => {
  try {
    const jobs = (await pool.query(
      `SELECT d.id, d.ro_number, d.customer_name, d.vehicle, d.current_stage, d.in_date, d.onsite_at, d.delivered_at,
              d.actual_delivered_date, d.ro_amount, d.insurance, d.estimator, d.created_at, d.vehicle_type, d.vehicle_color,
              (SELECT count(*) FROM parts p WHERE btrim(p.parts_ro_number) IN (btrim(d.ro_number), btrim(coalesce(d.ccc_estfile_id, ''))))::int AS part_count,
              (SELECT count(*) FROM qc_records q WHERE btrim(q.qc_ro_number) = btrim(d.ro_number) AND q.qc_department IS NOT NULL)::int AS qc_count
       FROM daily_go_list d
       WHERE d.current_stage = ANY($1) AND d.merged_into IS NULL
       ORDER BY coalesce(d.delivered_at, d.updated_at) DESC`,
      [COMPLETED_STAGES]
    )).rows;
    const deleted = (await pool.query(
      `SELECT DISTINCT ON (a.record_id) a.record_id AS id, a.before_data AS job, a.created_at AS deleted_at,
              coalesce(a.full_name, a.username) AS deleted_by
       FROM activity_log a
       WHERE a.resource = 'daily' AND a.action = 'delete' AND a.before_data IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM daily_go_list d WHERE d.id = a.record_id)
       ORDER BY a.record_id, a.created_at DESC`
    )).rows
      .map((r) => ({ id: r.id, ro_number: r.job.ro_number, customer_name: r.job.customer_name, vehicle: r.job.vehicle, current_stage: r.job.current_stage, ro_amount: r.job.ro_amount, deleted_at: r.deleted_at, deleted_by: r.deleted_by }))
      .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
    res.json({ jobs, deleted });
  } catch (e) { fail(res, e); }
});

router.get("/:id", async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw Object.assign(Error("Job not found."), { status: 404 });
    let job = (await pool.query("SELECT * FROM daily_go_list WHERE id = $1", [req.params.id])).rows[0];
    let deleted = null;
    if (!job) {
      const row = (await pool.query(
        `SELECT before_data, created_at, coalesce(full_name, username) AS who FROM activity_log
         WHERE resource = 'daily' AND action = 'delete' AND record_id = $1 AND before_data IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`, [req.params.id])).rows[0];
      if (!row) throw Object.assign(Error("Job not found."), { status: 404 });
      job = row.before_data;
      deleted = { at: row.created_at, by: row.who };
    }
    const ros = jobRos(job);

    // Production timeline and change history from the activity log.
    const log = (await pool.query(
      `SELECT action, summary, changes, after_data, coalesce(full_name, username) AS who, username, created_at
       FROM activity_log WHERE resource = 'daily' AND record_id = $1 ORDER BY created_at ASC`, [req.params.id])).rows;
    const timeline = [];
    const changes = [];
    for (const a of log) {
      const who = a.username === "ems-auto-import" ? "CCC import" : a.who || "";
      if (a.action === "create") {
        timeline.push({ at: a.created_at, who, event: `Job created${a.after_data && a.after_data.current_stage ? ` · ${a.after_data.current_stage}` : ""}` });
        continue;
      }
      if (a.action !== "update" || !a.changes) continue;
      const c = a.changes;
      if (c.current_stage) timeline.push({ at: a.created_at, who, event: `${c.current_stage.old || "—"} → ${c.current_stage.new || "—"}`, stage: c.current_stage.new });
      if (c.onsite && String(c.onsite.new) === "true") timeline.push({ at: a.created_at, who, event: "Marked on site" });
      if (c.ro_number && c.ro_number.old) timeline.push({ at: a.created_at, who, event: `RO number ${c.ro_number.old} → ${c.ro_number.new}` });
      const fields = Object.keys(c).filter((k) => HISTORY_FIELDS[k]).map((k) => ({ field: HISTORY_FIELDS[k], old: c[k].old, new: c[k].new }));
      if (fields.length) changes.push({ at: a.created_at, who, fields });
    }
    if (deleted) timeline.push({ at: deleted.at, who: deleted.by, event: "Job deleted" });

    const parts = ros.length ? (await pool.query(
      `SELECT p.*, l.name AS location_name, l.kind AS location_kind FROM parts p
       LEFT JOIN inventory_locations l ON l.id = p.part_location
       WHERE btrim(p.parts_ro_number) = ANY($1) ORDER BY p.created_at`, [ros])).rows : [];

    // Parts removed from the job along the way (single deletes and group deletes).
    const removedParts = [];
    if (ros.length) {
      const single = (await pool.query(
        `SELECT before_data, created_at, coalesce(full_name, username) AS who FROM activity_log
         WHERE resource = 'parts' AND action = 'delete' AND btrim(before_data->>'parts_ro_number') = ANY($1)`, [ros])).rows;
      single.forEach((r) => removedParts.push({ ...r.before_data, removed_at: r.created_at, removed_by: r.who }));
      const bulk = (await pool.query(
        `SELECT changes, created_at, coalesce(full_name, username) AS who FROM activity_log
         WHERE resource = 'parts' AND action = 'delete' AND jsonb_typeof(changes->'before') = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(changes->'before') x WHERE btrim(x->>'parts_ro_number') = ANY($1))`, [ros])).rows;
      bulk.forEach((r) => r.changes.before.forEach((p) => removedParts.push({ ...p, removed_at: r.created_at, removed_by: r.who })));
      removedParts.sort((a, b) => String(a.removed_at).localeCompare(String(b.removed_at)));
    }

    const qc = job.ro_number ? (await pool.query(
      "SELECT * FROM qc_records WHERE btrim(qc_ro_number) = btrim($1) ORDER BY coalesce(qc_signed_at, updated_at)", [job.ro_number])).rows : [];

    const recordIds = [req.params.id, ...parts.map((p) => p.id), ...qc.map((q) => q.id)];
    const attachments = (await pool.query(
      `SELECT id, resource, record_id, original_name, mime_type, file_url, note, uploaded_by, created_at
       FROM attachments WHERE record_id = ANY($1::uuid[]) ORDER BY created_at`, [recordIds])).rows;
    const appointments = (await pool.query(
      "SELECT title, appointment_type, appointment_date, appointment_time, notes, created_by FROM appointments WHERE job_id = $1 ORDER BY appointment_date, appointment_time",
      [req.params.id])).rows;
    const cores = ros.length ? (await pool.query(
      "SELECT description, assigned_to, created_at FROM core_events WHERE btrim(ro_number) = ANY($1) ORDER BY created_at", [ros])).rows : [];

    res.json({ job, deleted, timeline, changes, parts, removedParts, qc, attachments, appointments, cores });
  } catch (e) { fail(res, e); }
});

module.exports = router;
