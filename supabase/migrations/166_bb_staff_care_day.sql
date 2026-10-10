-- 166: BB Staff Car Care Day (pickup and return) inside the ON-SITE module.
--
-- BrainyBunch staff book on the same public page. We collect the car at BB HQ, service it
-- at the Hub workshop, wash it and return it the same day. A staff ID (BB + 4 digits) is
-- required, there is no deposit (payment at return) and at most N cars are taken per day.
--
-- A booking is an os_bookings row (service_mode 'bb_pickup', branch = the Hub) so the status
-- page, notifications, cancellation and the staff list all work as they do for the van.
-- It also creates a Hub `bookings` row (source 'bb_staff', arrival_mode 'pick_up') so the
-- workshop sees the car in its normal Bookings list and turns it into a job card. No invoice
-- is made at booking: the bill comes from the job card, as for any workshop job.

-- ── settings, packages, prices, bookings ────────────────────────────────
ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS bb_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS bb_capacity_per_day int NOT NULL DEFAULT 8 CHECK (bb_capacity_per_day >= 1);
ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS bb_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}';
ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS bb_hq_address text;
ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS bb_pickup_note text NOT NULL DEFAULT 'We collect your car from BB HQ in the morning and return it before the end of the day.';

ALTER TABLE os_packages ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'public';
ALTER TABLE os_packages DROP CONSTRAINT IF EXISTS os_packages_audience_check;
ALTER TABLE os_packages ADD CONSTRAINT os_packages_audience_check CHECK (audience IN ('public', 'bb_staff'));

ALTER TABLE os_prices DROP CONSTRAINT IF EXISTS os_prices_tier_check;
ALTER TABLE os_prices ADD CONSTRAINT os_prices_tier_check CHECK (tier IN ('tier1', 'tier2', 'bb'));

ALTER TABLE os_bookings ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'van';
ALTER TABLE os_bookings DROP CONSTRAINT IF EXISTS os_bookings_service_mode_check;
ALTER TABLE os_bookings ADD CONSTRAINT os_bookings_service_mode_check CHECK (service_mode IN ('van', 'bb_pickup'));
ALTER TABLE os_bookings ADD COLUMN IF NOT EXISTS staff_id text;
ALTER TABLE os_bookings ADD COLUMN IF NOT EXISTS hub_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS os_bookings_bb_day ON os_bookings (tenant_id, service_date) WHERE service_mode = 'bb_pickup';

-- ── date rules shared by create and reschedule ──────────────────────────
CREATE OR REPLACE FUNCTION os_bb_date_error(p_tenant uuid, p_date date, p_exclude uuid, st os_settings) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_date IS NULL THEN RETURN 'date_required'; END IF;
  IF st.hub_branch_id IS NOT NULL AND EXISTS (SELECT 1 FROM os_blackouts WHERE branch_id = st.hub_branch_id AND blackout_date = p_date) THEN RETURN 'date_blocked'; END IF;
  IF NOT (extract(isodow FROM p_date)::smallint = ANY (st.bb_days)) THEN RETURN 'day_not_served'; END IF;
  IF p_date < os_today() OR p_date > os_today() + st.booking_window_days THEN RETURN 'outside_window'; END IF;
  IF os_ts(p_date, time '08:00') - make_interval(hours => st.booking_cutoff_hours) <= now() THEN RETURN 'too_soon'; END IF;
  IF (SELECT count(*) FROM os_bookings b WHERE b.tenant_id = p_tenant AND b.service_mode = 'bb_pickup' AND b.service_date = p_date
         AND b.status IN ('confirmed','en_route','arrived','in_progress','completed') AND b.id IS DISTINCT FROM p_exclude) >= st.bb_capacity_per_day THEN
    RETURN 'day_full';
  END IF;
  RETURN NULL;
END $$;

