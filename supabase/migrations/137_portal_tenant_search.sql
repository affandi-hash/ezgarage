-- 137: Type-ahead workshop search for the public customer portal's fallback
-- picker. resolve_portal_tenant (099) refuses to guess once 2+ tenants are
-- active, so a slug-less/stale link now needs a way for the customer to
-- find their own workshop -- without ever dumping the full tenant roster
-- to an anonymous visitor (the >= 2 char guard lives in the function
-- itself, not just the frontend, so it can't be bypassed via a direct
-- RPC call either).

CREATE OR REPLACE FUNCTION search_active_portal_tenants(p_query text)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(json_build_object('slug', slug, 'name', name, 'logo_url', logo_url) ORDER BY name), '[]'::json)
  FROM tenants
  WHERE is_active = true AND length(trim(p_query)) >= 2 AND name ILIKE '%' || trim(p_query) || '%'
  LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION search_active_portal_tenants(text) TO anon, authenticated;
