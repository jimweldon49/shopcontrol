-- Customer update schedule:
--   * first call within 24 hours of the car being marked onsite (every job);
--   * then every 2 days for smaller jobs (RO under $4,000), every 3 days for larger
--     jobs ($4,000+) or anything flagged "Structural repair".
-- Setting "Customer Updated" to Yes stamps customer_updated_at; the server's reminder
-- scan (src/customerUpdateReminders.js) flips it back to No when the next update is
-- due, which puts the car back under Customer Updates Needed.
-- Keep in sync with ShopModel.customerUpdateDueAt in client/shared.js.
ALTER TABLE daily_go_list ADD COLUMN IF NOT EXISTS customer_updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION customer_update_due_at(p_onsite_at TIMESTAMPTZ, p_updated_at TIMESTAMPTZ, p_ro_amount NUMERIC, p_flags TEXT[])
RETURNS TIMESTAMPTZ AS $$
 SELECT CASE
   WHEN p_onsite_at IS NULL THEN NULL
   WHEN p_updated_at IS NULL OR p_updated_at < p_onsite_at THEN p_onsite_at + interval '24 hours'
   WHEN coalesce(p_ro_amount, 0) >= 4000 OR 'Structural repair' = ANY(coalesce(p_flags, '{}')) THEN p_updated_at + interval '3 days'
   ELSE p_updated_at + interval '2 days'
 END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION stamp_customer_updated_at() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.customer_updated_today = 'Yes' AND (TG_OP = 'INSERT' OR OLD.customer_updated_today IS DISTINCT FROM 'Yes') THEN
   NEW.customer_updated_at := now();
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zz_daily_stamp_customer_updated_at ON daily_go_list;
CREATE TRIGGER zz_daily_stamp_customer_updated_at BEFORE INSERT OR UPDATE ON daily_go_list
 FOR EACH ROW EXECUTE FUNCTION stamp_customer_updated_at();

-- Cars already marked "updated" before this existed: we don't know when the call
-- was, so count it as today rather than flagging every car at once.
UPDATE daily_go_list SET customer_updated_at = now()
 WHERE customer_updated_today = 'Yes' AND customer_updated_at IS NULL AND onsite;
