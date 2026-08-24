const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { sendPasswordResetEmail } = require("../mailer");
const { logActivity } = require("../activityLogger");

const router = express.Router();


function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicClientUrl() {
  return (process.env.PUBLIC_CLIENT_URL || process.env.CORS_ORIGIN || "http://localhost:8080").split(",")[0].trim();
}

// Request password reset email.
// Always returns success message so usernames/emails cannot be guessed.
router.post("/forgot-password", async (req, res) => {
  const { identifier } = req.body || {};
  if (!identifier) {
    return res.json({ success: true, message: "If that account exists, a reset email has been sent." });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, full_name, email, active
       FROM users
       WHERE lower(username) = lower($1)
       LIMIT 1`,
      [String(identifier).trim()]
    );
    const user = result.rows[0];

    if (user && user.active && user.email) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(token);
      const expiresMinutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
        [user.id, tokenHash, String(expiresMinutes)]
      );

      const resetUrl = `${publicClientUrl()}?resetToken=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail({
        to: user.email,
        name: user.full_name || user.username,
        resetUrl,
        expiresMinutes,
      });

      await logActivity({
        req: { user: { username: "system", fullName: "Password Reset" } },
        resource: "auth",
        recordId: user.id,
        action: "create",
        summary: `Password reset requested for ${user.username}`,
        after: { username: user.username },
      });
    }

    res.json({ success: true, message: "If that account exists, a reset email has been sent." });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Password reset request failed." });
  }
});

// Complete password reset with token from email.
router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: "Reset token and new password are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const tokenHash = hashResetToken(token);
    const result = await pool.query(
      `SELECT prt.id AS token_id, prt.user_id, u.username
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > now()
         AND u.active = TRUE
       LIMIT 1`,
      [tokenHash]
    );

    const reset = result.rows[0];
    if (!reset) {
      return res.status(400).json({ error: "This reset link is invalid or expired." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, reset.user_id]);
    await pool.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [reset.token_id]);

    await logActivity({
      req: { user: { username: "system", fullName: "Password Reset" } },
      resource: "auth",
      recordId: reset.user_id,
      action: "update",
      summary: `Password reset completed for ${reset.username}`,
      after: { username: reset.username, password_reset: true },
    });

    res.json({ success: true, message: "Password has been reset. You can log in now." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Password reset failed." });
  }
});


router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash, full_name, role, can_delete, active FROM users WHERE username = $1",
      [username.trim().toLowerCase()]
    );
    const user = result.rows[0];

    // Use the same generic error whether the user doesn't exist or the password is wrong,
    // and always run bcrypt.compare to avoid leaking which case it was via timing.
    const dummyHash = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8gO3Hj5s0X6z1z1z1z1z1z1z1z1z1u";
    const isMatch = await bcrypt.compare(password, user ? user.password_hash : dummyHash);

    if (!user || !user.active || !isMatch) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const claims = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      canDelete: user.can_delete,
    };

    const token = jwt.sign(claims, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "12h",
    });

    res.json({ token, user: claims });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
