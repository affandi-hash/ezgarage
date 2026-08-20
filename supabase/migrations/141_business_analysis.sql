-- 141: "Business Analysis" -- an evergreen, reconciliation-focused
-- conversation (one per tenant, not per-plan) sitting before "Generate
-- New Plan". The point isn't a report the AI writes and the owner reads;
-- it's a sync between what the real data shows and what the owner knows
-- that no file/table can capture (a competitor closing, a renovation
-- explaining a dip, a planned price change). current_analysis holds the
-- reconciled, human-corrected understanding the Marketing Plan generator
-- reads -- not the AI's uncorrected first draft -- and gets updated
-- (via the save_analysis tool) every time that understanding changes,
-- not just once at the start. conversation carries prior owner-given
-- context forward across sessions, same shape as
-- sales_marketing_business_profile.conversation.

CREATE TABLE IF NOT EXISTS sales_marketing_business_analysis (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  business_profile_id   uuid NOT NULL REFERENCES sales_marketing_business_profile(id) ON DELETE CASCADE,
  current_analysis      text,
  conversation          jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_smba_profile ON sales_marketing_business_analysis (business_profile_id);

-- Same tenant-scoped RLS shape as sales_marketing_plans (132).
ALTER TABLE sales_marketing_business_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_marketing_business_analysis_select" ON sales_marketing_business_analysis;
CREATE POLICY "sales_marketing_business_analysis_select" ON sales_marketing_business_analysis FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "sales_marketing_business_analysis_insert" ON sales_marketing_business_analysis;
CREATE POLICY "sales_marketing_business_analysis_insert" ON sales_marketing_business_analysis FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "sales_marketing_business_analysis_update" ON sales_marketing_business_analysis;
CREATE POLICY "sales_marketing_business_analysis_update" ON sales_marketing_business_analysis FOR UPDATE TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "sales_marketing_business_analysis_delete" ON sales_marketing_business_analysis;
CREATE POLICY "sales_marketing_business_analysis_delete" ON sales_marketing_business_analysis FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));
