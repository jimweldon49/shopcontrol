// Shop board: the touch screen in the shop where technicians move cars to their next
// production stage. It signs in with a "shopboard" account that can see everything
// but change only a car's production stage, through this route. Each move is logged
// under the technician who tapped their name, e.g. "Luis S (shop board)".
const express = require("express");
const { pool } = require("../db");
const { requireAuth, hasPermission } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");
const ShopModel = require("../../../client/shared.js");

const router = express.Router();
router.use(requireAuth);

const BOARD_ROLES = ["shopboard"];
const NOT_PEOPLE = ["display", "shopboard"];
const isBoard = (user) => BOARD_ROLES.includes(String((user && user.role) || "").toLowerCase());
const canMove = (user) => isBoard(user) || hasPermission(user, "daily", "update");

function fail(res, e) {
  console.error("Shop board request:", e.message);
  res.status(e.status || 400).json({ error: e.message });
}
const err = (status, message) => Object.assign(Error(message), { status });

// The people who can be picked as "who's moving it" on the board.
router.get("/people", async (req, res) => {
  try {
    if (!canMove(req.user)) throw err(403, "This account can't move cars.");
    res.json((await pool.query(
      "SELECT id, full_name, department FROM users WHERE active = true AND NOT (role = ANY($1)) ORDER BY full_name",
      [NOT_PEOPLE])).rows);
  } catch (e) { fail(res, e); }
});

// Move a car to another production stage.
router.post("/move", async (req, res) => {
  try {
    if (!canMove(req.user)) throw err(403, "This account can't move cars.");
    const { job_id: jobId, stage, moved_by: movedBy, expected_version: expectedVersion } = req.body || {};
    if (!ShopModel.production.includes(stage)) throw err(400, "Choose a production stage.");
    if (!/^[0-9a-f-]{36}$/i.test(String(jobId || ""))) throw err(404, "Car not found.");

    // Who is moving it: required on the shop board, otherwise the signed-in person.
    let mover = { id: req.user.id, username: req.user.username, fullName: req.user.fullName };
    if (movedBy || isBoard(req.user)) {
      if (!/^[0-9a-f-]{36}$/i.test(String(movedBy || ""))) throw err(400, "Tap your name to move the car.");
      const person = (await pool.query(
        "SELECT id, username, full_name FROM users WHERE id = $1 AND active = true AND NOT (role = ANY($2))",
        [movedBy, NOT_PEOPLE])).rows[0];
      if (!person) throw err(400, "Tap your name to move the car.");
      mover = { id: person.id, username: person.username, fullName: isBoard(req.user) ? `${person.full_name} (shop board)` : person.full_name };
    }

    const before = (await pool.query("SELECT * FROM daily_go_list WHERE id = $1", [jobId])).rows[0];
    if (!before || before.merged_into) throw err(404, "Car not found.");
    if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== before.version) {
      throw err(409, "Someone just changed this car. The board has been refreshed; try again.");
    }
    if (before.current_stage === stage) return res.json(before);

    const after = (await pool.query(
      `UPDATE daily_go_list SET current_stage = $1, onsite = true, updated_at = now(), updated_by = $2
       WHERE id = $3 AND version = $4 RETURNING *`,
      [stage, mover.fullName, jobId, before.version])).rows[0];
    if (!after) throw err(409, "Someone just changed this car. The board has been refreshed; try again.");

    await logActivity({
      req: { user: mover },
      resource: "daily",
      recordId: after.id,
      action: "update",
      before,
      after,
      summary: `Moved from ${before.current_stage || "—"} to ${stage}${isBoard(req.user) ? " on the shop board" : ""}`,
    });
    res.json(after);
  } catch (e) { fail(res, e); }
});

module.exports = router;
