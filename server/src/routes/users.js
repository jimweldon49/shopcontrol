const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { logActivity } = require("../activityLogger");

const router = express.Router();

const USER_FIELDS = "id, username, full_name, email, role, can_delete, active, created_at";
const ALLOWED_ROLES = ["admin", "owner", "manager", "office", "estimator", "parts", "paint", "body", "qc", "cleanup", "employee"];

function normalizeRole(role) {
  const value = String(role || "employee").toLowerCase();
  return ALLOWED_ROLES.includes(value) ? value : "employee";
}

// List employees (no password hashes returned)
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query(`SELECT ${USER_FIELDS} FROM users ORDER BY active DESC, full_name`);
  res.json(result.rows);
});

// Create a new employee login
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { username, password, fullName, email, role, canDelete } = req.body || {};
  if (!username || !password || !fullName) {
    return res.status(400).json({ error: "username, password, and fullName are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role, can_delete)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${USER_FIELDS}`,
      [
        username.trim().toLowerCase(),
        passwordHash,
        fullName,
        email ? String(email).trim().toLowerCase() : null,
        normalizeRole(role),
        canDelete === false ? false : true,
      ]
    );

    await logActivity({
      req,
      resource: "users",
      recordId: result.rows[0].id,
      action: "create",
      after: result.rows[0],
      summary: `Created user ${result.rows[0].username}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That username is already taken." });
    }
    console.error("Create user error:", err);
    res.status(500).json({ error: "Failed to create user." });
  }
});

// Update an employee: active status, role, delete permission, full name.
router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { active, role, canDelete, fullName, email } = req.body || {};

  const beforeResult = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [req.params.id]);
  const before = beforeResult.rows[0];
  if (!before) return res.status(404).json({ error: "User not found." });

  if (active === false && req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't deactivate your own account." });
  }
  if (role && normalizeRole(role) !== before.role && req.params.id === req.user.id && !["admin", "owner"].includes(normalizeRole(role))) {
    return res.status(400).json({ error: "You can't remove your own admin access." });
  }

  const nextActive = typeof active === "boolean" ? active : before.active;
  const nextRole = role ? normalizeRole(role) : before.role;
  const nextCanDelete = typeof canDelete === "boolean" ? canDelete : before.can_delete;
  const nextFullName = typeof fullName === "string" && fullName.trim() ? fullName.trim() : before.full_name;
  const nextEmail = typeof email === "string" ? (email.trim() ? email.trim().toLowerCase() : null) : before.email;

  const result = await pool.query(
    `UPDATE users SET active = $1, role = $2, can_delete = $3, full_name = $4, email = $5
     WHERE id = $6
     RETURNING ${USER_FIELDS}`,
    [nextActive, nextRole, nextCanDelete, nextFullName, nextEmail, req.params.id]
  );

  await logActivity({
    req,
    resource: "users",
    recordId: result.rows[0].id,
    action: "update",
    before,
    after: result.rows[0],
    summary: `Updated user ${result.rows[0].username}`,
  });

  res.json(result.rows[0]);
});

// Reset a user's password
router.post("/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const beforeResult = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [req.params.id]);
  const before = beforeResult.rows[0];
  if (!before) return res.status(404).json({ error: "User not found." });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING ${USER_FIELDS}`,
    [passwordHash, req.params.id]
  );

  await logActivity({
    req,
    resource: "users",
    recordId: result.rows[0].id,
    action: "update",
    before,
    after: { ...result.rows[0], password_reset: true },
    summary: `Reset password for ${result.rows[0].username}`,
  });

  res.json({ success: true });
});

module.exports = router;
