-- 154: storage for ON-SITE before/after photos. Public read (the customer's
-- private status page embeds them by URL; paths contain the booking uuid),
-- writes only by signed-in staff of the same tenant's booking.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('onsite-photos', 'onsite-photos', true, 8388608, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS onsite_photos_insert ON storage.objects;
CREATE POLICY onsite_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'onsite-photos'
    AND EXISTS (
      SELECT 1 FROM os_bookings b
       WHERE b.id::text = (storage.foldername(name))[1]
         AND b.tenant_id = get_my_tenant()
         AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','mechanic'])
    )
  );
