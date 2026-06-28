-- Migration: 060_fix_portal_rpc_columns.sql
-- Fix portal_lookup: use actual jobs column names
-- customer_complaint (not complaint), diagnosis_summary (not diagnosis)

DROP FUNCTION IF EXISTS portal_lookup(TEXT, TEXT);

CREATE OR REPLACE FUNCTION portal_lookup(
  p_plate       TEXT,
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

  SELECT id, full_name, phone
    INTO v_customer
    FROM customers
   WHERE id = v_vehicle.customer_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'customer_not_found');
  END IF;

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
