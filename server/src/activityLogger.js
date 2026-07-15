const { pool } = require("./db");

function simplifyValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function diffRows(before, after) {
  if (!before || !after) return null;
  const changes = {};
  Object.keys(after).forEach((key) => {
    if (key === "updated_at") return;
    const oldVal = simplifyValue(before[key]);
    const newVal = simplifyValue(after[key]);
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[key] = { old: oldVal ?? "", new: newVal ?? "" };
    }
  });
  return changes;
}

async function logActivity({ req, resource, recordId, action, before = null, after = null, summary = null }) {
  try {
    const user = req.user || {};
    const changes = action === "update" ? diffRows(before, after) : null;
    await pool.query(
      `INSERT INTO activity_log
        (resource, record_id, action, summary, changes, before_data, after_data, user_id, username, full_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        resource,
        recordId || null,
        action,
        summary,
        changes,
        before,
        after,
        user.id || null,
        user.username || null,
        user.fullName || null,
      ]
    );
  } catch (err) {
    console.error("Activity log error:", err.message);
  }
}

module.exports = { logActivity, diffRows };
