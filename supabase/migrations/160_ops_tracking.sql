-- 160: three things the Operations sheet needs and EZWerkFlo did not record.
--  1. jobs.ready_at / closed_at are stamped when a job moves to Ready / Delivered
--     (they existed but were never filled), so service time can be averaged.
--  2. a nightly count of parts at zero stock, kept per branch per day.
--  3. a complaints log.

-- 1 ── service-time stamps ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION jobs_stamp_times() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'ready' AND NEW.ready_at IS NULL THEN
      NEW.ready_at := now();
    ELSIF NEW.status = 'delivered' THEN
      IF NEW.ready_at IS NULL THEN NEW.ready_at := now(); END IF;
      IF NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
    END IF;
    -- a job reopened after being ready/delivered starts counting again
    IF OLD.status IN ('ready', 'delivered') AND NEW.status NOT IN ('ready', 'delivered') THEN
      NEW.ready_at := NULL; NEW.closed_at := NULL;
    ELSIF OLD.status = 'delivered' AND NEW.status = 'ready' THEN
      NEW.closed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_stamp_times ON jobs;
CREATE TRIGGER jobs_stamp_times BEFORE UPDATE OF status ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_stamp_times();

-- 2 ── nightly stock snapshot ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_daily_snapshots (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  snapshot_date  date NOT NULL,
  zero_stock     int  NOT NULL,
  below_reorder  int  NOT NULL,
  total_parts    int  NOT NULL,
  PRIMARY KEY (branch_id, snapshot_date)
);
ALTER TABLE stock_daily_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_daily_snapshots_select ON stock_daily_snapshots;
CREATE POLICY stock_daily_snapshots_select ON stock_daily_snapshots FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','parts_admin','foreman','finance']));

-- Counts active parts per branch. Run just after midnight, it is labelled with the day that just ended.
CREATE OR REPLACE FUNCTION snapshot_stock(p_date date DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := coalesce(p_date, ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - 1)); n int;
BEGIN
  INSERT INTO stock_daily_snapshots (tenant_id, branch_id, snapshot_date, zero_stock, below_reorder, total_parts)
  SELECT tenant_id, branch_id, d,
         count(*) FILTER (WHERE coalesce(stock_qty, 0) <= 0),
         count(*) FILTER (WHERE coalesce(stock_qty, 0) <= coalesce(reorder_level, 0)),
         count(*)
    FROM parts_catalogue WHERE is_active AND branch_id IS NOT NULL AND tenant_id IS NOT NULL
   GROUP BY tenant_id, branch_id
  ON CONFLICT (branch_id, snapshot_date) DO UPDATE
     SET zero_stock = EXCLUDED.zero_stock, below_reorder = EXCLUDED.below_reorder, total_parts = EXCLUDED.total_parts;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION snapshot_stock(date) FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
SELECT cron.unschedule('stock-snapshot') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stock-snapshot');
SELECT cron.schedule('stock-snapshot', '15 16 * * *', 'SELECT public.snapshot_stock()');   -- 00:15 Malaysia time

-- 3 ── complaints log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_complaints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES branches(id),
  complaint_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
  customer_name  text,
  reference      text,                       -- job number, invoice number or plate
  description    text NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution     text,
  resolved_at    timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_complaints_tenant_date ON job_complaints (tenant_id, complaint_date DESC);
ALTER TABLE job_complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_complaints_select ON job_complaints;
CREATE POLICY job_complaints_select ON job_complaints FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','finance'])
  AND (branch_id = get_my_branch() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])));
DROP POLICY IF EXISTS job_complaints_write ON job_complaints;
CREATE POLICY job_complaints_write ON job_complaints FOR ALL TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant()
         AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk'])
         AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin','ops_manager')))
  WITH CHECK (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk']));

-- the sheet only gets a value for these columns from the day tracking started
ALTER TABLE sheet_sync_config ADD COLUMN IF NOT EXISTS complaints_from date;
ALTER TABLE sheet_sync_config ADD COLUMN IF NOT EXISTS stockout_from date;
UPDATE sheet_sync_config SET complaints_from = coalesce(complaints_from, current_date), stockout_from = coalesce(stockout_from, current_date);
