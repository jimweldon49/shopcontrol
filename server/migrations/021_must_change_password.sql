-- Accounts created by an admin (or given an admin password reset) must choose their
-- own password at first sign-in. While set, the API refuses everything except
-- /api/auth/me and /api/auth/change-password (see middleware/auth.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
