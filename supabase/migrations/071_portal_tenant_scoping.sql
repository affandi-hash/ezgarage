-- 071: Scope public customer-portal RPCs by tenant (multi-branch SaaS readiness)
--
-- get_portal_config, portal_lookup, and portal_approve_estimate previously
-- ignored tenant/branch entirely: portal_lookup matched a plate number
-- against *every* tenant's vehicles, and get_portal_config always returned
-- whichever tenant was created first. Harmless with a single tenant, but a
-- real cross-tenant data leak once a second garage business signs up.
--
-- All three now take an optional p_tenant_slug. Passing no slug falls back
-- to the previous "first active tenant" behaviour, so existing bookmarked
-- /portal links keep working; new tenant-scoped links pass their slug.

CREATE OR REPLACE FUNCTION resolve_portal_tenant(p_tenant_slug TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM tenants
   WHERE is_active = true
     AND (
       (p_tenant_slug IS NOT NULL AND slug = p_tenant_slug)
       OR (p_tenant_slug IS NULL)
     )
   ORDER BY created_at ASC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION resolve_portal_tenant(TEXT) TO anon, authenticated;

-- ── get_portal_config ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_portal_config();

CREATE OR REPLACE FUNCTION get_portal_config(p_tenant_slug TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT json_build_object(
    'id',                 t.id,
    'name',               t.name,
    'slug',               t.slug,
    'logo_url',           t.logo_url,
    'phone',              t.phone,
    'whatsapp_number',    t.whatsapp_number,
    'google_review_link', t.google_review_link,
    'sst_rate',           t.sst_rate
  )
  FROM tenants t
  WHERE t.id = resolve_portal_tenant(p_tenant_slug);
$$;

GRANT EXECUTE ON FUNCTION get_portal_config(TEXT) TO anon, authenticated;

-- ── portal_lookup ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS portal_lookup(TEXT, TEXT);

CREATE OR REPLACE FUNCTION portal_lookup(
  p_plate       TEXT,
  p_phone_last4 TEXT,
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

GRANT EXECUTE ON FUNCTION portal_lookup(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── portal_approve_estimate ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS portal_approve_estimate(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION portal_approve_estimate(
  p_job_id      UUID,
  p_plate       TEXT,
  p_phone_last4 TEXT,
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

GRANT EXECUTE ON FUNCTION portal_approve_estimate(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
