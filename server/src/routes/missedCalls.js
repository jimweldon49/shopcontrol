const express = require("express");
const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const { sendMissedCallAlert } = require("../missedCallAlerts");

const router = express.Router();
router.use(requireAuth);

function fail(res, e) {
  console.error("Missed calls request:", e.message);
  return res.status(e.status || 400).json({ error: e.message });
}

// entered_by/created_by/updated_by are set server-side, never from the request body.
const COLUMNS = [
  "assigned_to", "received_at", "caller_name", "company", "callback_phone", "email",
  "caller_type", "reason", "priority", "message",
  "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_vin", "vehicle_plate",
  "ro_number", "claim_number", "insurance_company", "preferred_callback",
  "status", "closed_reason",
];

const ATTEMPT_OUTCOMES = ["Reached caller", "Left voicemail", "No answer", "Wrong number"];
const CLOSED_STATUSES = ["Returned / resolved", "Closed — no callback needed"];

function validateCall(b) {
  if (!b.caller_name?.trim()) throw Error("Caller name is required.");
  if (!b.callback_phone?.trim()) throw Error("Callback phone number is required.");
  if (!b.message?.trim()) throw Error("Message / important information is required.");
  if (b.status === "Closed — no callback needed" && !b.closed_reason?.trim()) {
    throw Error("A reason is required to close without a callback.");
  }
}

router.get("/", requirePermission("missed_calls", "list"), async (req, res) => {
  try {
    res.json((await pool.query("SELECT * FROM missed_calls ORDER BY created_at DESC")).rows);
  } catch (e) { fail(res, e); }
});

router.get("/duplicate-check", requirePermission("missed_calls", "list"), async (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();
    const ro = String(req.query.ro || "").trim();
    if (!phone && !ro) return res.json([]);
    const rows = (await pool.query(
      `SELECT id, caller_name, callback_phone, ro_number, status, created_at FROM missed_calls
       WHERE status NOT IN ('${CLOSED_STATUSES.join("','")}')
         AND ((btrim($1)<>'' AND callback_phone=$1) OR (btrim($2)<>'' AND ro_number=$2))
       ORDER BY created_at DESC LIMIT 5`,
      [phone, ro]
    )).rows;
    res.json(rows);
  } catch (e) { fail(res, e); }
});

router.post("/", requirePermission("missed_calls", "create"), async (req, res) => {
  try {
    validateCall(req.body);
    const who = req.user.fullName || req.user.username;
    const values = COLUMNS.map(k => (req.body[k] === "" ? null : (req.body[k] ?? null)));
    const allCols = ["entered_by", "created_by", "updated_by", ...COLUMNS];
    const allValues = [who, who, who, ...values];
    const placeholders = allValues.map((_, i) => `$${i + 1}`).join(", ");

    const result = await pool.query(
      `INSERT INTO missed_calls(${allCols.join(",")}) VALUES(${placeholders}) RETURNING *`,
      allValues
    );
    const row = result.rows[0];
    await logActivity({ req, resource: "missed_calls", recordId: row.id, action: "create", after: row, summary: `Logged missed call from ${row.caller_name}` });
    sendMissedCallAlert(row, "created").catch(err => console.error("Missed call alert failed:", err.message));
    res.status(201).json(row);
  } catch (e) { fail(res, e); }
});

router.put("/:id", requirePermission("missed_calls", "update"), async (req, res) => {
  try {
    validateCall(req.body);
    if (!req.body.expected_updated_at) throw Error("Refresh this entry before saving.");
    const before = (await pool.query("SELECT * FROM missed_calls WHERE id=$1", [req.params.id])).rows[0];
    if (!before) return res.status(404).json({ error: "Missed call not found." });

    const who = req.user.fullName || req.user.username;
    const values = COLUMNS.map(k => (req.body[k] === "" ? null : (req.body[k] ?? null)));
    const setClauses = COLUMNS.map((k, i) => `${k}=$${i + 1}`);
    setClauses.push("updated_at=now()", `updated_by=$${COLUMNS.length + 1}`);
    const params = [...values, who, req.params.id, req.body.expected_updated_at];

    const result = await pool.query(
      `UPDATE missed_calls SET ${setClauses.join(",")} WHERE id=$${params.length - 1} AND date_trunc('milliseconds',updated_at)=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(409).json({ error: "This entry changed. Reopen it before saving." });
    const row = result.rows[0];
    await logActivity({ req, resource: "missed_calls", recordId: row.id, action: "update", before, after: row, summary: "Updated missed call" });

    const reassigned = String(before.assigned_to || "") !== String(row.assigned_to || "");
    if (reassigned) sendMissedCallAlert(row, "reassigned").catch(err => console.error("Missed call alert failed:", err.message));
    res.json(row);
  } catch (e) { fail(res, e); }
});

router.delete("/:id", requirePermission("missed_calls", "delete"), async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM missed_calls WHERE id=$1 RETURNING *", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Missed call not found." });
    await logActivity({ req, resource: "missed_calls", recordId: req.params.id, action: "delete", before: result.rows[0], summary: "Deleted missed call" });
    res.json({ deleted: true });
  } catch (e) { fail(res, e); }
});

router.get("/:id/attempts", requirePermission("missed_calls", "list"), async (req, res) => {
  try {
    res.json((await pool.query("SELECT * FROM callback_attempts WHERE missed_call_id=$1 ORDER BY attempted_at DESC", [req.params.id])).rows);
  } catch (e) { fail(res, e); }
});

router.post("/:id/attempts", requirePermission("missed_calls", "update"), async (req, res) => {
  const db = await pool.connect();
  try {
    const { outcome, notes, next_follow_up_at } = req.body;
    if (!ATTEMPT_OUTCOMES.includes(outcome)) throw Error("Choose a valid outcome.");

    await db.query("BEGIN");
    const call = (await db.query("SELECT * FROM missed_calls WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
    if (!call) throw Object.assign(Error("Missed call not found."), { status: 404 });

    const who = req.user.fullName || req.user.username;
    const attempt = (await db.query(
      `INSERT INTO callback_attempts(missed_call_id, staff_member, outcome, notes, next_follow_up_at, created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [call.id, who, outcome, notes || null, next_follow_up_at || null, who]
    )).rows[0];

    // Attempts document that the call is being worked; the final "resolved"/"closed" call is
    // still a deliberate staff choice on the entry itself, not inferred from an outcome here.
    const nextStatus = CLOSED_STATUSES.includes(call.status) ? call.status : "Callback attempted";
    const updated = (await db.query(
      "UPDATE missed_calls SET status=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *",
      [nextStatus, who, call.id]
    )).rows[0];

    await db.query("COMMIT");
    await logActivity({ req, resource: "missed_calls", recordId: call.id, action: "update", before: call, after: updated, summary: `Logged callback attempt: ${outcome}` });
    res.status(201).json({ attempt, call: updated });
  } catch (e) {
    await db.query("ROLLBACK");
    fail(res, e);
  } finally {
    db.release();
  }
});

module.exports = router;
