-- 156: Weekly Report. Targets used by the report tiles, and saved snapshots
-- so a generated report keeps its numbers even if invoices are back-dated.
CREATE TABLE IF NOT EXISTS report_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_sales_goal   numeric(12,2) NOT NULL DEFAULT 120000 CHECK (monthly_sales_goal >= 0),
  working_days_month   int           NOT NULL DEFAULT 26 CHECK (working_days_month BETWEEN 1 AND 31),
  target_gp_pct        numeric(5,2)  NOT NULL DEFAULT 43 CHECK (target_gp_pct > 0 AND target_gp_pct <= 100),
  weekly_target_override numeric(12,2) CHECK (weekly_target_override IS NULL OR weekly_target_override >= 0),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);

CREATE TABLE IF NOT EXISTS weekly_report_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        text NOT NULL,
  period_mode  text NOT NULL CHECK (period_mode IN ('week','month','custom')),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  branch_id    uuid REFERENCES branches(id) ON DELETE SET NULL,
  data         jsonb NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weekly_report_snapshots_tenant ON weekly_report_snapshots (tenant_id, created_at DESC);

ALTER TABLE report_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_settings_select ON report_settings;
CREATE POLICY report_settings_select ON report_settings FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance']));
DROP POLICY IF EXISTS report_settings_write ON report_settings;
CREATE POLICY report_settings_write ON report_settings FOR ALL TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  WITH CHECK (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

ALTER TABLE weekly_report_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weekly_report_snapshots_all ON weekly_report_snapshots;
CREATE POLICY weekly_report_snapshots_all ON weekly_report_snapshots FOR ALL TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance']))
  WITH CHECK (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance']));
