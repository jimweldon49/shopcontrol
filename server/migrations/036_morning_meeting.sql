-- Morning meeting (src/routes/meeting.js): topics anyone posts during the day for the
-- Housekeeping section (anonymous ones print as "Anonymous"; managers still see who
-- sent them). 'open' until the meeting covers them ('covered', with the day)
-- or the office removes them ('hidden'). The first time this runs it also adds Meeting
-- and Training calendar types, which the meeting notes list for the day.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'meeting_topics') THEN
    UPDATE board_settings
    SET data = jsonb_set(data, '{appointmentTypes}',
          coalesce(data->'appointmentTypes', '[]'::jsonb)
          || (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM unnest(ARRAY['Meeting', 'Training']) t
              WHERE NOT coalesce(data->'appointmentTypes', '[]'::jsonb) ? t)),
        revision = revision + 1, updated_at = now()
    WHERE id = 1;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS meeting_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL CHECK (btrim(text) <> ''),
  submitted_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'covered', 'hidden')),
  covered_on DATE,
  edited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE meeting_topics ADD COLUMN IF NOT EXISTS anonymous BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_meeting_topics_open ON meeting_topics(status, created_at);

-- The day's sheet as the office published it to the employee app (no dollar amounts).
CREATE TABLE IF NOT EXISTS meeting_published (
  day DATE PRIMARY KEY,
  sections JSONB NOT NULL,
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
