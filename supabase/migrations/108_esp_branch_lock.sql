-- 108: ESP had no branch-level segregation at all -- any staff member of a
-- tenant could see/manage every ESP community and member across every
-- branch of that tenant, unlike Invoices/Jobs which lock non-super_admin
-- staff to their own branch (InvoicesPage.tsx's own query filter:
-- `if (user?.role !== 'super_admin' && user?.branch_id) q = q.eq('branch_id', ...)`).
-- User confirmed: lock ESP to branch too, strictly -- only super_admin
-- exempt (no ops_manager carve-out, matching that exact Invoices pattern
-- rather than the broader vehicles-style super_admin+ops_manager exemption).

-- esp_members had no branch_id of its own -- every other business-record
-- table (customers/vehicles/invoices/receipts) has its own branch_id
-- column rather than requiring a join through a related table for RLS, so
-- add one here too, denormalized from the community's home_branch_id at
-- registration time (mirrors exactly how esp_public_register already sets
-- branch_id on the customers/vehicles/invoices rows it creates).
ALTER TABLE esp_members ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);

UPDATE esp_members em
   SET branch_id = ec.home_branch_id
  FROM esp_communities ec
 WHERE em.community_id = ec.id
   AND em.branch_id IS NULL;

ALTER TABLE esp_members ALTER COLUMN branch_id SET NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- esp_communities RLS -- add branch lock on top of the existing tenant lock
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS esp_communities_select ON esp_communities;
CREATE POLICY esp_communities_select ON esp_communities FOR SELECT TO authenticated
  USING (
    is_active_user() AND tenant_id = get_my_tenant()
    AND (home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_communities_insert ON esp_communities;
CREATE POLICY esp_communities_insert ON esp_communities FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
    AND (home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_communities_update ON esp_communities;
CREATE POLICY esp_communities_update ON esp_communities FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
    AND (home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_communities_delete ON esp_communities;
CREATE POLICY esp_communities_delete ON esp_communities FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
    AND (home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

-- ─────────────────────────────────────────────────────────────
-- esp_members RLS -- same lock, using the new branch_id column
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS esp_members_select ON esp_members;
CREATE POLICY esp_members_select ON esp_members FOR SELECT TO authenticated
  USING (
    is_active_user() AND tenant_id = get_my_tenant()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_members_insert ON esp_members;
CREATE POLICY esp_members_insert ON esp_members FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk']))
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_members_update ON esp_members;
CREATE POLICY esp_members_update ON esp_members FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk']))
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_members_delete ON esp_members;
CREATE POLICY esp_members_delete ON esp_members FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

-- ─────────────────────────────────────────────────────────────
-- esp_membership_counters RLS -- same lock via the parent community
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS esp_membership_counters_rw ON esp_membership_counters;
CREATE POLICY esp_membership_counters_rw ON esp_membership_counters FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM esp_communities ec WHERE ec.id = esp_membership_counters.community_id
      AND ec.tenant_id = get_my_tenant()
      AND (ec.home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM esp_communities ec WHERE ec.id = esp_membership_counters.community_id
      AND ec.tenant_id = get_my_tenant()
      AND (ec.home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  ));

-- ─────────────────────────────────────────────────────────────
-- esp_public_register() -- SECURITY DEFINER bypasses RLS entirely, so the
-- INSERT policy above alone does NOT block a staff-initiated walk-in
-- registration into another branch's community. Add the same check inside
-- the function itself, but ONLY when called by an authenticated staff
-- session (auth.uid() is NULL for genuine anonymous customer-portal
-- registrations, which must remain unaffected -- a customer has no branch
-- of their own to be locked to).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esp_public_register(
  p_community_slug text,
  p_full_name      text,
  p_phone          text,
  p_email          text,
  p_ic_number      text,
  p_vehicles       jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Staff-initiated calls only (auth.uid() null => genuine anon customer
  -- portal registration, never branch-restricted).
  IF auth.uid() IS NOT NULL AND get_my_role() <> 'super_admin' AND get_my_branch() <> v_community.home_branch_id THEN
    RETURN json_build_object('error', 'forbidden_branch');
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

  SELECT c.id INTO v_existing_customer
    FROM customers c
   WHERE c.tenant_id = v_community.tenant_id
     AND normalize_my_phone(c.phone) = normalize_my_phone(p_phone)
   LIMIT 1;
  v_customer_id := v_existing_customer.id;

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

  IF v_customer_id IS NOT NULL THEN
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

  SELECT * INTO v_member FROM esp_members WHERE community_id = v_community.id AND customer_id = v_customer_id;

  IF FOUND THEN
    IF v_member.status = 'active' THEN
      RETURN json_build_object(
        'error', 'already_active_member',
        'membership_number', v_member.membership_number,
        'valid_until', v_member.valid_until
      );
    END IF;
    v_member_id := v_member.id;
    UPDATE esp_members SET status = 'pending_payment', updated_at = now() WHERE id = v_member_id;
  ELSE
    INSERT INTO esp_members (tenant_id, community_id, customer_id, branch_id, status, created_by)
    VALUES (v_community.tenant_id, v_community.id, v_customer_id, v_community.home_branch_id, 'pending_payment', auth.uid())
    RETURNING id INTO v_member_id;
    SELECT * INTO v_member FROM esp_members WHERE id = v_member_id;
  END IF;

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

-- ─────────────────────────────────────────────────────────────
-- esp_renew_member() -- staff-only already; add the same branch check.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esp_renew_member(p_member_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  IF get_my_role() <> 'super_admin' AND get_my_branch() <> v_member.branch_id THEN
    RETURN json_build_object('error', 'forbidden_branch');
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
