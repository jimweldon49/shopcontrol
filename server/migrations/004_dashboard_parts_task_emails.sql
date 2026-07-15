-- Dashboard first, grouped parts UI, and task email/reminder support.
-- This migration adds task email tracking fields.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_assigned_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_reminder_1h_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_reminder_3h_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_email_reminders ON tasks (task_status, created_at, task_reminder_1h_sent_at, task_reminder_3h_sent_at);
