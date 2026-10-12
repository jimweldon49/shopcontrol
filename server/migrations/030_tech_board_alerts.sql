-- One row per shop day the end-of-day hot car email went out (src/techBoardAlerts.js),
-- so it's sent once a day even if the server restarts.
CREATE TABLE IF NOT EXISTS tech_board_alert_days (
  day DATE PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cars INTEGER NOT NULL DEFAULT 0,
  recipients INTEGER NOT NULL DEFAULT 0
);
