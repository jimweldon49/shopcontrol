-- Customer status page (conceptautobody.app/update, see src/routes/portal.js).
--
-- Private links live in their own table so making one doesn't bump the job's
-- version (which would make an open job editor fail to save).
CREATE TABLE IF NOT EXISTS customer_portal_links (
  job_id UUID PRIMARY KEY REFERENCES daily_go_list(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages the office writes for the customer; shown newest first on the page.
CREATE TABLE IF NOT EXISTS customer_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES daily_go_list(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (btrim(message) <> ''),
  created_by TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_updates_job ON customer_updates(job_id, created_at DESC);

-- When the stage last changed, and the last stage that wasn't "On Hold", so a car
-- put on hold keeps showing the customer how far along it got.
ALTER TABLE daily_go_list
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_progress_stage TEXT;

CREATE OR REPLACE FUNCTION track_progress_stage() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
    NEW.stage_changed_at := now();
  END IF;
  IF NEW.current_stage IS NOT NULL AND NEW.current_stage <> 'On Hold' THEN
    NEW.last_progress_stage := NEW.current_stage;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- "zz_" so it runs after unified_job_state_trigger has settled the final stage.
DROP TRIGGER IF EXISTS zz_track_progress_stage ON daily_go_list;
CREATE TRIGGER zz_track_progress_stage BEFORE INSERT OR UPDATE ON daily_go_list
  FOR EACH ROW EXECUTE FUNCTION track_progress_stage();

-- Existing jobs are not backfilled (that would run every job through the job
-- triggers); the page falls back to updated_at and current_stage until a job moves.
