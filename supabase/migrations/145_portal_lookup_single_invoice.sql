-- 145: portal_lookup() joined invoices the wrong direction -- `inv.job_id =
-- jo.id` matches EVERY invoice ever created against a job, not just its
-- current one. A job with more than one invoice (a corrected reissue, or in
-- this case repeated live payment-gateway testing) produced one row per
-- invoice, and the frontend rendered each as its own card -- so "Pay
-- Online" could show a stale or superseded invoice's balance while "Final
-- Amount" (jobs.final_amount, synced from the job's real current invoice)
-- showed something else entirely on the very same job.
--
-- Join on jo.invoice_id instead -- the same FK final_amount is already kept
-- in sync with (see InvoicesPage.tsx's createInvoice/saveInvoice) -- so
-- there is always at most one invoice per job, and it's always the right
-- one.

DROP FUNCTION IF EXISTS portal_lookup(TEXT, TEXT, TEXT, TEXT);

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
        inv.line_items    AS inv_lines,
        EXISTS(
          SELECT 1 FROM job_photos jp
           WHERE jp.job_id = jo.id AND jp.visible_to_customer = true
        ) AS has_photos
      FROM jobs jo
      LEFT JOIN invoices inv ON inv.id = jo.invoice_id
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
