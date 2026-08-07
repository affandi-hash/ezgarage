-- 130: Two additions to the Sales & Marketing module:
-- (1) A private storage bucket so the owner can attach images (competitor
--     screenshots, existing marketing materials) to the CSMO chat --
--     tenant-scoped the same way payment-proofs etc. already are (080).
-- (2) A shared ai_token_usage log so every AI feature in this module
--     (and future ones) records what it spent, with a timestamp, for
--     later analysis. Write-only via service role -- no insert policy
--     for authenticated, so a client can't fake its own usage numbers.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sales-marketing-uploads', 'sales-marketing-uploads', false, 10485760, ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION storage_sales_marketing_uploads_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM sales_marketing_business_profile p
    WHERE p.id = (split_part(p_name, '/', 1))::uuid
      AND p.tenant_id = get_my_tenant()
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

DROP POLICY IF EXISTS "auth_users_read_sales_marketing_uploads" ON storage.objects;
CREATE POLICY "auth_users_read_sales_marketing_uploads" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sales-marketing-uploads' AND storage_sales_marketing_uploads_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_upload_sales_marketing_uploads" ON storage.objects;
CREATE POLICY "auth_users_upload_sales_marketing_uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sales-marketing-uploads' AND storage_sales_marketing_uploads_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_delete_sales_marketing_uploads" ON storage.objects;
CREATE POLICY "auth_users_delete_sales_marketing_uploads" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sales-marketing-uploads' AND storage_sales_marketing_uploads_tenant_ok(name));

CREATE TABLE IF NOT EXISTS ai_token_usage (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    uuid NOT NULL REFERENCES tenants(id),
  feature                      text NOT NULL,  -- e.g. 'business_profile_assistant'
  model                        text NOT NULL,
  input_tokens                 integer NOT NULL DEFAULT 0,
  output_tokens                integer NOT NULL DEFAULT 0,
  cache_creation_input_tokens  integer NOT NULL DEFAULT 0,
  cache_read_input_tokens      integer NOT NULL DEFAULT 0,
  requested_by                 uuid REFERENCES auth.users(id),
  created_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_token_usage_tenant_feature ON ai_token_usage (tenant_id, feature, created_at);

ALTER TABLE ai_token_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_token_usage_select ON ai_token_usage;
CREATE POLICY ai_token_usage_select ON ai_token_usage FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']));
