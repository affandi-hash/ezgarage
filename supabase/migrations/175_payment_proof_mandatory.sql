-- 175: proof of payment is required for cash and transfer-type payments.
--
-- A payment made by cash, bank transfer, QR, DuitNow/online transfer, cheque or "other" can no longer be recorded
-- without a proof file (photo or PDF). Card and the payment-gateway methods are left out because they have their own record.
-- The rule is enforced here, in the database, so no screen can skip it.
--
-- How the file gets there: the screen uploads it to payment-proofs/<invoice id>/<file> first, then calls record_payment
-- with that path. record_payment checks the file really exists and attaches it to the new receipt in the same step.
-- (Later replacement of a proof still goes through set_receipt_proof and the receipt's own folder.)

-- the storage rule: a file may sit in a receipt's folder OR an invoice's folder, within the user's own company
CREATE OR REPLACE FUNCTION storage_payment_proofs_tenant_ok(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE folder uuid := (split_part(p_name, '/', 1))::uuid;
BEGIN
  RETURN EXISTS (SELECT 1 FROM receipts r WHERE r.id = folder AND r.tenant_id = get_my_tenant())
      OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = folder AND i.tenant_id = get_my_tenant());
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- the core: everything record_payment did before, plus the proof. Not callable from the app directly.
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

  IF p_require_proof AND NOT v_has_proof
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

-- the function the screens call: same name, one new optional argument
DROP FUNCTION IF EXISTS record_payment(uuid, numeric, text, date, text);
CREATE OR REPLACE FUNCTION record_payment(
  p_invoice_id uuid, p_amount numeric, p_payment_method text, p_payment_date date, p_reference text DEFAULT NULL, p_proof_path text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN record_payment_core(p_invoice_id, p_amount, p_payment_method, p_payment_date, p_reference, p_proof_path, 'payment-proofs', true);
END $$;
REVOKE ALL ON FUNCTION record_payment(uuid, numeric, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_payment(uuid, numeric, text, date, text, text) TO authenticated;

-- approving a customer's proof submission: the customer's own upload is the proof
CREATE OR REPLACE FUNCTION approve_payment_proof_submission(
  p_submission_id uuid, p_amount numeric, p_payment_method text, p_payment_date date, p_reference text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_submission RECORD; v_result json;
BEGIN
  IF NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_submission FROM payment_proof_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'submission_not_found'); END IF;
  IF v_submission.tenant_id != get_my_tenant() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF v_submission.status != 'pending' THEN RETURN json_build_object('error', 'already_reviewed'); END IF;

  v_result := record_payment_core(v_submission.invoice_id, p_amount, p_payment_method, p_payment_date, p_reference,
                                  v_submission.storage_path, 'portal-uploads', true);
  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;

  UPDATE payment_proof_submissions SET status = 'approved', receipt_id = (v_result->>'receipt_id')::uuid, reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = p_submission_id;
  RETURN v_result;
END $$;
