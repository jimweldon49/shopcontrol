-- One row per shop day the 6:00 AM cycle time email went out (src/cycleTimeAlerts.js),
-- so it's sent once a day even if the server restarts. The first time this runs it also
-- adds the "DRP" card flag (DRP jobs get the tier's cycle days; all others get one more).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cycle_digest_days') THEN
    UPDATE board_settings
    SET data = jsonb_set(data, '{flags}', coalesce(data->'flags', '[]'::jsonb) || '["DRP"]'::jsonb),
        revision = revision + 1, updated_at = now()
    WHERE id = 1 AND NOT coalesce(data->'flags', '[]'::jsonb) ? 'DRP';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cycle_digest_days (
  day DATE PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cars INTEGER NOT NULL DEFAULT 0
);
