-- 109: Public "pick your community" listing for the new /esp/join/:tenantSlug
-- picker page that sits in front of /esp/:communitySlug. There is no anon
-- SELECT policy on esp_communities at all (by design -- 100_esp_program_schema.sql
-- top comment: "NOT a cross-tenant directory"), so a tenant-scoped public listing
-- needs its own RPC rather than a direct table query, same reasoning that
-- replaced the old anon-open branches_anon_select policy with
-- get_portal_branches() in 072_booking_tenant_scoping.sql.
--
-- Scoped by tenant_id only, not home_branch_id -- home_branch_id is purely an
-- operational default for where esp_public_register/esp_renew_member file new
-- records (100_esp_program_schema.sql), never a visibility boundary anywhere
-- else in this app (EspMembersPage.tsx / EspCommunitySettingsPage.tsx both
-- filter staff queries by tenant_id alone).
--
-- Resolves the tenant slug inline rather than via resolve_portal_tenant --
-- that helper has a NULL-slug "first active tenant" fallback for legacy
-- bookmarked /portal links, which would be wrong here: a missing/blank slug
-- must return an empty result, never leak an arbitrary other tenant's
-- communities. Same stricter-than-portal precedent as resolve_esp_community.
--
-- Returns tenant branding alongside the list (same tenant_name/tenant_logo_url
-- shape as get_esp_community_public) so the picker page can render the same
-- header style as the registration page itself, before a community is chosen.
CREATE OR REPLACE FUNCTION public.get_esp_communities_public(p_tenant_slug text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant RECORD;
BEGIN
  SELECT id, name, logo_url INTO v_tenant FROM tenants WHERE slug = p_tenant_slug AND is_active = true;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'tenant_not_found');
  END IF;

  RETURN json_build_object(
    'tenant_name', v_tenant.name,
    'tenant_logo_url', v_tenant.logo_url,
    'communities', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug,
        'description', c.description
      ) ORDER BY c.name), '[]'::json)
      FROM esp_communities c
      WHERE c.tenant_id = v_tenant.id AND c.is_active = true
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_esp_communities_public(text) TO anon, authenticated;
