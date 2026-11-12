-- 198: closes the supplier-bill status gap. Staff could change a bill's status or amount paid directly through the system's data
-- connection (the app's screens did not offer it). Now, for a company with the stricter rules on, only the Branch Admin / super admin
-- can change amount_paid or move a bill into or out of paid / part-paid, or create a bill that is already paid. The approved routes keep
-- working: mark_supplier_bill_paid (needs a payment slip), the owner's bank-feed matching, and the automatic bank feed.
CREATE OR REPLACE FUNCTION supplier_bill_money_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT controls_on(NEW.tenant_id) OR coalesce(current_setting('app.bill_paid_rpc', true), '') = '1' THEN RETURN NEW; END IF;
  IF money_check(NEW.tenant_id, ARRAY['super_admin']) IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('paid', 'partial') OR coalesce(NEW.amount_paid, 0) <> 0 THEN
      RAISE EXCEPTION 'A new bill cannot be created as already paid. Add a payment slip and mark it paid.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
       OR (NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IN ('paid', 'partial') OR OLD.status IN ('paid', 'partial'))) THEN
      RAISE EXCEPTION 'Only the Branch Admin can change what has been paid on a bill. Add a payment slip and use Mark as paid.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_bill_money_guard ON supplier_invoices;
CREATE TRIGGER supplier_bill_money_guard BEFORE INSERT OR UPDATE ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION supplier_bill_money_guard();

-- the approved route sets a transaction-local flag around its own update
CREATE OR REPLACE FUNCTION mark_supplier_bill_paid(p_invoice uuid, p_method text DEFAULT 'transfer', p_date date DEFAULT NULL, p_reference text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE si supplier_invoices; slips int; bal numeric;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  IF p_method NOT IN ('cash', 'transfer', 'cheque') THEN RETURN jsonb_build_object('error', 'bad_method'); END IF;
  SELECT * INTO si FROM supplier_invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR si.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF si.status IN ('paid', 'voided') THEN RETURN jsonb_build_object('error', 'not_available'); END IF;
  bal := si.total_amount - coalesce(si.amount_paid, 0);
  IF bal <= 0 THEN RETURN jsonb_build_object('error', 'not_available'); END IF;
  SELECT count(*) INTO slips FROM supplier_invoice_slips WHERE supplier_invoice_id = si.id;
  IF slips = 0 THEN RETURN jsonb_build_object('error', 'slip_required'); END IF;
  INSERT INTO supplier_payments (tenant_id, supplier_invoice_id, payment_date, amount, payment_method, reference, notes, created_by)
  VALUES (si.tenant_id, si.id, coalesce(p_date, current_date), bal, p_method, nullif(trim(coalesce(p_reference, '')), ''),
          'Marked paid with payment slip (' || slips || ')', auth.uid());
  PERFORM set_config('app.bill_paid_rpc', '1', true);
  UPDATE supplier_invoices SET amount_paid = total_amount, status = 'paid', updated_at = now() WHERE id = si.id;
  PERFORM set_config('app.bill_paid_rpc', '', true);
  PERFORM insert_audit_log('supplier_bill_marked_paid', 'supplier_invoices', si.id, 'supplier_invoice',
    jsonb_build_object('invoice_number', si.invoice_number, 'amount', bal, 'method', p_method, 'slips', slips, 'role', get_my_role()),
    si.branch_id, auth.uid(), si.tenant_id);
  RETURN jsonb_build_object('ok', true, 'amount', bal);
END $$;

-- the owner's bank-feed matching
CREATE OR REPLACE FUNCTION public.ezacc_resolve(p_payment uuid, p_idx integer, p_action text, p_invoice uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rec ezacc_payments; al ezacc_allocations; sp supplier_payments; inv supplier_invoices;
BEGIN
  IF NOT is_active_user() OR NOT is_owner_login() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  PERFORM set_config('app.bill_paid_rpc', '1', true);   -- the owner's own bank-feed matching may change bill amounts
  SELECT * INTO rec FROM ezacc_payments WHERE ezacc_id = p_payment;
  IF NOT FOUND OR rec.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO al FROM ezacc_allocations WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF p_action = 'ignore' THEN
    UPDATE ezacc_allocations SET user_ignored = true, forced_invoice_id = NULL WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'unignore' THEN
    UPDATE ezacc_allocations SET user_ignored = false WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'match' THEN
    IF NOT EXISTS (SELECT 1 FROM supplier_invoices WHERE id = p_invoice AND tenant_id = rec.tenant_id AND voided_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'invoice_not_found');
    END IF;
    UPDATE ezacc_allocations SET forced_invoice_id = p_invoice, user_ignored = false WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'keep' THEN
    IF al.state <> 'void_review' THEN RETURN jsonb_build_object('error', 'not_in_review'); END IF;
    UPDATE ezacc_allocations SET state = 'ignored', note = 'kept in ezWF after the ezAcc payment was cancelled' WHERE ezacc_payment_id = p_payment AND idx = p_idx;
    RETURN jsonb_build_object('ok', true);
  ELSIF p_action = 'remove_manual' THEN
    IF NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
    IF al.state <> 'void_review' OR al.manual_payment_id IS NULL THEN RETURN jsonb_build_object('error', 'not_in_review'); END IF;
    SELECT * INTO sp FROM supplier_payments WHERE id = al.manual_payment_id AND tenant_id = rec.tenant_id AND ezacc_payment_id IS NULL;
    IF FOUND THEN
      SELECT * INTO inv FROM supplier_invoices WHERE id = sp.supplier_invoice_id FOR UPDATE;
      DELETE FROM supplier_payments WHERE id = sp.id;
      UPDATE supplier_invoices SET amount_paid = greatest(0, amount_paid - sp.amount),
             status = CASE WHEN voided_at IS NOT NULL THEN status ELSE ezacc_inv_status(total_amount, greatest(0, amount_paid - sp.amount), due_date) END,
             updated_at = now() WHERE id = inv.id;
    END IF;
    UPDATE ezacc_allocations SET state = 'ignored', note = 'hand-keyed payment removed after the ezAcc payment was cancelled' WHERE ezacc_payment_id = p_payment AND idx = p_idx;
    RETURN jsonb_build_object('ok', true);
  ELSE
    RETURN jsonb_build_object('error', 'bad_action');
  END IF;
  PERFORM ezacc_process(p_payment);
  RETURN jsonb_build_object('ok', true);
END $function$;
