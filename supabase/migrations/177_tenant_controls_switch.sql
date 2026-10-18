-- 177: a per-company switch for the stricter rules, switched OFF for MAC Service.
--
-- Migrations 170 to 176 added rules for every company: deleting needs a super admin's approval, invoices/receipts/supplier bills
-- cannot be deleted, proof is required for cash and transfers, supplier bills need a branch, and several tables were limited to
-- the roles that use them. MAC Service has no super admin to approve deletions, so for MAC those rules are switched off and the
-- earlier behaviour is restored. Their data is not changed. Deletions are still written to the log (kind "direct").
--
-- tenants.tight_controls = true (the default) keeps the rules on, as for Motoverse Garage and any new company.
-- Only a platform admin (or SQL) can change the switch; a company's own admins cannot turn the rules off for themselves.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tight_controls boolean NOT NULL DEFAULT true;
UPDATE tenants SET tight_controls = false WHERE id = '634878d7-2734-4f16-ab2e-30a8f3dda95a';   -- MAC SERVICE SDN BHD

CREATE OR REPLACE FUNCTION tenants_controls_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.tight_controls IS DISTINCT FROM OLD.tight_controls AND current_user IN ('authenticated', 'anon')
     AND NOT coalesce((SELECT is_platform_admin FROM users WHERE id = auth.uid()), false) THEN
    RAISE EXCEPTION 'Only the platform administrator can change this setting.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenants_controls_guard ON tenants;
CREATE TRIGGER tenants_controls_guard BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_controls_guard();

CREATE OR REPLACE FUNCTION controls_on(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT tight_controls FROM tenants WHERE id = p_tenant), true)
$$;
GRANT EXECUTE ON FUNCTION controls_on(uuid) TO authenticated;

-- the guards respect the switch
CREATE OR REPLACE FUNCTION guard_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tier text := TG_ARGV[0]; snap jsonb := to_jsonb(OLD);
BEGIN
  -- a company with the new rules switched off keeps the earlier behaviour (RLS decides); deletions are still logged
  IF current_user IN ('authenticated', 'anon') AND NOT controls_on(nullif(snap->>'tenant_id', '')::uuid) THEN
    PERFORM log_deletion(TG_TABLE_NAME, snap, 'direct'); RETURN OLD;
  END IF;
  IF current_user NOT IN ('authenticated', 'anon') THEN
    -- functions, cron and the service role: allowed, always recorded ('approved' when a super admin released it)
    PERFORM log_deletion(TG_TABLE_NAME, snap, CASE WHEN nullif(current_setting('app.delete_request', true), '') IS NOT NULL THEN 'approved' ELSE 'system' END);
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'jobs' AND EXISTS (SELECT 1 FROM invoices WHERE job_id = OLD.id AND status <> 'void') THEN
    RAISE EXCEPTION 'This job has an invoice. Void the invoice first.' USING ERRCODE = '42501';
  END IF;
  IF tier = 'never' THEN
    RAISE EXCEPTION 'This record cannot be deleted. Void it instead.' USING ERRCODE = '42501';
  END IF;
  IF get_my_role() = 'super_admin' THEN
    PERFORM log_deletion(TG_TABLE_NAME, snap, 'super_admin'); RETURN OLD;
  END IF;
  IF tier = 'logged' THEN
    PERFORM log_deletion(TG_TABLE_NAME, snap, 'direct'); RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Deleting this needs super admin approval. Use Request deletion.' USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION guard_receipt_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND controls_on(NEW.tenant_id) AND NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) THEN
    IF (NEW.amount, NEW.invoice_id, NEW.payment_method, NEW.payment_date, NEW.gateway_ref, NEW.voided_at, NEW.tenant_id, NEW.branch_id)
       IS DISTINCT FROM (OLD.amount, OLD.invoice_id, OLD.payment_method, OLD.payment_date, OLD.gateway_ref, OLD.voided_at, OLD.tenant_id, OLD.branch_id) THEN
      RAISE EXCEPTION 'A recorded payment cannot be edited. Void it and record it again.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_invoice_money() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND controls_on(NEW.tenant_id) AND NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) THEN
    IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
      RAISE EXCEPTION 'Payments are recorded with Record Payment, not by editing the invoice.' USING ERRCODE = '42501';
    END IF;
    -- staff may issue a draft and move between sent/overdue; voiding goes through void_invoice, payment through record_payment
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'draft' AND NEW.status = 'sent')
       AND NOT (OLD.status IN ('sent', 'overdue') AND NEW.status IN ('sent', 'overdue')) THEN
      RAISE EXCEPTION 'This status change is not allowed here. Use Void Invoice or Record Payment.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.subtotal, NEW.discount_pct, NEW.discount_amount, NEW.tax_pct, NEW.tax_amount, NEW.total_amount, NEW.line_items)
       IS DISTINCT FROM (OLD.subtotal, OLD.discount_pct, OLD.discount_amount, OLD.tax_pct, OLD.tax_amount, OLD.total_amount, OLD.line_items) THEN
      RAISE EXCEPTION 'An issued invoice cannot be edited. Ask an operations manager.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION supplier_invoice_branch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS NULL AND controls_on(NEW.tenant_id) THEN
    NEW.branch_id := get_my_branch();
    IF NEW.branch_id IS NULL AND current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Choose a branch for this supplier bill.' USING ERRCODE = '23502';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION record_payment_core(
  p_invoice_id uuid, p_amount numeric, p_payment_method text, p_payment_date date, p_reference text,
  p_proof_path text, p_proof_bucket text, p_require_proof boolean
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice RECORD; v_receipt_id uuid; v_new_paid numeric; v_new_status text;
  v_has_proof boolean := coalesce(trim(p_proof_path), '') <> '';
