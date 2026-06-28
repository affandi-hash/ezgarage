-- Migration: 059_portal_phone_lookup.sql
-- Change portal_lookup to verify by phone last 4 (always collected)
-- IC was optional so portal lookup always failed for customers without IC

DROP FUNCTION IF EXISTS portal_lookup(TEXT, TEXT);

CREATE OR REPLACE FUNCTION portal_lookup(
  p_plate      TEXT,
  p_phone_last4 TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle  RECORD;
  v_customer RECORD;
  v_jobs     JSON;
BEGIN
  p_plate := upper(regexp_replace(p_plate, '\s+', '', 'g'));

  SELECT id, plate_number, make, model, year, customer_id
    INTO v_vehicle
    FROM vehicles
   WHERE upper(regexp_replace(plate_number, '\s+', '', 'g')) = p_plate
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

  -- Verify last 4 digits of phone (strip all non-digits then take last 4)
  IF right(regexp_replace(coalesce(v_customer.phone, ''), '[^0-9]', '', 'g'), 4) <> p_phone_last4 THEN
    RETURN json_build_object('error', 'phone_mismatch');
  END IF;

  SELECT json_agg(row_to_json(j) ORDER BY j.created_at DESC)
    INTO v_jobs
    FROM (
      SELECT
        jo.id,
        jo.job_number,
        jo.service_type,
        jo.status,
        jo.complaint,
        jo.diagnosis,
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

GRANT EXECUTE ON FUNCTION portal_lookup(TEXT, TEXT) TO anon, authenticated;


-- Also update portal_approve_estimate to verify by phone last 4

DROP FUNCTION IF EXISTS portal_approve_estimate(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION portal_approve_estimate(
  p_job_id      UUID,
  p_plate       TEXT,
  p_phone_last4 TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job      RECORD;
  v_vehicle  RECORD;
  v_customer RECORD;
BEGIN
  SELECT id, vehicle_id, status, estimated_cost, estimate_approved_at
    INTO v_job
    FROM jobs
   WHERE id = p_job_id;

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
     AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = p_plate;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'vehicle_mismatch');
  END IF;

  SELECT id, phone
    INTO v_customer
    FROM customers
   WHERE id = v_vehicle.customer_id;

  IF NOT FOUND OR right(regexp_replace(coalesce(v_customer.phone, ''), '[^0-9]', '', 'g'), 4) <> p_phone_last4 THEN
    RETURN json_build_object('error', 'phone_mismatch');
  END IF;

  UPDATE jobs
     SET estimate_approved_at = now(),
         estimate_approved_by = 'Customer (Portal)'
   WHERE id = p_job_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION portal_approve_estimate(UUID, TEXT, TEXT) TO anon, authenticated;
