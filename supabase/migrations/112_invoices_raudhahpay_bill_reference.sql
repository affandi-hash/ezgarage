-- 112: Persist the RaudhahPay bill reference on the invoice at creation
-- time, not just on the receipt once a webhook happens to succeed.
--
-- Today, if a webhook is ever dropped (see 111's secret-resolution
-- observability), there is nothing to reconcile against — RaudhahPay's
-- own bill_id/payment_session_id/reference_number are returned to the
-- browser and then thrown away. Storing them lets a reconciliation job
-- ask RaudhahPay directly "did this pending bill actually succeed?"
-- instead of depending solely on the webhook arriving.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raudhahpay_bill_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raudhahpay_payment_session_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raudhahpay_reference_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raudhahpay_bill_created_at timestamptz;
-- The method the customer picked at checkout time -- stored so the
-- reconciliation job has an authoritative value for the synthetic webhook
-- it replays, rather than guessing if a status-query response ever omits it.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raudhahpay_payment_method text;

-- Reconciliation's candidate query (stale-pending invoices with a bill
-- reference) filters on exactly these two columns together.
CREATE INDEX IF NOT EXISTS invoices_raudhahpay_pending_idx
  ON invoices (raudhahpay_bill_created_at)
  WHERE raudhahpay_bill_id IS NOT NULL;
