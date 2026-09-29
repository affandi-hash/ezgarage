-- Fixes two more instances of the same non-atomic insert-then-separately-
-- update-a-related-record shape already fixed for stock receiving in
-- migration 147, found in the same code audit:
--
-- 1. QuotationsPage.tsx's convertToBooking() inserted a `bookings` row,
--    then a SEPARATE `update quotations set converted_to_booking_id = ...`
--    call. Nothing guarded against calling it twice concurrently, and if
--    the second call failed after the first succeeded, the quote kept
--    showing "Convert to Booking" (gated only by converted_to_booking_id
--    being null) with no way to detect the orphaned booking on refetch --
--    a retry would create a second, duplicate booking from the same
--    quote. The booking was also written with `arrival_mode: 'drop_off'`
--    and `service_type: 'Workshop Service'`, neither a real value in
--    either column's vocabulary (arrival_mode's own real values include
--    'drive_in'/'booked'/'walk_in' etc; service_type is
--    service/repair/inspection/body_work/tyre/other) -- so any booking
--    created this way rendered with unstyled, uncategorized badges.
--
-- 2. BookingsPage.tsx's ConvertToJobModal did the equivalent for jobs:
--    insert into jobs, then a separate `update bookings set status =
--    'arrived'`. A duplicate-job click was already prevented by checking
--    jobs.booking_id on refetch, but a failure between the two writes
--    still left a booking's status stuck showing as not-yet-arrived even
--    though a job already existed for it.
--
-- Both conversions now happen in one atomic Postgres function, with an
-- explicit already-converted guard so a duplicate click/retry can't ever
-- create a second booking or job for the same source record.

CREATE OR REPLACE FUNCTION public.convert_quotation_to_booking(p_quotation_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant uuid;
  v_quote RECORD;
  v_booking_id uuid;
  v_booking_number text;
BEGIN
  v_tenant := get_my_tenant();
  IF v_tenant IS NULL THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT id, tenant_id, branch_id, quote_number, status, converted_to_booking_id,
         customer_name, customer_phone, customer_email, vehicle_plate
    INTO v_quote
    FROM quotations
   WHERE id = p_quotation_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;
  IF v_quote.converted_to_booking_id IS NOT NULL THEN
    RETURN json_build_object('error', 'already_converted', 'booking_id', v_quote.converted_to_booking_id);
  END IF;

  INSERT INTO bookings (
    tenant_id, branch_id, customer_name, customer_phone, customer_email,
    vehicle_plate, service_type, booking_date, booking_time,
    arrival_mode, status, source, notes
  ) VALUES (
    v_quote.tenant_id, v_quote.branch_id, v_quote.customer_name, v_quote.customer_phone, v_quote.customer_email,
    v_quote.vehicle_plate, 'other', current_date, '09:00:00',
    'drive_in', 'confirmed', 'other', 'Converted from quotation ' || v_quote.quote_number
  )
  RETURNING id, booking_number INTO v_booking_id, v_booking_number;

  UPDATE quotations SET converted_to_booking_id = v_booking_id, updated_at = now() WHERE id = p_quotation_id;

  RETURN json_build_object('success', true, 'booking_id', v_booking_id, 'booking_number', v_booking_number);
END;
$function$;

CREATE OR REPLACE FUNCTION public.convert_booking_to_job(
  p_booking_id uuid,
  p_customer_id uuid,
  p_vehicle_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant uuid;
  v_booking RECORD;
  v_job_id uuid;
  v_existing_job_id uuid;
BEGIN
  v_tenant := get_my_tenant();
  IF v_tenant IS NULL THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT id, tenant_id, branch_id, service_type, arrival_mode, source, problem_description
    INTO v_booking
    FROM bookings
   WHERE id = p_booking_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT id INTO v_existing_job_id FROM jobs WHERE booking_id = p_booking_id LIMIT 1;
  IF v_existing_job_id IS NOT NULL THEN
    RETURN json_build_object('error', 'already_converted', 'job_id', v_existing_job_id);
  END IF;

  INSERT INTO jobs (
    branch_id, tenant_id, customer_id, vehicle_id, service_type, arrival_mode,
    status, vehicle_type, source, customer_complaint, checked_in_at, payment_status, booking_id
  ) VALUES (
    v_booking.branch_id, v_booking.tenant_id, p_customer_id, p_vehicle_id,
    COALESCE(v_booking.service_type, 'service'), COALESCE(v_booking.arrival_mode, 'booked'),
    'checked_in', 'car', COALESCE(v_booking.source, 'website'), v_booking.problem_description,
    now(), 'unpaid', p_booking_id
  )
  RETURNING id INTO v_job_id;

  UPDATE bookings SET status = 'arrived', updated_at = now() WHERE id = p_booking_id;

  RETURN json_build_object('success', true, 'job_id', v_job_id);
END;
$function$;
