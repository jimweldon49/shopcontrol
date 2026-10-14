-- When a part was marked as having a core (the 3-day return clock starts then), and when
-- the "core not returned in 3 days" email went out to all staff (src/coreNotifications.js).
-- Unticking Core returned, or ticking Has a core again, restarts the clock and the email.
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS core_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS core_overdue_alerted_at TIMESTAMPTZ;

UPDATE parts p SET core_flagged_at = coalesce(
  (SELECT max(e.created_at) FROM core_events e WHERE e.part_id = p.id), p.updated_at)
WHERE p.has_core AND NOT p.core_returned AND p.core_flagged_at IS NULL;

CREATE OR REPLACE FUNCTION set_core_flagged_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.has_core AND NOT NEW.core_returned AND (TG_OP = 'INSERT' OR NOT OLD.has_core OR OLD.core_returned) THEN
    NEW.core_flagged_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS part_core_flagged_at_trigger ON parts;
CREATE TRIGGER part_core_flagged_at_trigger BEFORE INSERT OR UPDATE OF has_core, core_returned ON parts
  FOR EACH ROW EXECUTE FUNCTION set_core_flagged_at();
