-- 127: Mileage history (date + mileage), not just a single current_mileage
-- snapshot. Every mileage update -- from a job check-in (125's trigger) or
-- a member self-report (126's esp_member_update_vehicle) -- now leaves a
-- dated record instead of silently overwriting the last value.

CREATE TABLE IF NOT EXISTS vehicle_mileage_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  recorded_at date NOT NULL DEFAULT current_date,
  mileage     integer NOT NULL CHECK (mileage >= 0),
  source      text NOT NULL CHECK (source IN ('job_checkin', 'member_report')),
  job_id      uuid REFERENCES jobs(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_mileage_log_vehicle ON vehicle_mileage_log (vehicle_id, recorded_at DESC);

ALTER TABLE vehicle_mileage_log ENABLE ROW LEVEL SECURITY;

-- All writes go through SECURITY DEFINER functions (the mileage-sync
-- trigger below, and esp_member_update_vehicle), so the only policy
-- needed here is read access for tenant staff.
DROP POLICY IF EXISTS vehicle_mileage_log_select ON vehicle_mileage_log;
CREATE POLICY vehicle_mileage_log_select ON vehicle_mileage_log FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant());

-- ── Re-point the mileage-sync trigger through a SECURITY DEFINER function ──
-- It needs to write to vehicle_mileage_log regardless of the calling
-- staff member's own RLS grants on that table (there are none, by design
-- above) -- same reasoning as every other cross-table trigger in this app.
CREATE OR REPLACE FUNCTION public.sync_vehicle_mileage_from_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public
AS $$
BEGIN
  IF NEW.mileage_in IS NOT NULL AND NEW.vehicle_id IS NOT NULL THEN
    UPDATE vehicles
       SET current_mileage = NEW.mileage_in
     WHERE id = NEW.vehicle_id
       AND (current_mileage IS NULL OR current_mileage < NEW.mileage_in);

    IF FOUND THEN
      INSERT INTO vehicle_mileage_log (tenant_id, vehicle_id, recorded_at, mileage, source, job_id, created_by)
      VALUES (NEW.tenant_id, NEW.vehicle_id, coalesce(NEW.checked_in_at::date, current_date), NEW.mileage_in, 'job_checkin', NEW.id, auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── esp_member_update_vehicle: log self-reported mileage too ────────────
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

  IF v_mileage IS NOT NULL AND (v_vehicle.current_mileage IS NULL OR v_mileage > v_vehicle.current_mileage) THEN
    INSERT INTO vehicle_mileage_log (tenant_id, vehicle_id, recorded_at, mileage, source)
    VALUES (v_tenant_id, p_vehicle_id, current_date, v_mileage, 'member_report');
  END IF;

  RETURN json_build_object('success', true, 'plate_number', v_plate);
END;
$$;

-- ── esp_get_vehicle_log: return mileage history alongside job history ───
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
  v_mileage_log JSON;
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

  SELECT coalesce(json_agg(json_build_object(
           'recorded_at', l.recorded_at, 'mileage', l.mileage, 'source', l.source
         ) ORDER BY l.recorded_at DESC, l.created_at DESC), '[]'::json)
    INTO v_mileage_log
    FROM (
      SELECT recorded_at, mileage, source, created_at FROM vehicle_mileage_log
       WHERE vehicle_id = v_vehicle.id
       ORDER BY recorded_at DESC, created_at DESC
       LIMIT 20
    ) l;

  RETURN json_build_object(
    'success', true,
    'vehicle', json_build_object(
      'id', v_vehicle.id, 'plate_number', v_vehicle.plate_number, 'make', v_vehicle.make,
      'model', v_vehicle.model, 'year', v_vehicle.year, 'vehicle_type', v_vehicle.vehicle_type,
      'color', v_vehicle.color, 'current_mileage', v_vehicle.current_mileage
    ),
    'jobs', v_jobs,
    'mileage_history', v_mileage_log
  );
END;
$$;
