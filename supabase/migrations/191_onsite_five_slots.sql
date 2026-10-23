-- 191: five ON-SITE slots a day; long jobs take two back-to-back slots, and the night slot can stretch to 11pm.
--   * os_slots.extend_to: a later finish a slot can stretch to for a long job (night slot 8-10pm stretches to 11pm)
--   * os_bookings.slot_id2: the second slot of a two-slot booking; both slots are held, so nobody else can take either
--   * a job up to (slot length - travel buffer) fits one slot; a longer job takes two back-to-back slots or the stretched night slot
--   * travel buffer 50 min, so a 2-hour slot fits a job of up to 70 min, two slots up to 190 min, the stretched night slot up to 130 min

ALTER TABLE os_slots ADD COLUMN IF NOT EXISTS extend_to time;
ALTER TABLE os_slots DROP CONSTRAINT IF EXISTS os_slots_extend_after_end;
ALTER TABLE os_slots ADD CONSTRAINT os_slots_extend_after_end CHECK (extend_to IS NULL OR extend_to > end_time);
ALTER TABLE os_bookings ADD COLUMN IF NOT EXISTS slot_id2 uuid REFERENCES os_slots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS os_bookings_slot2 ON os_bookings (branch_id, service_date, slot_id2) WHERE slot_id2 IS NOT NULL;

-- the second slot of a booking must not be held by anyone else, and the first slot must not be someone else's second slot
CREATE OR REPLACE FUNCTION os_booking_slot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slot_id IS NULL OR NEW.service_date IS NULL
     OR NEW.status NOT IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress','completed') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('os_slot:' || NEW.branch_id::text || ':' || NEW.service_date::text, 0));
  IF EXISTS (
    SELECT 1 FROM os_bookings o
     WHERE o.id <> NEW.id AND o.branch_id = NEW.branch_id AND o.service_date = NEW.service_date
       AND o.status IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress','completed')
       AND (o.slot_id = NEW.slot_id OR o.slot_id2 = NEW.slot_id
            OR (NEW.slot_id2 IS NOT NULL AND (o.slot_id = NEW.slot_id2 OR o.slot_id2 = NEW.slot_id2)))
  ) THEN
    RAISE EXCEPTION 'slot_taken' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS os_bookings_slot_guard ON os_bookings;
CREATE TRIGGER os_bookings_slot_guard BEFORE INSERT OR UPDATE OF slot_id, slot_id2, service_date, status ON os_bookings
  FOR EACH ROW EXECUTE FUNCTION os_booking_slot_guard();

CREATE OR REPLACE FUNCTION os_time_label(p_t time) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_t, 'FMHH12') || CASE WHEN extract(minute FROM p_t) <> 0 THEN ':' || to_char(p_t, 'MI') ELSE '' END || lower(to_char(p_t, 'AM'))
$$;

-- longest single slot, and longest span (two back-to-back slots or a stretched slot), in minutes, before the travel buffer
CREATE OR REPLACE FUNCTION os_single_max(p_branch uuid) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce(max(extract(epoch FROM (s.end_time - s.start_time)) / 60), 0)::int FROM os_slots s WHERE s.branch_id = p_branch AND s.is_open
$$;
CREATE OR REPLACE FUNCTION os_span_max(p_branch uuid) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce(max(m), 0)::int FROM (
    SELECT extract(epoch FROM (s.end_time - s.start_time)) / 60 AS m FROM os_slots s WHERE s.branch_id = p_branch AND s.is_open
    UNION ALL
    SELECT extract(epoch FROM (s.extend_to - s.start_time)) / 60 FROM os_slots s WHERE s.branch_id = p_branch AND s.is_open AND s.extend_to IS NOT NULL
    UNION ALL
    SELECT extract(epoch FROM (n.end_time - s.start_time)) / 60 FROM os_slots s
      JOIN os_slots n ON n.branch_id = s.branch_id AND n.start_time = s.end_time AND n.is_open
     WHERE s.branch_id = p_branch AND s.is_open
  ) x
$$;

