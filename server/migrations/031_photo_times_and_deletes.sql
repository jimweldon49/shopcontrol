-- When a photo was taken (from the photo's own date, or the phone's file date), and
-- deleted photos. A deleted photo is hidden everywhere but its file is kept, so it can be
-- brought back; who deleted it is also in the activity log.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS deleted_by_id UUID;
