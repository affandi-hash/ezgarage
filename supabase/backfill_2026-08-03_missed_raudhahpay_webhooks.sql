-- One-off backfill, not a schema migration. raudhahpay-webhook silently
-- failed to process two genuine payment.success deliveries (root cause
-- still under investigation -- see webhook_debug_log ids
-- 8613ed67-5ff7-4df3-ac76-5c2359615459 and
-- 490ad56b-dd71-433c-a4b6-22926406a75b). Both are confirmed real: RaudhahPay
-- delivered the event, the customer has a bank receipt, but our invoices/
-- receipts never reflected it. This replays exactly what the webhook should
-- have done for each, so the esp_activate_on_invoice_paid trigger fires
-- normally off the invoices UPDATE, same as any other paid invoice.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('d0c6377d-f157-4280-8753-ba470e268443'::uuid, 'd215568f-0726-4a2f-ab79-1f254b19ff77', 30.00::numeric, 'duitnow', '54a10aa6-3e62-4479-83c1-aa5b6cb951b8', '2026-08-03'::date),
      ('301f7536-0123-4ce7-97e0-ce14e172d569'::uuid, '70988e59-934f-4fc4-bf53-e8979b5c49f3', 30.00::numeric, 'duitnow', 'e76e414c-fd0f-452a-8d34-17f0090efff1', '2026-08-03'::date)
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
      payment_method = 'qr',
      payment_date = r.paid_date,
      payment_reference = r.bill_id
    WHERE i.id = r.invoice_id;
  END LOOP;
END $$;
