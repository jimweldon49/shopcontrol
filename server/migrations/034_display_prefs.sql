-- Each user's own look: theme, text size and highlight color (Display button in the
-- header; options in client/shared.js displayOptions).
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
