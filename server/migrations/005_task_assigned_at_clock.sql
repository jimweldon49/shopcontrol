ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_assigned_at TIMESTAMPTZ;

UPDATE tasks
SET task_assigned_at = created_at
WHERE task_assigned_to IS NOT NULL
  AND task_assigned_to <> ''
  AND task_assigned_at IS NULL;
