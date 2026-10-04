-- 158: ON-SITE revenue is recognised when the job is done, not when it is booked.
--
-- A van booking's invoice used to be 'sent' at booking time, so a job booked
-- for next week already counted as sales and as a receivable. Now the invoice
-- stays 'draft' (which every sales, receivable and P&L query already ignores)
-- until the booking is completed. Deposits paid in the meantime sit on the
-- draft. A kept (forfeited) deposit becomes revenue on the day it is kept.

CREATE OR REPLACE FUNCTION os_invoice_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM os_bookings b WHERE b.invoice_id = NEW.id
             AND b.status IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress')) THEN
    NEW.status := 'draft';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION os_invoice_hold() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS os_invoice_hold ON invoices;
CREATE TRIGGER os_invoice_hold BEFORE UPDATE ON invoices
  FOR EACH ROW WHEN (NEW.status IN ('sent','paid','overdue')) EXECUTE FUNCTION os_invoice_hold();

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
          b.vehicle_plate, trim(coalesce(b.vehicle_make, '') || ' ' || coalesce(b.vehicle_model, '')), 'draft',
          items, b.price_total, b.price_total, 'ON-SITE booking ' || b.booking_number)
  RETURNING id INTO inv;
  RETURN inv;
END $$;

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

  PERFORM os_enqueue(b.id, CASE WHEN p_status = 'no_show' THEN 'no_show'
                                WHEN b.deposit_status = 'paid' AND p_refund THEN 'cancelled_refund_due'
                                WHEN b.deposit_status = 'paid' THEN 'cancelled_forfeited'
                                ELSE 'cancelled' END);
END $$;

CREATE OR REPLACE FUNCTION os_booking_status_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
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
      UPDATE invoices SET status = 'draft' WHERE id = NEW.id AND status = 'void';
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

-- bookings already open when this ran
UPDATE invoices i SET status = 'draft'
  FROM os_bookings b
 WHERE b.invoice_id = i.id AND i.status IN ('sent','overdue')
   AND b.status IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress');
