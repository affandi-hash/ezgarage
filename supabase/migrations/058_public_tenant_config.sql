-- Migration: 058_public_tenant_config.sql
-- Add SST rate to tenants and public RPC for portal/booking pages

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sst_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION get_portal_config()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT json_build_object(
    'name',               t.name,
    'logo_url',           t.logo_url,
    'phone',              t.phone,
    'whatsapp_number',    t.whatsapp_number,
    'google_review_link', t.google_review_link,
    'sst_rate',           t.sst_rate
  )
  FROM tenants t
  WHERE t.is_active = true
  ORDER BY t.created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_portal_config() TO anon, authenticated;
