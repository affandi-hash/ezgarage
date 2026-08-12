-- 135: "Mark as Sent" on a quotation was a bare status flip with no record
-- of how or to whom -- staff clicked it as a self-reported "I've dealt
-- with this" flag regardless of whether the customer ever actually saw
-- the quote. Adds columns to record a real send action (channel,
-- recipient, timestamp) and a private bucket for the generated quotation
-- PDF that gets linked in the WhatsApp message.

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS sent_channel text;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS sent_to text;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS sent_at timestamptz;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('quotation-pdfs', 'quotation-pdfs', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION storage_quotation_pdfs_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM quotations q
    WHERE q.id = (split_part(p_name, '/', 1))::uuid
      AND q.tenant_id = get_my_tenant()
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE POLICY "auth_users_read_quotation_pdfs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quotation-pdfs' AND storage_quotation_pdfs_tenant_ok(name));

CREATE POLICY "auth_users_upload_quotation_pdfs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quotation-pdfs' AND storage_quotation_pdfs_tenant_ok(name));

CREATE POLICY "auth_users_delete_quotation_pdfs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quotation-pdfs' AND storage_quotation_pdfs_tenant_ok(name));
