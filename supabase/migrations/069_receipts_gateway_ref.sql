-- 069: Track the RaudhahPay bill_id on receipts so retried/duplicate webhook
-- deliveries for the same payment can't double-record a receipt.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS gateway_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS receipts_gateway_ref_unique
  ON receipts (gateway_ref) WHERE gateway_ref IS NOT NULL;
