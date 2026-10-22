-- 183: the ON-SITE menu: more packages, selectable add-ons, bike and Harley price levels.
--
--  * New vehicle price levels: bike, harley_sportster, harley_softail (cars keep tier1 and tier2).
--  * Packages get a list of what is included, free extras, a price note, a "from" flag and an "add-on required" flag.
--  * New os_addons table: extras the customer ticks while booking. Car add-ons only for cars, bike add-ons only for bikes.
--    An add-on can be hidden for a package that already includes it.
--  * The quote adds the add-ons: total = package + add-ons + travel. Estimated time = package time + the add-ons' time.
--  * A job whose estimated time does not fit one visit window (window length less the travel buffer) cannot be booked as a
--    standard slot. The customer sends it as a request and staff arrange the time.
--  * The booking stores the chosen add-ons; the invoice lists them line by line.
--  * The menu itself (8 packages, "Others", 26 add-ons, vehicle rules) is loaded at the end for Motoverse Garage.

-- 1. price levels and package time
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass::text AS t, conname FROM pg_constraint
            WHERE contype = 'c' AND conrelid IN ('os_prices'::regclass, 'os_vehicle_rules'::regclass, 'os_packages'::regclass)
              AND (pg_get_constraintdef(oid) ILIKE '%tier%' OR pg_get_constraintdef(oid) ILIKE '%duration_min%')
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.t, c.conname); END LOOP;
END $$;
ALTER TABLE os_prices ADD CONSTRAINT os_prices_tier_check CHECK (tier IN ('tier1', 'tier2', 'bike', 'harley_sportster', 'harley_softail', 'bb'));
ALTER TABLE os_vehicle_rules ADD CONSTRAINT os_vehicle_rules_tier_check CHECK (tier IN ('tier1', 'tier2', 'bike', 'harley_sportster', 'harley_softail', 'hub_only'));
ALTER TABLE os_packages ADD CONSTRAINT os_packages_duration_check CHECK (duration_min >= 0);

-- 2. package details
ALTER TABLE os_packages ADD COLUMN IF NOT EXISTS includes text[] NOT NULL DEFAULT '{}';
ALTER TABLE os_packages ADD COLUMN IF NOT EXISTS bonus text[] NOT NULL DEFAULT '{}';
ALTER TABLE os_packages ADD COLUMN IF NOT EXISTS price_note text;
ALTER TABLE os_packages ADD COLUMN IF NOT EXISTS price_from boolean NOT NULL DEFAULT false;
ALTER TABLE os_packages ADD COLUMN IF NOT EXISTS requires_addon boolean NOT NULL DEFAULT false;

-- 3. add-ons
CREATE TABLE IF NOT EXISTS os_addons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  vehicle_type   text NOT NULL CHECK (vehicle_type IN ('car', 'bike')),
  duration_min   int  NOT NULL CHECK (duration_min >= 0),
  duration_max   int  CHECK (duration_max IS NULL OR duration_max >= duration_min),
  price          numeric(12,2) NOT NULL CHECK (price >= 0),
  price_from     boolean NOT NULL DEFAULT false,
  plus_parts     boolean NOT NULL DEFAULT false,
  not_with_packages uuid[] NOT NULL DEFAULT '{}',
  sort_order     int  NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS os_addons_tenant ON os_addons (tenant_id, vehicle_type, sort_order);
