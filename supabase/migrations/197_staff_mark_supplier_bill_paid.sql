-- 197: an ops manager (or finance) can mark a supplier bill as paid once a payment slip has been uploaded on it.
-- Recording a supplier payment by hand stays a money power; this is the one narrow exception: the full remaining balance, only when a
-- slip exists, one step, logged with who did it. The owner reviews these in the audit log and the Integrity Report.
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
  UPDATE supplier_invoices SET amount_paid = total_amount, status = 'paid', updated_at = now() WHERE id = si.id;
  PERFORM insert_audit_log('supplier_bill_marked_paid', 'supplier_invoices', si.id, 'supplier_invoice',
    jsonb_build_object('invoice_number', si.invoice_number, 'amount', bal, 'method', p_method, 'slips', slips, 'role', get_my_role()),
    si.branch_id, auth.uid(), si.tenant_id);
  RETURN jsonb_build_object('ok', true, 'amount', bal);
END $$;
REVOKE ALL ON FUNCTION mark_supplier_bill_paid(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_supplier_bill_paid(uuid, text, date, text) TO authenticated;
