-- Department QC checklists (Check-In, Body, Paint, Reassy, Final QC; defined in
-- client/qcChecklists.js). Each employee can be assigned a QC department so the
-- mobile app opens their form automatically; each QC record is one department's
-- checklist for one RO.
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE qc_records
  ADD COLUMN IF NOT EXISTS qc_department TEXT,
  ADD COLUMN IF NOT EXISTS qc_checklist JSONB;
CREATE INDEX IF NOT EXISTS idx_qc_ro_department ON qc_records(qc_ro_number, qc_department);
