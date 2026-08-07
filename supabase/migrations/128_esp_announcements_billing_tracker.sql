-- 128: Three things requested together for the ESP member portal:
-- (1) Announcements -- can be community-specific OR general (all
--     communities of the tenant), so community_id is nullable.
-- (2) Billing -- members should see every invoice tied to them, open or
--     closed, not just paid ones (Receipts, 120, only ever showed paid).
-- (3) A live job-status tracker for an active (non-terminal) job, matching
--     the standalone CustomerPortalPage's feature set (status timeline,
--     estimate approval, pay online, payment-proof upload) rather than the
--     plain completed-jobs list Vehicle Log (124) had until now.

-- ── esp_announcements ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS esp_announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  community_id uuid REFERENCES esp_communities(id) ON DELETE CASCADE,  -- NULL = general, to every community
  title        text NOT NULL,
  body         text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esp_announcements_tenant ON esp_announcements (tenant_id, community_id);

ALTER TABLE esp_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esp_announcements_select ON esp_announcements;
CREATE POLICY esp_announcements_select ON esp_announcements FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant());

DROP POLICY IF EXISTS esp_announcements_insert ON esp_announcements;
CREATE POLICY esp_announcements_insert ON esp_announcements FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk']));

DROP POLICY IF EXISTS esp_announcements_update ON esp_announcements;
CREATE POLICY esp_announcements_update ON esp_announcements FOR UPDATE TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk']));

DROP POLICY IF EXISTS esp_announcements_delete ON esp_announcements;
CREATE POLICY esp_announcements_delete ON esp_announcements FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

-- Member-facing feed: general (community_id IS NULL) + every community this
-- customer actually belongs to. Re-verify phone+password, same as every
-- other member RPC in this lineage.
CREATE OR REPLACE FUNCTION public.esp_get_announcements(
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
  v_items     JSON;
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

  SELECT coalesce(json_agg(json_build_object(
           'id', a.id, 'title', a.title, 'body', a.body, 'created_at', a.created_at,
           'community_name', ec.name, 'is_general', a.community_id IS NULL
         ) ORDER BY a.created_at DESC), '[]'::json)
    INTO v_items
    FROM esp_announcements a
    LEFT JOIN esp_communities ec ON ec.id = a.community_id
   WHERE a.tenant_id = v_tenant_id
     AND a.is_active = true
     AND (
       a.community_id IS NULL
       OR a.community_id IN (SELECT em.community_id FROM esp_members em WHERE em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id)
     );

  RETURN json_build_object('success', true, 'announcements', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_get_announcements(text, text, text) TO anon, authenticated;

-- ── esp_get_billing ───────────────────────────────────────────────────────
-- Every invoice belonging to this customer -- ESP fee invoices AND regular
-- job/service invoices -- split into open vs closed by the caller (status
-- + balance are both returned so the frontend can group either way).
CREATE OR REPLACE FUNCTION public.esp_get_billing(
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
  v_bills     JSON;
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

  SELECT coalesce(json_agg(json_build_object(
           'invoice_id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
           'total_amount', i.total_amount, 'amount_paid', i.amount_paid,
           'balance_due', i.total_amount - i.amount_paid,
           'issue_date', i.issue_date, 'due_date', i.due_date,
           'is_esp_fee', i.esp_member_id IS NOT NULL,
           'vehicle_plate', i.vehicle_plate, 'job_number', j.job_number
         ) ORDER BY i.issue_date DESC), '[]'::json)
    INTO v_bills
    FROM invoices i
    LEFT JOIN jobs j ON j.id = i.job_id
   WHERE i.customer_id = v_customer.id AND i.tenant_id = v_tenant_id AND i.status <> 'void';

  RETURN json_build_object('success', true, 'bills', v_bills);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_get_billing(text, text, text) TO anon, authenticated;

-- ── esp_approve_estimate ──────────────────────────────────────────────────
-- Mirrors portal_approve_estimate (075) but verifies phone+password and
-- vehicle-belongs-to-this-member instead of plate+IC -- ESP members
-- authenticate differently, everything downstream is identical.
CREATE OR REPLACE FUNCTION public.esp_approve_estimate(
  p_phone       text,
  p_password    text,
  p_job_id      uuid,
  p_tenant_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_job       RECORD;
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

  SELECT j.id, j.estimate_approved_at INTO v_job
    FROM jobs j
    JOIN vehicles v ON v.id = j.vehicle_id
    JOIN esp_members em ON em.id = v.esp_member_id
   WHERE j.id = p_job_id AND em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id AND j.tenant_id = v_tenant_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'job_not_found'); END IF;
  IF v_job.estimate_approved_at IS NOT NULL THEN RETURN json_build_object('error', 'already_approved'); END IF;

  UPDATE jobs SET estimate_approved_at = now(), estimate_approved_by = 'ESP Member (Portal)' WHERE id = p_job_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_approve_estimate(text, text, uuid, text) TO anon, authenticated;

-- ── esp_verify_customer_invoice_by_password ──────────────────────────────
-- Generalizes esp_verify_invoice_access_by_password (119-lineage, which
-- only matches ESP membership-fee invoices via esp_member_id) to ANY
-- invoice belonging to the verified customer -- needed so Billing's Pay
-- Now can cover regular job/service invoices too, not just fee invoices.
CREATE OR REPLACE FUNCTION public.esp_verify_customer_invoice_by_password(
  p_invoice_id  uuid,
  p_phone       text,
  p_password    text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT customer_id INTO v_customer_id FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM customers
     WHERE id = v_customer_id
       AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
       AND normalize_my_phone(phone) <> ''
       AND esp_portal_password_hash IS NOT NULL
       AND crypt(p_password, esp_portal_password_hash) = esp_portal_password_hash
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_verify_customer_invoice_by_password(uuid, text, text) TO anon, authenticated;

-- ── esp_get_vehicle_log: add live-tracker fields for the active job ──────
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
           'next_action', j.next_action,
           'estimated_cost', j.estimated_cost,
           'estimate_approved_at', j.estimate_approved_at,
           'final_amount', j.final_amount,
           'photo_count', (SELECT count(*) FROM job_photos jp WHERE jp.job_id = j.id AND jp.visible_to_customer = true),
           'invoice_id', i.id, 'invoice_number', i.invoice_number,
           'invoice_total', i.total_amount, 'invoice_paid', i.amount_paid
         ) ORDER BY j.checked_in_at DESC), '[]'::json)
    INTO v_jobs
    FROM jobs j
    LEFT JOIN invoices i ON i.job_id = j.id
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
