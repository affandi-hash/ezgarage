-- 136: Bay tracking (for a real Workshop Occupancy %) and manual
-- sales/marketing period metrics (Reach/Leads/Prospects/Google Reviews/
-- Targets -- funnel-stage numbers with no other real data source), plus
-- spend/revenue actuals on sales_marketing_plans so the Campaigns &
-- Planning tab can show real progress/ROI instead of illustrative numbers.

CREATE TABLE IF NOT EXISTS bays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bays_branch ON bays (branch_id);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bay_id uuid REFERENCES bays(id);
CREATE INDEX IF NOT EXISTS idx_jobs_bay ON jobs (bay_id);

-- One row per (tenant, branch, month, channel, metric). branch_id/channel
-- null = tenant-wide / overall (not broken out by selling channel).
CREATE TABLE IF NOT EXISTS sales_marketing_period_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid REFERENCES branches(id),
  period_month  date NOT NULL,
  channel       text CHECK (channel IN (
                  'mia_whatsapp', 'facebook_instagram', 'walkin',
                  'google', 'community_events', 'referrals'
                )),
  metric_key    text NOT NULL CHECK (metric_key IN (
                  'reach', 'leads', 'prospects', 'google_reviews_count',
                  'google_reviews_rating', 'revenue_target', 'esp_target', 'spend'
                )),
  value         numeric NOT NULL,
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smpm_period ON sales_marketing_period_metrics (tenant_id, period_month);

ALTER TABLE sales_marketing_plans ADD COLUMN IF NOT EXISTS spent_myr numeric;
ALTER TABLE sales_marketing_plans ADD COLUMN IF NOT EXISTS revenue_myr numeric;

-- RLS: bays -- same tenant+branch scoping shape as the jobs table itself
-- (014_saas_tenants.sql) since a bay is a physical fixture of one branch.
ALTER TABLE bays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bays_select" ON bays;
CREATE POLICY "bays_select" ON bays FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "bays_insert" ON bays;
CREATE POLICY "bays_insert" ON bays FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "bays_update" ON bays;
CREATE POLICY "bays_update" ON bays FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "bays_delete" ON bays;
CREATE POLICY "bays_delete" ON bays FOR DELETE TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

-- RLS: sales_marketing_period_metrics -- tenant-scoped, same
-- super_admin/ops_manager-only shape as sales_marketing_plans (132).
ALTER TABLE sales_marketing_period_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_marketing_period_metrics_select" ON sales_marketing_period_metrics;
CREATE POLICY "sales_marketing_period_metrics_select" ON sales_marketing_period_metrics FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "sales_marketing_period_metrics_insert" ON sales_marketing_period_metrics;
CREATE POLICY "sales_marketing_period_metrics_insert" ON sales_marketing_period_metrics FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "sales_marketing_period_metrics_update" ON sales_marketing_period_metrics;
CREATE POLICY "sales_marketing_period_metrics_update" ON sales_marketing_period_metrics FOR UPDATE TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "sales_marketing_period_metrics_delete" ON sales_marketing_period_metrics;
CREATE POLICY "sales_marketing_period_metrics_delete" ON sales_marketing_period_metrics FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));
