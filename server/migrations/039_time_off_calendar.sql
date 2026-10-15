-- Approved time off is put on the calendar (routes/staff.js calendarTimeOff): one "Time off"
-- appointment per day out, weekdays only unless the request is only weekend days; full days
-- 00:00 for 24 hours, partial days the request's hours; at most 60 days. The first time
-- this runs it adds the "Time off" calendar type and calendars the approved time off that
-- hasn't ended yet, from today on.
DO $$
DECLARE
  r RECORD; d DATE; ids UUID[]; aid UUID; first_day DATE; any_weekday BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'time_off_requests' AND column_name = 'appointment_ids') THEN
    ALTER TABLE time_off_requests ADD COLUMN appointment_ids UUID[] NOT NULL DEFAULT '{}';
    UPDATE board_settings
    SET data = jsonb_set(data, '{appointmentTypes}', coalesce(data->'appointmentTypes', '[]'::jsonb) || '["Time off"]'::jsonb),
        revision = revision + 1, updated_at = now()
    WHERE id = 1 AND NOT coalesce(data->'appointmentTypes', '[]'::jsonb) ? 'Time off';
    FOR r IN SELECT * FROM time_off_requests WHERE status = 'Approved' AND end_date >= CURRENT_DATE LOOP
      ids := '{}';
      first_day := GREATEST(r.start_date, CURRENT_DATE);
      SELECT bool_or(extract(isodow FROM g) < 6) INTO any_weekday
        FROM generate_series(first_day, LEAST(r.end_date, first_day + 59), interval '1 day') g;
      FOR d IN SELECT g::date FROM generate_series(first_day, LEAST(r.end_date, first_day + 59), interval '1 day') g LOOP
        CONTINUE WHEN any_weekday AND extract(isodow FROM d) >= 6;
        INSERT INTO appointments(title, appointment_type, appointment_date, appointment_time, duration, location, created_by, updated_by)
        VALUES (r.full_name || ' – ' || CASE WHEN r.request_type = 'Other' THEN 'Other: ' || coalesce(r.other_reason, '') ELSE r.request_type END,
                'Time off', d,
                CASE WHEN r.partial_day AND r.start_time IS NOT NULL AND r.end_time IS NOT NULL THEN r.start_time ELSE '00:00'::time END,
                CASE WHEN r.partial_day AND r.start_time IS NOT NULL AND r.end_time IS NOT NULL
                     THEN GREATEST(5, (extract(epoch FROM (r.end_time - r.start_time)) / 60)::int) ELSE 1440 END,
                'Out', 'Time off', 'Time off')
        RETURNING id INTO aid;
        ids := ids || aid;
      END LOOP;
      UPDATE time_off_requests SET appointment_ids = ids WHERE id = r.id;
    END LOOP;
  END IF;
END $$;
