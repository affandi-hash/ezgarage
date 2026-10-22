-- Correction 3: MVG-INV-2026-0060: make the RM1,000 deposit receipt (8a36e784) self-explanatory.
--
-- Its proof (a CIMB OCTO slip, 19 Jul 2026 09:13:29, reference 269867980) shows a bank transfer, but the receipt says "QR"
-- and carries no reference or note. This sets the method to bank transfer, records the bank reference and adds a note.
-- The amount, date, proof and the invoice are not changed. Nothing is voided or deleted.
-- Run with:  supabase db query --linked -f supabase/corrections/2026-10-18_03_inv0060_deposit_receipt_details.sql
DO $$
DECLARE
  rid constant uuid := '8a36e784-07c1-401c-a516-30838be7f3e3';
  approver constant uuid := '34b8b6ab-4278-4739-99b1-dc555c68624d';   -- Affandi (super admin)
  r receipts; branch uuid;
BEGIN
  SELECT * INTO r FROM receipts WHERE id = rid;
  IF NOT FOUND OR r.voided_at IS NOT NULL OR r.amount <> 1000 OR r.payment_method::text <> 'qr' OR r.proof_url IS NULL
     OR r.invoice_id <> 'f1c43758-2eef-40f1-962b-a6c1132b36e5' THEN
    RAISE EXCEPTION 'The deposit receipt is not in the expected state';
  END IF;

  UPDATE receipts SET payment_method = 'bank_transfer', reference_number = '269867980',
         notes = 'Deposit paid at pickup on 19 Jul 2026 because the card terminal was unavailable (per Zack). CIMB transfer ref 269867980. Balance RM7,380 paid via RaudhahPay on 13 Aug. Details corrected 18 Oct 2026, approved by Affandi.'
   WHERE id = rid;

  SELECT branch_id INTO branch FROM invoices WHERE id = r.invoice_id;
  PERFORM insert_audit_log('receipt_correction', 'receipts', rid, 'receipt',
    jsonb_build_object('invoice', 'MVG-INV-2026-0060', 'old_method', 'qr', 'new_method', 'bank_transfer', 'reference', '269867980', 'amount_unchanged', 1000),
    branch, approver, r.tenant_id);
END $$;
