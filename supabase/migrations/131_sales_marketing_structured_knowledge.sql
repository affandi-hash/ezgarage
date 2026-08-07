-- 131: Move four list-shaped fields off the Business Profile's free-text
-- columns into their own tables: competitors, audience segments, goals,
-- and seasonal calendar events. The free-text design meant every AI update
-- REPLACED the entire field -- mentioning one new competitor required the
-- model to perfectly retype every existing one from context, or silently
-- drop them. That's not hypothetical: it's exactly what corrupted a real
-- tenant's Competitors field earlier. One row per item makes an update an
-- insert, not a rewrite of everything else.
--
-- Left as free text (genuinely single cohesive statements, not lists):
-- brand_voice, unique_selling_points, guardrails.

CREATE TABLE IF NOT EXISTS sales_marketing_competitors (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  business_profile_id  uuid NOT NULL REFERENCES sales_marketing_business_profile(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  competitor_type      text CHECK (competitor_type IN ('direct', 'indirect')),
  notes                text,
  threat_level         text CHECK (threat_level IN ('low', 'medium', 'high')),
  our_counter          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, name)
);

CREATE TABLE IF NOT EXISTS sales_marketing_audience_segments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  business_profile_id  uuid NOT NULL REFERENCES sales_marketing_business_profile(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  description          text,
  messaging_angle      text,
  priority             text CHECK (priority IN ('primary', 'secondary')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, name)
);

CREATE TABLE IF NOT EXISTS sales_marketing_goals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  business_profile_id  uuid NOT NULL REFERENCES sales_marketing_business_profile(id) ON DELETE CASCADE,
  description          text NOT NULL,
  metric               text,
  target_value         numeric,
  current_value        numeric,
  deadline             date,
  priority_rank        integer,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'dropped')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, description)
);

CREATE TABLE IF NOT EXISTS sales_marketing_seasonal_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  business_profile_id  uuid NOT NULL REFERENCES sales_marketing_business_profile(id) ON DELETE CASCADE,
  period_label         text NOT NULL,
  theme                text,
  focus_notes          text,
  priority             text CHECK (priority IN ('low', 'medium', 'high')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, period_label)
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_marketing_competitors', 'sales_marketing_audience_segments', 'sales_marketing_goals', 'sales_marketing_seasonal_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY[''super_admin'',''ops_manager'']))',
      t || '_select', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY[''super_admin'',''ops_manager'']))',
      t || '_insert', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY[''super_admin'',''ops_manager'']))',
      t || '_update', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY[''super_admin'',''ops_manager'']))',
      t || '_delete', t
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_smc_profile ON sales_marketing_competitors (business_profile_id);
CREATE INDEX IF NOT EXISTS idx_smas_profile ON sales_marketing_audience_segments (business_profile_id);
CREATE INDEX IF NOT EXISTS idx_smg_profile ON sales_marketing_goals (business_profile_id);
CREATE INDEX IF NOT EXISTS idx_smse_profile ON sales_marketing_seasonal_events (business_profile_id);
