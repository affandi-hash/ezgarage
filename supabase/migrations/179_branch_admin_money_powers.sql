-- 179: the money powers belong to the Branch Admin, plus device and IP on every audit entry.
--
-- Money powers (for companies with the stricter rules on): voiding a payment, voiding an invoice that has payments,
-- changing an issued invoice, adding or replacing proof on a payment, recording a supplier payment by hand.
-- Allowed only for a super admin or a person with the Branch Admin switch. A company with the rules off (MAC) keeps its
-- earlier role checks.
--
-- tenants.require_mfa (default false) adds the second step: when switched on, these powers (and approving a deletion)
-- also need a session that has passed the authenticator-app code (JWT aal2). It starts off so nobody is locked out
-- while the code is being set up; turn it on once the Branch Admin and the super admin have both enrolled.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION tenants_controls_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.tight_controls IS DISTINCT FROM OLD.tight_controls OR NEW.require_mfa IS DISTINCT FROM OLD.require_mfa)
     AND current_user IN ('authenticated', 'anon')
     AND NOT coalesce((SELECT is_platform_admin FROM users WHERE id = auth.uid()), false) THEN
    RAISE EXCEPTION 'Only the platform administrator can change this setting.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- where the call came from (as the platform forwards it)
CREATE OR REPLACE FUNCTION request_meta() RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE h jsonb;
BEGIN
  BEGIN h := nullif(current_setting('request.headers', true), '')::jsonb; EXCEPTION WHEN OTHERS THEN h := NULL; END;
  IF h IS NULL THEN RETURN '{}'::jsonb; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'ip', nullif(trim(split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', h->>'x-real-ip', ''), ',', 1)), ''),
    'device', nullif(left(h->>'user-agent', 160), '')));
END $$;

-- the assurance level of the caller's session: aal1 = password only, aal2 = password plus authenticator code
CREATE OR REPLACE FUNCTION caller_aal() RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb;
BEGIN
  BEGIN c := nullif(current_setting('request.jwt.claims', true), '')::jsonb; EXCEPTION WHEN OTHERS THEN c := NULL; END;
  RETURN coalesce(c->>'aal', 'aal1');
END $$;

-- NULL when the caller may use the money powers, otherwise why not
CREATE OR REPLACE FUNCTION money_check(p_tenant uuid, p_legacy text[]) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ba boolean; req boolean;
BEGIN
  IF NOT controls_on(p_tenant) THEN
    RETURN CASE WHEN get_my_role() = ANY (p_legacy) THEN NULL ELSE 'forbidden' END;
  END IF;
  SELECT coalesce(is_branch_admin, false) INTO ba FROM users WHERE id = auth.uid() AND is_active;
  IF NOT (get_my_role() = 'super_admin' OR coalesce(ba, false)) THEN RETURN 'branch_admin_only'; END IF;
  SELECT coalesce(require_mfa, false) INTO req FROM tenants WHERE id = p_tenant;
  IF req AND caller_aal() <> 'aal2' THEN RETURN 'mfa_required'; END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION money_check(uuid, text[]), caller_aal(), request_meta() TO authenticated;