-- ── public config: van packages stay as they were, plus a BB block ───────
CREATE OR REPLACE FUNCTION os_get_public_config(p_tenant_slug text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
        'offhours_enabled', st.offhours_enabled, 'offhours_surcharge', st.offhours_surcharge),
    'packages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'duration_min', p.duration_min,
        'grades', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.sort_order, g.name)
                              FROM os_oil_grades g WHERE g.package_id = p.id AND g.is_active), '[]'::jsonb),
        'tiers', coalesce((SELECT jsonb_agg(DISTINCT pr.tier) FROM os_prices pr WHERE pr.package_id = p.id AND pr.tier IN ('tier1','tier2') AND pr.effective_from <= os_today()), '[]'::jsonb)
      ) ORDER BY p.sort_order, p.name)
      FROM os_packages p WHERE p.tenant_id = t AND p.is_active AND p.audience = 'public'), '[]'::jsonb),
    'zones', coalesce((SELECT jsonb_agg(jsonb_build_object('name', z.name, 'surcharge', z.surcharge) ORDER BY z.sort_order)
                         FROM os_zones z WHERE z.tenant_id = t AND z.is_active), '[]'::jsonb),
    'makes', coalesce((SELECT jsonb_agg(jsonb_build_object('type', r.vehicle_type, 'make', r.make, 'model', r.model, 'tier', r.tier) ORDER BY r.make)
                         FROM os_vehicle_rules r WHERE r.tenant_id = t), '[]'::jsonb),
    'bb', CASE WHEN st.bb_enabled AND st.hub_branch_id IS NOT NULL AND jsonb_array_length(bbp) > 0
               THEN jsonb_build_object('packages', bbp, 'capacity_per_day', st.bb_capacity_per_day, 'hq_address', st.bb_hq_address,
                                       'pickup_note', st.bb_pickup_note, 'window_days', st.booking_window_days)
               ELSE NULL END
  );
END $$;

-- ── public: days a BB booking can be made on ────────────────────────────
CREATE OR REPLACE FUNCTION os_bb_available_days(p_tenant_slug text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := os_tenant_by_slug(p_tenant_slug); st os_settings; out jsonb;
BEGIN
  IF t IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = t;
  IF NOT FOUND OR NOT st.bb_enabled OR st.hub_branch_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.day,
           'left', greatest(0, st.bb_capacity_per_day - (SELECT count(*) FROM os_bookings b WHERE b.tenant_id = t AND b.service_mode = 'bb_pickup'
                      AND b.service_date = d.day AND b.status IN ('confirmed','en_route','arrived','in_progress','completed'))),
           'available', os_bb_date_error(t, d.day, NULL, st) IS NULL) ORDER BY d.day), '[]'::jsonb)
    INTO out
    FROM (SELECT os_today() + i AS day FROM generate_series(0, st.booking_window_days) AS i) d
   WHERE extract(isodow FROM d.day)::smallint = ANY (st.bb_days)
     AND NOT EXISTS (SELECT 1 FROM os_blackouts bo WHERE bo.branch_id = st.hub_branch_id AND bo.blackout_date = d.day);
  RETURN out;
END $$;

