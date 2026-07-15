const express = require("express");
const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requirePermission("activity", "list"), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "300", 10), 1000);
    const result = await pool.query(
      `SELECT id, resource, record_id, action, summary, changes, username, full_name, created_at
       FROM activity_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Activity list error:", err);
    res.status(500).json({ error: "Failed to load activity log." });
  }
});

module.exports = router;
