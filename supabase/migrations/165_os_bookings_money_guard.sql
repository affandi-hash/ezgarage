-- 165: staff cannot rewrite a booking's money or identity columns directly.
--
-- RLS lets mechanics, foremen and front desk UPDATE os_bookings (status moves, photos,
-- notes, technician, rescheduling). It did not limit which columns: a mechanic could
-- set price_total, deposit_status or invoice_id straight from the API and leave the
-- invoice out of step. Money moves only through the booking functions (SECURITY DEFINER,
-- they run as the table owner) and through ops_manager / super_admin.
CREATE OR REPLACE FUNCTION os_bookings_money_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- only direct client updates (PostgREST runs as authenticated); functions, the service role and SQL are not limited
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF get_my_role() = ANY (ARRAY['super_admin','ops_manager']) THEN RETURN NEW; END IF;
  IF (NEW.price_base, NEW.price_zone, NEW.price_offhours, NEW.price_total, NEW.deposit_amount, NEW.deposit_status,
      NEW.invoice_id, NEW.token, NEW.tenant_id, NEW.booking_number, NEW.refund_due_at, NEW.refunded_at, NEW.refunded_by,
      NEW.refund_reference, NEW.refund_proof_url, NEW.hold_expires_at)
     IS DISTINCT FROM
     (OLD.price_base, OLD.price_zone, OLD.price_offhours, OLD.price_total, OLD.deposit_amount, OLD.deposit_status,
      OLD.invoice_id, OLD.token, OLD.tenant_id, OLD.booking_number, OLD.refund_due_at, OLD.refunded_at, OLD.refunded_by,
      OLD.refund_reference, OLD.refund_proof_url, OLD.hold_expires_at) THEN
    RAISE EXCEPTION 'Prices, deposits and refunds on a booking can only be changed by an operations manager' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS os_bookings_money_guard ON os_bookings;
CREATE TRIGGER os_bookings_money_guard BEFORE UPDATE ON os_bookings
  FOR EACH ROW EXECUTE FUNCTION os_bookings_money_guard();
