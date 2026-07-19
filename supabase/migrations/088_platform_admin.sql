-- 088: Platform admin — a genuinely separate, additive concept from the
-- tenant-scoped `role` column. Deliberately NOT built on `super_admin`,
-- since that role already has a cross-tenant RLS bypass baked into ~115
-- policies across the schema (audited live before writing this) — reusing
-- it here would mean any future tenant's own super_admin automatically
-- gains this platform tooling too, which is exactly the coupling we're
-- trying to avoid. This migration only ADDS new capability; it does not
-- modify any of those 115 existing policies.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(is_platform_admin, false) FROM users WHERE id = auth.uid()
$function$;

-- ── platform_settings / raudhahpay_statement_log: switch their gate from
-- the super_admin role check (087) to the new flag ─────────────────────
DROP POLICY IF EXISTS platform_settings_select ON platform_settings;
CREATE POLICY platform_settings_select ON platform_settings FOR SELECT TO authenticated
  USING (is_platform_admin());

DROP POLICY IF EXISTS platform_settings_update ON platform_settings;
CREATE POLICY platform_settings_update ON platform_settings FOR UPDATE TO authenticated
  USING (is_platform_admin());

DROP POLICY IF EXISTS raudhahpay_statement_log_select ON raudhahpay_statement_log;
CREATE POLICY raudhahpay_statement_log_select ON raudhahpay_statement_log FOR SELECT TO authenticated
  USING (is_platform_admin());

-- ── tenants: additive policies for the platform directory. These OR into
-- the existing tenants_select/tenants_select_own/tenants_update policies
-- (RLS policies are always OR'd together) — nothing existing is touched
-- or removed, this purely adds a new way to see/update rows. ───────────
CREATE POLICY tenants_platform_admin_select ON tenants FOR SELECT TO authenticated
  USING (is_platform_admin());

CREATE POLICY tenants_platform_admin_update ON tenants FOR UPDATE TO authenticated
  USING (is_platform_admin());

-- ── Tenant health snapshot: aggregates only, no row-level operational
-- data is ever returned to the caller — a platform admin sees counts and
-- totals, never an individual customer/job/invoice record. ──────────────
CREATE OR REPLACE FUNCTION public.get_tenant_health_snapshot()
 RETURNS TABLE (
   tenant_id uuid,
   tenant_name text,
   slug text,
   plan text,
   is_active boolean,
   created_at timestamptz,
   job_count bigint,
   total_revenue numeric,
   last_activity_at timestamptz
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Permission denied: platform admin only';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.slug,
    t.plan,
    t.is_active,
    t.created_at,
    COALESCE(j.job_count, 0),
    COALESCE(i.total_revenue, 0),
    GREATEST(j.last_job_at, i.last_invoice_at)
  FROM tenants t
  LEFT JOIN (
    SELECT jobs.tenant_id, count(*) AS job_count, max(jobs.created_at) AS last_job_at
    FROM jobs GROUP BY jobs.tenant_id
  ) j ON j.tenant_id = t.id
  LEFT JOIN (
    SELECT invoices.tenant_id, sum(invoices.amount_paid) AS total_revenue, max(invoices.created_at) AS last_invoice_at
    FROM invoices GROUP BY invoices.tenant_id
  ) i ON i.tenant_id = t.id
  ORDER BY t.created_at DESC;
END;
$function$;

-- ── reset_user_password: add the is_platform_admin bypass for the
-- locked-out-admin recovery case, alongside the existing super_admin
-- cross-tenant bypass (untouched). Every platform-admin-triggered reset
-- is explicitly audit-logged with the TARGET tenant's id (not the
-- caller's own), since insert_audit_log's own get_my_tenant() would
-- otherwise attribute it to the platform admin's tenant instead. ───────
CREATE OR REPLACE FUNCTION reset_user_password(p_user_id uuid, p_new_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_tenant uuid;
  v_caller_is_platform_admin boolean;
  v_target_tenant uuid;
BEGIN
  SELECT role::text, tenant_id, is_platform_admin INTO v_caller_role, v_caller_tenant, v_caller_is_platform_admin
    FROM users WHERE id = auth.uid();

  IF NOT COALESCE(v_caller_is_platform_admin, false) AND COALESCE(v_caller_role, '') NOT IN ('ops_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: only ops_manager, super_admin, or a platform admin can reset passwords';
  END IF;

  IF length(trim(p_new_password)) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  SELECT tenant_id INTO v_target_tenant FROM users WHERE id = p_user_id;

  IF v_caller_role != 'super_admin' AND NOT COALESCE(v_caller_is_platform_admin, false) THEN
    IF v_target_tenant IS DISTINCT FROM v_caller_tenant THEN
      RAISE EXCEPTION 'Permission denied: cannot reset password for user in another tenant';
    END IF;
  END IF;

  UPDATE auth.users
    SET encrypted_password = extensions.crypt(trim(p_new_password), extensions.gen_salt('bf', 10)),
        updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found in auth system';
  END IF;

  UPDATE users SET must_change_password = true WHERE id = p_user_id;

  IF COALESCE(v_caller_is_platform_admin, false) THEN
    INSERT INTO audit_logs (action, module, record_id, record_type, details, user_id, tenant_id)
    VALUES (
      'platform_admin_password_reset', 'users', p_user_id, 'user',
      jsonb_build_object('target_tenant_id', v_target_tenant),
      auth.uid(), v_target_tenant
    );
  END IF;
END;
$function$;
