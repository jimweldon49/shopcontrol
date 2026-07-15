-- Concept Shop Control - Database Schema
-- PostgreSQL

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ============================================================
-- USERS (employee logins)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'employee', -- admin, owner, manager, office, estimator, parts, paint, body, qc, cleanup, employee
  can_delete    BOOLEAN NOT NULL DEFAULT TRUE, -- can this person delete records?
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- PASSWORD RESET TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens (token_hash);

-- ============================================================
-- DAILY GO LIST (vehicles)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_go_list (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ro_number                TEXT,
  customer_name            TEXT,
  vehicle                  TEXT,
  location                 TEXT,
  current_stage            TEXT,
  priority                 TEXT,
  assigned_to              TEXT,
  department_responsible   TEXT,
  hold_up_reason           TEXT,
  target_delivery_date     DATE,
  actual_delivered_date    DATE,
  customer_updated_today   TEXT,
  estimate_needed          TEXT,
  estimate_completed       TEXT,
  supplement_needed        TEXT,
  supplement_submitted     TEXT,
  supplement_approved      TEXT,
  supplement_completed     TEXT,
  needs_management_help    TEXT,
  todays_goal              TEXT,
  management_issue         TEXT,
  end_of_day_status        TEXT,
  end_of_day_notes         TEXT,
  delivered_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT,
  updated_by               TEXT
);
CREATE INDEX IF NOT EXISTS idx_daily_stage ON daily_go_list (current_stage);
CREATE INDEX IF NOT EXISTS idx_daily_priority ON daily_go_list (priority);

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name                 TEXT,
  task_assigned_to          TEXT,
  task_assigned_by          TEXT,
  task_due_date             DATE,
  task_priority             TEXT,
  task_status               TEXT,
  task_waiting_on           TEXT,
  task_management_notified  TEXT,
  task_notes                TEXT,
  completed_date            DATE,
  task_assigned_email_sent_at TIMESTAMPTZ,
  task_reminder_1h_sent_at    TIMESTAMPTZ,
  task_reminder_3h_sent_at    TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                TEXT,
  updated_by                TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (task_status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks (task_due_date);

-- ============================================================
-- PARTS
-- ============================================================
CREATE TABLE IF NOT EXISTS parts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parts_ro_number        TEXT,
  parts_customer_name    TEXT,
  parts_vehicle          TEXT,
  part_description       TEXT,
  part_type              TEXT,
  part_vendor            TEXT,
  part_status            TEXT,
  part_priority          TEXT,
  part_ordered_date      DATE,
  part_eta               DATE,
  part_received_date     DATE,
  part_mirror_matched    TEXT,
  part_return_needed     TEXT,
  part_credit_needed     TEXT,
  part_assigned_to       TEXT,
  part_last_follow_up    DATE,
  part_notes             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             TEXT,
  updated_by             TEXT
);
CREATE INDEX IF NOT EXISTS idx_parts_status ON parts (part_status);

-- ============================================================
-- VEHICLE QC
-- ============================================================
CREATE TABLE IF NOT EXISTS qc_records (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_ro_number             TEXT,
  qc_customer_name         TEXT,
  qc_vehicle               TEXT,
  qc_date                  DATE,
  qc_performed_by          TEXT,
  qc_final_status          TEXT,
  qc_body_work             TEXT,
  qc_paint_quality         TEXT,
  qc_color_match           TEXT,
  qc_panel_alignment       TEXT,
  qc_electrical            TEXT,
  qc_calibration           TEXT,
  qc_interior              TEXT,
  qc_exterior              TEXT,
  qc_warning_lights        TEXT,
  qc_test_drive_needed     TEXT,
  qc_test_drive_completed  TEXT,
  qc_customer_items        TEXT,
  qc_rework_needed         TEXT,
  qc_rework_assigned_to    TEXT,
  qc_rework_due_date       DATE,
  qc_customer_called       TEXT,
  qc_issues                TEXT,
  qc_delivery_notes        TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT,
  updated_by               TEXT
);
CREATE INDEX IF NOT EXISTS idx_qc_status ON qc_records (qc_final_status);

-- ============================================================
-- PAINT BOOTH FILTER LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS booth_inspections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_date             DATE,
  booth_painter          TEXT,
  intake_filters         TEXT,
  exhaust_filters        TEXT,
  rear_filters           TEXT,
  filters_changed        TEXT,
  picture_sent           TEXT,
  helper_assisted        TEXT,
  management_verified    TEXT,
  booth_notes            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             TEXT,
  updated_by             TEXT
);

-- ============================================================
-- WEEKLY FACILITY CHECKLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS facility_checklist (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_week          DATE,
  facility_area          TEXT,
  facility_item          TEXT,
  facility_status        TEXT,
  facility_completed_by  TEXT,
  facility_verified      TEXT,
  facility_notes         TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             TEXT,
  updated_by             TEXT
);


-- ============================================================
-- ACTIVITY LOG (who changed what)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource      TEXT NOT NULL,
  record_id     UUID,
  action        TEXT NOT NULL,
  summary       TEXT,
  changes       JSONB,
  before_data   JSONB,
  after_data    JSONB,
  user_id       UUID,
  username      TEXT,
  full_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_resource ON activity_log (resource, record_id);

-- ============================================================
-- ATTACHMENTS / PHOTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource       TEXT NOT NULL,
  record_id      UUID NOT NULL,
  original_name  TEXT NOT NULL,
  stored_name    TEXT NOT NULL,
  mime_type      TEXT,
  size_bytes     INTEGER,
  file_url       TEXT NOT NULL,
  note           TEXT,
  uploaded_by    TEXT,
  user_id        UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments (resource, record_id);
CREATE INDEX IF NOT EXISTS idx_attachments_created ON attachments (created_at DESC);
