-- 186: ON-SITE coverage is the whole of KL, Selangor and the Klang Valley, so the zone / postcode check can be switched off.
-- With zones off: any postcode is accepted, no travel surcharge is added, and the booking page shows no coverage list.
ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS zones_enabled boolean NOT NULL DEFAULT true;
UPDATE os_settings SET zones_enabled = false WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'motoverse-garage');

CREATE OR REPLACE FUNCTION os_zone_for(p_tenant uuid, p_postcode text)
RETURNS os_zones LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT z.* FROM os_zones z, unnest(z.postcodes) pc
   WHERE z.tenant_id = p_tenant AND z.is_active
     AND coalesce((SELECT s.zones_enabled FROM os_settings s WHERE s.tenant_id = p_tenant), true)
     AND regexp_replace(coalesce(p_postcode, ''), '\D', '', 'g') LIKE trim(pc) || '%'
     AND length(trim(pc)) > 0
   ORDER BY length(trim(pc)) DESC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION os_calc_quote(p_tenant uuid, p_type text, p_make text, p_model text,
  p_package uuid, p_grade uuid, p_postcode text, p_offhours boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st os_settings; v_tier text; base numeric; z os_zones; zs numeric := 0; oh numeric := 0; tot numeric; err text;
BEGIN
  SELECT * INTO st FROM os_settings WHERE tenant_id = p_tenant;
  v_tier := os_tier_for(p_tenant, p_type, p_make, p_model);
  IF v_tier IS NULL THEN err := 'unknown_vehicle';
  ELSIF v_tier = 'hub_only' THEN err := 'hub_only'; END IF;

  IF err IS NULL THEN
    SELECT price INTO base FROM os_prices pr
     WHERE pr.tenant_id = p_tenant AND pr.package_id = p_package AND pr.tier = v_tier
       AND pr.effective_from <= os_today()
       AND (pr.grade_id IS NOT DISTINCT FROM p_grade OR pr.grade_id IS NULL)
     ORDER BY (pr.grade_id IS NOT NULL) DESC, pr.effective_from DESC LIMIT 1;
    IF base IS NULL OR NOT EXISTS (SELECT 1 FROM os_packages WHERE id = p_package AND tenant_id = p_tenant AND is_active) THEN
      err := 'package_unavailable';
    END IF;
  END IF;

  z := os_zone_for(p_tenant, p_postcode);
  IF err IS NULL AND z.id IS NULL AND st.zones_enabled THEN err := 'outside_zone'; END IF;
  IF z.id IS NOT NULL THEN zs := z.surcharge; END IF;
  IF p_offhours AND st.offhours_enabled THEN oh := coalesce(st.offhours_surcharge, 0); END IF;

  tot := CASE WHEN base IS NULL THEN NULL ELSE base + zs + oh END;
  RETURN jsonb_build_object(
    'error', err, 'tier', v_tier, 'base', base, 'zone_id', z.id, 'zone_name', z.name,
    'zone_surcharge', zs, 'offhours_surcharge', oh, 'total', tot,
    'deposit', CASE WHEN tot IS NULL THEN NULL ELSE round(tot * st.deposit_pct / 100.0, 2) END,
    'deposit_pct', st.deposit_pct);
END $$;

CREATE OR REPLACE FUNCTION os_get_public_config(p_tenant_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t uuid := os_tenant_by_slug(p_tenant_slug); st os_settings; bbp jsonb;
BEGIN
  IF t IS NULL THEN RETURN jsonb_build_object('error', 'tenant_not_found'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = t;
  IF NOT FOUND OR st.default_branch_id IS NULL THEN RETURN jsonb_build_object('error', 'not_configured'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description,
           'price', (SELECT pr.price FROM os_prices pr WHERE pr.package_id = p.id AND pr.tier = 'bb' AND pr.effective_from <= os_today()
                      ORDER BY pr.effective_from DESC LIMIT 1)) ORDER BY p.sort_order, p.name), '[]'::jsonb)
    INTO bbp
    FROM os_packages p
   WHERE p.tenant_id = t AND p.is_active AND p.audience = 'bb_staff'
     AND EXISTS (SELECT 1 FROM os_prices pr WHERE pr.package_id = p.id AND pr.tier = 'bb' AND pr.effective_from <= os_today());
  RETURN jsonb_build_object(
    'tenant_name', (SELECT name FROM tenants WHERE id = t),
    'settings', jsonb_build_object('deposit_pct', st.deposit_pct, 'cancel_cutoff_hours', st.cancel_cutoff_hours,
        'refund_due_hours', st.refund_due_hours, 'max_reschedules', st.max_reschedules,
        'booking_window_days', st.booking_window_days, 'hold_minutes', st.hold_minutes,
        'offhours_enabled', st.offhours_enabled, 'offhours_surcharge', st.offhours_surcharge, 'travel_buffer_min', st.travel_buffer_min,
        'max_job_min', (SELECT max(extract(epoch FROM (s.end_time - s.start_time)) / 60)::int - st.travel_buffer_min FROM os_slots s WHERE s.branch_id = st.default_branch_id AND s.is_open)),
    'packages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'duration_min', p.duration_min, 'includes', to_jsonb(p.includes), 'bonus', to_jsonb(p.bonus), 'price_note', p.price_note,
        'price_from', p.price_from, 'requires_addon', p.requires_addon,
        'prices', coalesce((SELECT jsonb_object_agg(x.tier, x.price) FROM (SELECT DISTINCT ON (pr.tier) pr.tier, pr.price FROM os_prices pr WHERE pr.package_id = p.id AND pr.tier <> 'bb' AND pr.grade_id IS NULL AND pr.effective_from <= os_today() ORDER BY pr.tier, pr.effective_from DESC) x), '{}'::jsonb),
        'grades', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.sort_order, g.name)
                              FROM os_oil_grades g WHERE g.package_id = p.id AND g.is_active), '[]'::jsonb),
        'tiers', coalesce((SELECT jsonb_agg(DISTINCT pr.tier) FROM os_prices pr WHERE pr.package_id = p.id AND pr.tier <> 'bb' AND pr.effective_from <= os_today()), '[]'::jsonb)
      ) ORDER BY p.sort_order, p.name)
      FROM os_packages p WHERE p.tenant_id = t AND p.is_active AND p.audience = 'public'), '[]'::jsonb),
    'addons', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'description', a.description, 'vehicle_type', a.vehicle_type,
        'duration_min', a.duration_min, 'duration_max', coalesce(a.duration_max, a.duration_min), 'price', a.price, 'price_from', a.price_from, 'plus_parts', a.plus_parts,
        'not_with', to_jsonb(a.not_with_packages)) ORDER BY a.sort_order, a.name) FROM os_addons a WHERE a.tenant_id = t AND a.is_active), '[]'::jsonb),
    'zones_enabled', st.zones_enabled,
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object('name', z.name, 'surcharge', z.surcharge) ORDER BY z.sort_order)
                         FROM os_zones z WHERE z.tenant_id = t AND z.is_active AND st.zones_enabled), '[]'::jsonb),
    'makes', coalesce((SELECT jsonb_agg(jsonb_build_object('type', r.vehicle_type, 'make', r.make, 'model', r.model, 'tier', r.tier) ORDER BY r.make)
                         FROM os_vehicle_rules r WHERE r.tenant_id = t), '[]'::jsonb),
    'bb', CASE WHEN st.bb_enabled AND st.hub_branch_id IS NOT NULL AND jsonb_array_length(bbp) > 0
               THEN jsonb_build_object('packages', bbp, 'capacity_per_day', st.bb_capacity_per_day, 'hq_address', st.bb_hq_address,
                                       'pickup_note', st.bb_pickup_note, 'window_days', st.booking_window_days)
               ELSE NULL END
  );
END $function$;
