-- 192: the platform owner can work inside any business.
-- The app sends an "x-acting-tenant" header naming the business the owner has picked in the header selector.
-- get_my_tenant() honours it ONLY for an active platform admin with the super_admin role; for everyone else the header is ignored.
-- Everything that asks "which company am I in" (the money rules, deletion approvals, cancel and no-charge rules, the integrity
-- report, record payment ...) then runs for that business, so the owner works in MAC exactly as a MAC super admin would.
CREATE OR REPLACE FUNCTION get_my_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE h text; home uuid; plat boolean; a uuid;
BEGIN
  SELECT u.tenant_id, (u.is_platform_admin AND u.role = 'super_admin' AND u.is_active) INTO home, plat FROM users u WHERE u.id = auth.uid();
  h := current_setting('request.headers', true);
  IF NOT coalesce(plat, false) OR h IS NULL OR position('x-acting-tenant' IN h) = 0 THEN RETURN home; END IF;
  BEGIN
    a := nullif((h::jsonb) ->> 'x-acting-tenant', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN home;
  END;
  IF a IS NOT NULL AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = a) THEN RETURN a; END IF;
  RETURN home;
END $$;
GRANT EXECUTE ON FUNCTION get_my_tenant() TO authenticated, anon;
