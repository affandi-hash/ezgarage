-- 098: The customer portal's plate + phone + first-6-IC-digits check gates
-- the lookup and estimate-approval RPCs, but the payment-creation and
-- proof-of-payment-upload paths only ever required a bare invoice_id / job_id
-- -- fine while record IDs stay unguessable, but not defense in depth.
-- portal_verify_invoice_access() mirrors portal_lookup()'s exact matching
-- logic (same normalize_my_phone(), same IC-digit comparison) so both of
-- those actions can require the same 3-factor check before proceeding.

CREATE OR REPLACE FUNCTION public.portal_verify_invoice_access(
  p_invoice_id uuid,
  p_plate text,
  p_phone text,
  p_ic_first6 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle  RECORD;
  v_customer RECORD;
  v_ic_digits TEXT;
  v_plate TEXT := upper(regexp_replace(p_plate, '\s+', '', 'g'));
BEGIN
  SELECT v.id, v.plate_number, v.customer_id
    INTO v_vehicle
    FROM invoices inv
    JOIN jobs jo ON jo.id = inv.job_id
    JOIN vehicles v ON v.id = jo.vehicle_id
   WHERE inv.id = p_invoice_id
   LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;
  IF upper(regexp_replace(v_vehicle.plate_number, '\s+', '', 'g')) <> v_plate THEN RETURN false; END IF;

  SELECT id, phone, ic_number INTO v_customer FROM customers WHERE id = v_vehicle.customer_id LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  IF normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN false;
  END IF;

  v_ic_digits := regexp_replace(coalesce(v_customer.ic_number, ''), '[^0-9]', '', 'g');
  IF length(v_ic_digits) < 6 THEN RETURN false; END IF;
  IF length(regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g')) <> 6
     OR left(v_ic_digits, 6) <> regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;
