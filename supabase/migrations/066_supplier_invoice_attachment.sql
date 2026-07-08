-- 066: Supplier invoice number + attachment for stock purchases (parts_requests)

ALTER TABLE parts_requests ADD COLUMN IF NOT EXISTS invoice_number text;

-- Create the storage bucket for supplier invoice attachments (images or PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supplier-invoices',
  'supplier-invoices',
  false,
  10485760, -- 10 MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload supplier invoice attachments
CREATE POLICY "auth_users_upload_supplier_invoices"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'supplier-invoices');

-- Allow authenticated users to read supplier invoice attachments
CREATE POLICY "auth_users_read_supplier_invoices"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'supplier-invoices');

-- Allow authenticated users to delete supplier invoice attachments
CREATE POLICY "auth_users_delete_supplier_invoices"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'supplier-invoices');
