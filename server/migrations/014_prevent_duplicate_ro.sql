-- Stop the same RO number from being put on two different jobs (e.g. RO 17944 was
-- typed onto both a Honda Accord and an unrelated Colorado estimate, which mixed
-- their parts up). Only checked when an RO is entered or changed, so jobs that
-- already share one (from before this rule) can still be saved while they get
-- cleaned up. Merged cards are ignored, and numbers under 100 (stand-ins such as
-- "00001" used to schedule a car before it has a real RO) are allowed to repeat.
-- CCC supplements are unaffected: they update the job that already has the RO.
CREATE OR REPLACE FUNCTION prevent_duplicate_ro() RETURNS TRIGGER AS $$
DECLARE
 ro TEXT := btrim(coalesce(NEW.ro_number, ''));
 other RECORD;
BEGIN
 IF NEW.merged_into IS NOT NULL OR ro !~ '^[0-9]+$' THEN RETURN NEW; END IF;
 IF ro::numeric < 100 THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND btrim(coalesce(OLD.ro_number, '')) = ro THEN RETURN NEW; END IF;

 SELECT customer_name, vehicle INTO other FROM daily_go_list
  WHERE id <> NEW.id AND merged_into IS NULL AND btrim(ro_number) = ro
  LIMIT 1;
 IF FOUND THEN
   RAISE EXCEPTION 'RO % is already on another job (%). Check the RO number in CCC before saving.',
     ro, coalesce(nullif(btrim(other.customer_name), ''), 'no customer name')
     USING ERRCODE = '23505';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS daily_prevent_duplicate_ro ON daily_go_list;
CREATE TRIGGER daily_prevent_duplicate_ro BEFORE INSERT OR UPDATE OF ro_number, merged_into ON daily_go_list
 FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_ro();