ALTER TABLE os_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS os_addons_select ON os_addons;
CREATE POLICY os_addons_select ON os_addons FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','finance','mechanic']));
DROP POLICY IF EXISTS os_addons_write ON os_addons;
CREATE POLICY os_addons_write ON os_addons FOR ALL TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  WITH CHECK (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

-- 4. what a booking stores
ALTER TABLE os_bookings ADD COLUMN IF NOT EXISTS addons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE os_bookings ADD COLUMN IF NOT EXISTS price_addons numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE os_bookings ADD COLUMN IF NOT EXISTS est_duration_min int;
ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS travel_buffer_min int NOT NULL DEFAULT 30 CHECK (travel_buffer_min >= 0);

CREATE OR REPLACE FUNCTION os_bookings_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF get_my_role() = ANY (ARRAY['super_admin','ops_manager']) THEN RETURN NEW; END IF;
  IF (NEW.price_base, NEW.price_zone, NEW.price_offhours, NEW.price_addons, NEW.price_total, NEW.deposit_amount, NEW.deposit_status,
      NEW.invoice_id, NEW.token, NEW.tenant_id, NEW.booking_number, NEW.refund_due_at, NEW.refunded_at, NEW.refunded_by,
      NEW.refund_reference, NEW.refund_proof_url, NEW.hold_expires_at, NEW.addons)
     IS DISTINCT FROM
     (OLD.price_base, OLD.price_zone, OLD.price_offhours, OLD.price_addons, OLD.price_total, OLD.deposit_amount, OLD.deposit_status,
      OLD.invoice_id, OLD.token, OLD.tenant_id, OLD.booking_number, OLD.refund_due_at, OLD.refunded_at, OLD.refunded_by,
      OLD.refund_reference, OLD.refund_proof_url, OLD.hold_expires_at, OLD.addons) THEN
    RAISE EXCEPTION 'Prices, deposits and refunds on a booking can only be changed by an operations manager' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- 5. the quote with add-ons (the original os_calc_quote stays as it is)
CREATE OR REPLACE FUNCTION os_calc_quote_ex(p_tenant uuid, p_type text, p_make text, p_model text, p_package uuid, p_grade uuid, p_postcode text,
                                           p_offhours boolean, p_addons uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q jsonb; pkg os_packages; st os_settings; ids uuid[]; found int; ad jsonb; ad_total numeric := 0; est int; est_flag boolean; err text; tot numeric; vt text := coalesce(nullif(p_type, ''), 'car');
BEGIN
  q := os_calc_quote(p_tenant, p_type, p_make, p_model, p_package, p_grade, p_postcode, p_offhours);
  SELECT * INTO pkg FROM os_packages WHERE id = p_package AND tenant_id = p_tenant;
  SELECT * INTO st FROM os_settings WHERE tenant_id = p_tenant;
  SELECT array_agg(DISTINCT x) INTO ids FROM unnest(coalesce(p_addons, '{}')) x;
  ids := coalesce(ids, '{}');

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price, 'price_from', a.price_from, 'plus_parts', a.plus_parts,
                                              'duration_min', a.duration_min, 'duration_max', coalesce(a.duration_max, a.duration_min)) ORDER BY a.sort_order, a.name), '[]'::jsonb),
         count(*), coalesce(sum(a.price), 0), coalesce(sum(coalesce(a.duration_max, a.duration_min)), 0),
         coalesce(bool_or(a.price_from OR a.plus_parts), false)
    INTO ad, found, ad_total, est, est_flag
    FROM os_addons a
   WHERE a.id = ANY (ids) AND a.tenant_id = p_tenant AND a.is_active AND a.vehicle_type = vt AND NOT (p_package = ANY (a.not_with_packages));

  err := q->>'error';
  IF err IS NULL THEN
    IF found <> cardinality(ids) THEN err := 'addon_unavailable';
    ELSIF coalesce(pkg.requires_addon, false) AND found = 0 THEN err := 'addon_required'; END IF;
  END IF;
  est := coalesce(pkg.duration_min, 0) + est;
  tot := CASE WHEN (q->>'total') IS NULL THEN NULL ELSE (q->>'total')::numeric + ad_total END;
  RETURN q || jsonb_build_object('error', err, 'addons', ad, 'addons_total', ad_total, 'est_duration_min', est,
    'max_job_min', (SELECT max(extract(epoch FROM (s.end_time - s.start_time)) / 60)::int - st.travel_buffer_min FROM os_slots s WHERE s.branch_id = st.default_branch_id AND s.is_open),
    'estimate', coalesce(pkg.price_from, false) OR est_flag OR coalesce(pkg.price_note, '') <> '',
    'package_from', coalesce(pkg.price_from, false),
    'total', tot, 'deposit', CASE WHEN tot IS NULL THEN NULL ELSE round(tot * st.deposit_pct / 100.0, 2) END);
