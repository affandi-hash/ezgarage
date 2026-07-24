-- 101: ESP program -- public + staff RPCs.

-- ── resolve_esp_community ───────────────────────────────────────────────
-- Deliberately has NO NULL-slug fallback branch at all (stricter than
-- resolve_portal_tenant, which still has a single-tenant fallback even after
-- 099's hardening) -- always requires a real slug, never guesses.
CREATE OR REPLACE FUNCTION public.resolve_esp_community(p_community_slug text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id FROM esp_communities WHERE slug = p_community_slug AND is_active = true LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION resolve_esp_community(text) TO anon, authenticated;


-- ── get_esp_community_public ────────────────────────────────────────────
-- Modeled on get_portal_config (071). Public branding/fee/tier payload for
-- the registration page header + pitch.
CREATE OR REPLACE FUNCTION public.get_esp_community_public(p_community_slug text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_community RECORD;
  v_tenant    RECORD;
BEGIN
  SELECT * INTO v_community FROM esp_communities WHERE slug = p_community_slug AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'community_not_found');
  END IF;

  SELECT name, logo_url, phone INTO v_tenant FROM tenants WHERE id = v_community.tenant_id;

  RETURN json_build_object(
    'id', v_community.id,
    'name', v_community.name,
    'slug', v_community.slug,
    'description', v_community.description,
    'membership_fee', v_community.membership_fee,
    'validity_years', v_community.validity_years,
    'car_full_package_discount_pct', v_community.car_full_package_discount_pct,
    'car_selected_item_discount_pct', v_community.car_selected_item_discount_pct,
    'bike_full_package_discount_pct', v_community.bike_full_package_discount_pct,
    'bike_selected_item_discount_pct', v_community.bike_selected_item_discount_pct,
    'tenant_name', v_tenant.name,
    'tenant_logo_url', v_tenant.logo_url,
    'tenant_phone', v_tenant.phone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_esp_community_public(text) TO anon, authenticated;


-- ── esp_public_register ─────────────────────────────────────────────────
-- Used by BOTH the public /esp/:communitySlug page (anon) AND staff walk-in
-- registration (authenticated) -- created_by distinguishes which. All-or-
-- nothing: if ANY submitted vehicle plate collides with a DIFFERENT
-- customer's existing vehicle in this tenant, the whole call fails with no
-- rows created.
--
-- p_vehicles shape: [{"plate_number":"ABC1234","vehicle_type":"car","make":"Toyota","model":"Vios","year":2020}, ...]
CREATE OR REPLACE FUNCTION public.esp_public_register(
  p_community_slug text,
  p_full_name      text,
  p_phone          text,
  p_email          text,
  p_ic_number      text,
  p_vehicles       jsonb
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_community      RECORD;
  v_customer       RECORD;
  v_customer_id    uuid;
  v_member         RECORD;
  v_member_id      uuid;
  v_veh            jsonb;
  v_plate          text;
  v_existing_veh   RECORD;
  v_invoice        RECORD;
  v_invoice_id     uuid;
  v_invoice_number text;
BEGIN
  IF p_community_slug IS NULL OR p_community_slug = '' THEN
    RETURN json_build_object('error', 'community_slug_required');
  END IF;

  SELECT * INTO v_community FROM esp_communities WHERE slug = p_community_slug AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'community_not_found');
  END IF;

  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RETURN json_build_object('error', 'full_name_required');
  END IF;
  IF normalize_my_phone(p_phone) = '' THEN
    RETURN json_build_object('error', 'phone_required');
  END IF;
  IF p_vehicles IS NULL OR jsonb_array_length(p_vehicles) < 1 THEN
    RETURN json_build_object('error', 'at_least_one_vehicle_required');
  END IF;

  -- ── Pre-check every plate for basic validity before touching anything ──
  FOR v_veh IN SELECT * FROM jsonb_array_elements(p_vehicles)
  LOOP
    v_plate := upper(regexp_replace(coalesce(v_veh->>'plate_number', ''), '\s+', '', 'g'));
    IF v_plate = '' THEN
      RETURN json_build_object('error', 'plate_number_required');
    END IF;
    IF (v_veh->>'vehicle_type') NOT IN ('car', 'bike') THEN
      RETURN json_build_object('error', 'invalid_vehicle_type', 'plate', v_plate);
    END IF;
  END LOOP;

  -- ── Resolve or create the customer (match by phone within this tenant) ─
  SELECT c.id, c.full_name, c.phone, c.email, c.ic_number
    INTO v_customer
    FROM customers c
   WHERE c.tenant_id = v_community.tenant_id
     AND normalize_my_phone(c.phone) = normalize_my_phone(p_phone)
   LIMIT 1;

  IF FOUND THEN
    v_customer_id := v_customer.id;
    -- Never clobber existing data from an untrusted public form -- only
    -- backfill fields the existing record doesn't already have.
    UPDATE customers
       SET email      = COALESCE(NULLIF(email, ''), NULLIF(trim(p_email), '')),
           ic_number  = COALESCE(NULLIF(ic_number, ''), NULLIF(trim(p_ic_number), '')),
           updated_at = now()
     WHERE id = v_customer_id;
  ELSE
    INSERT INTO customers (branch_id, tenant_id, full_name, phone, email, ic_number, customer_type, customer_status)
    VALUES (v_community.home_branch_id, v_community.tenant_id, trim(p_full_name), p_phone, NULLIF(trim(p_email), ''), NULLIF(trim(p_ic_number), ''), 'individual', 'active')
    RETURNING id INTO v_customer_id;
  END IF;

  -- ── Now that customer_id is resolved, check plate conflicts for real ──
  -- (Whole call fails atomically -- no partial registration, no silent
  -- reassignment of someone else's vehicle to a new owner.)
  FOR v_veh IN SELECT * FROM jsonb_array_elements(p_vehicles)
  LOOP
    v_plate := upper(regexp_replace(v_veh->>'plate_number', '\s+', '', 'g'));
    SELECT id, customer_id INTO v_existing_veh
      FROM vehicles
     WHERE tenant_id = v_community.tenant_id
       AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_plate
     LIMIT 1;
    IF FOUND AND v_existing_veh.customer_id IS DISTINCT FROM v_customer_id THEN
      RETURN json_build_object(
        'error', 'plate_already_registered_to_another_customer',
        'plate', v_plate
      );
    END IF;
  END LOOP;

  -- ── Resolve or create the esp_members row ─────────────────────────────
  SELECT * INTO v_member FROM esp_members WHERE community_id = v_community.id AND customer_id = v_customer_id;

  IF FOUND THEN
    IF v_member.status = 'active' THEN
      RETURN json_build_object(
        'error', 'already_active_member',
        'membership_number', v_member.membership_number,
        'valid_until', v_member.valid_until
      );
    END IF;
    -- pending_payment / expired / cancelled -> reuse the SAME row and SAME
    -- membership_number. This also solves "abandoned registration": a
    -- second visit with the same phone resumes the same pending row instead
    -- of creating a duplicate.
    v_member_id := v_member.id;
    UPDATE esp_members SET status = 'pending_payment', updated_at = now() WHERE id = v_member_id;
  ELSE
    INSERT INTO esp_members (tenant_id, community_id, customer_id, status, created_by)
    VALUES (v_community.tenant_id, v_community.id, v_customer_id, 'pending_payment', auth.uid())
    RETURNING id INTO v_member_id;
    SELECT * INTO v_member FROM esp_members WHERE id = v_member_id;
  END IF;

  -- ── Vehicles: reuse-by-plate-under-same-customer, or create ───────────
  FOR v_veh IN SELECT * FROM jsonb_array_elements(p_vehicles)
  LOOP
    v_plate := upper(regexp_replace(v_veh->>'plate_number', '\s+', '', 'g'));
    SELECT id INTO v_existing_veh FROM vehicles
     WHERE tenant_id = v_community.tenant_id
       AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_plate
       AND customer_id = v_customer_id
     LIMIT 1;

    IF FOUND THEN
      UPDATE vehicles SET esp_member_id = v_member_id, updated_at = now() WHERE id = v_existing_veh.id;
    ELSE
      INSERT INTO vehicles (customer_id, branch_id, tenant_id, plate_number, vehicle_type, make, model, year, esp_member_id)
      VALUES (
        v_customer_id, v_community.home_branch_id, v_community.tenant_id, v_plate,
        v_veh->>'vehicle_type', NULLIF(v_veh->>'make', ''), NULLIF(v_veh->>'model', ''),
        NULLIF(v_veh->>'year', '')::integer, v_member_id
      );
    END IF;
  END LOOP;

  -- ── Fee invoice: reuse an existing unpaid one, else create a new one ──
  v_invoice_id := NULL;
  IF v_member.fee_invoice_id IS NOT NULL THEN
    SELECT id, invoice_number, status INTO v_invoice FROM invoices WHERE id = v_member.fee_invoice_id;
    IF FOUND AND v_invoice.status IN ('draft', 'sent') THEN
      v_invoice_id := v_invoice.id;
      v_invoice_number := v_invoice.invoice_number;
    END IF;
  END IF;

  IF v_invoice_id IS NULL THEN
    INSERT INTO invoices (
      tenant_id, branch_id, job_id, customer_id, customer_name, customer_phone, customer_email,
      issue_date, status, line_items, subtotal, discount_amount, tax_pct, tax_amount, total_amount,
      esp_member_id, created_by
    )
    VALUES (
      v_community.tenant_id, v_community.home_branch_id, NULL, v_customer_id,
      trim(p_full_name), p_phone, NULLIF(trim(p_email), ''),
      current_date, 'sent',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'custom',
        'description', 'ESP Membership Fee -- ' || v_community.name || ' (Membership #' || v_member.membership_number || ')',
        'qty', 1, 'uom', 'unit',
        'unit_price', v_community.membership_fee, 'amount', v_community.membership_fee
      )),
      v_community.membership_fee, 0, 0, 0, v_community.membership_fee,
      v_member_id, auth.uid()
    )
    RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

    UPDATE esp_members SET fee_invoice_id = v_invoice_id, updated_at = now() WHERE id = v_member_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'member_id', v_member_id,
    'membership_number', v_member.membership_number,
    'status', v_member.status,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'amount', v_community.membership_fee,
    'community_name', v_community.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_public_register(text, text, text, text, text, jsonb) TO anon, authenticated;


-- ── esp_verify_invoice_access ────────────────────────────────────────────
-- Sibling to portal_verify_invoice_access (098) for ESP fee invoices, which
-- have job_id = NULL and so can never satisfy that function's hard
-- INNER JOIN invoices -> jobs -> vehicles. No plate/vehicle involved --
-- matches phone + IC-first-6 against esp_members -> customers directly.
CREATE OR REPLACE FUNCTION public.esp_verify_invoice_access(
  p_invoice_id uuid,
  p_phone      text,
  p_ic_first6  text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_customer_id uuid;
  v_customer    RECORD;
  v_ic_digits   TEXT;
BEGIN
  SELECT em.customer_id INTO v_customer_id
    FROM invoices inv
    JOIN esp_members em ON em.id = inv.esp_member_id
   WHERE inv.id = p_invoice_id
   LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT phone, ic_number INTO v_customer FROM customers WHERE id = v_customer_id LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  IF normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN false;
  END IF;

  v_ic_digits := regexp_replace(coalesce(v_customer.ic_number, ''), '[^0-9]', '', 'g');
  IF length(v_ic_digits) < 6 THEN RETURN false; END IF;
  IF length(regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g')) <> 6
     OR left(v_ic_digits, 6) <> regexp_replace(coalesce(p_ic_first6, ''), '[^0-9]', '', 'g') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION esp_verify_invoice_access(uuid, text, text) TO anon, authenticated;


-- ── esp_check_status ─────────────────────────────────────────────────────
-- Public post-payment / "check my membership status" RPC -- used after the
-- RaudhahPay redirect back, or any time later. Requires membership_number
-- AND a matching phone (not a bare unguarded ID lookup) -- same
-- defense-in-depth discipline as 098's IDOR fix.
CREATE OR REPLACE FUNCTION public.esp_check_status(p_membership_number text, p_phone text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_member   RECORD;
  v_customer RECORD;
BEGIN
  SELECT id, status, valid_until, membership_number, customer_id
    INTO v_member
    FROM esp_members
   WHERE membership_number = p_membership_number
   LIMIT 1;

  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  SELECT phone INTO v_customer FROM customers WHERE id = v_member.customer_id;
  IF NOT FOUND OR normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN json_build_object('error', 'phone_mismatch');
  END IF;

  RETURN json_build_object(
    'success', true,
    'status', v_member.status,
    'valid_until', v_member.valid_until,
    'membership_number', v_member.membership_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_check_status(text, text) TO anon, authenticated;


-- ── esp_renew_member (staff-only) ────────────────────────────────────────
-- Does NOT touch valid_until/status directly -- that only happens via the
-- 100's trigger once the renewal invoice is actually paid, same activation
-- path as first-time registration.
CREATE OR REPLACE FUNCTION public.esp_renew_member(p_member_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_member         RECORD;
  v_community      RECORD;
  v_customer       RECORD;
  v_invoice_id     uuid;
  v_invoice_number text;
BEGIN
  IF NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;

  SELECT * INTO v_member FROM esp_members WHERE id = p_member_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'member_not_found'); END IF;
  IF v_member.tenant_id <> get_my_tenant() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'front_desk'])) THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_community FROM esp_communities WHERE id = v_member.community_id;
  IF NOT FOUND OR NOT v_community.is_active THEN RETURN json_build_object('error', 'community_inactive'); END IF;

  SELECT full_name, phone, email INTO v_customer FROM customers WHERE id = v_member.customer_id;

  INSERT INTO invoices (
    tenant_id, branch_id, job_id, customer_id, customer_name, customer_phone, customer_email,
    issue_date, status, line_items, subtotal, discount_amount, tax_pct, tax_amount, total_amount,
    esp_member_id, created_by
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
    p_member_id, auth.uid()
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  UPDATE esp_members SET fee_invoice_id = v_invoice_id, updated_at = now() WHERE id = p_member_id;

  RETURN json_build_object('success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'amount', v_community.membership_fee);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_renew_member(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION esp_renew_member(uuid) FROM PUBLIC;