-- ── public: create a BB booking ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION os_create_bb_booking(
  p_tenant_slug text, p_name text, p_phone text, p_email text, p_staff_id text,
  p_make text, p_model text, p_plate text, p_package uuid, p_date date, p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := os_tenant_by_slug(p_tenant_slug); st os_settings; pkg os_packages; price numeric; err text;
  sid text := upper(regexp_replace(coalesce(p_staff_id, ''), '\s', '', 'g'));
  plate text := os_norm_plate(p_plate); cust uuid; veh uuid; b os_bookings; hb uuid; open_n int; addr text;
BEGIN
  IF t IS NULL THEN RETURN jsonb_build_object('error', 'tenant_not_found'); END IF;
  SELECT * INTO st FROM os_settings WHERE tenant_id = t;
  IF NOT FOUND OR NOT st.bb_enabled OR st.hub_branch_id IS NULL THEN RETURN jsonb_build_object('error', 'not_configured'); END IF;
  IF sid !~ '^BB[0-9]{4}$' THEN RETURN jsonb_build_object('error', 'invalid_staff_id'); END IF;
  IF coalesce(trim(p_name), '') = '' OR plate = '' OR length(os_norm_phone(p_phone)) NOT BETWEEN 8 AND 12 THEN
    RETURN jsonb_build_object('error', 'invalid_details');
  END IF;
  IF coalesce(trim(p_email), '') <> '' AND p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('error', 'invalid_email');
  END IF;

  SELECT * INTO pkg FROM os_packages WHERE id = p_package AND tenant_id = t AND is_active AND audience = 'bb_staff';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'package_unavailable'); END IF;
  SELECT pr.price INTO price FROM os_prices pr WHERE pr.package_id = pkg.id AND pr.tier = 'bb' AND pr.effective_from <= os_today()
   ORDER BY pr.effective_from DESC LIMIT 1;
  IF price IS NULL THEN RETURN jsonb_build_object('error', 'package_unavailable'); END IF;

  -- one booking at a time per day: the capacity count and the insert must not race
  PERFORM pg_advisory_xact_lock(hashtextextended('os_bb:' || t::text || ':' || coalesce(p_date::text, ''), 0));
  err := os_bb_date_error(t, p_date, NULL, st);
  IF err IS NOT NULL THEN RETURN jsonb_build_object('error', err); END IF;

  SELECT count(*) INTO open_n FROM os_bookings
   WHERE tenant_id = t AND service_mode = 'bb_pickup' AND status = 'confirmed'
     AND (os_norm_phone(customer_phone) = os_norm_phone(p_phone) OR staff_id = sid);
  IF open_n >= 3 THEN RETURN jsonb_build_object('error', 'too_many_open'); END IF;

  addr := coalesce(nullif(trim(st.bb_hq_address), ''), 'BB HQ');
  SELECT id INTO cust FROM customers WHERE tenant_id = t AND os_norm_phone(phone) = os_norm_phone(p_phone) ORDER BY created_at LIMIT 1;
  IF cust IS NULL THEN
    INSERT INTO customers (tenant_id, branch_id, full_name, phone, email, full_address, notes)
    VALUES (t, st.hub_branch_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''), addr, 'BB staff ' || sid || ' (Car Care Day)')
    RETURNING id INTO cust;
  END IF;
  SELECT id INTO veh FROM vehicles WHERE tenant_id = t AND os_norm_plate(plate_number) = plate ORDER BY created_at LIMIT 1;
  IF veh IS NULL THEN
    INSERT INTO vehicles (tenant_id, branch_id, customer_id, plate_number, vehicle_type, make, model)
    VALUES (t, st.hub_branch_id, cust, plate, 'car', nullif(trim(p_make), ''), nullif(trim(p_model), ''))
    RETURNING id INTO veh;
  END IF;

  INSERT INTO os_bookings (
    tenant_id, branch_id, status, request_type, service_mode, staff_id, customer_id, vehicle_id,
    customer_name, customer_phone, customer_email, vehicle_type, vehicle_make, vehicle_model, vehicle_plate,
    package_id, package_name, address, access_notes, service_date,
    price_base, price_zone, price_offhours, price_total, deposit_amount, deposit_status, confirmed_at)
  VALUES (
    t, st.hub_branch_id, 'confirmed', 'standard', 'bb_pickup', sid, cust, veh,
    trim(p_name), trim(p_phone), nullif(trim(p_email), ''), 'car', nullif(trim(p_make), ''), nullif(trim(p_model), ''), plate,
    pkg.id, pkg.name, addr, nullif(trim(p_notes), ''), p_date,
    price, 0, 0, price, 0, 'none', now())
  RETURNING * INTO b;

  -- the workshop sees it in its normal Bookings list
  INSERT INTO bookings (tenant_id, branch_id, customer_id, vehicle_id, customer_name, customer_phone, customer_email, vehicle_plate,
                        vehicle_type, vehicle_brand, vehicle_model, booking_date, booking_time, service_type, source, arrival_mode,
                        status, problem_description, address, notes, confirmed_at)
  VALUES (t, st.hub_branch_id, cust, veh, trim(p_name), trim(p_phone), nullif(trim(p_email), ''), plate,
          'car', nullif(trim(p_make), ''), nullif(trim(p_model), ''), p_date, time '08:00', 'service', 'bb_staff', 'pick_up',
          'confirmed', 'BB Staff Car Care Day: ' || pkg.name || ' (BB price RM ' || price || '). Collect from ' || addr || ' and return before end of day.',
          addr, 'Staff ID ' || sid || ' | ' || b.booking_number || coalesce(' | ' || nullif(trim(p_notes), ''), ''), now())
  RETURNING id INTO hb;
  UPDATE os_bookings SET hub_booking_id = hb WHERE id = b.id;

  PERFORM os_enqueue(b.id, 'bb_booked');
  RETURN jsonb_build_object('token', b.token, 'booking_number', b.booking_number, 'status', b.status, 'total', b.price_total);
END $$;

