-- 129: Business Profile for the new Sales & Marketing module -- the
-- permanent briefing an AI "CSMO" assistant reads before doing anything
-- else. Hybrid design: structured columns for the simple facts (channels,
-- budget, pricing) and free-text narrative columns for the fuzzier stuff
-- (brand voice, positioning, goals) that a guided AI conversation fills in.
-- One row per tenant. Staff-only (super_admin/ops_manager, matching the
-- Sales & Marketing sidebar section) -- no member-facing RPC needed here.

CREATE TABLE IF NOT EXISTS sales_marketing_business_profile (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL UNIQUE REFERENCES tenants(id),

  -- Structured fields
  tagline            text,
  website_url        text,
  instagram_handle   text,
  tiktok_handle      text,
  facebook_handle    text,
  whatsapp_number    text,
  pricing_position   text CHECK (pricing_position IN ('budget', 'mid_market', 'premium')),
  monthly_budget_myr numeric,
  execution_capacity text,  -- e.g. "just the owner", "front desk helps part-time"

  -- Narrative fields -- typically populated via the AI interview
  brand_voice          text,
  target_audience      text,
  unique_selling_points text,
  competitors           text,
  goals                  text,  -- ranked, in the owner's words
  guardrails             text,
  seasonal_notes         text,

  -- Conversation transcript with the AI interviewer, so the interview can
  -- resume across sessions instead of restarting each time.
  conversation jsonb NOT NULL DEFAULT '[]'::jsonb,

  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_marketing_business_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smbp_select ON sales_marketing_business_profile;
CREATE POLICY smbp_select ON sales_marketing_business_profile FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']));

DROP POLICY IF EXISTS smbp_insert ON sales_marketing_business_profile;
CREATE POLICY smbp_insert ON sales_marketing_business_profile FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']));

DROP POLICY IF EXISTS smbp_update ON sales_marketing_business_profile;
CREATE POLICY smbp_update ON sales_marketing_business_profile FOR UPDATE TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']));

CREATE OR REPLACE FUNCTION set_smbp_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS smbp_set_updated_at ON sales_marketing_business_profile;
CREATE TRIGGER smbp_set_updated_at BEFORE UPDATE ON sales_marketing_business_profile
  FOR EACH ROW EXECUTE FUNCTION set_smbp_updated_at();
