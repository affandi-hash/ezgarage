-- 075: Stronger customer-portal login — plate + full phone + first 6 digits
-- of IC (3 factors, no OTP), replacing the plate + phone-last-4 check.
--
-- Two correctness issues had to be handled along the way:
-- 1. Full-phone matching breaks on format inconsistency: real data has both
--    local ("0117450198") and international ("+60 11-7450 198") formats for
--    the same number. Stripping non-digits alone isn't enough (601174501 98
--    vs 01174501 98 don't match) — normalize_my_phone() also drops a
--    leading '60' or leading '0' so both forms converge to the same
--    "significant number".
-- 2. ic_number is optional and today only ~29% of real customers have one
--    on file (per live data pulled before writing this). A customer with no
--    IC on file gets a distinct 'ic_not_on_file' error so the frontend can
--    tell them to call in and have staff add it via the Customers page,
--    rather than a generic failure.

CREATE OR REPLACE FUNCTION normalize_my_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d TEXT;
BEGIN
  d := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF left(d, 2) = '60' THEN
    d := substring(d from 3);
  ELSIF left(d, 1) = '0' THEN
    d := substring(d from 2);
  END IF;
  RETURN d;
END;
$$;

-- ── portal_lookup ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS portal_lookup(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION portal_lookup(
  p_plate       TEXT,
  p_phone       TEXT,
  p_ic_first6   TEXT,
  p_tenant_slug TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_vehicle   RECORD;
  v_customer  RECORD;
  v_ic_digits TEXT;
  v_jobs      JSON;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN
    RETURN json_build_object('error', 'tenant_not_found');
  END IF;

  p_plate := upper(regexp_replace(p_plate, '\s+', '', 'g'));

  SELECT id, plate_number, make, model, year, customer_id
    INTO v_vehicle
    FROM vehicles
   WHERE tenant_id = v_tenant_id
     AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = p_plate
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'vehicle_not_found');
  END IF;

  SELECT id, full_name, phone, ic_number
    INTO v_customer
    FROM customers
   WHERE id = v_vehicle.customer_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'customer_not_found');
  END IF;

  IF normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN json_build_object('error', 'phone_mismatch');
  END IF;

  v_ic_digits := regexp_replace(coalesce(v_customer.ic_number, ''), '[^0-9]', '', 'g');
  IF length(v_ic_digits) < 6 THEN
    RETURN json_build_object('error', 'ic_not_on_file');
  END IF;
  IF length(regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g')) <> 6
     OR left(v_ic_digits, 6) <> regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g') THEN
    RETURN json_build_object('error', 'ic_mismatch');
  END IF;

  SELECT json_agg(row_to_json(j) ORDER BY j.created_at DESC)
    INTO v_jobs
    FROM (
      SELECT
        jo.id,
        jo.job_number,
        jo.service_type,
        jo.status,
        jo.customer_complaint   AS complaint,
        jo.diagnosis_summary    AS diagnosis,
        jo.next_action,
        jo.checked_in_at,
        jo.estimated_cost,
        jo.final_amount,
        jo.estimate_approved_at,
        jo.estimate_approved_by,
        jo.created_at,
        inv.id            AS invoice_id,
        inv.invoice_number,
        inv.subtotal      AS inv_subtotal,
        inv.tax_amount    AS inv_tax,
        inv.total_amount  AS inv_total,
        inv.amount_paid   AS inv_paid,
        inv.status        AS inv_status,
        inv.line_items    AS inv_lines
      FROM jobs jo
      LEFT JOIN invoices inv ON inv.job_id = jo.id
      WHERE jo.vehicle_id = v_vehicle.id
        AND jo.tenant_id = v_tenant_id
      ORDER BY jo.created_at DESC
      LIMIT 10
    ) j;

  RETURN json_build_object(
    'vehicle', json_build_object(
      'id',           v_vehicle.id,
      'plate_number', v_vehicle.plate_number,
      'make',         v_vehicle.make,
      'model',        v_vehicle.model,
      'year',         v_vehicle.year
    ),
    'customer', json_build_object(
      'full_name', v_customer.full_name,
      'phone',     v_customer.phone
    ),
    'jobs', coalesce(v_jobs, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION portal_lookup(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── portal_approve_estimate ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS portal_approve_estimate(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION portal_approve_estimate(
  p_job_id      UUID,
  p_plate       TEXT,
  p_phone       TEXT,
  p_ic_first6   TEXT,
  p_tenant_slug TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_job       RECORD;
  v_vehicle   RECORD;
  v_customer  RECORD;
  v_ic_digits TEXT;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN
    RETURN json_build_object('error', 'tenant_not_found');
  END IF;

  SELECT id, vehicle_id, status, estimated_cost, estimate_approved_at
    INTO v_job
    FROM jobs
   WHERE id = p_job_id
     AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'job_not_found');
  END IF;

  IF v_job.estimate_approved_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_approved');
  END IF;

  p_plate := upper(regexp_replace(p_plate, '\s+', '', 'g'));

  SELECT id, plate_number, customer_id
    INTO v_vehicle
    FROM vehicles
   WHERE id = v_job.vehicle_id
     AND tenant_id = v_tenant_id
     AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = p_plate;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'vehicle_mismatch');
  END IF;

  SELECT id, phone, ic_number
    INTO v_customer
    FROM customers
   WHERE id = v_vehicle.customer_id;

  IF NOT FOUND OR normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN json_build_object('error', 'phone_mismatch');
  END IF;

  v_ic_digits := regexp_replace(coalesce(v_customer.ic_number, ''), '[^0-9]', '', 'g');
  IF length(v_ic_digits) < 6 THEN
    RETURN json_build_object('error', 'ic_not_on_file');
  END IF;
  IF length(regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g')) <> 6
     OR left(v_ic_digits, 6) <> regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g') THEN
    RETURN json_build_object('error', 'ic_mismatch');
  END IF;

  UPDATE jobs
     SET estimate_approved_at = now(),
         estimate_approved_by = 'Customer (Portal)'
   WHERE id = p_job_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION portal_approve_estimate(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
