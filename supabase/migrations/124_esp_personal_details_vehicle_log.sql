-- 124: Personal Details (module 1) and Vehicle Log (module 3) for the ESP
-- member portal. Both re-verify phone+password themselves, same discipline
-- as every other public-facing RPC in this file's lineage (119-122) --
-- never trust client-side "logged in" state.

-- ── esp_member_update_profile ────────────────────────────────────────────
-- p_phone is the CURRENT phone, used for verification (matches login).
-- p_new_phone is what full_name/email/ic_number/full_address get updated
-- alongside -- can equal p_phone if the member isn't changing it. Rejects
-- a new phone that already belongs to a different customer in this
-- tenant, since esp_login has no way to disambiguate two customers
-- sharing one phone number.
CREATE OR REPLACE FUNCTION public.esp_member_update_profile(
  p_phone        text,
  p_password     text,
  p_full_name    text,
  p_new_phone    text,
  p_email        text,
  p_ic_number    text,
  p_full_address text,
  p_tenant_slug  text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, phone, esp_portal_password_hash INTO v_customer
    FROM customers
   WHERE tenant_id = v_tenant_id
     AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
     AND normalize_my_phone(phone) <> ''
   LIMIT 1;
  IF NOT FOUND
     OR v_customer.esp_portal_password_hash IS NULL
     OR crypt(p_password, v_customer.esp_portal_password_hash) <> v_customer.esp_portal_password_hash
  THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  IF length(trim(coalesce(p_full_name, ''))) = 0 THEN
    RETURN json_build_object('error', 'full_name_required');
  END IF;

  IF normalize_my_phone(p_new_phone) = '' THEN
    RETURN json_build_object('error', 'phone_required');
  END IF;

  IF normalize_my_phone(p_new_phone) <> normalize_my_phone(v_customer.phone) AND EXISTS (
    SELECT 1 FROM customers
     WHERE tenant_id = v_tenant_id
       AND id <> v_customer.id
       AND normalize_my_phone(phone) = normalize_my_phone(p_new_phone)
  ) THEN
    RETURN json_build_object('error', 'phone_already_in_use');
  END IF;

  UPDATE customers SET
    full_name = trim(p_full_name),
    phone = p_new_phone,
    email = coalesce(p_email, ''),
    ic_number = coalesce(p_ic_number, ''),
    full_address = coalesce(p_full_address, '')
  WHERE id = v_customer.id;

  RETURN json_build_object('success', true, 'phone', p_new_phone);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_member_update_profile(text, text, text, text, text, text, text, text) TO anon, authenticated;

-- ── esp_get_vehicle_log ──────────────────────────────────────────────────
-- Per-vehicle drill-down: full job history (diagnosis, complaint, amount)
-- plus which jobs have customer-visible photos (signed separately by
-- esp-vehicle-photos, same private-bucket-needs-service-role reasoning as
-- portal-job-photos). Confirms the vehicle is actually tied to one of this
-- customer's own ESP memberships before returning anything -- vehicle ids
-- are guessable UUIDs, this is the only thing standing between "my own
-- vehicle" and "a stranger's".
CREATE OR REPLACE FUNCTION public.esp_get_vehicle_log(
  p_phone       text,
  p_password    text,
  p_vehicle_id  uuid,
  p_tenant_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_vehicle   RECORD;
  v_jobs      JSON;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, esp_portal_password_hash INTO v_customer
    FROM customers
   WHERE tenant_id = v_tenant_id
     AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
     AND normalize_my_phone(phone) <> ''
   LIMIT 1;
  IF NOT FOUND
     OR v_customer.esp_portal_password_hash IS NULL
     OR crypt(p_password, v_customer.esp_portal_password_hash) <> v_customer.esp_portal_password_hash
  THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  SELECT v.id, v.plate_number, v.make, v.model, v.year, v.vehicle_type, v.current_mileage INTO v_vehicle
    FROM vehicles v
    JOIN esp_members em ON em.id = v.esp_member_id
   WHERE v.id = p_vehicle_id AND em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id
   LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('error', 'vehicle_not_found'); END IF;

  SELECT coalesce(json_agg(json_build_object(
           'job_id', j.id,
           'job_number', j.job_number,
           'service_type', j.service_type,
           'status', j.status,
           'checked_in_at', j.checked_in_at,
           'customer_complaint', j.customer_complaint,
           'diagnosis_summary', j.diagnosis_summary,
           'final_amount', j.final_amount,
           'photo_count', (SELECT count(*) FROM job_photos jp WHERE jp.job_id = j.id AND jp.visible_to_customer = true)
         ) ORDER BY j.checked_in_at DESC), '[]'::json)
    INTO v_jobs
    FROM jobs j
   WHERE j.vehicle_id = v_vehicle.id;

  RETURN json_build_object(
    'success', true,
    'vehicle', json_build_object(
      'id', v_vehicle.id, 'plate_number', v_vehicle.plate_number, 'make', v_vehicle.make,
      'model', v_vehicle.model, 'year', v_vehicle.year, 'vehicle_type', v_vehicle.vehicle_type,
      'current_mileage', v_vehicle.current_mileage
    ),
    'jobs', v_jobs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_get_vehicle_log(text, text, uuid, text) TO anon, authenticated;

-- ── esp_verify_job_photo_access ──────────────────────────────────────────
-- Sibling to portal_verify_job_access (098-lineage), but phone+password
-- instead of plate+phone+IC, since that's how the ESP portal authenticates.
CREATE OR REPLACE FUNCTION public.esp_verify_job_photo_access(
  p_phone    text,
  p_password text,
  p_job_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_customer RECORD;
BEGIN
  SELECT c.id INTO v_customer
    FROM jobs j
    JOIN vehicles v ON v.id = j.vehicle_id
    JOIN esp_members em ON em.id = v.esp_member_id
    JOIN customers c ON c.id = em.customer_id
   WHERE j.id = p_job_id
   LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM customers
     WHERE id = v_customer.id
       AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
       AND normalize_my_phone(phone) <> ''
       AND esp_portal_password_hash IS NOT NULL
       AND crypt(p_password, esp_portal_password_hash) = esp_portal_password_hash
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_verify_job_photo_access(text, text, uuid) TO anon, authenticated;

-- ── esp_login (extended) ─────────────────────────────────────────────────
-- Adds email/ic_number/full_address to the response so the Personal
-- Details edit form can be pre-filled without a second re-verified call.
CREATE OR REPLACE FUNCTION public.esp_login(
  p_phone       text,
  p_password    text,
  p_tenant_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_members   JSON;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, full_name, email, ic_number, full_address, esp_portal_password_hash INTO v_customer
    FROM customers
   WHERE tenant_id = v_tenant_id
     AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
     AND normalize_my_phone(phone) <> ''
   LIMIT 1;

  IF NOT FOUND
     OR v_customer.esp_portal_password_hash IS NULL
     OR crypt(p_password, v_customer.esp_portal_password_hash) <> v_customer.esp_portal_password_hash
  THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  SELECT json_agg(json_build_object(
           'membership_number', em.membership_number,
           'status', em.status,
           'valid_until', em.valid_until,
           'community_name', ec.name,
           'community_slug', ec.slug,
           'discounts', json_build_object(
             'car_full_pct', ec.car_full_package_discount_pct,
             'car_selected_pct', ec.car_selected_item_discount_pct,
             'bike_full_pct', ec.bike_full_package_discount_pct,
             'bike_selected_pct', ec.bike_selected_item_discount_pct
           ),
           'vehicles', (
             SELECT coalesce(json_agg(json_build_object(
                      'id', v.id, 'plate_number', v.plate_number, 'make', v.make,
                      'model', v.model, 'vehicle_type', v.vehicle_type
                    ) ORDER BY v.plate_number), '[]'::json)
             FROM vehicles v WHERE v.esp_member_id = em.id
           ),
           'service_history', (
             SELECT coalesce(json_agg(json_build_object(
                      'job_number', j.job_number, 'service_type', j.service_type,
                      'status', j.status, 'checked_in_at', j.checked_in_at,
                      'final_amount', j.final_amount, 'plate_number', v.plate_number
                    ) ORDER BY j.checked_in_at DESC), '[]'::json)
             FROM jobs j
             JOIN vehicles v ON v.id = j.vehicle_id
             WHERE v.esp_member_id = em.id
             LIMIT 20
           ),
           'receipts', (
             SELECT coalesce(json_agg(json_build_object(
                      'receipt_id', r.id, 'amount', r.amount, 'payment_date', r.payment_date,
                      'payment_method', r.payment_method, 'invoice_number', i.invoice_number
                    ) ORDER BY r.created_at DESC), '[]'::json)
             FROM receipts r
             JOIN invoices i ON i.id = r.invoice_id
             WHERE i.esp_member_id = em.id
           )
         ) ORDER BY em.registered_at DESC)
    INTO v_members
    FROM esp_members em
    JOIN esp_communities ec ON ec.id = em.community_id
   WHERE em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id;

  RETURN json_build_object(
    'success', true,
    'full_name', v_customer.full_name,
    'email', v_customer.email,
    'ic_number', v_customer.ic_number,
    'full_address', v_customer.full_address,
    'phone', p_phone,
    'memberships', coalesce(v_members, '[]'::json)
  );
END;
$$;
