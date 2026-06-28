-- Migration 019: Add status_at_upload to job_photos for vehicle track log
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS status_at_upload text;
