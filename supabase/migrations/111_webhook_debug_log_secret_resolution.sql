-- 111: Make the RaudhahPay webhook's secret-resolution outcome observable.
--
-- The Critical finding from the FPX root-cause investigation: when a
-- tenant's webhook secret can't be resolved (invoice lookup fails, or the
-- payload carries no reference at all), the webhook silently falls back to
-- the project-wide default secret with nothing recording that it happened.
-- For a tenant with their own dedicated secret, that fallback is wrong, the
-- signature check fails, RaudhahPay retries for up to 6 hours, then gives
-- up for good — and until now, nothing showed this had happened (this is
-- believed to be what actually caused MVG-INV-2026-0075). These columns
-- let raudhahpay-webhook/index.ts record, per delivery, which secret
-- source it used and whether the signature it computed actually matched.

ALTER TABLE webhook_debug_log ADD COLUMN IF NOT EXISTS resolved_invoice_id uuid;
ALTER TABLE webhook_debug_log ADD COLUMN IF NOT EXISTS secret_source text;
ALTER TABLE webhook_debug_log ADD COLUMN IF NOT EXISTS signature_valid boolean;

COMMENT ON COLUMN webhook_debug_log.secret_source IS
  'One of: tenant (own secret used), project_default_no_tenant_secret (tenant has none configured — expected), project_default_lookup_failed (invoice lookup returned nothing — suspicious if this tenant actually has their own secret), project_default_no_reference (payload had no invoice reference at all — suspicious), or null if verification never reached this point.';
