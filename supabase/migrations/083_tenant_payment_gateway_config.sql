-- 083: Let each tenant configure their own RaudhahPay merchant credentials.
--
-- Both the create-payment and webhook edge functions previously used a
-- single project-wide RAUDHAHPAY_API_KEY / RAUDHAHPAY_WEBHOOK_SECRET env
-- var — meaning a second tenant's online payments would settle through
-- Motoverse's own RaudhahPay merchant account with no way to route
-- otherwise. Add per-tenant override columns (nullable — tenants without
-- their own merchant account yet keep using the project default via the
-- edge functions' fallback logic).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS raudhahpay_api_key text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS raudhahpay_webhook_secret text;

-- OnboardingPage's Step 1 has always collected a postcode field and tried
-- to save it to tenants.postcode — a column that never actually existed,
-- so that save silently failed for every tenant that has ever signed up
-- (masked further by the onAuthStateChange race fixed alongside this).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS postcode text;
