-- 120: Fleshes out the ESP member portal (login already shipped in 119) with
-- the 8 "quick win"/"medium build" modules discussed: membership card,
-- discount summary, receipt history, service history, self-service renewal,
-- vehicle management, priority booking, and an expiry/maintenance banner.
--
-- Rather than one re-verified RPC per module, esp_login itself is extended
-- to return everything in one go (discounts, vehicles, service history,
-- receipt metadata) -- mirrors portal_lookup's existing "one big verified
-- lookup" shape rather than inventing N separately-authenticated calls.
-- Two genuine actions still need their own RPCs: renewing (creates an
-- invoice) and adding a vehicle (writes new data) -- both re-verify
-- phone+password themselves rather than trusting client-side "logged in"
-- state, same discipline as everything else public-facing in this app.

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

  SELECT id, full_name, esp_portal_password_hash INTO v_customer
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
    'phone', p_phone,
    'memberships', coalesce(v_members, '[]'::json)
  );
END;
$$;

-- ── esp_member_renew ─────────────────────────────────────────────────────
-- Member-facing version of staff's esp_renew_member -- same invoice-creation
-- logic, phone+password re-verification instead of a staff role check.
CREATE OR REPLACE FUNCTION public.esp_member_renew(
  p_phone            text,
  p_password         text,
  p_membership_number text,
  p_tenant_slug      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id      uuid;
  v_customer       RECORD;
  v_member         RECORD;
  v_community      RECORD;
  v_invoice_id     uuid;
  v_invoice_number text;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, full_name, phone, email, esp_portal_password_hash INTO v_customer
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

  SELECT * INTO v_member
    FROM esp_members
   WHERE regexp_replace(upper(membership_number), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_membership_number), '[^A-Z0-9]', '', 'g')
     AND customer_id = v_customer.id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'member_not_found'); END IF;

  SELECT * INTO v_community FROM esp_communities WHERE id = v_member.community_id;
  IF NOT FOUND OR NOT v_community.is_active THEN RETURN json_build_object('error', 'community_inactive'); END IF;

  INSERT INTO invoices (
    tenant_id, branch_id, job_id, customer_id, customer_name, customer_phone, customer_email,
    issue_date, status, line_items, subtotal, discount_amount, tax_pct, tax_amount, total_amount,
    esp_member_id
  )
  VALUES (
    v_member.tenant_id, v_community.home_branch_id, NULL, v_member.customer_id,
    v_customer.full_name, v_customer.phone, v_customer.email,
    current_date, 'sent',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'custom',
      'description', 'ESP Membership Renewal -- ' || v_community.name || ' (Membership #' || v_member.membership_number || ')',
      'qty', 1, 'uom', 'unit',
      'unit_price', v_community.membership_fee, 'amount', v_community.membership_fee
    )),
    v_community.membership_fee, 0, 0, 0, v_community.membership_fee,
    v_member.id
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  UPDATE esp_members SET fee_invoice_id = v_invoice_id, updated_at = now() WHERE id = v_member.id;

  RETURN json_build_object(
    'success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number,
    'amount', v_community.membership_fee
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_member_renew(text, text, text, text) TO anon, authenticated;

-- ── esp_member_add_vehicle ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.esp_member_add_vehicle(text, text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.esp_member_add_vehicle(
  p_phone            text,
  p_password         text,
  p_membership_number text,
  p_plate_number     text,
  p_vehicle_type     text,
  p_make             text DEFAULT NULL,
  p_model            text DEFAULT NULL,
  p_year             text DEFAULT NULL,
  p_tenant_slug      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_member    RECORD;
  v_plate     TEXT := upper(regexp_replace(p_plate_number, '\s+', '', 'g'));
  v_year      INTEGER := NULLIF(p_year, '')::INTEGER;
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

  SELECT * INTO v_member
    FROM esp_members
   WHERE regexp_replace(upper(membership_number), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_membership_number), '[^A-Z0-9]', '', 'g')
     AND customer_id = v_customer.id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'member_not_found'); END IF;

  IF p_vehicle_type NOT IN ('car', 'bike') THEN RETURN json_build_object('error', 'invalid_vehicle_type'); END IF;

  IF EXISTS (
    SELECT 1 FROM vehicles
     WHERE tenant_id = v_tenant_id
       AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_plate
       AND customer_id <> v_customer.id
  ) THEN
    RETURN json_build_object('error', 'plate_already_registered_to_another_customer');
  END IF;

  INSERT INTO vehicles (tenant_id, branch_id, customer_id, esp_member_id, plate_number, vehicle_type, make, model, year)
  VALUES (v_tenant_id, v_member.branch_id, v_customer.id, v_member.id, v_plate, p_vehicle_type, p_make, p_model, v_year)
  ON CONFLICT DO NOTHING;

  -- Plate already existed for this same customer -- just attach it to this
  -- membership rather than erroring, since re-submitting an existing plate
  -- isn't really a mistake worth blocking.
  UPDATE vehicles SET esp_member_id = v_member.id
   WHERE tenant_id = v_tenant_id AND customer_id = v_customer.id
     AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_plate;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_member_add_vehicle(text, text, text, text, text, text, text, text, text) TO anon, authenticated;

-- ── esp_get_receipt_paths ────────────────────────────────────────────────
-- Superseded esp_get_receipt (116, single-most-recent-receipt) now that the
-- portal shows full receipt history, not just one -- returns every receipt
-- across every membership this customer holds, re-verified via phone +
-- password. Storage paths only; the esp-receipt edge function signs each
-- one with the service role.
CREATE OR REPLACE FUNCTION public.esp_get_receipt_paths(
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
  v_receipts  JSON;
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
           'receipt_id', r.id, 'proof_bucket', r.proof_bucket, 'proof_url', r.proof_url,
           'amount', r.amount, 'payment_date', r.payment_date, 'payment_method', r.payment_method,
           'invoice_number', i.invoice_number
         ) ORDER BY r.created_at DESC), '[]'::json)
    INTO v_receipts
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
    JOIN esp_members em ON em.id = i.esp_member_id
   WHERE em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id AND r.proof_url IS NOT NULL;

  RETURN json_build_object('success', true, 'receipts', v_receipts);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_get_receipt_paths(text, text, text) TO anon, authenticated;

-- ── esp_verify_invoice_access_by_password ────────────────────────────────
-- raudhahpay-create-payment verifies ESP invoice access via
-- esp_verify_invoice_access (101, phone + IC-first-6) -- but IC is optional
-- at registration and the portal's own login is phone + password, not IC.
-- A portal member without an IC on file would be unable to pay a renewal
-- invoice at all through the existing check. Sibling function, same
-- customer_id resolution, password instead of IC.
CREATE OR REPLACE FUNCTION public.esp_verify_invoice_access_by_password(
  p_invoice_id uuid,
  p_phone      text,
  p_password   text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_customer_id uuid;
  v_customer    RECORD;
BEGIN
  SELECT em.customer_id INTO v_customer_id
    FROM invoices inv
    JOIN esp_members em ON em.id = inv.esp_member_id
   WHERE inv.id = p_invoice_id
   LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT phone, esp_portal_password_hash INTO v_customer FROM customers WHERE id = v_customer_id LIMIT 1;
  IF NOT FOUND OR normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN false;
  END IF;

  IF v_customer.esp_portal_password_hash IS NULL OR crypt(p_password, v_customer.esp_portal_password_hash) <> v_customer.esp_portal_password_hash THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION esp_verify_invoice_access_by_password(uuid, text, text) TO anon, authenticated;
