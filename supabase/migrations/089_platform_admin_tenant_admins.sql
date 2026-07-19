-- 089: A narrow, deliberate RPC for the platform admin's "reset locked-out
-- admin's password" action. Returns ONLY the admin-level (ops_manager /
-- super_admin) users of one tenant — never the full staff roster, never
-- any other role — since identifying who to reset is the one legitimate
-- reason a platform admin needs to see anything at all about a tenant's
-- users.
CREATE OR REPLACE FUNCTION public.get_tenant_admins(p_tenant_id uuid)
 RETURNS TABLE (id uuid, full_name text, email text, role text)
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
  SELECT u.id, u.full_name, u.email, u.role::text
  FROM users u
  WHERE u.tenant_id = p_tenant_id
    AND u.role IN ('ops_manager', 'super_admin')
    AND u.is_active = true
  ORDER BY u.role, u.full_name;
END;
$function$;
