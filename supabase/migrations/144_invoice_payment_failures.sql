-- 144: Persist RaudhahPay payment failure/expiry/rejection/cancellation
-- events. Previously these were only console.log'd in the webhook function
-- and captured incidentally in webhook_debug_log -- a temporary diagnostic
-- table explicitly documented as safe to drop once its original purpose
-- (chasing a signature-verification bug) was resolved. Relying on it as a
-- real audit trail for "why did this customer's payment fail" was never the
-- intent. RaudhahPay's fix now includes failure_code/failure_reason/
-- gateway_status/reference_number on these events, worth keeping properly.

CREATE TABLE IF NOT EXISTS invoice_payment_failures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  bill_id          text,
  event            text NOT NULL,
  failure_code     text,
  failure_reason   text,
  gateway_status   text,
  reference_number text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_failures_invoice ON invoice_payment_failures (invoice_id);

ALTER TABLE invoice_payment_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_payment_failures_tenant_rw ON invoice_payment_failures FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant())
  WITH CHECK (tenant_id = get_my_tenant());
