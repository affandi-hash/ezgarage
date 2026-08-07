-- 126: Let ESP members edit their own vehicle's details and self-report
-- mileage. Closes two real gaps found live-testing: a vehicle registered
-- with just a plate (e.g. TEST001) had no way to ever get make/model/year
-- filled in afterward, and current_mileage -- which the new hybrid
-- maintenance detection depends on -- only ever updates when staff check
-- the vehicle in for a job, so it goes stale for members who don't visit
-- often with no way for them to correct it themselves.

-- esp_get_vehicle_log: add color so the edit form can prefill it (all
-- other fields it needs -- make/model/year/current_mileage/vehicle_type --
-- were already returned).
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

  SELECT v.id, v.plate_number, v.make, v.model, v.year, v.vehicle_type, v.color, v.current_mileage INTO v_vehicle
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
      'color', v_vehicle.color, 'current_mileage', v_vehicle.current_mileage
    ),
    'jobs', v_jobs
  );
END;
$$;

-- ── esp_member_update_vehicle ─────────────────────────────────────────────
-- Same re-verify-phone+password + ownership-check discipline as every
-- other member RPC. Mileage can only ever move forward, same guarantee as
-- the staff-side sync_vehicle_mileage_from_job trigger (125) -- a member
-- fat-fingering a lower number shouldn't silently erase real history, or
-- worse, mask an item that's actually overdue.
CREATE OR REPLACE FUNCTION public.esp_member_update_vehicle(
  p_phone            text,
  p_password         text,
  p_vehicle_id       uuid,
  p_plate_number     text,
  p_make             text DEFAULT NULL,
  p_model            text DEFAULT NULL,
  p_year             text DEFAULT NULL,
  p_color            text DEFAULT NULL,
  p_current_mileage  text DEFAULT NULL,
  p_tenant_slug      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_vehicle   RECORD;
  v_plate     TEXT := upper(regexp_replace(p_plate_number, '\s+', '', 'g'));
  v_year      INTEGER := NULLIF(p_year, '')::INTEGER;
  v_mileage   INTEGER := NULLIF(p_current_mileage, '')::INTEGER;
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

  IF length(trim(v_plate)) = 0 THEN RETURN json_build_object('error', 'plate_required'); END IF;

  SELECT v.id, v.current_mileage INTO v_vehicle
    FROM vehicles v
    JOIN esp_members em ON em.id = v.esp_member_id
   WHERE v.id = p_vehicle_id AND em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id
   LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('error', 'vehicle_not_found'); END IF;

  IF EXISTS (
    SELECT 1 FROM vehicles
     WHERE tenant_id = v_tenant_id
       AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_plate
       AND id <> p_vehicle_id
       AND customer_id <> v_customer.id
  ) THEN
    RETURN json_build_object('error', 'plate_already_registered_to_another_customer');
  END IF;

  IF v_mileage IS NOT NULL AND v_vehicle.current_mileage IS NOT NULL AND v_mileage < v_vehicle.current_mileage THEN
    RETURN json_build_object('error', 'mileage_cannot_decrease', 'current_mileage', v_vehicle.current_mileage);
  END IF;

  UPDATE vehicles SET
    plate_number = v_plate,
    make = nullif(trim(coalesce(p_make, '')), ''),
    model = nullif(trim(coalesce(p_model, '')), ''),
    year = v_year,
    color = nullif(trim(coalesce(p_color, '')), ''),
    current_mileage = coalesce(v_mileage, current_mileage)
  WHERE id = p_vehicle_id;

  RETURN json_build_object('success', true, 'plate_number', v_plate);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_member_update_vehicle(text, text, uuid, text, text, text, text, text, text, text) TO anon, authenticated;