END $$;
REVOKE ALL ON FUNCTION os_calc_quote_ex(uuid, text, text, text, uuid, uuid, text, boolean, uuid[]) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS os_quote(text, text, text, text, uuid, uuid, text, boolean);
CREATE OR REPLACE FUNCTION os_quote(p_tenant_slug text, p_type text, p_make text, p_model text, p_package uuid, p_grade uuid, p_postcode text,
                                   p_offhours boolean DEFAULT false, p_addons uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := os_tenant_by_slug(p_tenant_slug);
BEGIN
  IF t IS NULL THEN RETURN jsonb_build_object('error', 'tenant_not_found'); END IF;
  RETURN os_calc_quote_ex(t, p_type, p_make, p_model, p_package, p_grade, p_postcode, p_offhours, p_addons);
END $$;
GRANT EXECUTE ON FUNCTION os_quote(text, text, text, text, uuid, uuid, text, boolean, uuid[]) TO anon, authenticated;

-- 6. booking, approval, invoice and lookups use the add-ons
DROP FUNCTION IF EXISTS os_create_booking(text, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, date, text);
CREATE OR REPLACE FUNCTION os_create_booking(p_tenant_slug text, p_name text, p_phone text, p_email text, p_type text, p_make text, p_model text, p_plate text, p_package uuid, p_grade uuid, p_address text, p_postcode text, p_access_notes text, p_slot uuid, p_date date, p_special_reason text DEFAULT NULL::text, p_addons uuid[] DEFAULT '{}')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t uuid := os_tenant_by_slug(p_tenant_slug); st os_settings; q jsonb; special boolean := coalesce(trim(p_special_reason), '') <> '';
  slot os_slots; pkg os_packages; grd os_oil_grades; z os_zones; err text;
  cust uuid; veh uuid; b os_bookings; plate text := os_norm_plate(p_plate); inv uuid;
  active_holds int; req_status text;
BEGIN
  IF t IS NULL THEN RETURN jsonb_build_object('error', 'tenant_not_found'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = t;
  IF NOT FOUND OR st.default_branch_id IS NULL THEN RETURN jsonb_build_object('error', 'not_configured'); END IF;
  IF coalesce(trim(p_name), '') = '' OR plate = '' OR length(os_norm_phone(p_phone)) NOT BETWEEN 8 AND 12
     OR coalesce(trim(p_address), '') = '' THEN
    RETURN jsonb_build_object('error', 'invalid_details');
  END IF;
  IF coalesce(trim(p_email), '') <> '' AND p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('error', 'invalid_email');
  END IF;

  PERFORM os_expire_holds();
  SELECT count(*) INTO active_holds FROM os_bookings
   WHERE tenant_id = t AND status IN ('awaiting_deposit','requested') AND os_norm_phone(customer_phone) = os_norm_phone(p_phone);
  IF active_holds >= 3 THEN RETURN jsonb_build_object('error', 'too_many_open'); END IF;

  SELECT * INTO pkg FROM os_packages WHERE id = p_package AND tenant_id = t;
  IF p_grade IS NOT NULL THEN SELECT * INTO grd FROM os_oil_grades WHERE id = p_grade AND package_id = p_package; END IF;
  q := os_calc_quote_ex(t, p_type, p_make, p_model, p_package, p_grade, p_postcode, false, p_addons);
  err := q->>'error';
  z := os_zone_for(t, p_postcode);

  IF NOT special THEN
    IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    IF p_slot IS NULL OR p_date IS NULL THEN RETURN jsonb_build_object('error', 'slot_required'); END IF;
    err := os_slot_error(st.default_branch_id, p_slot, p_date, false, st);
    IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    SELECT * INTO slot FROM os_slots WHERE id = p_slot;
    -- a job that does not fit one visit window (window length less the travel buffer) must go through a request
    IF (q->>'est_duration_min')::int > extract(epoch FROM (slot.end_time - slot.start_time)) / 60 - st.travel_buffer_min THEN
      RETURN jsonb_build_object('error', 'too_long', 'est_duration_min', (q->>'est_duration_min')::int);
    END IF;
  ELSIF err = 'hub_only' THEN
    RETURN jsonb_build_object('error', 'hub_only');
  END IF;

  req_status := CASE WHEN special THEN 'requested' ELSE 'awaiting_deposit' END;
  BEGIN
    -- customer and vehicle: reuse records the Hub already has; created inside this block
    -- so a lost slot race rolls them back too
    SELECT id INTO cust FROM customers WHERE tenant_id = t AND os_norm_phone(phone) = os_norm_phone(p_phone) ORDER BY created_at LIMIT 1;
    IF cust IS NULL THEN
      INSERT INTO customers (tenant_id, branch_id, full_name, phone, email, full_address, notes)
      VALUES (t, st.default_branch_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''), trim(p_address), 'Created from ON-SITE booking')
      RETURNING id INTO cust;
    END IF;
    SELECT id INTO veh FROM vehicles WHERE tenant_id = t AND os_norm_plate(plate_number) = plate ORDER BY created_at LIMIT 1;
    IF veh IS NULL THEN
      INSERT INTO vehicles (tenant_id, branch_id, customer_id, plate_number, vehicle_type, make, model)
      VALUES (t, st.default_branch_id, cust, plate, coalesce(nullif(p_type, ''), 'car'), nullif(trim(p_make), ''), nullif(trim(p_model), ''))
      RETURNING id INTO veh;
    END IF;
    INSERT INTO os_bookings (
      tenant_id, branch_id, status, request_type, special_reason,
      customer_id, vehicle_id, customer_name, customer_phone, customer_email,
      vehicle_type, vehicle_make, vehicle_model, vehicle_plate,
      tier, package_id, package_name, grade_id, grade_name,
      address, postcode, zone_id, zone_name, access_notes,
      slot_id, slot_label, service_date, slot_start, slot_end,
      price_base, price_zone, price_offhours, price_total, deposit_amount, hold_expires_at, addons, price_addons, est_duration_min)
    VALUES (
      t, st.default_branch_id, req_status, CASE WHEN special THEN 'special' ELSE 'standard' END, nullif(trim(p_special_reason), ''),
      cust, veh, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
      coalesce(nullif(p_type, ''), 'car'), nullif(trim(p_make), ''), nullif(trim(p_model), ''), plate,
      q->>'tier', pkg.id, pkg.name, grd.id, grd.name,
      trim(p_address), regexp_replace(coalesce(p_postcode, ''), '\D', '', 'g'), z.id, z.name, nullif(trim(p_access_notes), ''),
      CASE WHEN special THEN NULL ELSE slot.id END, CASE WHEN special THEN NULL ELSE slot.label END,
      p_date, CASE WHEN special THEN NULL ELSE slot.start_time END, CASE WHEN special THEN NULL ELSE slot.end_time END,
      (q->>'base')::numeric, coalesce((q->>'zone_surcharge')::numeric, 0), 0,
      CASE WHEN special THEN NULL ELSE (q->>'total')::numeric END,
      CASE WHEN special THEN 0 ELSE (q->>'deposit')::numeric END,
      CASE WHEN special THEN NULL ELSE now() + make_interval(mins => st.hold_minutes) END,
      coalesce(q->'addons', '[]'::jsonb), coalesce((q->>'addons_total')::numeric, 0), (q->>'est_duration_min')::int)
    RETURNING * INTO b;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'slot_taken');
  END;

  IF NOT special THEN
    inv := os_make_invoice(b.id);
    UPDATE os_bookings SET invoice_id = inv WHERE id = b.id;
    PERFORM os_enqueue(b.id, 'booking_received');
  ELSE
    PERFORM os_enqueue(b.id, 'request_received');
  END IF;

  RETURN jsonb_build_object('token', b.token, 'booking_number', b.booking_number, 'status', b.status,
                            'invoice_id', inv, 'deposit_amount', b.deposit_amount, 'total', b.price_total,
                            'hold_expires_at', b.hold_expires_at);
