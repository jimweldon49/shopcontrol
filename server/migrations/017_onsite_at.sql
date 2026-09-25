-- When a vehicle was marked onsite, to the minute (in_date only has the day). Used to
-- hold off the "Customer Updates Needed" reminder until a car has been in the shop
-- for 24 hours. Reset each time the car goes from not-onsite to onsite; cleared when
-- it leaves.
ALTER TABLE daily_go_list ADD COLUMN IF NOT EXISTS onsite_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION track_onsite_at() RETURNS TRIGGER AS $$
BEGIN
 IF NOT coalesce(NEW.onsite, false) THEN
   NEW.onsite_at := NULL;
 ELSIF TG_OP = 'INSERT' OR NOT coalesce(OLD.onsite, false) OR NEW.onsite_at IS NULL THEN
   NEW.onsite_at := now();
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- BEFORE triggers run in name order: this must run after unified_job_state_trigger,
-- which can switch onsite off (e.g. when a car is delivered).
DROP TRIGGER IF EXISTS zz_daily_track_onsite_at ON daily_go_list;
CREATE TRIGGER zz_daily_track_onsite_at BEFORE INSERT OR UPDATE ON daily_go_list
 FOR EACH ROW EXECUTE FUNCTION track_onsite_at();

-- Cars already onsite before this existed: use their in-date (midnight), so they
-- aren't all treated as just arrived.
UPDATE daily_go_list SET onsite_at = in_date::timestamptz
 WHERE onsite AND onsite_at IS NULL AND in_date IS NOT NULL;