BEGIN
  IF NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;

  SELECT id, tenant_id, branch_id, amount_paid, total_amount INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'invoice_not_found'); END IF;

  IF v_invoice.tenant_id != get_my_tenant() AND get_my_role() != 'super_admin' THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']) OR v_invoice.branch_id = get_my_branch()) THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN json_build_object('error', 'invalid_amount'); END IF;
  IF p_amount > (v_invoice.total_amount - v_invoice.amount_paid) + 0.001 THEN RETURN json_build_object('error', 'amount_exceeds_balance'); END IF;

  IF p_require_proof AND controls_on(v_invoice.tenant_id) AND NOT v_has_proof
     AND p_payment_method IN ('cash', 'bank_transfer', 'online_transfer', 'qr', 'duitnow', 'cheque', 'other') THEN
    RETURN json_build_object('error', 'proof_required');
  END IF;
  IF v_has_proof THEN
    IF p_proof_bucket = 'payment-proofs' AND left(p_proof_path, length(p_invoice_id::text) + 1) <> p_invoice_id::text || '/' THEN
      RETURN json_build_object('error', 'bad_proof');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = p_proof_bucket AND o.name = p_proof_path) THEN
      RETURN json_build_object('error', 'bad_proof');
    END IF;
  END IF;

  INSERT INTO receipts (tenant_id, branch_id, invoice_id, amount, payment_method, payment_date, reference_number, created_by,
                        proof_url, proof_bucket, proof_updated_at, proof_updated_by)
  VALUES (v_invoice.tenant_id, v_invoice.branch_id, p_invoice_id, p_amount, p_payment_method, p_payment_date, p_reference, auth.uid(),
          CASE WHEN v_has_proof THEN p_proof_path END, CASE WHEN v_has_proof THEN p_proof_bucket ELSE 'payment-proofs' END,
          CASE WHEN v_has_proof THEN now() END, CASE WHEN v_has_proof THEN auth.uid() END)
  RETURNING id INTO v_receipt_id;

  v_new_paid := v_invoice.amount_paid + p_amount;
  v_new_status := CASE WHEN v_new_paid >= v_invoice.total_amount THEN 'paid' ELSE 'sent' END;

  UPDATE invoices SET amount_paid = v_new_paid, payment_method = p_payment_method::payment_method, payment_date = p_payment_date,
         payment_reference = p_reference, status = v_new_status::invoice_status, updated_at = now()
   WHERE id = p_invoice_id;

  PERFORM insert_audit_log('payment', 'invoices', p_invoice_id, 'invoice',
    jsonb_build_object('receipt_id', v_receipt_id, 'amount', p_amount, 'payment_method', p_payment_method, 'new_status', v_new_status, 'proof', v_has_proof),
    v_invoice.branch_id, auth.uid(), get_my_tenant());

  RETURN json_build_object('success', true, 'receipt_id', v_receipt_id, 'new_status', v_new_status, 'new_amount_paid', v_new_paid);
END $$;
REVOKE ALL ON FUNCTION record_payment_core(uuid, numeric, text, date, text, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- the earlier table access, restored for companies with the rules off (policies add up, so this changes nothing where the rules are on)
DROP POLICY IF EXISTS legacy_suppliers_all ON suppliers;
CREATE POLICY legacy_suppliers_all ON suppliers FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_supplier_invoices_all ON supplier_invoices;
CREATE POLICY legacy_supplier_invoices_all ON supplier_invoices FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_supplier_payments_all ON supplier_payments;
CREATE POLICY legacy_supplier_payments_all ON supplier_payments FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_receipts_all ON receipts;
CREATE POLICY legacy_receipts_all ON receipts FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_quotations_all ON quotations;
CREATE POLICY legacy_quotations_all ON quotations FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_parts_catalogue_all ON parts_catalogue;
CREATE POLICY legacy_parts_catalogue_all ON parts_catalogue FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_labour_charges_all ON labour_charges;
CREATE POLICY legacy_labour_charges_all ON labour_charges FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_stock_movements_all ON stock_movements;
CREATE POLICY legacy_stock_movements_all ON stock_movements FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_invoice_payment_failures_all ON invoice_payment_failures;
CREATE POLICY legacy_invoice_payment_failures_all ON invoice_payment_failures FOR ALL TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_quotation_items_all ON quotation_items;
CREATE POLICY legacy_quotation_items_all ON quotation_items FOR ALL TO authenticated
  USING (is_active_user() AND quotation_id IN (SELECT id FROM quotations WHERE tenant_id = get_my_tenant()) AND NOT (SELECT controls_on(get_my_tenant())))
  WITH CHECK (quotation_id IN (SELECT id FROM quotations WHERE tenant_id = get_my_tenant()) AND NOT (SELECT controls_on(get_my_tenant())));
DROP POLICY IF EXISTS legacy_invoices_delete ON invoices;
CREATE POLICY legacy_invoices_delete ON invoices FOR DELETE TO authenticated
  USING (is_active_user() AND get_my_role() IN ('super_admin', 'ops_manager') AND tenant_id = get_my_tenant() AND NOT (SELECT controls_on(get_my_tenant())));
