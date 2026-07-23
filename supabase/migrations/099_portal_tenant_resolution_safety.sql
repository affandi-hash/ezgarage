-- 099: resolve_portal_tenant(NULL) previously matched ANY active tenant
-- unconditionally (the "OR p_tenant_slug IS NULL" branch), then picked the
-- oldest one by created_at -- meaning the generic /portal URL (no garage
-- slug) silently resolved to whichever tenant was onboarded first. Harmless
-- with a single tenant, but a real cross-tenant data-isolation gap the
-- moment a second garage joins. Now the no-slug fallback only fires when
-- there is genuinely exactly one active tenant; with two or more, a slug is
-- required and the lookup returns no match instead of guessing.

CREATE OR REPLACE FUNCTION public.resolve_portal_tenant(p_tenant_slug text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_count int;
BEGIN
  IF p_tenant_slug IS NOT NULL THEN
    SELECT id INTO v_id FROM tenants WHERE is_active = true AND slug = p_tenant_slug LIMIT 1;
    RETURN v_id;
  END IF;

  SELECT count(*) INTO v_count FROM tenants WHERE is_active = true;
  IF v_count = 1 THEN
    SELECT id INTO v_id FROM tenants WHERE is_active = true LIMIT 1;
    RETURN v_id;
  END IF;

  RETURN NULL;
END;
$function$;
