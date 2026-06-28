-- 047: Add logo_url to branches for company logo storage
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create storage bucket for branch logos (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branch-logos', 'branch-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to branch-logos
CREATE POLICY IF NOT EXISTS "Authenticated users can upload branch logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'branch-logos');

CREATE POLICY IF NOT EXISTS "Branch logos are publicly readable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'branch-logos');

CREATE POLICY IF NOT EXISTS "Authenticated users can update branch logos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'branch-logos');

CREATE POLICY IF NOT EXISTS "Authenticated users can delete branch logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'branch-logos');
