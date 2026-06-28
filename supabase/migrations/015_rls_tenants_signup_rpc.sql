-- ============================================================
-- 015: RLS on tenants table + SECURITY DEFINER signup function
-- ============================================================

-- BUG-001: Enable RLS on tenants (was missing)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Each tenant can only read their own row; super_admin reads all
CREATE POLICY "tenants_select_own"
  ON tenants FOR SELECT
  TO authenticated
  USING (
    id = get_my_tenant()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role = 'super_admin'
        AND u.is_active = true
    )
  );

-- Tenant admins can update their own tenant row
CREATE POLICY "tenants_update_own"
  ON tenants FOR UPDATE
  TO authenticated
  USING (
    id = get_my_tenant()
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('ops_manager', 'super_admin')
        AND u.is_active = true
    )
  );

-- ============================================================
-- BUG-002: SECURITY DEFINER signup function
-- Bypasses RLS so a newly-authenticated user can atomically
-- create their tenant, branch, and profile in one transaction.
-- Called from SignUpPage after supabase.auth.signUp() succeeds.
-- ============================================================

CREATE OR REPLACE FUNCTION create_tenant_signup(
  p_tenant_name  TEXT,
  p_tenant_slug  TEXT,
  p_tenant_email TEXT,
  p_tenant_phone TEXT,
  p_tenant_city  TEXT,
  p_user_id      UUID,
  p_user_name    TEXT,
  p_user_email   TEXT,
  p_branch_name  TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_branch_id UUID;
  v_slug      TEXT;
  v_counter   INT := 0;
BEGIN
  -- Ensure slug uniqueness
  v_slug := p_tenant_slug;
  WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = v_slug) LOOP
    v_counter := v_counter + 1;
    v_slug := p_tenant_slug || '-' || v_counter::TEXT;
  END LOOP;

  -- Create tenant
  INSERT INTO tenants (name, slug, email, phone, city, plan, is_active)
  VALUES (p_tenant_name, v_slug, p_tenant_email, NULLIF(p_tenant_phone,''), NULLIF(p_tenant_city,''), 'free', true)
  RETURNING id INTO v_tenant_id;

  -- Create main branch
  INSERT INTO branches (tenant_id, name, city, is_main, is_active)
  VALUES (v_tenant_id, p_branch_name, NULLIF(p_tenant_city,''), true, true)
  RETURNING id INTO v_branch_id;

  -- Create user profile (id = auth.uid of the just-signed-up user)
  INSERT INTO users (id, tenant_id, branch_id, full_name, email, role, approval_status, is_active)
  VALUES (p_user_id, v_tenant_id, v_branch_id, p_user_name, p_user_email, 'ops_manager', 'approved', true);

  RETURN json_build_object(
    'tenant_id', v_tenant_id,
    'branch_id', v_branch_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- Grant execute to authenticated users (they have a session after signUp())
GRANT EXECUTE ON FUNCTION create_tenant_signup TO authenticated;
