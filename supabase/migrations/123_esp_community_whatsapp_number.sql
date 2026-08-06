-- 123: get_esp_community_public only returned tenant_phone, not
-- tenant_whatsapp_number -- needed for a wa.me "still stuck? contact us"
-- escape valve on the registration page's pending-payment screen.

CREATE OR REPLACE FUNCTION public.get_esp_community_public(p_community_slug text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_community RECORD;
  v_tenant    RECORD;
BEGIN
  SELECT * INTO v_community FROM esp_communities WHERE slug = p_community_slug AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'community_not_found');
  END IF;

  SELECT name, logo_url, phone, whatsapp_number INTO v_tenant FROM tenants WHERE id = v_community.tenant_id;

  RETURN json_build_object(
    'id', v_community.id,
    'name', v_community.name,
    'slug', v_community.slug,
    'description', v_community.description,
    'membership_fee', v_community.membership_fee,
    'validity_years', v_community.validity_years,
    'car_full_package_discount_pct', v_community.car_full_package_discount_pct,
    'car_selected_item_discount_pct', v_community.car_selected_item_discount_pct,
    'bike_full_package_discount_pct', v_community.bike_full_package_discount_pct,
    'bike_selected_item_discount_pct', v_community.bike_selected_item_discount_pct,
    'tenant_name', v_tenant.name,
    'tenant_logo_url', v_tenant.logo_url,
    'tenant_phone', v_tenant.phone,
    'tenant_whatsapp_number', v_tenant.whatsapp_number
  );
END;
$$;
