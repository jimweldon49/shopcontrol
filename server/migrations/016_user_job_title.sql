-- Free-text job title for each employee (e.g. "Body Tech", "Painter", "CSR"),
-- shown and edited in Employees. Separate from role (permissions) and department
-- (which QC checklist opens in the mobile app).
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
