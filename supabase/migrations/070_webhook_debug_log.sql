-- 070: Temporary diagnostic table for the raudhahpay-webhook function —
-- captures every incoming request's headers/body so real-world webhook
-- payloads can be inspected without direct log access. Safe to drop once
-- RaudhahPay's signature-verification issue (see raudhahpay-webhook/index.ts)
-- is resolved and RAUDHAHPAY_SKIP_SIGNATURE_CHECK is removed.

CREATE TABLE IF NOT EXISTS webhook_debug_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  headers jsonb,
  raw_body text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE webhook_debug_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhook_debug_log_rw" ON webhook_debug_log FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);
