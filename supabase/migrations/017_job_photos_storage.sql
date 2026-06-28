-- Migration 017: Supabase Storage bucket for job photos + job_photos table policies

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-photos',
  'job-photos',
  false,
  10485760, -- 10 MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload photos to job-photos bucket
CREATE POLICY "auth_users_upload_job_photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'job-photos');

-- Allow authenticated users to read photos from job-photos bucket
CREATE POLICY "auth_users_read_job_photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'job-photos');

-- Allow authenticated users to delete their own uploaded photos
CREATE POLICY "auth_users_delete_job_photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'job-photos');

-- Enable RLS on job_photos if not already enabled
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

-- job_photos: select — same branch
DROP POLICY IF EXISTS "job_photos_select" ON job_photos;
CREATE POLICY "job_photos_select" ON job_photos
  FOR SELECT TO authenticated
  USING (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'));

-- job_photos: insert — same branch
DROP POLICY IF EXISTS "job_photos_insert" ON job_photos;
CREATE POLICY "job_photos_insert" ON job_photos
  FOR INSERT TO authenticated
  WITH CHECK (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'));

-- job_photos: delete — same branch
DROP POLICY IF EXISTS "job_photos_delete" ON job_photos;
CREATE POLICY "job_photos_delete" ON job_photos
  FOR DELETE TO authenticated
  USING (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'));
