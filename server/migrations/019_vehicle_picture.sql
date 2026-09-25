-- Body type + base color picked for each job, choosing its picture on the production
-- board (client/img/vehicles/<type>-<color>.jpg; ids listed in client/shared.js).
-- Blank = guessed from the CCC vehicle description.
ALTER TABLE daily_go_list
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_color TEXT;
