-- 132: Marketing Plan submodule. A plan is a themed period (a month, a
-- quarter, a specific seasonal window) with a list of initiatives -- same
-- one-row-per-item principle as competitors/goals/segments/events, so
-- adding initiative #5 never touches #1-4.

CREATE TABLE IF NOT EXISTS sales_marketing_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  business_profile_id   uuid NOT NULL REFERENCES sales_marketing_business_profile(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  theme                 text,
  target_segment_names  text[],
  budget_allocated_myr  numeric,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  ai_rationale          text,  -- why this plan looks the way it does -- grounded in real historical data, shown to the owner for transparency
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_marketing_plan_initiatives (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  plan_id       uuid NOT NULL REFERENCES sales_marketing_plans(id) ON DELETE CASCADE,
  description   text NOT NULL,
  channel       text,
  owner_text    text,
  due_date      date,
  status        text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  priority_rank integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, description)
);

CREATE INDEX IF NOT EXISTS idx_smp_profile ON sales_marketing_plans (business_profile_id);
CREATE INDEX IF NOT EXISTS idx_smpi_plan ON sales_marketing_plan_initiatives (plan_id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_marketing_plans', 'sales_marketing_plan_initiatives']
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
