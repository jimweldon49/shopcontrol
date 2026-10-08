-- Payroll correction forms: page 1 of the paper "Payroll Correction Form", filed from
-- the employee app and approved by an admin, which stands in for the supervisor's
-- signature (see src/routes/staff.js). days holds one entry per date in question:
-- [{ "date": "2026-10-05", "from": "08:00", "to": "16:30", "hours": 8 }].

CREATE TABLE IF NOT EXISTS payroll_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  employee_number TEXT,
  phone TEXT NOT NULL,
  days JSONB NOT NULL,
  total_hours NUMERIC(6,2) NOT NULL,
  programs TEXT,
  explanation TEXT NOT NULL,
  payout TEXT NOT NULL CHECK (payout IN ('Next payroll','Separate check')),
  signature TEXT NOT NULL CHECK (btrim(signature) <> ''),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Denied','Cancelled')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_corrections_status ON payroll_corrections(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_corrections_user ON payroll_corrections(user_id, created_at DESC);
