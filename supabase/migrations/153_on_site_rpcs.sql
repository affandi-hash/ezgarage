-- 153: ON-SITE booking engine (RPCs, status guard, deposit sync, housekeeping).
--
-- Public (anon) entry points identify a booking only by its long random
-- token; nothing here lets an anonymous caller list or search bookings.
-- Staff entry points check the caller's role inside the function.

ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS hub_branch_id uuid REFERENCES branches(id);
UPDATE os_settings s SET hub_branch_id = b.id
  FROM branches b
 WHERE b.tenant_id = s.tenant_id AND b.code = 'MVG' AND s.hub_branch_id IS NULL;
UPDATE branches SET code = 'ONS1' WHERE id = 'c683e98b-6f0e-4df5-85b5-ff9ba1e30531' AND (code IS NULL OR code = '');

-- ── small helpers (internal) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION os_today() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date $$;

CREATE OR REPLACE FUNCTION os_ts(p_date date, p_time time) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$ SELECT (p_date + p_time) AT TIME ZONE 'Asia/Kuala_Lumpur' $$;

-- 0123456789 / 60123456789 / +60 12-345 6789 all compare equal.
CREATE OR REPLACE FUNCTION os_norm_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(60|0)', '') $$;

CREATE OR REPLACE FUNCTION os_norm_plate(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')) $$;

CREATE OR REPLACE FUNCTION os_tenant_by_slug(p_slug text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id FROM tenants WHERE is_active = true AND slug = coalesce(p_slug, 'motoverse-garage') LIMIT 1 $$;

CREATE OR REPLACE FUNCTION os_tier_for(p_tenant uuid, p_type text, p_make text, p_model text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tier FROM os_vehicle_rules
   WHERE tenant_id = p_tenant
     AND vehicle_type = coalesce(nullif(p_type, ''), 'car')
     AND lower(make) = lower(trim(coalesce(p_make, '')))
     AND (model IS NULL OR lower(model) = lower(trim(coalesce(p_model, ''))))
   ORDER BY (model IS NOT NULL) DESC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION os_zone_for(p_tenant uuid, p_postcode text)
RETURNS os_zones LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT z.* FROM os_zones z, unnest(z.postcodes) pc
   WHERE z.tenant_id = p_tenant AND z.is_active
     AND regexp_replace(coalesce(p_postcode, ''), '\D', '', 'g') LIKE trim(pc) || '%'
     AND length(trim(pc)) > 0
   ORDER BY length(trim(pc)) DESC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION os_enqueue(p_booking uuid, p_event text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings;
BEGIN
  SELECT * INTO b FROM os_bookings WHERE id = p_booking;
  IF NOT FOUND THEN RETURN; END IF;
  IF coalesce(trim(b.customer_email), '') <> '' THEN
    INSERT INTO os_notifications (tenant_id, booking_id, event, channel, to_address)
    VALUES (b.tenant_id, b.id, p_event, 'email', trim(b.customer_email));
  ELSE
    INSERT INTO os_notifications (tenant_id, booking_id, event, channel, status, error)
    VALUES (b.tenant_id, b.id, p_event, 'email', 'skipped', 'no email address');
  END IF;
  -- WhatsApp (WATI) is added here as a second channel once a number is registered.
END $$;

-- Release held slots whose deposit never arrived.
CREATE OR REPLACE FUNCTION os_expire_holds() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; r record;
BEGIN
  FOR r IN
    UPDATE os_bookings SET status = 'expired', cancelled_at = now(), cancel_reason = 'Deposit not paid in time'
     WHERE status = 'awaiting_deposit' AND deposit_status = 'unpaid' AND hold_expires_at < now()
    RETURNING id, invoice_id
  LOOP
    n := n + 1;
    IF r.invoice_id IS NOT NULL THEN
      UPDATE invoices SET status = 'void' WHERE id = r.invoice_id AND amount_paid = 0;
    END IF;
    PERFORM os_enqueue(r.id, 'hold_expired');
  END LOOP;
  RETURN n;
END $$;

-- Why a slot cannot be booked, or NULL when it can. p_staff skips the
-- customer-facing rules (open switch, window, cutoff).
CREATE OR REPLACE FUNCTION os_slot_error(p_branch uuid, p_slot uuid, p_date date, p_staff boolean, p_set os_settings)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s os_slots;
BEGIN
  SELECT * INTO s FROM os_slots WHERE id = p_slot AND branch_id = p_branch;
  IF NOT FOUND THEN RETURN 'slot_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM os_blackouts WHERE branch_id = p_branch AND blackout_date = p_date) THEN RETURN 'date_blocked'; END IF;
  IF NOT (extract(isodow FROM p_date)::smallint = ANY (s.days)) THEN RETURN 'day_not_served'; END IF;
  IF p_staff THEN RETURN NULL; END IF;
  IF NOT s.is_open THEN RETURN 'slot_closed'; END IF;
  IF p_date < os_today() OR p_date > os_today() + p_set.booking_window_days THEN RETURN 'outside_window'; END IF;
  IF os_ts(p_date, s.start_time) - make_interval(hours => p_set.booking_cutoff_hours) <= now() THEN RETURN 'too_soon'; END IF;
  RETURN NULL;
END $$;

-- Price a booking: tier from make/model, package x tier x grade price in
-- force today, plus zone and off-hours surcharges.
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
  IF err IS NULL AND z.id IS NULL THEN err := 'outside_zone'; END IF;
  IF z.id IS NOT NULL THEN zs := z.surcharge; END IF;
  IF p_offhours AND st.offhours_enabled THEN oh := coalesce(st.offhours_surcharge, 0); END IF;

  tot := CASE WHEN base IS NULL THEN NULL ELSE base + zs + oh END;
  RETURN jsonb_build_object(
    'error', err, 'tier', v_tier, 'base', base, 'zone_id', z.id, 'zone_name', z.name,
    'zone_surcharge', zs, 'offhours_surcharge', oh, 'total', tot,
    'deposit', CASE WHEN tot IS NULL THEN NULL ELSE round(tot * st.deposit_pct / 100.0, 2) END,
    'deposit_pct', st.deposit_pct);
END $$;

-- Invoice for a booking: full price on one invoice, deposit tracked by
-- os_bookings.deposit_amount. Called with the booking row already inserted.
CREATE OR REPLACE FUNCTION os_make_invoice(p_booking uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; inv uuid; items jsonb; desc_text text;
BEGIN
  SELECT * INTO b FROM os_bookings WHERE id = p_booking;
  desc_text := 'ON-SITE ' || coalesce(b.package_name, 'service') || coalesce(' (' || b.grade_name || ')', '');
  items := jsonb_build_array(jsonb_build_object('item_type', 'labour', 'description', desc_text, 'qty', 1, 'uom', 'job',
             'unit_price', coalesce(b.price_base, b.price_total), 'amount', coalesce(b.price_base, b.price_total)));
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
          b.vehicle_plate, trim(coalesce(b.vehicle_make, '') || ' ' || coalesce(b.vehicle_model, '')), 'sent',
          items, b.price_total, b.price_total, 'ON-SITE booking ' || b.booking_number)
  RETURNING id INTO inv;
  RETURN inv;
END $$;

-- ── public: config, lookups, availability, quote ────────────────────────
CREATE OR REPLACE FUNCTION os_get_public_config(p_tenant_slug text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := os_tenant_by_slug(p_tenant_slug); st os_settings;
BEGIN
  IF t IS NULL THEN RETURN jsonb_build_object('error', 'tenant_not_found'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = t;
  IF NOT FOUND OR st.default_branch_id IS NULL THEN RETURN jsonb_build_object('error', 'not_configured'); END IF;
  RETURN jsonb_build_object(
    'tenant_name', (SELECT name FROM tenants WHERE id = t),
    'settings', jsonb_build_object('deposit_pct', st.deposit_pct, 'cancel_cutoff_hours', st.cancel_cutoff_hours,
        'refund_due_hours', st.refund_due_hours, 'max_reschedules', st.max_reschedules,
        'booking_window_days', st.booking_window_days, 'hold_minutes', st.hold_minutes,
        'offhours_enabled', st.offhours_enabled, 'offhours_surcharge', st.offhours_surcharge),
    'packages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'duration_min', p.duration_min,
        'grades', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.sort_order, g.name)
                              FROM os_oil_grades g WHERE g.package_id = p.id AND g.is_active), '[]'::jsonb),
        'tiers', coalesce((SELECT jsonb_agg(DISTINCT pr.tier) FROM os_prices pr WHERE pr.package_id = p.id AND pr.effective_from <= os_today()), '[]'::jsonb)
      ) ORDER BY p.sort_order, p.name)
      FROM os_packages p WHERE p.tenant_id = t AND p.is_active), '[]'::jsonb),
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object('name', z.name, 'surcharge', z.surcharge) ORDER BY z.sort_order)
                         FROM os_zones z WHERE z.tenant_id = t AND z.is_active), '[]'::jsonb),
    'makes', coalesce((SELECT jsonb_agg(jsonb_build_object('type', r.vehicle_type, 'make', r.make, 'model', r.model, 'tier', r.tier) ORDER BY r.make)
                         FROM os_vehicle_rules r WHERE r.tenant_id = t), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION os_quote(p_tenant_slug text, p_type text, p_make text, p_model text,
  p_package uuid, p_grade uuid, p_postcode text, p_offhours boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := os_tenant_by_slug(p_tenant_slug);
BEGIN
  IF t IS NULL THEN RETURN jsonb_build_object('error', 'tenant_not_found'); END IF;
  RETURN os_calc_quote(t, p_type, p_make, p_model, p_package, p_grade, p_postcode, p_offhours);
END $$;

CREATE OR REPLACE FUNCTION os_available_slots(p_tenant_slug text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := os_tenant_by_slug(p_tenant_slug); st os_settings; out jsonb;
BEGIN
  IF t IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = t;
  IF NOT FOUND OR st.default_branch_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  PERFORM os_expire_holds();
  SELECT coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'slots', d.slots) ORDER BY d.day), '[]'::jsonb) INTO out
  FROM (
    SELECT g.day,
           jsonb_agg(jsonb_build_object('slot_id', s.id, 'label', s.label, 'start', s.start_time, 'end', s.end_time,
                     'available', (os_slot_error(st.default_branch_id, s.id, g.day, false, st) IS NULL
                                   AND NOT EXISTS (SELECT 1 FROM os_bookings b WHERE b.branch_id = s.branch_id AND b.service_date = g.day AND b.slot_id = s.id
                                                   AND b.status IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress','completed')))
                    ) ORDER BY s.sort_order, s.start_time) AS slots
      FROM (SELECT os_today() + i AS day FROM generate_series(0, st.booking_window_days) AS i) g
      JOIN os_slots s ON s.branch_id = st.default_branch_id AND s.is_open
       AND extract(isodow FROM g.day)::smallint = ANY (s.days)
     WHERE NOT EXISTS (SELECT 1 FROM os_blackouts bo WHERE bo.branch_id = s.branch_id AND bo.blackout_date = g.day)
     GROUP BY g.day
  ) d;
  RETURN out;
END $$;

-- ── public: create a booking ────────────────────────────────────────────
-- Standard: slot + date required, deposit invoice created, slot held.
-- Special (p_special_reason set): no slot hold, no invoice; staff approve first.
CREATE OR REPLACE FUNCTION os_create_booking(
  p_tenant_slug text, p_name text, p_phone text, p_email text,
  p_type text, p_make text, p_model text, p_plate text,
  p_package uuid, p_grade uuid,
  p_address text, p_postcode text, p_access_notes text,
  p_slot uuid, p_date date, p_special_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  q := os_calc_quote(t, p_type, p_make, p_model, p_package, p_grade, p_postcode, false);
  err := q->>'error';
  z := os_zone_for(t, p_postcode);

  IF NOT special THEN
    IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    IF p_slot IS NULL OR p_date IS NULL THEN RETURN jsonb_build_object('error', 'slot_required'); END IF;
    err := os_slot_error(st.default_branch_id, p_slot, p_date, false, st);
    IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    SELECT * INTO slot FROM os_slots WHERE id = p_slot;
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
      price_base, price_zone, price_offhours, price_total, deposit_amount, hold_expires_at)
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
      CASE WHEN special THEN NULL ELSE now() + make_interval(mins => st.hold_minutes) END)
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
END $$;

-- ── public: read / change a booking by token ────────────────────────────
CREATE OR REPLACE FUNCTION os_get_booking(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; st os_settings; inv invoices; hrs numeric; open_status boolean;
BEGIN
  PERFORM os_expire_holds();
  SELECT * INTO b FROM os_bookings WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  IF b.invoice_id IS NOT NULL THEN SELECT * INTO inv FROM invoices WHERE id = b.invoice_id; END IF;
  hrs := CASE WHEN b.service_date IS NOT NULL AND b.slot_start IS NOT NULL
              THEN extract(epoch FROM (os_ts(b.service_date, b.slot_start) - now())) / 3600.0 END;
  open_status := b.status IN ('awaiting_deposit','requested','confirmed');
  RETURN jsonb_build_object(
    'booking_number', b.booking_number, 'status', b.status, 'request_type', b.request_type,
    'customer_name', b.customer_name, 'vehicle_plate', b.vehicle_plate,
    'vehicle', trim(coalesce(b.vehicle_make, '') || ' ' || coalesce(b.vehicle_model, '')),
    'package_name', b.package_name, 'grade_name', b.grade_name,
    'address', b.address, 'zone_name', b.zone_name,
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
    'refund_due_at', b.refund_due_at, 'refunded_at', b.refunded_at,
    'confirmed_at', b.confirmed_at, 'en_route_at', b.en_route_at, 'arrived_at', b.arrived_at,
    'started_at', b.started_at, 'completed_at', b.completed_at, 'cancelled_at', b.cancelled_at,
    'photos_before', b.photos_before, 'photos_after', b.photos_after, 'health_check', b.health_check,
    'technician_name', (SELECT split_part(full_name, ' ', 1) FROM users WHERE id = b.technician_id),
    'hub_quote', CASE WHEN b.hub_quote_id IS NULL THEN NULL
                      ELSE (SELECT jsonb_build_object('quote_number', q.quote_number, 'total', q.total_amount) FROM quotations q WHERE q.id = b.hub_quote_id) END
  );
END $$;

-- Cancel or reschedule, with the cutoff and refund rules from os_settings.
CREATE OR REPLACE FUNCTION os_do_cancel(p_booking uuid, p_refund boolean, p_status text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; st os_settings; inv invoices;
BEGIN
  SELECT * INTO b FROM os_bookings WHERE id = p_booking;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  IF b.invoice_id IS NOT NULL THEN SELECT * INTO inv FROM invoices WHERE id = b.invoice_id; END IF;

  IF coalesce(inv.amount_paid, 0) > 0 AND b.deposit_status = 'paid' THEN
    IF p_refund THEN
      UPDATE invoices SET status = 'void' WHERE id = inv.id;
      UPDATE os_bookings SET deposit_status = 'refund_due', refund_due_at = now() + make_interval(hours => st.refund_due_hours) WHERE id = b.id;
    ELSE
      -- deposit kept: it becomes the invoice, so revenue is the deposit only
      UPDATE invoices SET status = 'paid', subtotal = amount_paid, total_amount = amount_paid,
             line_items = jsonb_build_array(jsonb_build_object('item_type', 'custom', 'description',
               'Booking deposit retained (' || b.booking_number || ')', 'qty', 1, 'uom', 'job',
               'unit_price', amount_paid, 'amount', amount_paid)) WHERE id = inv.id;
      UPDATE os_bookings SET deposit_status = 'forfeited' WHERE id = b.id;
    END IF;
  ELSIF inv.id IS NOT NULL THEN
    UPDATE invoices SET status = 'void' WHERE id = inv.id;
    UPDATE os_bookings SET deposit_status = 'none' WHERE id = b.id;
  END IF;

  UPDATE os_bookings SET status = p_status, cancelled_at = now(), cancel_reason = p_reason WHERE id = b.id;
  PERFORM os_enqueue(b.id, CASE WHEN p_status = 'no_show' THEN 'no_show'
                                WHEN b.deposit_status = 'paid' AND p_refund THEN 'cancelled_refund_due'
                                WHEN b.deposit_status = 'paid' THEN 'cancelled_forfeited'
                                ELSE 'cancelled' END);
END $$;

CREATE OR REPLACE FUNCTION os_change_booking(p_token text, p_action text, p_slot uuid DEFAULT NULL, p_date date DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; st os_settings; hrs numeric; err text; slot os_slots; early boolean;
BEGIN
  PERFORM os_expire_holds();
  SELECT * INTO b FROM os_bookings WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF b.status NOT IN ('awaiting_deposit','requested','confirmed') THEN RETURN jsonb_build_object('error', 'not_changeable'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  hrs := CASE WHEN b.service_date IS NOT NULL AND b.slot_start IS NOT NULL
              THEN extract(epoch FROM (os_ts(b.service_date, b.slot_start) - now())) / 3600.0 END;
  early := hrs IS NULL OR hrs >= st.cancel_cutoff_hours;

  IF p_action = 'cancel' THEN
    PERFORM os_do_cancel(b.id, early, 'cancelled', coalesce(nullif(trim(p_reason), ''), 'Cancelled by customer'));
    RETURN jsonb_build_object('ok', true, 'refund', early AND b.deposit_status = 'paid');
  ELSIF p_action = 'reschedule' THEN
    IF b.status = 'requested' THEN RETURN jsonb_build_object('error', 'not_changeable'); END IF;
    IF NOT early THEN RETURN jsonb_build_object('error', 'too_late'); END IF;
    IF b.reschedule_count >= st.max_reschedules THEN RETURN jsonb_build_object('error', 'max_reschedules'); END IF;
    IF p_slot IS NULL OR p_date IS NULL THEN RETURN jsonb_build_object('error', 'slot_required'); END IF;
    err := os_slot_error(b.branch_id, p_slot, p_date, false, st);
    IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    SELECT * INTO slot FROM os_slots WHERE id = p_slot;
    BEGIN
      UPDATE os_bookings SET slot_id = slot.id, slot_label = slot.label, service_date = p_date,
             slot_start = slot.start_time, slot_end = slot.end_time, reschedule_count = reschedule_count + 1,
             hold_expires_at = CASE WHEN status = 'awaiting_deposit' THEN now() + make_interval(mins => st.hold_minutes) ELSE hold_expires_at END
       WHERE id = b.id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
    END;
    PERFORM os_enqueue(b.id, 'rescheduled');
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('error', 'bad_action');
END $$;

-- Used by the payment edge function only: what may this token pay right now?
CREATE OR REPLACE FUNCTION os_payment_context(p_token text, p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; inv invoices;
BEGIN
  PERFORM os_expire_holds();
  SELECT * INTO b FROM os_bookings WHERE token = p_token AND invoice_id = p_invoice;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO inv FROM invoices WHERE id = b.invoice_id;
  IF b.status = 'awaiting_deposit' AND b.deposit_status = 'unpaid' AND inv.status <> 'void' THEN
    RETURN jsonb_build_object('kind', 'deposit', 'amount', b.deposit_amount - inv.amount_paid, 'booking_number', b.booking_number)
           ;
  ELSIF b.status = 'completed' AND inv.status <> 'void' AND inv.total_amount - inv.amount_paid > 0 THEN
    RETURN jsonb_build_object('kind', 'balance', 'amount', inv.total_amount - inv.amount_paid, 'booking_number', b.booking_number);
  END IF;
  RETURN NULL;
END $$;

-- ── deposit sync: the invoice gets paid -> the booking confirms ─────────
CREATE OR REPLACE FUNCTION os_invoice_paid_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; st os_settings;
BEGIN
  SELECT * INTO b FROM os_bookings WHERE invoice_id = NEW.id;
  IF NOT FOUND OR b.deposit_status IN ('paid','refund_due','refunded','forfeited') THEN RETURN NEW; END IF;
  IF NEW.amount_paid < b.deposit_amount OR NEW.amount_paid <= 0 THEN RETURN NEW; END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;

  IF b.status = 'awaiting_deposit' THEN
    UPDATE os_bookings SET deposit_status = 'paid', hold_expires_at = NULL,
           status = CASE WHEN st.auto_confirm THEN 'confirmed' ELSE 'requested' END,
           confirmed_at = CASE WHEN st.auto_confirm THEN now() END
     WHERE id = b.id;
    PERFORM os_enqueue(b.id, CASE WHEN st.auto_confirm THEN 'booking_confirmed' ELSE 'deposit_received' END);
  ELSIF b.status = 'expired' THEN
    -- paid after the hold lapsed: honour it if the slot is still free, else refund
    BEGIN
      UPDATE os_bookings SET deposit_status = 'paid', status = 'confirmed', confirmed_at = now(), hold_expires_at = NULL,
             cancelled_at = NULL, cancel_reason = NULL WHERE id = b.id;
      UPDATE invoices SET status = 'sent' WHERE id = NEW.id AND status = 'void';
      PERFORM os_enqueue(b.id, 'booking_confirmed');
    EXCEPTION WHEN unique_violation THEN
      UPDATE os_bookings SET deposit_status = 'refund_due', refund_due_at = now() + make_interval(hours => st.refund_due_hours),
             cancel_reason = 'Deposit arrived after the slot was released' WHERE id = b.id;
      UPDATE invoices SET status = 'void' WHERE id = NEW.id;
      PERFORM os_enqueue(b.id, 'late_payment_refund');
    END;
  ELSIF b.status IN ('cancelled','declined') THEN
    UPDATE os_bookings SET deposit_status = 'refund_due', refund_due_at = now() + make_interval(hours => st.refund_due_hours) WHERE id = b.id;
    UPDATE invoices SET status = 'void' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS os_invoice_paid ON invoices;
CREATE TRIGGER os_invoice_paid AFTER UPDATE OF amount_paid ON invoices
  FOR EACH ROW WHEN (NEW.amount_paid IS DISTINCT FROM OLD.amount_paid) EXECUTE FUNCTION os_invoice_paid_trg();

-- ── status guard: valid moves, timestamps, customer notifications ───────
CREATE OR REPLACE FUNCTION os_booking_status_before() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  ok := CASE OLD.status
    WHEN 'awaiting_deposit' THEN NEW.status IN ('confirmed','requested','cancelled','expired')
    WHEN 'requested'        THEN NEW.status IN ('awaiting_deposit','confirmed','declined','cancelled')
    WHEN 'confirmed'        THEN NEW.status IN ('en_route','arrived','in_progress','cancelled','no_show')
    WHEN 'en_route'         THEN NEW.status IN ('confirmed','arrived','in_progress','cancelled')
    WHEN 'arrived'          THEN NEW.status IN ('en_route','in_progress','cancelled')
    WHEN 'in_progress'      THEN NEW.status IN ('arrived','completed')
    WHEN 'expired'          THEN NEW.status IN ('confirmed')
    ELSE false END;
  IF NOT ok THEN RAISE EXCEPTION 'Invalid booking status change % -> %', OLD.status, NEW.status USING ERRCODE = 'P0001'; END IF;
  IF NEW.status = 'en_route'     THEN NEW.en_route_at  := coalesce(NEW.en_route_at, now()); END IF;
  IF NEW.status = 'arrived'      THEN NEW.arrived_at   := coalesce(NEW.arrived_at, now()); END IF;
  IF NEW.status = 'in_progress'  THEN NEW.started_at   := coalesce(NEW.started_at, now()); END IF;
  IF NEW.status = 'completed'    THEN NEW.completed_at := coalesce(NEW.completed_at, now()); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS os_booking_status_before ON os_bookings;
CREATE TRIGGER os_booking_status_before BEFORE UPDATE ON os_bookings FOR EACH ROW EXECUTE FUNCTION os_booking_status_before();

CREATE OR REPLACE FUNCTION os_booking_status_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'en_route' THEN PERFORM os_enqueue(NEW.id, 'en_route');
  ELSIF NEW.status = 'completed' THEN PERFORM os_enqueue(NEW.id, 'completed');
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN PERFORM os_enqueue(NEW.id, 'booking_confirmed');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS os_booking_status_after ON os_bookings;
CREATE TRIGGER os_booking_status_after AFTER UPDATE OF status ON os_bookings FOR EACH ROW EXECUTE FUNCTION os_booking_status_after();

-- ── staff: approve / decline special requests, cancel, no-show, refund ──
CREATE OR REPLACE FUNCTION os_staff_check(p_booking uuid, p_roles text[]) RETURNS os_bookings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (p_roles)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM os_bookings WHERE id = p_booking;
  IF NOT FOUND OR b.tenant_id <> get_my_tenant() THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002'; END IF;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION os_approve_request(p_booking uuid, p_slot uuid, p_date date, p_total numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    q := os_calc_quote(b.tenant_id, b.vehicle_type, b.vehicle_make, b.vehicle_model, b.package_id, b.grade_id, b.postcode, false);
    tot := (q->>'total')::numeric;
  END IF;
  IF tot IS NULL OR tot <= 0 THEN RETURN jsonb_build_object('error', 'price_required'); END IF;
  BEGIN
    UPDATE os_bookings SET status = 'awaiting_deposit', slot_id = slot.id, slot_label = slot.label, service_date = p_date,
           slot_start = slot.start_time, slot_end = slot.end_time,
           price_total = tot, price_base = tot - price_zone - price_offhours,
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
END $$;

CREATE OR REPLACE FUNCTION os_decline_request(p_booking uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings;
BEGIN
  b := os_staff_check(p_booking, ARRAY['super_admin','ops_manager','foreman','front_desk']);
  IF b.status <> 'requested' THEN RETURN jsonb_build_object('error', 'not_a_pending_request'); END IF;
  IF b.deposit_status = 'paid' THEN
    PERFORM os_do_cancel(b.id, true, 'declined', coalesce(nullif(trim(p_reason), ''), 'Declined'));
  ELSE
    UPDATE os_bookings SET status = 'declined', cancelled_at = now(), cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Declined') WHERE id = b.id;
    PERFORM os_enqueue(b.id, 'request_declined');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Staff cancel (e.g. van breakdown): refund by default; no-show keeps the deposit.
CREATE OR REPLACE FUNCTION os_staff_cancel(p_booking uuid, p_refund boolean DEFAULT true, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings;
BEGIN
  b := os_staff_check(p_booking, ARRAY['super_admin','ops_manager','foreman','front_desk']);
  IF b.status NOT IN ('awaiting_deposit','requested','confirmed','en_route','arrived') THEN RETURN jsonb_build_object('error', 'not_changeable'); END IF;
  PERFORM os_do_cancel(b.id, p_refund, 'cancelled', coalesce(nullif(trim(p_reason), ''), 'Cancelled by staff'));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION os_staff_no_show(p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings;
BEGIN
  b := os_staff_check(p_booking, ARRAY['super_admin','ops_manager','foreman','front_desk','mechanic']);
  IF b.status NOT IN ('confirmed','en_route','arrived') THEN RETURN jsonb_build_object('error', 'not_changeable'); END IF;
  PERFORM os_do_cancel(b.id, false, 'no_show', 'Customer not at the location');
  RETURN jsonb_build_object('ok', true);
END $$;

-- Finance marks a refund as paid. The deposit receipt is voided and the
-- invoice zeroed so revenue and receipts stay correct.
CREATE OR REPLACE FUNCTION os_mark_refunded(p_booking uuid, p_reference text, p_proof_url text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings;
BEGIN
  b := os_staff_check(p_booking, ARRAY['super_admin','ops_manager','finance']);
  IF b.deposit_status <> 'refund_due' THEN RETURN jsonb_build_object('error', 'no_refund_due'); END IF;
  IF coalesce(trim(p_reference), '') = '' THEN RETURN jsonb_build_object('error', 'reference_required'); END IF;
  UPDATE receipts SET voided_at = now(), voided_by = auth.uid(), void_reason = 'ON-SITE deposit refunded (' || b.booking_number || ') ref ' || trim(p_reference)
   WHERE invoice_id = b.invoice_id AND voided_at IS NULL;
  UPDATE invoices SET amount_paid = 0, status = 'void' WHERE id = b.invoice_id;
  UPDATE os_bookings SET deposit_status = 'refunded', refunded_at = now(), refunded_by = auth.uid(),
         refund_reference = trim(p_reference), refund_proof_url = nullif(trim(p_proof_url), '') WHERE id = b.id;
  PERFORM os_enqueue(b.id, 'refunded');
  RETURN jsonb_build_object('ok', true);
END $$;

-- Same-visit referral: a draft quotation in the Hub branch for the customer
-- and vehicle already on file (readable across branches since 151).
CREATE OR REPLACE FUNCTION os_create_hub_quote(p_booking uuid, p_total numeric, p_notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; st os_settings; qn text; qid uuid;
BEGIN
  b := os_staff_check(p_booking, ARRAY['super_admin','ops_manager','foreman','front_desk','mechanic']);
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  IF st.hub_branch_id IS NULL THEN RETURN jsonb_build_object('error', 'no_hub_branch'); END IF;
  IF b.hub_quote_id IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_referred'); END IF;
  qn := generate_quote_number(st.hub_branch_id);
  INSERT INTO quotations (tenant_id, branch_id, quote_number, status, customer_name, customer_phone, customer_email, customer_id,
                          vehicle_plate, vehicle_make, vehicle_model, vehicle_id, total_amount, notes, created_by)
  VALUES (b.tenant_id, st.hub_branch_id, qn, 'draft', b.customer_name, b.customer_phone, b.customer_email, b.customer_id,
          b.vehicle_plate, coalesce(b.vehicle_make, ''), coalesce(b.vehicle_model, ''), b.vehicle_id, coalesce(p_total, 0),
          'Referred from ON-SITE ' || b.booking_number || E'\n' || coalesce(p_notes, ''), auth.uid())
  RETURNING id INTO qid;
  UPDATE os_bookings SET hub_quote_id = qid WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'quote_number', qn, 'quote_id', qid);
END $$;

-- ── housekeeping (cron): expire holds, 24h reminders ────────────────────
CREATE OR REPLACE FUNCTION os_housekeeping() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  PERFORM os_expire_holds();
  FOR r IN
    SELECT b.id FROM os_bookings b
     WHERE b.status = 'confirmed'
       AND os_ts(b.service_date, b.slot_start) BETWEEN now() + interval '12 hours' AND now() + interval '26 hours'
       AND NOT EXISTS (SELECT 1 FROM os_notifications n WHERE n.booking_id = b.id AND n.event = 'reminder')
  LOOP
    PERFORM os_enqueue(r.id, 'reminder');
  END LOOP;
END $$;

-- ── grants ──────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'os_today()','os_ts(date,time)','os_norm_phone(text)','os_norm_plate(text)','os_tenant_by_slug(text)',
    'os_tier_for(uuid,text,text,text)','os_zone_for(uuid,text)','os_enqueue(uuid,text)','os_expire_holds()',
    'os_slot_error(uuid,uuid,date,boolean,os_settings)','os_calc_quote(uuid,text,text,text,uuid,uuid,text,boolean)',
    'os_make_invoice(uuid)','os_do_cancel(uuid,boolean,text,text)','os_payment_context(text,uuid)',
    'os_invoice_paid_trg()','os_booking_status_after()','os_staff_check(uuid,text[])','os_housekeeping()',
    'os_get_public_config(text)','os_quote(text,text,text,text,uuid,uuid,text,boolean)','os_available_slots(text)',
    'os_create_booking(text,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,date,text)',
    'os_get_booking(text)','os_change_booking(text,text,uuid,date,text)',
    'os_approve_request(uuid,uuid,date,numeric)','os_decline_request(uuid,text)','os_staff_cancel(uuid,boolean,text)',
    'os_staff_no_show(uuid)','os_mark_refunded(uuid,text,text)','os_create_hub_quote(uuid,numeric,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'os_get_public_config(text)','os_quote(text,text,text,text,uuid,uuid,text,boolean)','os_available_slots(text)',
    'os_create_booking(text,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,date,text)',
    'os_get_booking(text)','os_change_booking(text,text,uuid,date,text)']
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'os_approve_request(uuid,uuid,date,numeric)','os_decline_request(uuid,text)','os_staff_cancel(uuid,boolean,text)',
    'os_staff_no_show(uuid)','os_mark_refunded(uuid,text,text)','os_create_hub_quote(uuid,numeric,text)']
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION os_payment_context(text,uuid) TO service_role';
END $$;

-- ── cron ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('os-housekeeping') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'os-housekeeping');
SELECT cron.schedule('os-housekeeping', '*/5 * * * *', 'SELECT public.os_housekeeping()');

SELECT cron.unschedule('os-notify') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'os-notify');
SELECT cron.schedule('os-notify', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://lgowhzdwriklgdpfdwot.supabase.co/functions/v1/os-notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'::jsonb);
$$);
