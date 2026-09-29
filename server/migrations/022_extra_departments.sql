-- Extra QC checklists an employee also does, besides their main department (e.g. a
-- body tech who reassembles the cars they work on also does Reassy). Shown as
-- their own checklist buttons in the Employee App. Values are QC department names
-- (client/qcChecklists.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_departments TEXT[] NOT NULL DEFAULT '{}';
