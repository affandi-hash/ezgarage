-- 182: a confirmed booking opens an empty draft invoice, and it carries over to the job card.
--
-- Why: an invoice that exists from the first moment the car is known cannot be quietly skipped. A cancelled booking
-- voids its empty draft, so every invoice number is accounted for (sold, or voided with a reason).
--
-- Rules
--   * When a booking becomes confirmed or arrived (or is saved that way), one draft invoice is opened for it
--     (customer, phone, plate and car filled in, amount RM0, due in 30 days). Never a second one for the same booking.
--   * A draft is not a bill yet: it stays out of Accounts Receivable, sales and the Google Sheet until it is issued.
--   * When the booking becomes a job card, the job and the draft are linked (either order).
--   * A cancelled or no-show booking voids its draft if it is still empty (no items, no payments, no job).
--     A draft that already has items or payments is left alone and noted in the audit log.
--   * Bookings that belong to the ON-SITE or BB Care Day flows are skipped (they open their own invoices).
--   * Companies with the stricter rules switched off (MAC) are skipped.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_live_per_booking ON invoices (booking_id) WHERE booking_id IS NOT NULL AND status <> 'void';

CREATE OR REPLACE FUNCTION open_draft_invoice_for_booking(b bookings) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv_id uuid; j jobs%ROWTYPE; opener text; cemail text;
BEGIN
  SELECT id INTO inv_id FROM invoices WHERE booking_id = b.id AND status <> 'void' LIMIT 1;
  IF inv_id IS NOT NULL THEN RETURN inv_id; END IF;
  SELECT full_name INTO opener FROM users WHERE id = coalesce(b.confirmed_by, b.created_by);
  SELECT email INTO cemail FROM customers WHERE id = b.customer_id;
  INSERT INTO invoices (tenant_id, branch_id, booking_id, customer_id, customer_name, customer_phone, customer_email, vehicle_plate, vehicle_info,
                        issue_date, due_date, status, line_items, subtotal, total_amount, amount_paid, notes, created_by, opened_by, is_internal_fleet)
  VALUES (b.tenant_id, b.branch_id, b.id, b.customer_id, coalesce(nullif(trim(b.customer_name), ''), 'Customer'), b.customer_phone, coalesce(b.customer_email, cemail),
          b.vehicle_plate, nullif(trim(coalesce(b.vehicle_brand, '') || ' ' || coalesce(b.vehicle_model, '')), ''),
          current_date, current_date + 30, 'draft', '[]'::jsonb, 0, 0, 0, 'Opened automatically from booking ' || coalesce(b.booking_number, ''),
          coalesce(b.confirmed_by, b.created_by), coalesce(opener, 'Booking'), coalesce((SELECT is_internal_fleet FROM vehicles WHERE id = b.vehicle_id), false))
  RETURNING id INTO inv_id;
  SELECT * INTO j FROM jobs WHERE booking_id = b.id LIMIT 1;
  IF FOUND THEN
    UPDATE invoices SET job_id = j.id WHERE id = inv_id;
    UPDATE jobs SET invoice_id = inv_id WHERE id = j.id AND invoice_id IS NULL;
  END IF;
  RETURN inv_id;
END $$;
REVOKE ALL ON FUNCTION open_draft_invoice_for_booking(bookings) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION bookings_draft_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv invoices%ROWTYPE;
BEGIN
  IF NOT controls_on(NEW.tenant_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM os_bookings o WHERE o.hub_booking_id = NEW.id) THEN RETURN NEW; END IF;

  IF NEW.status IN ('confirmed', 'arrived') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM open_draft_invoice_for_booking(NEW);
  ELSIF NEW.status IN ('cancelled', 'no_show') AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT * INTO inv FROM invoices WHERE booking_id = NEW.id AND status = 'draft' ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      IF inv.total_amount = 0 AND inv.amount_paid = 0 AND jsonb_array_length(coalesce(inv.line_items, '[]'::jsonb)) = 0 AND inv.job_id IS NULL THEN
        UPDATE invoices SET status = 'void', updated_at = now(),
               notes = coalesce(notes || E'\n', '') || 'Voided automatically: booking ' || NEW.status || coalesce(' (' || NEW.cancelled_reason || ')', '')
         WHERE id = inv.id;
        PERFORM insert_audit_log('void', 'invoices', inv.id, 'invoice',
          jsonb_build_object('invoice_number', inv.invoice_number, 'reason', 'booking ' || NEW.status, 'booking', NEW.booking_number, 'automatic', true), inv.branch_id, auth.uid(), inv.tenant_id);
      ELSE
        PERFORM insert_audit_log('booking_cancelled_invoice_kept', 'invoices', inv.id, 'invoice',
          jsonb_build_object('invoice_number', inv.invoice_number, 'booking', NEW.booking_number, 'status', NEW.status), inv.branch_id, auth.uid(), inv.tenant_id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_draft_invoice ON bookings;
CREATE TRIGGER bookings_draft_invoice AFTER INSERT OR UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_draft_invoice();

-- a job card created from a booking picks up the booking's draft
CREATE OR REPLACE FUNCTION jobs_link_booking_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv_id uuid;
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    SELECT id INTO inv_id FROM invoices WHERE booking_id = NEW.booking_id AND status <> 'void' AND job_id IS NULL ORDER BY created_at LIMIT 1;
    IF inv_id IS NOT NULL THEN
      UPDATE invoices SET job_id = NEW.id WHERE id = inv_id;
      UPDATE jobs SET invoice_id = inv_id WHERE id = NEW.id AND invoice_id IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_link_booking_invoice ON jobs;
CREATE TRIGGER jobs_link_booking_invoice AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_link_booking_invoice();
