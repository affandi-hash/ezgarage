-- 068: Customer payment ledger (receipts) with proof-of-payment attachment.
-- ARPage.tsx already expected a `receipts` table for its "Add Payment" flow
-- but it was never created — this fixes that gap and extends it to
-- InvoicesPage.tsx's "Record Payment" flow too, so both support installments
-- with an optional proof-of-payment file per payment.

CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  branch_id uuid,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  payment_method text,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_number text,
  proof_url text,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipts_rw" ON receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage bucket for customer proof-of-payment attachments (private, signed URLs only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "auth_users_upload_payment_proofs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'payment-proofs');

CREATE POLICY "auth_users_read_payment_proofs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'payment-proofs');

CREATE POLICY "auth_users_delete_payment_proofs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'payment-proofs');
