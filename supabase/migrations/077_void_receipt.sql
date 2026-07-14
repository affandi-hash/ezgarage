-- 077: Let staff correct a mistaken payment record without silently
-- overwriting it — void the original (kept, not deleted) and re-record via
-- the existing "Record Payment" flow, so the full history stays visible.
--
-- Triggered by a real incident: a payment was confirmed without proof of
-- payment attached, and there was no way to retroactively add proof or
-- correct it — receipts_rw's RLS policy is USING(true)/WITH CHECK(true)
-- for any authenticated user, so gating this in the UI alone wouldn't
-- actually enforce anything; a non-permitted user could still call the
-- table directly. Enforcing the role check inside a SECURITY DEFINER RPC
-- instead.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS void_reason text;

CREATE OR REPLACE FUNCTION void_receipt(p_receipt_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_invoice RECORD;
  v_new_paid NUMERIC;
  v_new_status TEXT;
BEGIN
  IF get_my_role() NOT IN ('super_admin', 'ops_manager', 'foreman') THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT id, invoice_id, amount, payment_method, payment_date, voided_at
    INTO v_receipt
    FROM receipts
   WHERE id = p_receipt_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'receipt_not_found');
  END IF;
  IF v_receipt.voided_at IS NOT NULL THEN
    RETURN json_build_object('error', 'already_voided');
  END IF;

  SELECT id, amount_paid, total_amount INTO v_invoice FROM invoices WHERE id = v_receipt.invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invoice_not_found');
  END IF;

  v_new_paid := GREATEST(0, v_invoice.amount_paid - v_receipt.amount);
  v_new_status := CASE WHEN v_new_paid >= v_invoice.total_amount THEN 'paid' ELSE 'sent' END;

  UPDATE invoices SET amount_paid = v_new_paid, status = v_new_status::invoice_status WHERE id = v_invoice.id;

  UPDATE receipts
     SET voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   WHERE id = p_receipt_id;

  PERFORM insert_audit_log(
    'void', 'receipts', p_receipt_id, 'receipt',
    jsonb_build_object(
      'invoice_id', v_receipt.invoice_id,
      'amount', v_receipt.amount,
      'payment_method', v_receipt.payment_method,
      'payment_date', v_receipt.payment_date,
      'reason', p_reason
    ),
    NULL, auth.uid(), get_my_tenant()
  );

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION void_receipt(UUID, TEXT) TO authenticated;
