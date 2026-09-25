-- Staff hub: time-off requests, internal staff messages and admin-editable company
-- info, used by the employee mobile app and the desktop (see src/routes/staff.js).

CREATE TABLE IF NOT EXISTS time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('Sick','Vacation','Bereavement','Time off without pay','Military','Jury duty','Maternity/Paternity','Other')),
  other_reason TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  partial_day BOOLEAN NOT NULL DEFAULT false,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Denied','Cancelled')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (request_type <> 'Other' OR btrim(coalesce(other_reason, '')) <> '')
);
CREATE INDEX IF NOT EXISTS idx_time_off_status ON time_off_requests(status, start_date);
CREATE INDEX IF NOT EXISTS idx_time_off_user ON time_off_requests(user_id, created_at DESC);

-- One row per recipient, so each person has their own read status. Messages sent to
-- a group share a group_id; replies point at the message they answer.
CREATE TABLE IF NOT EXISTS staff_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to UUID REFERENCES staff_messages(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_messages_inbox ON staff_messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_messages_sender ON staff_messages(sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
