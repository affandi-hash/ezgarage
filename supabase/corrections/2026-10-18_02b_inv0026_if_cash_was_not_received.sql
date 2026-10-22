-- Correction 2B: MVG-INV-2026-0026 (Dre Coffee Sdn Bhd, VH9448): use this ONLY if the RM1,181 cash on 8 Jul was NOT received.
--
-- The 8 Jul cash receipt (bc45efc6) was recorded in error. The invoice already shows the true position
-- (RM331 paid by two bank transfers, RM850 still due), so the invoice is NOT changed. Only the wrong receipt is voided.
-- Nothing is deleted; the receipt stays visible as voided.
-- Run with:  supabase db query --linked -f supabase/corrections/2026-10-18_02b_inv0026_if_cash_was_not_received.sql
DO $$
DECLARE
  inv_id  constant uuid := '1b4a387e-7aff-46ee-98d0-6c74e00f4de3';
  approver constant uuid := '34b8b6ab-4278-4739-99b1-dc555c68624d';
  tenant uuid; branch uuid; paid numeric; total numeric; st text; n int; rs numeric;
BEGIN
  SELECT tenant_id, branch_id, amount_paid, total_amount, status::text INTO tenant, branch, paid, total, st FROM invoices WHERE id = inv_id AND invoice_number = 'MVG-INV-2026-0026';
  IF NOT FOUND OR paid <> 331 OR total <> 1181 OR st <> 'sent' THEN RAISE EXCEPTION 'INV-0026 is not in the expected state'; END IF;
  SELECT count(*) INTO n FROM receipts WHERE id = 'bc45efc6-e34a-4df7-b7f5-a57f195c0c50' AND invoice_id = inv_id AND voided_at IS NULL AND amount = 1181;
  IF n <> 1 THEN RAISE EXCEPTION 'The RM1,181 cash receipt is not active'; END IF;

  UPDATE receipts SET voided_at = now(), voided_by = approver,
         void_reason = 'Recorded in error: the RM1,181 cash was not received. Corrected 18 Oct 2026, approved by Affandi.'
   WHERE id = 'bc45efc6-e34a-4df7-b7f5-a57f195c0c50';
  PERFORM insert_audit_log('receipt_correction', 'receipts', 'bc45efc6-e34a-4df7-b7f5-a57f195c0c50', 'receipt',
    jsonb_build_object('invoice', 'MVG-INV-2026-0026', 'amount', 1181, 'reason', 'cash not received', 'invoice_unchanged', true), branch, approver, tenant);

  SELECT coalesce(sum(amount), 0) INTO rs FROM receipts WHERE invoice_id = inv_id AND voided_at IS NULL;
  IF rs <> 331 THEN RAISE EXCEPTION 'Receipts would add up to %, not 331. Nothing changed.', rs; END IF;
END $$;
