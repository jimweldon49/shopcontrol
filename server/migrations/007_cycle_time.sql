ALTER TABLE daily_go_list ADD COLUMN IF NOT EXISTS ro_amount NUMERIC(10,2);
ALTER TABLE daily_go_list ADD COLUMN IF NOT EXISTS cycle_24h_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE daily_go_list ADD COLUMN IF NOT EXISTS cycle_past_due_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_daily_ro_amount ON daily_go_list (ro_amount);
