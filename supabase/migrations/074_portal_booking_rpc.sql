-- 074: Replace the direct anon `bookings` INSERT with an RPC
--
-- Found while testing: PostgREST's `Prefer: return=representation` (needed
-- so the frontend can show the customer their booking reference number)
-- requires the inserted row to also pass the table's SELECT policy under
-- RLS — anon has none on `bookings`, so every insert failed with the same
-- "row violates row-level security policy" error even when the INSERT's own
-- WITH CHECK passed. Opening a SELECT policy instead would let anyone list
-- every tenant's bookings. Routing through a SECURITY DEFINER RPC sidesteps
-- this entirely and matches the pattern already used by portal_lookup etc.

DROP POLICY IF EXISTS bookings_anon_insert ON bookings;

CREATE OR REPLACE FUNCTION create_portal_booking(
  p_branch_id           UUID,
  p_customer_name       TEXT,
  p_customer_phone      TEXT,
  p_customer_email      TEXT,
  p_vehicle_plate       TEXT,
  p_service_type        TEXT,
  p_booking_date        DATE,
  p_booking_time        TIME,
  p_problem_description TEXT,
  p_tenant_slug         TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_booking   RECORD;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN
    RETURN json_build_object('error', 'tenant_not_found');
  END IF;

  IF NOT branch_belongs_to_active_tenant(p_branch_id, v_tenant_id) THEN
    RETURN json_build_object('error', 'branch_not_found');
  END IF;

  INSERT INTO bookings (
    tenant_id, branch_id, customer_name, customer_phone, customer_email,
    vehicle_plate, service_type, booking_date, booking_time,
    arrival_mode, status, problem_description, source
  ) VALUES (
    v_tenant_id, p_branch_id, p_customer_name, p_customer_phone, p_customer_email,
    upper(regexp_replace(p_vehicle_plate, '\s+', '', 'g')), p_service_type, p_booking_date, p_booking_time,
    'drop_off', 'pending', p_problem_description, 'online'
  )
  RETURNING id, booking_number INTO v_booking;

  RETURN json_build_object('id', v_booking.id, 'booking_number', v_booking.booking_number);
END;
$$;

GRANT EXECUTE ON FUNCTION create_portal_booking(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT) TO anon, authenticated;
