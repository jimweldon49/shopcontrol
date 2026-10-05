-- Capture opportunities: jobs without a five-digit RO (job_kind = 'opportunity').
-- They no longer get cycle time alerts. Instead office staff get at most 3 reminders
-- to call the customer, 2 days apart; a logged call pushes the next one out 2 days.
-- After the 3rd reminder they stop for good (see src/captureOpportunityAlerts.js).
-- Reminder state lives in its own table so the scan never bumps a job's version.
BEGIN;
CREATE TABLE IF NOT EXISTS capture_calls(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES daily_go_list(id) ON DELETE CASCADE,
  called_by TEXT NOT NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_capture_calls_job ON capture_calls(job_id, called_at);

CREATE TABLE IF NOT EXISTS capture_alert_state(
  job_id UUID PRIMARY KEY REFERENCES daily_go_list(id) ON DELETE CASCADE,
  alerts_sent INTEGER NOT NULL DEFAULT 0,
  last_alert_at TIMESTAMPTZ
);
COMMIT;
