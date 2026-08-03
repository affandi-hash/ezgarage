-- Second one-off backfill same day -- root cause of raudhahpay-webhook's
-- silent processing failures still unresolved (still need the actual Edge
-- Function error log from the Supabase dashboard). A new case recurred:
-- webhook_debug_log id for this delivery has bill_id d63269c3-b69d-41f3-
-- 9d63-9509e0790744. RaudhahPay confirmed payment.success (FPX) but our
-- invoices/receipts never reflected it. Replays exactly what the webhook
-- should have done, same as the first backfill.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('c0786f57-d4c2-4227-b65d-256cc35021b7'::uuid, 'd63269c3-b69d-41f3-9d63-9509e0790744', 30.00::numeric, 'fpx', 'F3B9J8E1', '2026-08-03'::date)
    ) AS t(invoice_id, bill_id, amount, payment_method, reference_number, paid_date)
  LOOP
    INSERT INTO receipts (id, tenant_id, branch_id, invoice_id, amount, payment_method, payment_date, reference_number, gateway_ref, notes)
    SELECT
      gen_random_uuid(), i.tenant_id, i.branch_id, i.id, r.amount, r.payment_method, r.paid_date, r.reference_number, r.bill_id,
      'RaudhahPay online payment (' || r.payment_method || ') -- reconciled 2026-08-03 from webhook_debug_log; original webhook delivery did not update records'
    FROM invoices i WHERE i.id = r.invoice_id
    ON CONFLICT (gateway_ref) WHERE gateway_ref IS NOT NULL DO NOTHING;

    UPDATE invoices i SET
      amount_paid = i.amount_paid + r.amount,
      status = (CASE WHEN i.amount_paid + r.amount >= i.total_amount THEN 'paid' ELSE 'sent' END)::invoice_status,
      payment_method = 'bank_transfer',
      payment_date = r.paid_date,
      payment_reference = r.bill_id
    WHERE i.id = r.invoice_id;
  END LOOP;
END $$;
