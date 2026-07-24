-- 104: Fix a real-world payment failure -- esp_public_register() only ever
-- returned member/invoice identifiers, never the customer's actual stored
-- phone/IC. The frontend built the payment-step identity (phone, IC-first-6)
-- from whatever was just typed into the registration form.
--
-- That's wrong the moment someone submits the form more than once with
-- different phone/IC than the first time: the backend only BACKFILLS empty
-- fields on an existing customer (deliberately, to avoid an untrusted public
-- form clobbering real data) -- so the DB keeps the FIRST value entered,
-- while the frontend's session ends up holding whatever was typed on the
-- LATEST attempt. esp_verify_invoice_access() (098-style 3-factor check)
-- then compares the stale client-held values against the real DB row and
-- rejects the payment with "Could not verify your identity for this
-- invoice" -- confirmed live: a real registration's stored phone/IC passed
-- esp_verify_invoice_access() perfectly when tested directly, proving the
-- verification logic itself was correct and the bug was purely a stale
-- client-side value.
--
-- Fix: return the customer's ACTUAL current phone and IC (first 6 digits)
-- in the response, so the frontend always uses ground truth from the DB
-- for the payment step, never its own local form state.

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
  v_community        RECORD;
  v_existing_customer RECORD;
  v_customer_id       uuid;
  v_customer_final    RECORD;
  v_member            RECORD;
  v_member_id         uuid;
  v_veh               jsonb;
  v_plate              text;
  v_existing_veh       RECORD;
  v_invoice            RECORD;
  v_invoice_id         uuid;
  v_invoice_number     text;
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

  -- ── Validate every plate's basic shape (still read-only) ──────────────
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

  -- ── Resolve (read-only) which customer this would be, WITHOUT writing
  -- anything yet -- match by phone within this tenant.
  SELECT c.id INTO v_existing_customer
    FROM customers c
   WHERE c.tenant_id = v_community.tenant_id
     AND normalize_my_phone(c.phone) = normalize_my_phone(p_phone)
   LIMIT 1;
  v_customer_id := v_existing_customer.id;  -- NULL if no match found yet

  -- ── Check every plate for a conflict BEFORE any write happens. A
  -- conflict is: this plate already belongs to a DIFFERENT customer than
  -- the one resolved above (or to ANY customer, if none was resolved --
  -- i.e. this call would otherwise create a brand new customer for a
  -- vehicle someone else already owns). Whole call fails atomically with
  -- no rows created -- no partial registration, no silent reassignment.
  FOR v_veh IN SELECT * FROM jsonb_array_elements(p_vehicles)
  LOOP
    v_plate := upper(regexp_replace(v_veh->>'plate_number', '\s+', '', 'g'));
    SELECT id, customer_id INTO v_existing_veh
      FROM vehicles
     WHERE tenant_id = v_community.tenant_id
       AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_plate
     LIMIT 1;
    IF FOUND AND (v_customer_id IS NULL OR v_existing_veh.customer_id IS DISTINCT FROM v_customer_id) THEN
      RETURN json_build_object(
        'error', 'plate_already_registered_to_another_customer',
        'plate', v_plate
      );
    END IF;
  END LOOP;

  -- ── All checks passed -- now safe to write. Resolve or create the customer. ──
  IF v_customer_id IS NOT NULL THEN
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

  -- ── Re-select the customer's ACTUAL current stored values -- this is the
  -- fix. Never trust the just-typed form input for what to use later at
  -- payment time; always hand back ground truth.
  SELECT phone, ic_number INTO v_customer_final FROM customers WHERE id = v_customer_id;

  RETURN json_build_object(
    'success', true,
    'member_id', v_member_id,
    'membership_number', v_member.membership_number,
    'status', v_member.status,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'amount', v_community.membership_fee,
    'community_name', v_community.name,
    'customer_phone', v_customer_final.phone,
    'customer_ic_first6', left(regexp_replace(coalesce(v_customer_final.ic_number, ''), '[^0-9]', '', 'g'), 6)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_public_register(text, text, text, text, text, jsonb) TO anon, authenticated;