-- every audit entry now also records the IP address and device
CREATE OR REPLACE FUNCTION insert_audit_log(p_action text, p_module text, p_record_id uuid DEFAULT NULL, p_record_type text DEFAULT NULL,
  p_details jsonb DEFAULT NULL, p_branch_id uuid DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_tenant_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m jsonb := request_meta();
BEGIN
  INSERT INTO audit_logs (action, module, record_id, record_type, details, branch_id, user_id, tenant_id, ip_address)
  VALUES (p_action, p_module, p_record_id, p_record_type,
          CASE WHEN m = '{}'::jsonb THEN p_details ELSE coalesce(p_details, '{}'::jsonb) || jsonb_build_object('client', m) END,
          p_branch_id, auth.uid(), get_my_tenant(), m->>'ip');
END $$;

-- 1. void a payment
CREATE OR REPLACE FUNCTION void_receipt(p_receipt_id uuid, p_reason text DEFAULT NULL) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_receipt RECORD; v_invoice RECORD; v_new_paid numeric; v_new_status text; v_my_tenant uuid; mc text;
BEGIN
  v_my_tenant := get_my_tenant();
  IF v_my_tenant IS NULL OR NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  mc := money_check(v_my_tenant, ARRAY['super_admin', 'ops_manager', 'foreman']);
  IF mc IS NOT NULL THEN RETURN json_build_object('error', mc); END IF;

  SELECT id, invoice_id, amount, payment_method, payment_date, voided_at, tenant_id INTO v_receipt FROM receipts WHERE id = p_receipt_id AND tenant_id = v_my_tenant;
  IF NOT FOUND THEN RETURN json_build_object('error', 'receipt_not_found'); END IF;
  IF v_receipt.voided_at IS NOT NULL THEN RETURN json_build_object('error', 'already_voided'); END IF;

  SELECT id, amount_paid, total_amount INTO v_invoice FROM invoices WHERE id = v_receipt.invoice_id AND tenant_id = v_my_tenant;
  IF NOT FOUND THEN RETURN json_build_object('error', 'invoice_not_found'); END IF;

  v_new_paid := GREATEST(0, v_invoice.amount_paid - v_receipt.amount);
  v_new_status := CASE WHEN v_new_paid >= v_invoice.total_amount THEN 'paid' ELSE 'sent' END;
  UPDATE invoices SET amount_paid = v_new_paid, status = v_new_status::invoice_status WHERE id = v_invoice.id;
  UPDATE receipts SET voided_at = now(), voided_by = auth.uid(), void_reason = p_reason WHERE id = p_receipt_id;

  PERFORM insert_audit_log('void', 'receipts', p_receipt_id, 'receipt',
    jsonb_build_object('invoice_id', v_receipt.invoice_id, 'amount', v_receipt.amount, 'payment_method', v_receipt.payment_method, 'payment_date', v_receipt.payment_date, 'reason', p_reason),
    NULL, auth.uid(), v_my_tenant);
  RETURN json_build_object('success', true);
END $$;

-- 2. void an invoice (the has-payments case is a money power)
CREATE OR REPLACE FUNCTION void_invoice(p_invoice uuid, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv invoices; priv boolean; mc text;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO inv FROM invoices WHERE id = p_invoice;
  IF NOT FOUND OR inv.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'invoice_not_found'); END IF;
  mc := money_check(inv.tenant_id, ARRAY['super_admin','ops_manager']);
  priv := mc IS NULL;
  IF NOT (priv OR get_my_role() = 'finance' OR inv.branch_id = get_my_branch()) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  IF inv.status = 'void' THEN RETURN jsonb_build_object('error', 'already_void'); END IF;
  IF inv.status = 'paid' OR (inv.amount_paid > 0 AND NOT priv) THEN
    RETURN jsonb_build_object('error', CASE WHEN mc = 'mfa_required' THEN 'mfa_required' ELSE 'has_payments' END);
  END IF;
  PERFORM set_config('app.void_reason', trim(p_reason), true);
  UPDATE invoices SET status = 'void', updated_at = now() WHERE id = inv.id;
  PERFORM set_config('app.void_reason', '', true);
  PERFORM insert_audit_log('void', 'invoices', inv.id, 'invoice', jsonb_build_object('invoice_number', inv.invoice_number, 'reason', trim(p_reason),
          'total', inv.total_amount, 'amount_paid', inv.amount_paid, 'old_status', inv.status), inv.branch_id, auth.uid(), inv.tenant_id);
  RETURN jsonb_build_object('ok', true);
END $$;

-- 3. proof on a payment
CREATE OR REPLACE FUNCTION set_receipt_proof(p_receipt_id uuid, p_path text, p_reference text DEFAULT NULL) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r receipts; replaced boolean := false; mc text;
BEGIN
  IF NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  SELECT * INTO r FROM receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;
  IF r.tenant_id IS DISTINCT FROM get_my_tenant() AND get_my_role() <> 'super_admin' THEN RETURN json_build_object('error', 'forbidden'); END IF;
  mc := money_check(r.tenant_id, ARRAY['super_admin', 'ops_manager']);
  IF mc IS NOT NULL THEN RETURN json_build_object('error', mc); END IF;
  IF r.voided_at IS NOT NULL THEN RETURN json_build_object('error', 'voided'); END IF;
  IF p_path IS NULL OR left(p_path, length(p_receipt_id::text) + 1) <> p_receipt_id::text || '/' THEN RETURN json_build_object('error', 'bad_path'); END IF;

  IF r.proof_url IS NOT NULL THEN
    INSERT INTO receipt_proof_history (tenant_id, receipt_id, proof_url, proof_bucket, replaced_by) VALUES (r.tenant_id, r.id, r.proof_url, r.proof_bucket, auth.uid());
    replaced := true;
  END IF;
  UPDATE receipts SET proof_url = p_path, proof_bucket = 'payment-proofs', proof_updated_at = now(), proof_updated_by = auth.uid(),
         reference_number = coalesce(nullif(trim(p_reference), ''), reference_number)
   WHERE id = r.id;
  PERFORM insert_audit_log('proof_changed', 'receipts', r.id, 'receipt', jsonb_build_object('invoice_id', r.invoice_id, 'replaced', replaced), NULL, auth.uid(), r.tenant_id);
  RETURN json_build_object('ok', true, 'replaced', replaced);
END $$;

-- 4. changes to an issued invoice or a recorded payment
CREATE OR REPLACE FUNCTION guard_receipt_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND controls_on(NEW.tenant_id) AND money_check(NEW.tenant_id, ARRAY['super_admin','ops_manager']) IS NOT NULL THEN
    IF (NEW.amount, NEW.invoice_id, NEW.payment_method, NEW.payment_date, NEW.gateway_ref, NEW.voided_at, NEW.tenant_id, NEW.branch_id)
       IS DISTINCT FROM (OLD.amount, OLD.invoice_id, OLD.payment_method, OLD.payment_date, OLD.gateway_ref, OLD.voided_at, OLD.tenant_id, OLD.branch_id) THEN
      RAISE EXCEPTION 'A recorded payment cannot be edited. Void it and record it again.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_invoice_money() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND controls_on(NEW.tenant_id) AND money_check(NEW.tenant_id, ARRAY['super_admin','ops_manager']) IS NOT NULL THEN
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
      RAISE EXCEPTION 'Only the Branch Admin can change an issued invoice.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 5. supplier payments by hand
DROP POLICY IF EXISTS supplier_payments_insert ON supplier_payments;
CREATE POLICY supplier_payments_insert ON supplier_payments FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND money_check(tenant_id, ARRAY['super_admin','ops_manager']) IS NULL);
DROP POLICY IF EXISTS supplier_payments_update ON supplier_payments;
CREATE POLICY supplier_payments_update ON supplier_payments FOR UPDATE TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND money_check(tenant_id, ARRAY['super_admin','ops_manager']) IS NULL)
  WITH CHECK (tenant_id = get_my_tenant());

