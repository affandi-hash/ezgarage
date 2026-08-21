-- 146: Campaigns -- the minimal version of the "Campaign" execution layer
-- discussed for Sales & Marketing: a Sales activity gets "promoted" into a
-- campaign, and two AI roles (Project Manager, then Copywriter) turn that
-- one-line activity into an actual plan (audience/timing/success metric)
-- and ready-to-send copy. Designer/Analyst roles and standalone (not
-- promoted from an initiative) campaigns are deliberately out of scope for
-- this first version.

CREATE TABLE IF NOT EXISTS sales_marketing_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  business_profile_id   uuid NOT NULL REFERENCES sales_marketing_business_profile(id) ON DELETE CASCADE,
  initiative_id         uuid REFERENCES sales_marketing_plan_initiatives(id) ON DELETE SET NULL,
  title                 text NOT NULL,
  channel               text,
  target_audience       text,
  timing                text,
  success_metric        text,
  copy                  text,
  alt_copy              text,
  budget_allocated_myr  numeric,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  generation_tokens     integer,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smc_profile ON sales_marketing_campaigns (business_profile_id);
CREATE INDEX IF NOT EXISTS idx_smc_initiative ON sales_marketing_campaigns (initiative_id);

ALTER TABLE sales_marketing_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_marketing_campaigns_select ON sales_marketing_campaigns;
CREATE POLICY sales_marketing_campaigns_select ON sales_marketing_campaigns FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS sales_marketing_campaigns_insert ON sales_marketing_campaigns;
CREATE POLICY sales_marketing_campaigns_insert ON sales_marketing_campaigns FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS sales_marketing_campaigns_update ON sales_marketing_campaigns;
CREATE POLICY sales_marketing_campaigns_update ON sales_marketing_campaigns FOR UPDATE TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS sales_marketing_campaigns_delete ON sales_marketing_campaigns;
CREATE POLICY sales_marketing_campaigns_delete ON sales_marketing_campaigns FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));
