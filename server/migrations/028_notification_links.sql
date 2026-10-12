-- What a notification or mailbox message is about, so tapping it opens that thing:
-- { "type": "timeoff" | "punch" | "payfix" | "core", "id": <request id>, "ro": <RO>,
--   "view": "review" (office reviewing a request) | "mine" (the employee's own request) }.
ALTER TABLE employee_notifications ADD COLUMN IF NOT EXISTS link JSONB;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS link JSONB;

-- Links for notifications sent before this. Older ones don't know which request they
-- were about, so they open the list.
UPDATE employee_notifications n SET link = jsonb_build_object('type', 'core', 'ro', e.ro_number, 'partId', e.part_id)
FROM core_events e WHERE n.link IS NULL AND n.event_id = e.id;
UPDATE employee_notifications SET link = jsonb_build_object('type',
    CASE WHEN title LIKE 'Time-off request · %' THEN 'timeoff' WHEN title LIKE 'Missed punch · %' THEN 'punch' ELSE 'payfix' END,
    'view', 'review')
WHERE link IS NULL AND event_id IS NULL
  AND (title LIKE 'Time-off request · %' OR title LIKE 'Missed punch · %' OR title LIKE 'Payroll correction · %');
UPDATE staff_messages SET link = jsonb_build_object('type',
    CASE audience WHEN 'Time Off' THEN 'timeoff' WHEN 'Missed Punch' THEN 'punch' ELSE 'payfix' END,
    'view', 'mine')
WHERE link IS NULL AND audience IN ('Time Off', 'Missed Punch', 'Payroll Correction')
  AND (subject LIKE '% APPROVED: %' OR subject LIKE '% DENIED: %');
