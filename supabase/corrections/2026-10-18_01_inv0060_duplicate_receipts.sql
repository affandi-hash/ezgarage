-- Correction 1: MVG-INV-2026-0060 (EN BARRI, W783U): void two receipts that are not real payments.
--
-- The invoice is correct (RM8,380 total, RM8,380 paid). Its receipts add up to RM10,380 because of
--   * dac57d55: the same RM1,000 QR payment entered twice 30 seconds apart (identical proof file, same checksum), and
--   * 4bbffffa: an RM1,000 "online" entry on 13 Aug with no proof and no gateway reference.
-- The real payments are the RM1,000 QR deposit (8a36e784) and the RM7,380 RaudhahPay payment (25c9ceac).
--
-- This voids the two extra receipts WITHOUT touching the invoice (the normal Void button would also
-- subtract RM2,000 from the invoice and reopen it). Nothing is deleted; both receipts stay visible as voided.
-- Run with:  supabase db query --linked -f supabase/corrections/2026-10-18_01_inv0060_duplicate_receipts.sql
-- The script stops and changes nothing if anything is not exactly as expected.
DO $$
DECLARE
  inv_id  constant uuid := 'f1c43758-2eef-40f1-962b-a6c1132b36e5';
  approver constant uuid := '34b8b6ab-4278-4739-99b1-dc555c68624d';   -- Affandi (super admin)
  tenant  uuid; paid numeric; total numeric; st text; n int; active_sum numeric;
BEGIN
  SELECT tenant_id, amount_paid, total_amount, status::text INTO tenant, paid, total, st FROM invoices WHERE id = inv_id AND invoice_number = 'MVG-INV-2026-0060';
  IF NOT FOUND OR paid <> 8380 OR total <> 8380 OR st <> 'paid' THEN RAISE EXCEPTION 'INV-0060 is not in the expected state'; END IF;
  SELECT count(*) INTO n FROM receipts WHERE invoice_id = inv_id AND voided_at IS NULL
     AND id IN ('dac57d55-29fc-4119-85c7-973ec73b6c04', '4bbffffa-9d92-47a7-801b-632857bde34d') AND amount = 1000;
  IF n <> 2 THEN RAISE EXCEPTION 'The two receipts are not both active and RM1,000'; END IF;

  UPDATE receipts SET voided_at = now(), voided_by = approver,
         void_reason = 'Duplicate entry: same QR payment and same proof file recorded twice. Corrected 18 Oct 2026, approved by Affandi.'
   WHERE id = 'dac57d55-29fc-4119-85c7-973ec73b6c04';
  UPDATE receipts SET voided_at = now(), voided_by = approver,
         void_reason = 'No proof and no gateway record. The RM7,380 online payment of 13 Aug covers the balance. Corrected 18 Oct 2026, approved by Affandi.'
   WHERE id = '4bbffffa-9d92-47a7-801b-632857bde34d';

  PERFORM insert_audit_log('receipt_correction', 'receipts', 'dac57d55-29fc-4119-85c7-973ec73b6c04', 'receipt',
    jsonb_build_object('invoice', 'MVG-INV-2026-0060', 'amount', 1000, 'reason', 'duplicate entry, same proof file', 'invoice_unchanged', true), NULL, approver, tenant);
  PERFORM insert_audit_log('receipt_correction', 'receipts', '4bbffffa-9d92-47a7-801b-632857bde34d', 'receipt',
    jsonb_build_object('invoice', 'MVG-INV-2026-0060', 'amount', 1000, 'reason', 'no proof, no gateway record', 'invoice_unchanged', true), NULL, approver, tenant);

  SELECT coalesce(sum(amount), 0) INTO active_sum FROM receipts WHERE invoice_id = inv_id AND voided_at IS NULL;
  IF active_sum <> 8380 THEN RAISE EXCEPTION 'Receipts would add up to %, not 8380. Nothing changed.', active_sum; END IF;
END $$;
