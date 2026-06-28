-- ============================================================
-- Migration: 057_customer_portal_rpc.sql
-- Description: SECURITY DEFINER RPCs for customer portal
--              (bypasses RLS so anon users can look up their own jobs)
-- Created: 2026-06-28
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. portal_lookup — plate + IC last 4 → jobs + invoice data
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portal_lookup(
  p_plate    TEXT,
  p_ic_last4 TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle   RECORD;
  v_customer  RECORD;
  v_jobs      JSON;
  v_vehicle_id uuid;
BEGIN
  -- Normalise plate (strip spaces, uppercase)
  p_plate := upper(regexp_replace(p_plate, '\s+', '', 'g'));

  -- Find vehicle
  SELECT id, plate_number, make, model, year, customer_id
    INTO v_vehicle
    FROM vehicles
   WHERE upper(regexp_replace(plate_number, '\s+', '', 'g')) = p_plate
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'vehicle_not_found');
  END IF;

  -- Verify customer IC
  SELECT id, full_name, ic_number, phone
    INTO v_customer
    FROM customers
   WHERE id = v_vehicle.customer_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'customer_not_found');
  END IF;

  -- Check last 4 digits of IC (strip hyphens before comparing)
  IF right(regexp_replace(coalesce(v_customer.ic_number, ''), '[^0-9]', '', 'g'), 4) <> p_ic_last4 THEN
    RETURN json_build_object('error', 'ic_mismatch');
  END IF;

  -- Fetch jobs with invoice info
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
        -- Invoice summary
        inv.id          AS invoice_id,
        inv.invoice_number,
        inv.subtotal    AS inv_subtotal,
        inv.tax_amount  AS inv_tax,
        inv.total_amount AS inv_total,
        inv.amount_paid AS inv_paid,
        inv.status      AS inv_status,
        inv.line_items  AS inv_lines
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

-- Allow anon and authenticated roles to call this function
GRANT EXECUTE ON FUNCTION portal_lookup(TEXT, TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. portal_approve_estimate — customer approves estimate
-- ─────────────────────────────────────────────────────────────

-- Add approval columns to jobs if not there yet
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS estimate_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimate_approved_by  TEXT;  -- "customer" or staff name

CREATE OR REPLACE FUNCTION portal_approve_estimate(
  p_job_id   UUID,
  p_plate    TEXT,
  p_ic_last4 TEXT
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
  -- Get the job
  SELECT id, vehicle_id, status, estimated_cost, estimate_approved_at
    INTO v_job
    FROM jobs
   WHERE id = p_job_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'job_not_found');
  END IF;

  -- Already approved?
  IF v_job.estimate_approved_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_approved');
  END IF;

  -- Verify vehicle + IC
  p_plate := upper(regexp_replace(p_plate, '\s+', '', 'g'));

  SELECT id, plate_number, customer_id
    INTO v_vehicle
    FROM vehicles
   WHERE id = v_job.vehicle_id
     AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = p_plate;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'vehicle_mismatch');
  END IF;

  SELECT id, ic_number
    INTO v_customer
    FROM customers
   WHERE id = v_vehicle.customer_id;

  IF NOT FOUND OR right(regexp_replace(coalesce(v_customer.ic_number, ''), '[^0-9]', '', 'g'), 4) <> p_ic_last4 THEN
    RETURN json_build_object('error', 'ic_mismatch');
  END IF;

  -- Stamp the approval
  UPDATE jobs
     SET estimate_approved_at = now(),
         estimate_approved_by = 'Customer (Portal)'
   WHERE id = p_job_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION portal_approve_estimate(UUID, TEXT, TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. Storage bucket for portal payment proof uploads
-- ─────────────────────────────────────────────────────────────

-- Insert bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('portal-uploads', 'portal-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Anyone can upload to portal-uploads (anon + authenticated)
DROP POLICY IF EXISTS "portal_uploads_insert" ON storage.objects;
CREATE POLICY "portal_uploads_insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'portal-uploads');

-- Only authenticated staff can read portal uploads
DROP POLICY IF EXISTS "portal_uploads_select" ON storage.objects;
CREATE POLICY "portal_uploads_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'portal-uploads' AND is_active_user());
