BEGIN;
CREATE TABLE IF NOT EXISTS missed_calls(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entered_by TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  caller_name TEXT NOT NULL,
  company TEXT,
  callback_phone TEXT NOT NULL,
  email TEXT,
  caller_type TEXT NOT NULL DEFAULT 'Customer',
  reason TEXT NOT NULL DEFAULT 'Other',
  priority TEXT NOT NULL DEFAULT 'Normal',
  message TEXT NOT NULL,
  vehicle_year TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_vin TEXT,
  vehicle_plate TEXT,
  ro_number TEXT,
  claim_number TEXT,
  insurance_company TEXT,
  preferred_callback TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  closed_reason TEXT,
  escalation_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_missed_calls_status ON missed_calls(status);
CREATE INDEX IF NOT EXISTS idx_missed_calls_assigned ON missed_calls(assigned_to);
CREATE INDEX IF NOT EXISTS idx_missed_calls_created ON missed_calls(created_at);

CREATE TABLE IF NOT EXISTS callback_attempts(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  missed_call_id UUID NOT NULL REFERENCES missed_calls(id) ON DELETE CASCADE,
  staff_member TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome TEXT NOT NULL,
  notes TEXT,
  next_follow_up_at TIMESTAMPTZ,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_callback_attempts_call ON callback_attempts(missed_call_id, attempted_at);

CREATE TABLE IF NOT EXISTS missed_call_events(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  missed_call_id UUID NOT NULL REFERENCES missed_calls(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  recipients_created BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_missed_call_events_pending ON missed_call_events(recipients_created);

CREATE TABLE IF NOT EXISTS missed_call_notifications(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES missed_call_events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  email_sent_at TIMESTAMPTZ,
  email_attempts INTEGER NOT NULL DEFAULT 0,
  email_attempted_at TIMESTAMPTZ,
  admin_flagged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);
COMMIT;