-- the time a booking would cover. p_est NULL skips the fit checks (staff choose the time themselves).
CREATE OR REPLACE FUNCTION os_slot_window(p_slot uuid, p_slot2 uuid, p_extend boolean, p_est int, p_buffer int) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE s os_slots; n os_slots; e time;
BEGIN
  SELECT * INTO s FROM os_slots WHERE id = p_slot;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'slot_not_found'); END IF;
  e := s.end_time;
  IF p_slot2 IS NOT NULL AND coalesce(p_extend, false) THEN RETURN jsonb_build_object('error', 'slot_span_invalid'); END IF;
  IF p_slot2 IS NOT NULL THEN
    SELECT * INTO n FROM os_slots WHERE id = p_slot2 AND branch_id = s.branch_id;
    IF NOT FOUND OR n.start_time <> s.end_time THEN RETURN jsonb_build_object('error', 'slot_span_invalid'); END IF;
    e := n.end_time;
  ELSIF coalesce(p_extend, false) THEN
    IF s.extend_to IS NULL THEN RETURN jsonb_build_object('error', 'slot_span_invalid'); END IF;
    e := s.extend_to;
  END IF;
  IF p_est IS NOT NULL THEN
    IF e <> s.end_time AND p_est <= extract(epoch FROM (s.end_time - s.start_time)) / 60 - p_buffer THEN
      RETURN jsonb_build_object('error', 'span_not_needed');
    END IF;
    IF p_est > extract(epoch FROM (e - s.start_time)) / 60 - p_buffer THEN RETURN jsonb_build_object('error', 'too_long'); END IF;
  END IF;
  RETURN jsonb_build_object('start', s.start_time, 'end', e,
    'label', CASE WHEN e = s.end_time THEN s.label ELSE os_time_label(s.start_time) || ' - ' || os_time_label(e) END);
END $$;

-- a slot is taken when it is anyone's first or second slot that day
CREATE OR REPLACE FUNCTION os_slot_booked(p_branch uuid, p_date date, p_slot uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM os_bookings b WHERE b.branch_id = p_branch AND b.service_date = p_date AND (b.slot_id = p_slot OR b.slot_id2 = p_slot)
                  AND b.status IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress','completed'))
$$;

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
           jsonb_agg(jsonb_build_object(
             'slot_id', s.id, 'label', s.label, 'start', s.start_time, 'end', s.end_time,
             'available', (os_slot_error(st.default_branch_id, s.id, g.day, false, st) IS NULL AND NOT os_slot_booked(s.branch_id, g.day, s.id)),
             -- stretched finish for a long job (night slot)
             'single_max', (extract(epoch FROM (s.end_time - s.start_time)) / 60)::int - st.travel_buffer_min,
             'extend_max', CASE WHEN s.extend_to IS NOT NULL THEN (extract(epoch FROM (s.extend_to - s.start_time)) / 60)::int - st.travel_buffer_min END,
             'pair_max', CASE WHEN nx.id IS NOT NULL THEN (extract(epoch FROM (nx.end_time - s.start_time)) / 60)::int - st.travel_buffer_min END,
             'extend_end', s.extend_to, 'extend_label', CASE WHEN s.extend_to IS NOT NULL THEN os_time_label(s.start_time) || ' - ' || os_time_label(s.extend_to) END,
             -- the slot that starts exactly when this one ends, for a two-slot booking
             'next_id', nx.id, 'next_label', CASE WHEN nx.id IS NOT NULL THEN os_time_label(s.start_time) || ' - ' || os_time_label(nx.end_time) END,
             'next_available', (nx.id IS NOT NULL AND os_slot_error(st.default_branch_id, nx.id, g.day, false, st) IS NULL AND NOT os_slot_booked(s.branch_id, g.day, nx.id))
           ) ORDER BY s.sort_order, s.start_time) AS slots
      FROM (SELECT os_today() + i AS day FROM generate_series(0, st.booking_window_days) AS i) g
      JOIN os_slots s ON s.branch_id = st.default_branch_id AND s.is_open
       AND extract(isodow FROM g.day)::smallint = ANY (s.days)
      LEFT JOIN os_slots nx ON nx.branch_id = s.branch_id AND nx.is_open AND nx.start_time = s.end_time
       AND extract(isodow FROM g.day)::smallint = ANY (nx.days)
     WHERE NOT EXISTS (SELECT 1 FROM os_blackouts bo WHERE bo.branch_id = s.branch_id AND bo.blackout_date = g.day)
     GROUP BY g.day
  ) d;
  RETURN out;
