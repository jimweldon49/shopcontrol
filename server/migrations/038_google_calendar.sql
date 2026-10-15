-- Two-way sync between the ShopControl calendar and one Google Calendar
-- (src/googleCalendar.js; off until GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_FILE are
-- set in .env). Any change made in ShopControl marks the appointment google_dirty so the
-- next sync pushes it; writes made by the sync itself set google_synced_at instead.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_event_id TEXT,
  ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_dirty BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_google_event ON appointments(google_event_id) WHERE google_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION mark_appointment_google_dirty() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.google_synced_at IS NULL THEN NEW.google_dirty := true; END IF;
  ELSIF NEW.google_synced_at IS NOT DISTINCT FROM OLD.google_synced_at THEN
    NEW.google_dirty := true;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS appointment_google_dirty_trigger ON appointments;
CREATE TRIGGER appointment_google_dirty_trigger BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION mark_appointment_google_dirty();

-- Deleted in ShopControl: remember the Google event so the next sync deletes it there too.
-- (Deletes made by the sync itself, because the event was deleted in Google, are skipped.)
CREATE TABLE IF NOT EXISTS google_calendar_deletes (
  event_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION remember_google_delete() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.google_event_id IS NOT NULL AND coalesce(current_setting('shopcontrol.google_pull', true), '') <> 'on' THEN
    INSERT INTO google_calendar_deletes(event_id) VALUES (OLD.google_event_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS appointment_google_delete_trigger ON appointments;
CREATE TRIGGER appointment_google_delete_trigger AFTER DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION remember_google_delete();

CREATE TABLE IF NOT EXISTS google_calendar_sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  calendar_id TEXT,
  sync_token TEXT,
  last_pull_at TIMESTAMPTZ,
  last_push_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ
);

-- Events made in Google come in as this calendar type (added once).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'google_calendar_type_added') THEN
    UPDATE board_settings
    SET data = jsonb_set(data, '{appointmentTypes}', coalesce(data->'appointmentTypes', '[]'::jsonb) || '["Google Calendar"]'::jsonb),
        revision = revision + 1, updated_at = now()
    WHERE id = 1 AND NOT coalesce(data->'appointmentTypes', '[]'::jsonb) ? 'Google Calendar';
    CREATE TABLE google_calendar_type_added (done BOOLEAN);
  END IF;
END $$;