-- ── status page data: adds the mode, staff id and pickup note ───────────
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
              THEN extract(epoch FROM (os_ts(b.service_date, b.slot_start) - now())) / 3600.0
              WHEN b.service_date IS NOT NULL AND b.service_mode = 'bb_pickup'
              THEN extract(epoch FROM (os_ts(b.service_date, time '08:00') - now())) / 3600.0 END;
  open_status := b.status IN ('awaiting_deposit','requested','confirmed');
  RETURN jsonb_build_object(
    'booking_number', b.booking_number, 'status', b.status, 'request_type', b.request_type,
    'service_mode', b.service_mode, 'staff_id', b.staff_id,
    'pickup_note', CASE WHEN b.service_mode = 'bb_pickup' THEN st.bb_pickup_note END,
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

-- ── cancel: also cancels the workshop's booking row ─────────────────────
CREATE OR REPLACE FUNCTION os_do_cancel(p_booking uuid, p_refund boolean, p_status text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; st os_settings; inv invoices;
BEGIN
  SELECT * INTO b FROM os_bookings WHERE id = p_booking;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  IF b.invoice_id IS NOT NULL THEN SELECT * INTO inv FROM invoices WHERE id = b.invoice_id; END IF;

  UPDATE os_bookings SET status = p_status, cancelled_at = now(), cancel_reason = p_reason WHERE id = b.id;

  IF coalesce(inv.amount_paid, 0) > 0 AND b.deposit_status = 'paid' THEN
    IF p_refund THEN
      UPDATE invoices SET status = 'void' WHERE id = inv.id;
      UPDATE os_bookings SET deposit_status = 'refund_due', refund_due_at = now() + make_interval(hours => st.refund_due_hours) WHERE id = b.id;
    ELSE
      -- deposit kept: it becomes the invoice, so revenue is the deposit only
      -- the kept deposit is revenue from today, so the invoice is dated today
      UPDATE invoices SET status = 'paid', issue_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date, subtotal = amount_paid, total_amount = amount_paid,
             line_items = jsonb_build_array(jsonb_build_object('item_type', 'custom', 'description',
               'Booking deposit retained (' || b.booking_number || ')', 'qty', 1, 'uom', 'job',
               'unit_price', amount_paid, 'amount', amount_paid)) WHERE id = inv.id;
      UPDATE os_bookings SET deposit_status = 'forfeited' WHERE id = b.id;
    END IF;
  ELSIF inv.id IS NOT NULL THEN
    UPDATE invoices SET status = 'void' WHERE id = inv.id;
    UPDATE os_bookings SET deposit_status = 'none' WHERE id = b.id;
  END IF;

  IF b.hub_booking_id IS NOT NULL THEN
    UPDATE bookings SET status = CASE WHEN p_status = 'no_show' THEN 'no_show' ELSE 'cancelled' END, cancelled_reason = p_reason
     WHERE id = b.hub_booking_id AND status NOT IN ('completed', 'cancelled', 'no_show');
  END IF;

  PERFORM os_enqueue(b.id, CASE WHEN p_status = 'no_show' THEN 'no_show'
                                WHEN b.deposit_status = 'paid' AND p_refund THEN 'cancelled_refund_due'
                                WHEN b.deposit_status = 'paid' THEN 'cancelled_forfeited'
                                ELSE 'cancelled' END);
END $$;

-- ── customer change: BB bookings reschedule by date only ────────────────
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

-- ── status changes: keep the workshop's booking row in step ─────────────
CREATE OR REPLACE FUNCTION os_booking_status_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.service_mode = 'bb_pickup' AND NEW.hub_booking_id IS NOT NULL THEN
    UPDATE bookings SET status = CASE WHEN NEW.status IN ('arrived','in_progress') THEN 'arrived'
                                      WHEN NEW.status = 'completed' THEN 'completed' ELSE status END
     WHERE id = NEW.hub_booking_id AND status NOT IN ('cancelled','no_show','completed');
  END IF;
  IF NEW.status = 'en_route' THEN PERFORM os_enqueue(NEW.id, 'en_route');
  ELSIF NEW.status = 'completed' THEN
    -- the job is delivered: the invoice becomes real, dated the day of completion
    IF NEW.invoice_id IS NOT NULL THEN
      UPDATE invoices SET status = CASE WHEN amount_paid >= total_amount THEN 'paid'::invoice_status ELSE 'sent'::invoice_status END,
             issue_date = (coalesce(NEW.completed_at, now()) AT TIME ZONE 'Asia/Kuala_Lumpur')::date
       WHERE id = NEW.invoice_id AND status = 'draft';
    END IF;
    PERFORM os_enqueue(NEW.id, 'completed');
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN PERFORM os_enqueue(NEW.id, 'booking_confirmed');
  END IF;
  RETURN NEW;
END $$;

-- ── grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION os_bb_date_error(uuid, date, uuid, os_settings) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION os_bb_available_days(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION os_create_bb_booking(text, text, text, text, text, text, text, text, uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION os_bb_available_days(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION os_create_bb_booking(text, text, text, text, text, text, text, text, uuid, date, text) TO anon, authenticated;
