// One-off CLI helper for creating the first admin login or any user.
//
// Usage:
//   node src/create-user.js <username> <password> "<Full Name>" [role] [canDelete] [email]
//
// Example:
//   node src/create-user.js josh "S0meStrongPass!" "Josh Agah" admin true

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("./db");

const ALLOWED_ROLES = ["admin", "owner", "manager", "office", "estimator", "parts", "paint", "body", "qc", "cleanup", "employee"];
function normalizeRole(role) {
  const value = String(role || "admin").toLowerCase();
  return ALLOWED_ROLES.includes(value) ? value : "employee";
}

async function main() {
  const [username, password, fullName, role, canDeleteArg] = process.argv.slice(2);

  if (!username || !password || !fullName) {
    console.error('Usage: node src/create-user.js <username> <password> "<Full Name>" [role] [canDelete] [email]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const canDelete = canDeleteArg === "false" ? false : true;

  try {
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role, can_delete)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, full_name, email, role, can_delete`,
      [username.trim().toLowerCase(), passwordHash, fullName, email ? email.trim().toLowerCase() : null, normalizeRole(role), canDelete]
    );
    console.log("Created user:", result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      console.error("A user with that username already exists.");
    } else {
      console.error("Failed to create user:", err.message);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
