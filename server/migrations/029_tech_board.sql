-- Tech Board (src/routes/techBoard.js): cars the office puts on TODAY, and which
-- departments and techs need to work on each one. A department's assignment ends when
-- its QC checklist for the car is fully checked and signed after it was assigned; that's
-- worked out from qc_records when the board is read, so nothing here is marked done.
CREATE TABLE IF NOT EXISTS tech_board_jobs (
  job_id UUID PRIMARY KEY REFERENCES daily_go_list(id) ON DELETE CASCADE,
  hot BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  added_on DATE NOT NULL,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per department and tech; user_id NULL means "Any Tech" in that department.
CREATE TABLE IF NOT EXISTS tech_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES tech_board_jobs(job_id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_assignment_unique
  ON tech_assignments(job_id, department, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_tech_assignment_user ON tech_assignments(user_id);