END $$;


-- the new signatures replace the old ones
DROP FUNCTION IF EXISTS os_create_booking(text, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, date, text, uuid[]);
DROP FUNCTION IF EXISTS os_approve_request(uuid, uuid, date, numeric);
DROP FUNCTION IF EXISTS os_change_booking(text, text, uuid, date, text);

CREATE OR REPLACE FUNCTION public.os_create_booking(p_tenant_slug text, p_name text, p_phone text, p_email text, p_type text, p_make text, p_model text, p_plate text, p_package uuid, p_grade uuid, p_address text, p_postcode text, p_access_notes text, p_slot uuid, p_date date, p_special_reason text DEFAULT NULL::text, p_addons uuid[] DEFAULT '{}'::uuid[], p_slot2 uuid DEFAULT NULL::uuid, p_extend boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t uuid := os_tenant_by_slug(p_tenant_slug); st os_settings; q jsonb; special boolean := coalesce(trim(p_special_reason), '') <> '';
  slot os_slots; pkg os_packages; grd os_oil_grades; z os_zones; err text;
  cust uuid; veh uuid; b os_bookings; plate text := os_norm_plate(p_plate); inv uuid;
  active_holds int; req_status text; win jsonb;
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
    IF p_slot2 IS NOT NULL THEN
      err := os_slot_error(st.default_branch_id, p_slot2, p_date, false, st);
      IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    END IF;
    SELECT * INTO slot FROM os_slots WHERE id = p_slot;
    -- one slot, two back-to-back slots, or a night slot stretched to its later finish; the job plus the travel buffer must fit
    win := os_slot_window(p_slot, p_slot2, p_extend, (q->>'est_duration_min')::int, st.travel_buffer_min);
    IF win->>'error' IS NOT NULL THEN RETURN jsonb_build_object('error', win->>'error', 'est_duration_min', (q->>'est_duration_min')::int); END IF;
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
      slot_id, slot_id2, slot_label, service_date, slot_start, slot_end,
      price_base, price_zone, price_offhours, price_total, deposit_amount, hold_expires_at, addons, price_addons, est_duration_min)
    VALUES (
      t, st.default_branch_id, req_status, CASE WHEN special THEN 'special' ELSE 'standard' END, nullif(trim(p_special_reason), ''),
      cust, veh, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
      coalesce(nullif(p_type, ''), 'car'), nullif(trim(p_make), ''), nullif(trim(p_model), ''), plate,
      q->>'tier', pkg.id, pkg.name, grd.id, grd.name,
      trim(p_address), regexp_replace(coalesce(p_postcode, ''), '\D', '', 'g'), z.id, z.name, nullif(trim(p_access_notes), ''),
      CASE WHEN special THEN NULL ELSE slot.id END, CASE WHEN special THEN NULL ELSE p_slot2 END, CASE WHEN special THEN NULL ELSE win->>'label' END,
      p_date, CASE WHEN special THEN NULL ELSE (win->>'start')::time END, CASE WHEN special THEN NULL ELSE (win->>'end')::time END,
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

CREATE OR REPLACE FUNCTION public.os_approve_request(p_booking uuid, p_slot uuid, p_date date, p_total numeric DEFAULT NULL::numeric, p_slot2 uuid DEFAULT NULL::uuid, p_extend boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b os_bookings; st os_settings; slot os_slots; win jsonb; err text; q jsonb; tot numeric; inv uuid;
BEGIN
  b := os_staff_check(p_booking, ARRAY['super_admin','ops_manager','foreman','front_desk']);
  IF b.status <> 'requested' OR b.deposit_status <> 'unpaid' THEN RETURN jsonb_build_object('error', 'not_a_pending_request'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  err := os_slot_error(b.branch_id, p_slot, p_date, true, st);
  IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
  IF p_slot2 IS NOT NULL THEN
    err := os_slot_error(b.branch_id, p_slot2, p_date, true, st);
    IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
  END IF;
  SELECT * INTO slot FROM os_slots WHERE id = p_slot;
  win := os_slot_window(p_slot, p_slot2, p_extend, NULL, st.travel_buffer_min);   -- staff choose the time, so no fit check
  IF win->>'error' IS NOT NULL THEN RETURN jsonb_build_object('error', win->>'error'); END IF;
  tot := p_total;
  IF tot IS NULL THEN
    q := os_calc_quote_ex(b.tenant_id, b.vehicle_type, b.vehicle_make, b.vehicle_model, b.package_id, b.grade_id, b.postcode, false,
                          coalesce((SELECT array_agg((a->>'id')::uuid) FROM jsonb_array_elements(b.addons) a), '{}'));
    tot := (q->>'total')::numeric;
  END IF;
  IF tot IS NULL OR tot <= 0 THEN RETURN jsonb_build_object('error', 'price_required'); END IF;
  BEGIN
    UPDATE os_bookings SET status = 'awaiting_deposit', slot_id = slot.id, slot_id2 = p_slot2, slot_label = win->>'label', service_date = p_date,
           slot_start = (win->>'start')::time, slot_end = (win->>'end')::time,
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

CREATE OR REPLACE FUNCTION public.os_change_booking(p_token text, p_action text, p_slot uuid DEFAULT NULL::uuid, p_date date DEFAULT NULL::date, p_reason text DEFAULT NULL::text, p_slot2 uuid DEFAULT NULL::uuid, p_extend boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b os_bookings; st os_settings; hrs numeric; err text; slot os_slots; win jsonb; early boolean;
BEGIN
  PERFORM os_expire_holds();
  SELECT * INTO b FROM os_bookings WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF b.status NOT IN ('awaiting_deposit','requested','confirmed') THEN RETURN jsonb_build_object('error', 'not_changeable'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  hrs := CASE WHEN b.service_date IS NOT NULL AND b.slot_start IS NOT NULL
              THEN extract(epoch FROM (os_ts(b.service_date, b.slot_start) - now())) / 3600.0
              WHEN b.service_date IS NOT NULL AND b.service_mode = 'bb_pickup'
              THEN extract(epoch FROM (os_ts(b.service_date, time '08:00') - now())) / 3600.0 END;
  early := hrs IS NULL OR hrs >= st.cancel_cutoff_hours;

  IF p_action = 'cancel' THEN
    PERFORM os_do_cancel(b.id, early, 'cancelled', coalesce(nullif(trim(p_reason), ''), 'Cancelled by customer'));
    RETURN jsonb_build_object('ok', true, 'refund', early AND b.deposit_status = 'paid');
  ELSIF p_action = 'reschedule' THEN
    IF b.status = 'requested' THEN RETURN jsonb_build_object('error', 'not_changeable'); END IF;
    IF NOT early THEN RETURN jsonb_build_object('error', 'too_late'); END IF;
    IF b.reschedule_count >= st.max_reschedules THEN RETURN jsonb_build_object('error', 'max_reschedules'); END IF;

    IF b.service_mode = 'bb_pickup' THEN
      IF p_date IS NULL THEN RETURN jsonb_build_object('error', 'date_required'); END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('os_bb:' || b.tenant_id::text || ':' || p_date::text, 0));
      err := os_bb_date_error(b.tenant_id, p_date, b.id, st);
      IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
      UPDATE os_bookings SET service_date = p_date, reschedule_count = reschedule_count + 1 WHERE id = b.id;
      IF b.hub_booking_id IS NOT NULL THEN UPDATE bookings SET booking_date = p_date WHERE id = b.hub_booking_id; END IF;
      PERFORM os_enqueue(b.id, 'rescheduled');
      RETURN jsonb_build_object('ok', true);
    END IF;

    IF p_slot IS NULL OR p_date IS NULL THEN RETURN jsonb_build_object('error', 'slot_required'); END IF;
    err := os_slot_error(b.branch_id, p_slot, p_date, false, st);
    IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    IF p_slot2 IS NOT NULL THEN
      err := os_slot_error(b.branch_id, p_slot2, p_date, false, st);
      IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;
    END IF;
    SELECT * INTO slot FROM os_slots WHERE id = p_slot;
    win := os_slot_window(p_slot, p_slot2, p_extend, b.est_duration_min, st.travel_buffer_min);
    IF win->>'error' IS NOT NULL THEN RETURN jsonb_build_object('error', win->>'error', 'est_duration_min', b.est_duration_min); END IF;
    BEGIN
      UPDATE os_bookings SET slot_id = slot.id, slot_id2 = p_slot2, slot_label = win->>'label', service_date = p_date,
             slot_start = (win->>'start')::time, slot_end = (win->>'end')::time, reschedule_count = reschedule_count + 1,
             hold_expires_at = CASE WHEN status = 'awaiting_deposit' THEN now() + make_interval(mins => st.hold_minutes) ELSE hold_expires_at END
       WHERE id = b.id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
    END;
    PERFORM os_enqueue(b.id, 'rescheduled');
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('error', 'bad_action');
END $function$;

CREATE OR REPLACE FUNCTION public.os_get_public_config(p_tenant_slug text DEFAULT NULL::text)
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
        'max_job_min', os_span_max(st.default_branch_id) - st.travel_buffer_min, 'single_job_min', os_single_max(st.default_branch_id) - st.travel_buffer_min, 'travel_buffer_min', st.travel_buffer_min),
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

CREATE OR REPLACE FUNCTION public.os_calc_quote_ex(p_tenant uuid, p_type text, p_make text, p_model text, p_package uuid, p_grade uuid, p_postcode text, p_offhours boolean, p_addons uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'max_job_min', os_span_max(st.default_branch_id) - st.travel_buffer_min, 'single_job_min', os_single_max(st.default_branch_id) - st.travel_buffer_min,
    'estimate', coalesce(pkg.price_from, false) OR est_flag OR coalesce(pkg.price_note, '') <> '',
    'package_from', coalesce(pkg.price_from, false),
    'total', tot, 'deposit', CASE WHEN tot IS NULL THEN NULL ELSE round(tot * st.deposit_pct / 100.0, 2) END);
END $function$;

REVOKE ALL ON FUNCTION os_create_booking(text, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, date, text, uuid[], uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION os_create_booking(text, text, text, text, text, text, text, text, uuid, uuid, text, text, text, uuid, date, text, uuid[], uuid, boolean) TO anon, authenticated;
REVOKE ALL ON FUNCTION os_change_booking(text, text, uuid, date, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION os_change_booking(text, text, uuid, date, text, uuid, boolean) TO anon, authenticated;
REVOKE ALL ON FUNCTION os_approve_request(uuid, uuid, date, numeric, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION os_approve_request(uuid, uuid, date, numeric, uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION os_available_slots(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION os_available_slots(text) TO anon, authenticated;

-- Motoverse: five slots a day (the 4 existing ones open, plus the night slot), travel buffer 50 min
UPDATE os_slots SET is_open = true WHERE branch_id = 'c683e98b-6f0e-4df5-85b5-ff9ba1e30531';
INSERT INTO os_slots (tenant_id, branch_id, label, start_time, end_time, extend_to, is_open, days, sort_order)
SELECT 'c20ef6dc-4f38-4291-bb15-a4eb86c17520', 'c683e98b-6f0e-4df5-85b5-ff9ba1e30531', '8pm - 10pm', '20:00', '22:00', '23:00', true, '{1,2,3,4,5,6}', 5
 WHERE NOT EXISTS (SELECT 1 FROM os_slots WHERE branch_id = 'c683e98b-6f0e-4df5-85b5-ff9ba1e30531' AND start_time = '20:00');
UPDATE os_settings SET travel_buffer_min = 50 WHERE tenant_id = 'c20ef6dc-4f38-4291-bb15-a4eb86c17520';
