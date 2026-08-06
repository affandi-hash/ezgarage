-- One-off backfill, not a schema migration. raudhahpay-webhook root cause
-- still unfixed (still need the actual Edge Function error log from the
-- Supabase dashboard -- see prior backfills 2026-08-03). RaudhahPay
-- delivered payment.success (DuitNow, bill 1766289e-9653-4c8d-aa7e-
-- eed5713c9f0f) at 2026-08-06 04:37:38 for invoice MVG-INV-2026-0130
-- (MGC-2026-0001, Cik Siti) but it was never recorded. Replays exactly what
-- the webhook should have done.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('378aea1f-4f13-4748-8af3-5baa3b120ea0'::uuid, '1766289e-9653-4c8d-aa7e-eed5713c9f0f', 30.00::numeric, 'duitnow', '09a48362-6823-40dd-aab9-29d1d0549c2d', '2026-08-06'::date)
    ) AS t(invoice_id, bill_id, amount, payment_method, reference_number, paid_date)
  LOOP
    INSERT INTO receipts (id, tenant_id, branch_id, invoice_id, amount, payment_method, payment_date, reference_number, gateway_ref, notes)
    SELECT
      gen_random_uuid(), i.tenant_id, i.branch_id, i.id, r.amount, r.payment_method, r.paid_date, r.reference_number, r.bill_id,
      'RaudhahPay online payment (' || r.payment_method || ') -- reconciled 2026-08-06 from webhook_debug_log; original webhook delivery did not update records'
    FROM invoices i WHERE i.id = r.invoice_id
    ON CONFLICT (gateway_ref) WHERE gateway_ref IS NOT NULL DO NOTHING;

    UPDATE invoices i SET
      amount_paid = i.amount_paid + r.amount,
      status = (CASE WHEN i.amount_paid + r.amount >= i.total_amount THEN 'paid' ELSE 'sent' END)::invoice_status,
      payment_method = 'qr',
      payment_date = r.paid_date,
      payment_reference = r.bill_id
    WHERE i.id = r.invoice_id;
  END LOOP;
END $$;
