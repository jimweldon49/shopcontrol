-- Missed punch slips: the paper "Missed Punch" form, filed from the employee app and
-- approved by an admin (see src/routes/staff.js). Payroll runs Thursday to Wednesday.

CREATE TABLE IF NOT EXISTS missed_punch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  punch_date DATE NOT NULL,
  time_in TIME NOT NULL,
  lunch_out TIME,
  lunch_in TIME,
  time_out TIME NOT NULL,
  initials TEXT NOT NULL CHECK (btrim(initials) <> ''),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Denied','Cancelled')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((lunch_out IS NULL) = (lunch_in IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_missed_punch_status ON missed_punch_requests(status, punch_date);
CREATE INDEX IF NOT EXISTS idx_missed_punch_user ON missed_punch_requests(user_id, created_at DESC);
