-- Concept Shop Control upgrade migration
-- Safe to run against an existing database. It adds fields/tables only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'employee';

ALTER TABLE daily_go_list
  ADD COLUMN IF NOT EXISTS supplement_submitted TEXT,
  ADD COLUMN IF NOT EXISTS supplement_approved TEXT;

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