END $function$;
GRANT EXECUTE ON FUNCTION os_create_booking(text, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, date, text, uuid[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION os_make_invoice(p_booking uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; inv uuid; items jsonb := '[]'::jsonb; desc_text text; a jsonb; base numeric;
BEGIN
  SELECT * INTO b FROM os_bookings WHERE id = p_booking;
  desc_text := 'ON-SITE ' || coalesce(b.package_name, 'service') || coalesce(' (' || b.grade_name || ')', '');
  base := coalesce(b.price_base, greatest(coalesce(b.price_total, 0) - b.price_addons - b.price_zone - b.price_offhours, 0));
  IF base > 0 OR jsonb_array_length(b.addons) = 0 THEN
    items := items || jsonb_build_array(jsonb_build_object('item_type', 'labour', 'description', desc_text, 'qty', 1, 'uom', 'job', 'unit_price', base, 'amount', base));
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(b.addons) LOOP
    items := items || jsonb_build_object('item_type', 'labour',
             'description', 'ON-SITE add-on: ' || (a->>'name') || CASE WHEN (a->>'plus_parts')::boolean THEN ' (parts extra)' ELSE '' END,
             'qty', 1, 'uom', 'job', 'unit_price', (a->>'price')::numeric, 'amount', (a->>'price')::numeric);
  END LOOP;
  IF b.price_zone > 0 THEN
    items := items || jsonb_build_object('item_type', 'custom', 'description', 'Travel surcharge (' || coalesce(b.zone_name, 'zone') || ')',
             'qty', 1, 'uom', 'job', 'unit_price', b.price_zone, 'amount', b.price_zone);
  END IF;
  IF b.price_offhours > 0 THEN
    items := items || jsonb_build_object('item_type', 'custom', 'description', 'Off-hours surcharge',
             'qty', 1, 'uom', 'job', 'unit_price', b.price_offhours, 'amount', b.price_offhours);
  END IF;
  INSERT INTO invoices (tenant_id, branch_id, customer_id, customer_name, customer_phone, customer_email,
                        vehicle_plate, vehicle_info, status, line_items, subtotal, total_amount, notes)
  VALUES (b.tenant_id, b.branch_id, b.customer_id, b.customer_name, b.customer_phone, b.customer_email,
          b.vehicle_plate, trim(coalesce(b.vehicle_make, '') || ' ' || coalesce(b.vehicle_model, '')), 'draft',
          items, b.price_total, b.price_total, 'ON-SITE booking ' || b.booking_number)
  RETURNING id INTO inv;
  RETURN inv;
END $$;

CREATE OR REPLACE FUNCTION os_approve_request(p_booking uuid, p_slot uuid, p_date date, p_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b os_bookings; st os_settings; slot os_slots; err text; q jsonb; tot numeric; inv uuid;
BEGIN
  b := os_staff_check(p_booking, ARRAY['super_admin','ops_manager','foreman','front_desk']);
  IF b.status <> 'requested' OR b.deposit_status <> 'unpaid' THEN RETURN jsonb_build_object('error', 'not_a_pending_request'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  err := os_slot_error(b.branch_id, p_slot, p_date, true, st);
  IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
  SELECT * INTO slot FROM os_slots WHERE id = p_slot;
  tot := p_total;
  IF tot IS NULL THEN
    q := os_calc_quote_ex(b.tenant_id, b.vehicle_type, b.vehicle_make, b.vehicle_model, b.package_id, b.grade_id, b.postcode, false,
                          coalesce((SELECT array_agg((a->>'id')::uuid) FROM jsonb_array_elements(b.addons) a), '{}'));
    tot := (q->>'total')::numeric;
  END IF;
  IF tot IS NULL OR tot <= 0 THEN RETURN jsonb_build_object('error', 'price_required'); END IF;
  BEGIN
    UPDATE os_bookings SET status = 'awaiting_deposit', slot_id = slot.id, slot_label = slot.label, service_date = p_date,
           slot_start = slot.start_time, slot_end = slot.end_time,
           price_total = tot, price_base = greatest(tot - price_zone - price_offhours - price_addons, 0),
           deposit_amount = round(tot * st.deposit_pct / 100.0, 2),
           hold_expires_at = now() + make_interval(mins => greatest(st.hold_minutes, 1440))
     WHERE id = b.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'slot_taken');
  END;
  inv := os_make_invoice(b.id);
  UPDATE os_bookings SET invoice_id = inv WHERE id = b.id;
  PERFORM os_enqueue(b.id, 'request_approved');
  RETURN jsonb_build_object('ok', true);
END $function$;

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
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object('name', z.name, 'surcharge', z.surcharge) ORDER BY z.sort_order)
                         FROM os_zones z WHERE z.tenant_id = t AND z.is_active), '[]'::jsonb),
    'makes', coalesce((SELECT jsonb_agg(jsonb_build_object('type', r.vehicle_type, 'make', r.make, 'model', r.model, 'tier', r.tier) ORDER BY r.make)
                         FROM os_vehicle_rules r WHERE r.tenant_id = t), '[]'::jsonb),
    'bb', CASE WHEN st.bb_enabled AND st.hub_branch_id IS NOT NULL AND jsonb_array_length(bbp) > 0
               THEN jsonb_build_object('packages', bbp, 'capacity_per_day', st.bb_capacity_per_day, 'hq_address', st.bb_hq_address,
                                       'pickup_note', st.bb_pickup_note, 'window_days', st.booking_window_days)
               ELSE NULL END
  );
