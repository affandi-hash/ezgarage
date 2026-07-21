-- 092: Record Payment was two separate client-side calls — INSERT into
-- receipts, then UPDATE invoices — with no atomicity and no way to detect
-- a silently-affected-0-rows UPDATE (RLS filters rows out without raising
-- an error, so a tenant/branch mismatch just no-ops instead of failing
-- loudly). A real tenant hit exactly this: 6 receipts got inserted for one
-- invoice across repeated "Confirm Payment" attempts, but the invoice's
-- amount_paid never advanced past 0 — so it never showed Paid, and the
-- printed receipt (which reads amount_paid straight off the invoice row)
-- would have shown RM0.00 Payment Received.
--
-- Fix: move the whole receipt-insert + invoice-update into one
-- SECURITY DEFINER RPC, following the same pattern as void_receipt (077) —
-- tenant/branch/role checked explicitly server-side, single transaction,
-- explicit JSON success/error so failures can never go silent again.

CREATE OR REPLACE FUNCTION record_payment(
  p_invoice_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_payment_date DATE,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_receipt_id UUID;
  v_new_paid NUMERIC;
  v_new_status TEXT;
BEGIN
  IF NOT is_active_user() THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT id, tenant_id, branch_id, amount_paid, total_amount
    INTO v_invoice
    FROM invoices
   WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invoice_not_found');
  END IF;

  -- Same reach as invoices_update's RLS policy — enforced here explicitly
  -- so a mismatch fails loudly instead of silently affecting 0 rows.
  IF v_invoice.tenant_id != get_my_tenant() AND get_my_role() != 'super_admin' THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']) OR v_invoice.branch_id = get_my_branch()) THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN json_build_object('error', 'invalid_amount');
  END IF;
  IF p_amount > (v_invoice.total_amount - v_invoice.amount_paid) + 0.001 THEN
    RETURN json_build_object('error', 'amount_exceeds_balance');
  END IF;

  INSERT INTO receipts (tenant_id, branch_id, invoice_id, amount, payment_method, payment_date, reference_number, created_by)
  VALUES (v_invoice.tenant_id, v_invoice.branch_id, p_invoice_id, p_amount, p_payment_method, p_payment_date, p_reference, auth.uid())
  RETURNING id INTO v_receipt_id;

  v_new_paid := v_invoice.amount_paid + p_amount;
  v_new_status := CASE WHEN v_new_paid >= v_invoice.total_amount THEN 'paid' ELSE 'sent' END;

  UPDATE invoices SET
    amount_paid = v_new_paid,
    payment_method = p_payment_method::payment_method,
    payment_date = p_payment_date,
    payment_reference = p_reference,
    status = v_new_status::invoice_status,
    updated_at = now()
  WHERE id = p_invoice_id;

  PERFORM insert_audit_log(
    'payment', 'invoices', p_invoice_id, 'invoice',
    jsonb_build_object('receipt_id', v_receipt_id, 'amount', p_amount, 'payment_method', p_payment_method, 'new_status', v_new_status),
    v_invoice.branch_id, auth.uid(), get_my_tenant()
  );

  RETURN json_build_object('success', true, 'receipt_id', v_receipt_id, 'new_status', v_new_status, 'new_amount_paid', v_new_paid);
END;
$$;

GRANT EXECUTE ON FUNCTION record_payment(UUID, NUMERIC, TEXT, DATE, TEXT) TO authenticated;
