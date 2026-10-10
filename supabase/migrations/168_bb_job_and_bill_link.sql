-- 168: BB Staff Car Care Day, round two (found while testing the customer journey end to end).
--
--  * The workshop job card now moves the customer's booking along: checked in = collected,
--    work under way = in service, delivered / closed = returned. Staff no longer have to press
--    the same step twice, and the customer's page tells the truth.
--  * The workshop invoice for the job is linked to the booking, so the customer's private link
--    shows the bill and lets them pay it, one payment at a time when the bill is on a plan.
--  * The package price is carried onto the job card as its estimate.
--  * A WhatsApp contact can be shown on the public pages.
--  * The van's "invoice is held until the job is done" rules no longer touch BB invoices.

ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS contact_whatsapp text;
UPDATE os_settings SET contact_whatsapp = '01175931383' WHERE contact_whatsapp IS NULL;   -- the number printed on the BB flyer

-- ── van-only rules ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION os_invoice_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM os_bookings b WHERE b.invoice_id = NEW.id AND b.service_mode = 'van'
             AND b.status IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress')) THEN
    NEW.status := 'draft';
  END IF;
  RETURN NEW;
END $$;

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
    -- the van job is delivered: its invoice becomes real, dated the day of completion
    IF NEW.invoice_id IS NOT NULL AND NEW.service_mode = 'van' THEN
      UPDATE invoices SET status = CASE WHEN amount_paid >= total_amount THEN 'paid'::invoice_status ELSE 'sent'::invoice_status END,
             issue_date = (coalesce(NEW.completed_at, now()) AT TIME ZONE 'Asia/Kuala_Lumpur')::date
       WHERE id = NEW.invoice_id AND status = 'draft';
    END IF;
    PERFORM os_enqueue(NEW.id, 'completed');
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN PERFORM os_enqueue(NEW.id, 'booking_confirmed');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION os_do_cancel(p_booking uuid, p_refund boolean, p_status text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; st os_settings; inv invoices;
BEGIN
  SELECT * INTO b FROM os_bookings WHERE id = p_booking;
  SELECT * INTO st FROM os_settings WHERE tenant_id = b.tenant_id;
  IF b.invoice_id IS NOT NULL AND b.service_mode = 'van' THEN SELECT * INTO inv FROM invoices WHERE id = b.invoice_id; END IF;

  UPDATE os_bookings SET status = p_status, cancelled_at = now(), cancel_reason = p_reason WHERE id = b.id;

  IF coalesce(inv.amount_paid, 0) > 0 AND b.deposit_status = 'paid' THEN
    IF p_refund THEN
      UPDATE invoices SET status = 'void' WHERE id = inv.id;
      UPDATE os_bookings SET deposit_status = 'refund_due', refund_due_at = now() + make_interval(hours => st.refund_due_hours) WHERE id = b.id;
    ELSE
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

-- ── the workshop job drives the customer's booking ──────────────────────
CREATE OR REPLACE FUNCTION os_sync_bb_from_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ob os_bookings; target text;
BEGIN
  IF NEW.booking_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO ob FROM os_bookings WHERE hub_booking_id = NEW.booking_id AND service_mode = 'bb_pickup';
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND ob.price_total IS NOT NULL AND coalesce(NEW.estimated_cost, 0) = 0 THEN
    UPDATE jobs SET estimated_cost = ob.price_total WHERE id = NEW.id;
  END IF;

  target := CASE
    WHEN NEW.status = 'checked_in' THEN 'arrived'
    WHEN NEW.status IN ('diagnosing', 'waiting_approval', 'waiting_parts', 'in_progress', 'ready', 'long_due') THEN 'in_progress'
    WHEN NEW.status IN ('delivered', 'closed') THEN 'completed'
    ELSE NULL END;
  IF target IS NULL OR ob.status NOT IN ('confirmed', 'en_route', 'arrived', 'in_progress') THEN RETURN NEW; END IF;

  IF target = 'arrived' AND ob.status IN ('confirmed', 'en_route') THEN
    UPDATE os_bookings SET status = 'arrived' WHERE id = ob.id;
  ELSIF target = 'in_progress' AND ob.status IN ('confirmed', 'en_route', 'arrived') THEN
    UPDATE os_bookings SET status = 'in_progress' WHERE id = ob.id;
  ELSIF target = 'completed' THEN
    IF ob.status <> 'in_progress' THEN UPDATE os_bookings SET status = 'in_progress' WHERE id = ob.id; END IF;
    UPDATE os_bookings SET status = 'completed' WHERE id = ob.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS os_sync_bb_from_job ON jobs;
CREATE TRIGGER os_sync_bb_from_job AFTER INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW WHEN (NEW.booking_id IS NOT NULL) EXECUTE FUNCTION os_sync_bb_from_job();

-- ── the job's invoice becomes the booking's bill ────────────────────────
CREATE OR REPLACE FUNCTION os_link_bb_invoice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.job_id IS NULL OR NEW.status = 'void' THEN RETURN NEW; END IF;
  UPDATE os_bookings ob SET invoice_id = NEW.id
    FROM jobs j
   WHERE j.id = NEW.job_id AND j.booking_id IS NOT NULL AND ob.hub_booking_id = j.booking_id
     AND ob.service_mode = 'bb_pickup' AND ob.invoice_id IS DISTINCT FROM NEW.id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS os_link_bb_invoice ON invoices;
CREATE TRIGGER os_link_bb_invoice AFTER INSERT OR UPDATE OF job_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION os_link_bb_invoice();

-- ── paying the bill from the private link ───────────────────────────────
CREATE OR REPLACE FUNCTION os_payment_context(p_token text, p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; inv invoices; nxt jsonb;
BEGIN
  PERFORM os_expire_holds();
  SELECT * INTO b FROM os_bookings WHERE token = p_token AND invoice_id = p_invoice;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO inv FROM invoices WHERE id = b.invoice_id;
  IF b.service_mode = 'bb_pickup' THEN
    -- the workshop invoice: payable once issued; one instalment at a time when it is on a plan
    IF inv.status NOT IN ('sent', 'overdue') OR inv.total_amount - inv.amount_paid <= 0 THEN RETURN NULL; END IF;
    nxt := invoice_plan_next(inv.id);
    RETURN jsonb_build_object('kind', 'balance', 'booking_number', b.booking_number,
                              'amount', coalesce((nxt->>'pay_now')::numeric, inv.total_amount - inv.amount_paid));
  END IF;
  IF b.status = 'awaiting_deposit' AND b.deposit_status = 'unpaid' AND inv.status <> 'void' THEN
    RETURN jsonb_build_object('kind', 'deposit', 'amount', b.deposit_amount - inv.amount_paid, 'booking_number', b.booking_number);
  ELSIF b.status = 'completed' AND inv.status <> 'void' AND inv.total_amount - inv.amount_paid > 0 THEN
    RETURN jsonb_build_object('kind', 'balance', 'amount', inv.total_amount - inv.amount_paid, 'booking_number', b.booking_number);
  END IF;
  RETURN NULL;
END $$;

-- ── status page data: contact number, and the bill for BB bookings ──────
CREATE OR REPLACE FUNCTION os_get_booking(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  );
END $$;

-- public config also carries the contact number
CREATE OR REPLACE FUNCTION os_public_contact(p_tenant_slug text DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT contact_whatsapp FROM os_settings WHERE tenant_id = os_tenant_by_slug(p_tenant_slug)
$$;
REVOKE ALL ON FUNCTION os_public_contact(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION os_public_contact(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION os_sync_bb_from_job(), os_link_bb_invoice() FROM PUBLIC, anon, authenticated;