END $function$;

CREATE OR REPLACE FUNCTION os_get_booking(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b os_bookings; st os_settings; inv invoices; hrs numeric; open_status boolean; bill jsonb;
BEGIN
  PERFORM os_expire_holds();
  SELECT * INTO b FROM os_bookings WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  IF b.invoice_id IS NOT NULL THEN SELECT * INTO inv FROM invoices WHERE id = b.invoice_id; END IF;
  hrs := CASE WHEN b.service_date IS NOT NULL AND b.slot_start IS NOT NULL
              THEN extract(epoch FROM (os_ts(b.service_date, b.slot_start) - now())) / 3600.0
              WHEN b.service_date IS NOT NULL AND b.service_mode = 'bb_pickup'
              THEN extract(epoch FROM (os_ts(b.service_date, time '08:00') - now())) / 3600.0 END;
  open_status := b.status IN ('awaiting_deposit','requested','confirmed');
  IF b.service_mode = 'bb_pickup' AND inv.id IS NOT NULL AND inv.status IN ('sent', 'overdue', 'paid') THEN
    bill := jsonb_build_object('invoice_id', inv.id, 'status', inv.status, 'total', inv.total_amount, 'paid', inv.amount_paid,
                               'balance', inv.total_amount - inv.amount_paid, 'plan', invoice_plan_next(inv.id));
  END IF;
  RETURN jsonb_build_object(
    'booking_number', b.booking_number, 'status', b.status, 'request_type', b.request_type,
    'service_mode', b.service_mode, 'staff_id', b.staff_id, 'bill', bill,
    'contact_whatsapp', st.contact_whatsapp,
    'pickup_note', CASE WHEN b.service_mode = 'bb_pickup' THEN st.bb_pickup_note END,
    'customer_name', b.customer_name, 'vehicle_plate', b.vehicle_plate,
    'vehicle', trim(coalesce(b.vehicle_make, '') || ' ' || coalesce(b.vehicle_model, '')),
    'package_name', b.package_name, 'grade_name', b.grade_name,
    'address', b.address, 'zone_name', b.zone_name, 'access_notes', b.access_notes,
    'service_date', b.service_date, 'slot_label', b.slot_label, 'slot_start', b.slot_start,
    'price_base', b.price_base, 'price_zone', b.price_zone, 'price_offhours', b.price_offhours, 'price_total', b.price_total,
    'deposit_amount', b.deposit_amount, 'deposit_status', b.deposit_status,
    'amount_paid', coalesce(inv.amount_paid, 0),
    'balance_due', CASE WHEN b.price_total IS NULL THEN NULL ELSE b.price_total - coalesce(inv.amount_paid, 0) END,
    'invoice_id', b.invoice_id, 'hold_expires_at', b.hold_expires_at, 'decline_reason', CASE WHEN b.status = 'declined' THEN b.cancel_reason END,
    'special_reason', b.special_reason,
    'reschedule_count', b.reschedule_count, 'max_reschedules', st.max_reschedules,
    'cancel_cutoff_hours', st.cancel_cutoff_hours, 'refund_due_hours', st.refund_due_hours,
    'hours_to_service', hrs,
    'can_reschedule', open_status AND b.status <> 'requested' AND b.reschedule_count < st.max_reschedules AND (hrs IS NULL OR hrs >= st.cancel_cutoff_hours),
    'can_cancel', open_status,
    'refund_eligible', b.deposit_status = 'paid' AND (hrs IS NULL OR hrs >= st.cancel_cutoff_hours),
    'refund_due_at', b.refund_due_at, 'refunded_at', b.refunded_at
  ) || jsonb_build_object(
    'confirmed_at', b.confirmed_at, 'en_route_at', b.en_route_at, 'arrived_at', b.arrived_at,
    'started_at', b.started_at, 'completed_at', b.completed_at, 'cancelled_at', b.cancelled_at,
    'photos_before', b.photos_before, 'photos_after', b.photos_after, 'health_check', b.health_check,
    'technician_name', (SELECT split_part(full_name, ' ', 1) FROM users WHERE id = b.technician_id),
    'hub_quote', CASE WHEN b.hub_quote_id IS NULL THEN NULL
                      ELSE (SELECT jsonb_build_object('quote_number', q.quote_number, 'total', q.total_amount) FROM quotations q WHERE q.id = b.hub_quote_id) END
  ) || jsonb_build_object('addons', b.addons, 'price_addons', b.price_addons, 'est_duration_min', b.est_duration_min);
END $function$;

-- 7. the menu (Motoverse Garage)
DO $$
DECLARE
  t uuid; essential uuid; continental uuid; battery uuid; brake uuid; aircon uuid; rescue uuid; harley_s uuid; harley_t uuid; others uuid;
  eff date := os_today();
  m text; hs text[] := ARRAY['Sportster S', 'Iron 883', 'Forty-Eight', 'Seventy-Two', 'Nightster'];
  ht text[] := ARRAY['Street Bob', 'Fat Bob', 'Low Rider', 'Low Rider S', 'Breakout', 'Fat Boy', 'Road King', 'Street Glide', 'Road Glide', 'Ultra Limited'];
BEGIN
  SELECT id INTO t FROM tenants WHERE slug = 'motoverse-garage';
  IF t IS NULL THEN RETURN; END IF;

  -- packages (the existing "Engine lube" becomes the Essential package, keeping its RM379 price)
  SELECT id INTO essential FROM os_packages WHERE tenant_id = t AND audience = 'public' AND (name = 'Essential Oil Change Package' OR services = ARRAY['engine_lube']) ORDER BY created_at LIMIT 1;
  IF essential IS NULL THEN
    INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, is_active, audience) VALUES (t, 'Essential Oil Change Package', '', ARRAY['engine_lube'], 60, 1, true, 'public') RETURNING id INTO essential;
  END IF;
  UPDATE os_packages SET name = 'Essential Oil Change Package', description = 'Engine oil and oil filter change at your location. For local, Japanese, Korean and selected China vehicles.',
         includes = ARRAY['Engine oil', 'Oil filter', 'Labour (upah)', 'Service reminder reset'], duration_min = 60, sort_order = 1, is_active = true WHERE id = essential;

  -- Continental: use the one already added in Settings if there is one (its own name and description are kept)
  SELECT id INTO continental FROM os_packages WHERE tenant_id = t AND audience = 'public' AND name IN ('Continental Oil Change Package', 'Continental Package') ORDER BY created_at LIMIT 1;
  IF continental IS NULL THEN
    INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, includes)
    VALUES (t, 'Continental Oil Change Package', 'Engine oil and oil filter change for continental vehicles, which need more oil and a higher specification.', ARRAY['engine_lube'], 60, 2, 'public',
            ARRAY['Engine oil', 'Oil filter', 'Labour (upah)', 'Service reminder reset'])
    RETURNING id INTO continental;
  ELSE
    UPDATE os_packages SET sort_order = 2, is_active = true,
           includes = CASE WHEN cardinality(includes) = 0 THEN ARRAY['Engine oil', 'Oil filter', 'Labour (upah)', 'Service reminder reset'] ELSE includes END
     WHERE id = continental;
  END IF;
  INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, includes, price_note)
  SELECT t, 'Battery ON-SITE', 'Battery test, battery replacement and charging system check.', ARRAY['battery'], 30, 3, 'public',
         ARRAY['Battery test', 'Battery replacement', 'Charging system check'], 'Service fee. The battery is charged separately according to your vehicle and model.'
   WHERE NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = t AND name = 'Battery ON-SITE');
  INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, includes, price_from, price_note)
  SELECT t, 'Brake Care', 'Brake inspection and brake pad replacement.', ARRAY['brake'], 60, 4, 'public',
         ARRAY['Brake inspection', 'Brake pad replacement', 'Service reminder reset'], true, 'Labour from this price. Brake pads are charged separately according to your vehicle and model.'
   WHERE NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = t AND name = 'Brake Care');
  INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, includes, price_from, price_note)
  SELECT t, 'Air-Con Care', 'Air-conditioner inspection and servicing.', ARRAY['aircon'], 90, 5, 'public',
         ARRAY['Air-conditioner inspection', 'Air-conditioner servicing'], true, 'Gas, parts and any additional repair are charged separately where required.'
   WHERE NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = t AND name = 'Air-Con Care');
  INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, price_from, price_note)
  SELECT t, 'Bike ON-SITE Rescue', 'On-site help for minor motorcycle breakdowns and service support.', ARRAY['bike_rescue'], 30, 6, 'public', true,
         'Final price and time depend on the bike model, location and the work required.'
   WHERE NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = t AND name = 'Bike ON-SITE Rescue');
  INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, includes, bonus)
  SELECT t, 'Harley-Davidson Support Care: Sportster', 'Engine oil service for Harley-Davidson Sportster models.', ARRAY['engine_lube'], 60, 7, 'public',
         ARRAY['Engine oil service', 'Oil filter', 'Basic bike inspection', 'Labour (upah)'], ARRAY['Free bike wash']
   WHERE NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = t AND name = 'Harley-Davidson Support Care: Sportster');
  INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, includes, bonus)
  SELECT t, 'Harley-Davidson Support Care: Softail / Touring', 'Engine oil service for Harley-Davidson Softail and Touring models.', ARRAY['engine_lube'], 60, 8, 'public',
         ARRAY['Engine oil service', 'Oil filter', 'Basic bike inspection', 'Labour (upah)'], ARRAY['Free bike wash']
   WHERE NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = t AND name = 'Harley-Davidson Support Care: Softail / Touring');
  INSERT INTO os_packages (tenant_id, name, description, services, duration_min, sort_order, audience, requires_addon, price_note)
  SELECT t, 'Others', 'Need something else? Choose any of our services below, one or more.', ARRAY['others'], 0, 9, 'public', true,
         'You pay for the services you choose. Parts and products are charged separately where shown.'
   WHERE NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = t AND name = 'Others');
  -- the older gearbox packages stay switched off and move to the end of the list
  UPDATE os_packages SET sort_order = 20 + sort_order WHERE tenant_id = t AND audience = 'public' AND is_active = false AND services && ARRAY['gearbox_lube'] AND sort_order < 20;

  SELECT id INTO battery FROM os_packages WHERE tenant_id = t AND name = 'Battery ON-SITE';
  SELECT id INTO brake FROM os_packages WHERE tenant_id = t AND name = 'Brake Care';
  SELECT id INTO aircon FROM os_packages WHERE tenant_id = t AND name = 'Air-Con Care';
  SELECT id INTO rescue FROM os_packages WHERE tenant_id = t AND name = 'Bike ON-SITE Rescue';
  SELECT id INTO harley_s FROM os_packages WHERE tenant_id = t AND name = 'Harley-Davidson Support Care: Sportster';
  SELECT id INTO harley_t FROM os_packages WHERE tenant_id = t AND name = 'Harley-Davidson Support Care: Softail / Touring';
  SELECT id INTO others FROM os_packages WHERE tenant_id = t AND name = 'Others';

  -- prices (price level: tier1 local/Japanese/Korean, tier2 continental)
  INSERT INTO os_prices (tenant_id, package_id, tier, price, effective_from)
  SELECT t, v.pkg, v.tier, v.price, eff FROM (VALUES
    (essential, 'tier1', 379), (continental, 'tier2', 599),
    (battery, 'tier1', 80), (battery, 'tier2', 80),
    (brake, 'tier1', 120), (brake, 'tier2', 120),
    (aircon, 'tier1', 120), (aircon, 'tier2', 120),
    (rescue, 'bike', 100), (rescue, 'harley_sportster', 100), (rescue, 'harley_softail', 100),
    (harley_s, 'harley_sportster', 599), (harley_t, 'harley_softail', 899),
    (others, 'tier1', 0), (others, 'tier2', 0), (others, 'bike', 0), (others, 'harley_sportster', 0), (others, 'harley_softail', 0)
  ) AS v(pkg, tier, price)
  WHERE NOT EXISTS (SELECT 1 FROM os_prices p WHERE p.package_id = v.pkg AND p.tier = v.tier AND p.grade_id IS NULL);

  -- motorcycles: every bike make is a plain bike; Harley models pick their price level
  INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, model, tier)
  SELECT t, 'bike', mk, NULL, 'bike' FROM unnest(ARRAY['Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'Harley-Davidson', 'Ducati', 'BMW Motorrad', 'Royal Enfield', 'Triumph', 'KTM', 'Modenas', 'SYM', 'Vespa', 'Benelli', 'CFMoto']) AS mk
   WHERE NOT EXISTS (SELECT 1 FROM os_vehicle_rules r WHERE r.tenant_id = t AND r.vehicle_type = 'bike' AND r.make = mk AND r.model IS NULL);
  FOREACH m IN ARRAY hs LOOP
    INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, model, tier) SELECT t, 'bike', 'Harley-Davidson', m, 'harley_sportster'
     WHERE NOT EXISTS (SELECT 1 FROM os_vehicle_rules r WHERE r.tenant_id = t AND r.vehicle_type = 'bike' AND r.make = 'Harley-Davidson' AND r.model = m);
  END LOOP;
  FOREACH m IN ARRAY ht LOOP
    INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, model, tier) SELECT t, 'bike', 'Harley-Davidson', m, 'harley_softail'
     WHERE NOT EXISTS (SELECT 1 FROM os_vehicle_rules r WHERE r.tenant_id = t AND r.vehicle_type = 'bike' AND r.make = 'Harley-Davidson' AND r.model = m);
  END LOOP;

  -- add-ons (price_from: "from"; plus_parts: the part or product is charged on top)
  IF NOT EXISTS (SELECT 1 FROM os_addons WHERE tenant_id = t) THEN
    INSERT INTO os_addons (tenant_id, name, vehicle_type, duration_min, duration_max, price, price_from, plus_parts, not_with_packages, sort_order)
    SELECT t, a.name, a.vt, a.dmin, a.dmax, a.price, a.pfrom, a.pparts,
           CASE a.name
             WHEN 'Service Reminder Reset' THEN ARRAY[essential, continental, brake]
             WHEN 'Brake Inspection' THEN ARRAY[brake]
             WHEN 'Battery Test' THEN ARRAY[battery]
             WHEN 'Battery Replacement' THEN ARRAY[battery]
             WHEN 'Front Brake Pad Replacement' THEN ARRAY[brake]
             WHEN 'Rear Brake Pad Replacement' THEN ARRAY[brake]
             ELSE '{}'::uuid[] END,
           a.ord
    FROM (VALUES
      ('Cabin Filter Replacement', 'car', 10, NULL::int, 50, true, true, 1),
      ('Engine Air Filter Replacement', 'car', 10, NULL, 40, true, true, 2),
      ('Battery Test', 'car', 5, NULL, 20, false, false, 3),
      ('Wiper Blade Replacement', 'car', 5, NULL, 30, true, true, 4),
      ('Diagnostic Scan', 'car', 10, NULL, 50, false, false, 5),
      ('Brake Inspection', 'car', 15, NULL, 30, false, false, 6),
      ('20-Point Vehicle Health Check', 'car', 15, NULL, 30, false, false, 7),
      ('Tyre Pressure & Condition Check', 'car', 5, NULL, 15, false, false, 8),
      ('Fluid Level Check', 'car', 5, NULL, 15, false, false, 9),
      ('Service Reminder Reset', 'car', 5, NULL, 30, false, false, 10),
      ('Engine Flush', 'car', 10, NULL, 50, true, true, 11),
      ('Coolant Top-Up', 'car', 5, NULL, 20, true, true, 12),
      ('AdBlue Top-Up', 'car', 5, NULL, 20, true, true, 13),
      ('Engine / Fuel Treatment Additive', 'car', 5, NULL, 30, true, true, 14),
      ('Bulb Replacement', 'car', 10, 20, 30, true, true, 15),
      ('Spark Plug Replacement', 'car', 30, 45, 80, true, true, 16),
      ('Battery Replacement', 'car', 15, NULL, 50, false, true, 17),
      ('Front Brake Pad Replacement', 'car', 45, NULL, 120, true, true, 18),
      ('Rear Brake Pad Replacement', 'car', 45, 60, 120, true, true, 19),
      ('Tyre / Spare Wheel Change', 'car', 20, 30, 80, false, false, 20),
      ('Chain Clean & Lube', 'bike', 15, NULL, 40, false, false, 1),
      ('Chain Adjustment', 'bike', 15, NULL, 40, false, false, 2),
      ('Bike Battery Test', 'bike', 5, NULL, 20, false, false, 3),
      ('Bike Brake Inspection', 'bike', 10, NULL, 30, false, false, 4),
      ('Bike Diagnostic Scan', 'bike', 15, NULL, 50, false, false, 5),
      ('Bike Spark Plug Replacement', 'bike', 20, 45, 60, true, true, 6)
    ) AS a(name, vt, dmin, dmax, price, pfrom, pparts, ord);
  END IF;
END $$;
