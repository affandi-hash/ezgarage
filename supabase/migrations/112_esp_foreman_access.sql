-- 112: Grants Foreman the same ESP access Ops Manager already has (parity,
-- same pattern as the earlier Attendance module extension) -- ESP Community
-- Settings + ESP Members, on top of ESP Reports which foreman already had.
--
-- Every role array below just adds 'foreman' alongside the existing
-- 'ops_manager' entries -- the branch lock itself (108_esp_branch_lock.sql)
-- is untouched and needs no change: it's role-agnostic, exempting ONLY
-- super_admin via `OR get_my_role() = 'super_admin'`, so foreman is
-- automatically branch-locked to their own home_branch_id/branch_id the
-- moment they're added to these role arrays, same as ops_manager/front_desk
-- already are. Verified live: the real foreman user at this tenant already
-- has branch_id set correctly, so this isn't blocked by a null-branch gap.

DROP POLICY IF EXISTS esp_communities_insert ON esp_communities;
CREATE POLICY esp_communities_insert ON esp_communities FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman']))
    AND (home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_communities_update ON esp_communities;
CREATE POLICY esp_communities_update ON esp_communities FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman']))
    AND (home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_communities_delete ON esp_communities;
CREATE POLICY esp_communities_delete ON esp_communities FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman']))
    AND (home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_members_insert ON esp_members;
CREATE POLICY esp_members_insert ON esp_members FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','foreman']))
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_members_update ON esp_members;
CREATE POLICY esp_members_update ON esp_members FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','foreman']))
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS esp_members_delete ON esp_members;
CREATE POLICY esp_members_delete ON esp_members FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman']))
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

-- esp_renew_member() has its own explicit role check (SECURITY DEFINER
-- bypasses the RLS policies above entirely) -- add foreman there too so
-- Foreman can actually renew a member from the Members page.
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
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'front_desk', 'foreman'])) THEN
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