-- a supplier payment recorded by hand now leaves an audit entry too
CREATE OR REPLACE FUNCTION audit_supplier_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM insert_audit_log('supplier_payment', 'supplier_payments', NEW.id, 'supplier_payment',
      jsonb_build_object('supplier_invoice_id', NEW.supplier_invoice_id, 'amount', NEW.amount, 'method', NEW.payment_method, 'date', NEW.payment_date), NULL, auth.uid(), NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_supplier_payment ON supplier_payments;
CREATE TRIGGER audit_supplier_payment AFTER INSERT ON supplier_payments FOR EACH ROW EXECUTE FUNCTION audit_supplier_payment();

-- 6. approving a deletion needs the second step when it is switched on
CREATE OR REPLACE FUNCTION decide_deletion(p_request uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rq deletion_requests; gone boolean;
BEGIN
  IF NOT is_active_user() OR get_my_role() <> 'super_admin' THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF coalesce((SELECT require_mfa FROM tenants WHERE id = get_my_tenant()), false) AND caller_aal() <> 'aal2' THEN RETURN jsonb_build_object('error', 'mfa_required'); END IF;
  SELECT * INTO rq FROM deletion_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR rq.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF rq.status <> 'pending' THEN RETURN jsonb_build_object('error', 'already_decided'); END IF;
  IF NOT p_approve THEN
    UPDATE deletion_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') WHERE id = rq.id;
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;
  IF rq.table_name = 'jobs' AND EXISTS (SELECT 1 FROM invoices WHERE job_id = rq.record_id AND status <> 'void') THEN
    RETURN jsonb_build_object('error', 'has_invoice', 'detail', 'This job has an invoice. Void the invoice first.');
  END IF;
  PERFORM set_config('app.delete_request', rq.id::text, true);
  PERFORM set_config('app.delete_reason', rq.reason, true);
  BEGIN
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', rq.table_name) USING rq.record_id;
    GET DIAGNOSTICS gone = ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    PERFORM set_config('app.delete_request', '', true);
    RETURN jsonb_build_object('error', 'in_use', 'detail', 'Other records still depend on this one, so it cannot be deleted.');
  END;
  PERFORM set_config('app.delete_request', '', true);
  PERFORM set_config('app.delete_reason', '', true);
  IF NOT gone THEN
    UPDATE deletion_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'The record no longer exists' WHERE id = rq.id;
    RETURN jsonb_build_object('error', 'already_gone');
  END IF;
  UPDATE deletion_requests SET status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') WHERE id = rq.id;
  RETURN jsonb_build_object('ok', true, 'status', 'approved');
END $$;
