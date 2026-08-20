-- 140: Historical-data import (139) needs to accept PDF exports of old
-- reports, not just chart screenshots -- widen the existing
-- sales-marketing-uploads bucket rather than standing up a second bucket.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'sales-marketing-uploads';
