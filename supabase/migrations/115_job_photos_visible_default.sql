-- 115: job_photos.visible_to_customer (010_mgod_v3_schema.sql) has defaulted
-- to false since the table was created, but no staff-facing UI anywhere in
-- the app (PhotoUploader.tsx, WorkshopBoardPage.tsx's QuickPhotoUpload) has
-- ever set it to true, and category is always hardcoded 'general' with no
-- customer-safe/internal distinction. Combined with 114's has_photos gate,
-- this meant no photo could ever reach the customer portal for any job,
-- confirmed live on job MVG-2026-0093 where a real customer saw nothing
-- despite photos being uploaded. There's no existing curation signal to
-- selectively hide any subset, so the fix is to treat "uploaded" as
-- "visible" by default going forward, and backfill everything already
-- uploaded to match.

ALTER TABLE job_photos ALTER COLUMN visible_to_customer SET DEFAULT true;

UPDATE job_photos SET visible_to_customer = true WHERE visible_to_customer = false;
