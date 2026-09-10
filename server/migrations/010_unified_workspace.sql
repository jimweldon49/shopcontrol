-- Run once after migrations 001-009. Safe to re-run. No existing job is deleted.
BEGIN;
ALTER TABLE daily_go_list
 ADD COLUMN IF NOT EXISTS onsite BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS job_kind TEXT NOT NULL DEFAULT 'opportunity',
 ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES daily_go_list(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS insurance TEXT,
 ADD COLUMN IF NOT EXISTS pay_type TEXT,
 ADD COLUMN IF NOT EXISTS estimator TEXT,
 ADD COLUMN IF NOT EXISTS body_hours NUMERIC NOT NULL DEFAULT 0 CHECK(body_hours>=0),
 ADD COLUMN IF NOT EXISTS paint_hours NUMERIC NOT NULL DEFAULT 0 CHECK(paint_hours>=0),
 ADD COLUMN IF NOT EXISTS other_hours NUMERIC NOT NULL DEFAULT 0 CHECK(other_hours>=0),
 ADD COLUMN IF NOT EXISTS body_techs TEXT[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS painters TEXT[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS support_techs TEXT[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS board_flags TEXT[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS card_color TEXT DEFAULT '#cfedf2',
 ADD COLUMN IF NOT EXISTS delivery_stage TEXT,
 ADD COLUMN IF NOT EXISTS planning_bucket TEXT NOT NULL DEFAULT 'Unscheduled',
 ADD COLUMN IF NOT EXISTS in_date DATE,
 ADD COLUMN IF NOT EXISTS dropoff_date DATE,
 ADD COLUMN IF NOT EXISTS pickup_date DATE,
 ADD COLUMN IF NOT EXISTS follow_up_date DATE,
 ADD COLUMN IF NOT EXISTS follow_up_notes TEXT,
 ADD COLUMN IF NOT EXISTS parts_status TEXT,
 ADD COLUMN IF NOT EXISTS commercial BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS legacy_board_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_board_id ON daily_go_list(legacy_board_id) WHERE legacy_board_id IS NOT NULL;
UPDATE daily_go_list SET job_kind=CASE WHEN btrim(coalesce(ro_number,'')) ~ '^[0-9]{5}$' THEN 'active' ELSE 'opportunity' END
WHERE job_kind IS DISTINCT FROM CASE WHEN btrim(coalesce(ro_number,'')) ~ '^[0-9]{5}$' THEN 'active' ELSE 'opportunity' END;
-- Arrival must be confirmed by staff. An import alone is not evidence a car is onsite.
CREATE INDEX IF NOT EXISTS idx_daily_job_kind ON daily_go_list(job_kind,current_stage);
CREATE TABLE IF NOT EXISTS board_settings(id INTEGER PRIMARY KEY CHECK(id=1), data JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS appointments(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID REFERENCES daily_go_list(id) ON DELETE SET NULL,
 title TEXT NOT NULL, appointment_type TEXT NOT NULL, appointment_date DATE NOT NULL, appointment_time TIME NOT NULL,
 duration INTEGER NOT NULL DEFAULT 30 CHECK(duration BETWEEN 5 AND 1440), location TEXT NOT NULL, notes TEXT,
 created_by TEXT, updated_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS legacy_board_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_appointment ON appointments(legacy_board_id) WHERE legacy_board_id IS NOT NULL;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS has_core BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS core_returned BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS core_events(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
 ro_number TEXT, description TEXT, assigned_to TEXT, recipients_created BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS employee_notifications(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID REFERENCES core_events(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, message TEXT NOT NULL,
 read_at TIMESTAMPTZ, email_sent_at TIMESTAMPTZ, email_attempts INTEGER NOT NULL DEFAULT 0,
 email_attempted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(event_id,user_id));
CREATE INDEX IF NOT EXISTS idx_notification_user ON employee_notifications(user_id,created_at);
CREATE OR REPLACE FUNCTION unified_job_state() RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP='UPDATE' THEN NEW.version:=OLD.version+1; END IF;
 NEW.ro_number:=btrim(coalesce(NEW.ro_number,''));
 NEW.job_kind:=CASE WHEN NEW.ro_number ~ '^[0-9]{5}$' THEN 'active' ELSE 'opportunity' END;
 IF NEW.current_stage='Scheduled' AND NEW.job_kind<>'active' THEN RAISE EXCEPTION 'Assign a five-digit RO before scheduling this job.'; END IF;
 IF NEW.job_kind='opportunity' OR NEW.current_stage IN ('Scheduled','On the Road','No Show','Delivered','Total Loss') THEN NEW.onsite:=false; END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.current_stage IS DISTINCT FROM OLD.current_stage AND NEW.delivery_stage IS NOT DISTINCT FROM OLD.delivery_stage THEN
     IF NEW.current_stage='Ready for Delivery' THEN NEW.delivery_stage:='Ready for Delivery';
     ELSIF NEW.current_stage='Delivered' THEN NEW.delivery_stage:='Delivered Waiting for Payment';
     ELSIF NEW.current_stage NOT IN ('Total Loss') THEN NEW.delivery_stage:=NULL; END IF;
   END IF;
 END IF;
 IF NEW.current_stage='Ready for Delivery' AND NEW.delivery_stage IS NULL THEN NEW.delivery_stage:='Ready for Delivery'; END IF;
 IF (TG_OP='INSERT' OR NEW.delivery_stage IS DISTINCT FROM OLD.delivery_stage) AND NEW.delivery_stage IS NOT NULL THEN
   IF NEW.delivery_stage IN ('Delivered Waiting for Payment','Delivered / Paid') THEN NEW.current_stage:='Delivered'; NEW.onsite:=false;
   ELSIF NEW.delivery_stage='Confirmed Total Loss Waiting for Pickup' THEN NEW.current_stage:='Total Loss'; NEW.onsite:=false;
   ELSE NEW.current_stage:='Ready for Delivery'; END IF;
 END IF;
 IF NEW.current_stage='Delivered' THEN NEW.delivered_at:=coalesce(NEW.delivered_at,now()); NEW.actual_delivered_date:=coalesce(NEW.actual_delivered_date,CURRENT_DATE);
 ELSIF TG_OP='UPDATE' AND OLD.current_stage='Delivered' THEN NEW.delivered_at:=NULL; NEW.actual_delivered_date:=NULL; END IF;
 IF NEW.onsite THEN NEW.in_date:=coalesce(NEW.in_date,CURRENT_DATE); END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS unified_job_state_trigger ON daily_go_list;
CREATE TRIGGER unified_job_state_trigger BEFORE INSERT OR UPDATE ON daily_go_list FOR EACH ROW EXECUTE FUNCTION unified_job_state();
CREATE OR REPLACE FUNCTION reconcile_opportunity() RETURNS TRIGGER AS $$
BEGIN
 -- Same named customer AND full vehicle AND positive amount; never amount alone.
 IF NEW.ro_amount>0 AND btrim(coalesce(NEW.customer_name,''))<>'' AND btrim(coalesce(NEW.vehicle,''))<>'' AND lower(btrim(NEW.vehicle))<>'vehicle from ccc' THEN
   UPDATE daily_go_list o SET merged_into=a.id,updated_at=now()
   FROM daily_go_list a
   WHERE o.job_kind='opportunity' AND o.merged_into IS NULL AND a.job_kind='active'
     AND a.ro_amount=NEW.ro_amount AND o.ro_amount=a.ro_amount
     AND lower(btrim(a.customer_name))=lower(btrim(NEW.customer_name))
     AND lower(btrim(a.vehicle))=lower(btrim(NEW.vehicle))
     AND lower(btrim(o.customer_name))=lower(btrim(a.customer_name)) AND lower(btrim(o.vehicle))=lower(btrim(a.vehicle))
     AND (SELECT count(*) FROM daily_go_list b WHERE b.job_kind='active' AND b.ro_amount=a.ro_amount AND lower(btrim(b.customer_name))=lower(btrim(a.customer_name)) AND lower(btrim(b.vehicle))=lower(btrim(a.vehicle)))=1;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS reconcile_opportunity_trigger ON daily_go_list;
CREATE TRIGGER reconcile_opportunity_trigger AFTER INSERT OR UPDATE OF ro_number,ro_amount,customer_name,vehicle ON daily_go_list FOR EACH ROW EXECUTE FUNCTION reconcile_opportunity();
CREATE OR REPLACE FUNCTION record_core_event() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.has_core AND NOT NEW.core_returned AND (TG_OP='INSERT' OR NOT OLD.has_core OR OLD.core_returned) THEN
   INSERT INTO core_events(part_id,ro_number,description,assigned_to) VALUES(NEW.id,NEW.parts_ro_number,NEW.part_description,NEW.part_assigned_to);
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS part_core_event_trigger ON parts;
CREATE TRIGGER part_core_event_trigger AFTER INSERT OR UPDATE OF has_core,core_returned ON parts FOR EACH ROW EXECUTE FUNCTION record_core_event();
COMMIT;
