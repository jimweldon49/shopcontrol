-- CCC EMS supplements can arrive before the shop's real RO number is entered into
-- CCC (env.RO_ID blank), so the importer previously fell back to using the CCC
-- package/file id (env.ESTFILE_ID) as a stand-in RO number. Once the real RO
-- number later appeared, the importer no longer matched the existing job and
-- created a duplicate Daily GO List card + duplicate parts instead of updating it.
--
-- ESTFILE_ID is stable across the initial estimate and every later supplement for
-- the same job, so store it separately and match on it first.
ALTER TABLE daily_go_list ADD COLUMN IF NOT EXISTS ccc_estfile_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_ccc_estfile_id ON daily_go_list(ccc_estfile_id) WHERE ccc_estfile_id IS NOT NULL;
