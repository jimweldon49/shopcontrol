-- Staff training (src/routes/training.js): each person's courses for the year (I-CAR and
-- others) with a due date. Scheduling a course puts it on the calendar as a Training
-- appointment. Anyone behind pace gets a weekly reminder (src/trainingAlerts.js).
CREATE TABLE IF NOT EXISTS training_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course TEXT NOT NULL CHECK (btrim(course) <> ''),
  provider TEXT NOT NULL DEFAULT 'I-CAR',
  due_date DATE NOT NULL,
  scheduled_date DATE,
  scheduled_time TIME,
  duration INTEGER NOT NULL DEFAULT 240 CHECK (duration BETWEEN 15 AND 1440),
  location TEXT,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  completed_on DATE,
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_user ON training_courses(user_id, due_date);

-- One row per week the "behind on training" reminders went out (Mondays).
CREATE TABLE IF NOT EXISTS training_alert_weeks (
  week_start DATE PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  people INTEGER NOT NULL DEFAULT 0
);
