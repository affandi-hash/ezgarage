-- Correction 2A: MVG-INV-2026-0026 (Dre Coffee Sdn Bhd, VH9448): use this ONLY if Dre Coffee really paid RM1,181 cash on 8 Jul.
--
-- The 8 Jul cash receipt (bc45efc6) never reached the invoice balance, so the invoice still shows RM331 paid and RM850 due.
-- If the cash was received the invoice is fully paid, and the two bank transfers (RM181 on 14 Aug, RM150 on 26 Aug = RM331)
-- are an overpayment that must be refunded or moved to another invoice.
--
-- This marks the invoice paid (RM1,181) and leaves all three receipts active, so the RM331 stays visible.
-- The Integrity Report will keep listing this invoice ("receipts add up to more than the total") until the refund
-- or transfer is recorded. That is intended.
-- Run with:  supabase db query --linked -f supabase/corrections/2026-10-18_02a_inv0026_if_cash_was_received.sql
DO $$
DECLARE
  inv_id  constant uuid := '1b4a387e-7aff-46ee-98d0-6c74e00f4de3';
  approver constant uuid := '34b8b6ab-4278-4739-99b1-dc555c68624d';
  tenant uuid; branch uuid; paid numeric; total numeric; st text; rs numeric;
BEGIN
  SELECT tenant_id, branch_id, amount_paid, total_amount, status::text INTO tenant, branch, paid, total, st FROM invoices WHERE id = inv_id AND invoice_number = 'MVG-INV-2026-0026';
  IF NOT FOUND OR paid <> 331 OR total <> 1181 OR st <> 'sent' THEN RAISE EXCEPTION 'INV-0026 is not in the expected state'; END IF;
  SELECT coalesce(sum(amount), 0) INTO rs FROM receipts WHERE invoice_id = inv_id AND voided_at IS NULL;
  IF rs <> 1512 THEN RAISE EXCEPTION 'Receipts add up to %, expected 1512', rs; END IF;

  UPDATE invoices SET amount_paid = 1181, status = 'paid',
         notes = trim(both E'\n' from coalesce(notes, '') || E'\n' || 'Correction 18 Oct 2026: RM1,181 cash received 8 Jul is counted. RM331 bank transfers (14 Aug RM181, 26 Aug RM150) are an overpayment pending refund or credit.')
   WHERE id = inv_id;
  PERFORM insert_audit_log('invoice_correction', 'invoices', inv_id, 'invoice',
    jsonb_build_object('invoice', 'MVG-INV-2026-0026', 'old_amount_paid', 331, 'new_amount_paid', 1181, 'old_status', 'sent', 'new_status', 'paid',
                       'reason', 'cash receipt of 8 Jul confirmed; RM331 overpaid'), branch, approver, tenant);
END $$;
