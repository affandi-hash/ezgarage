-- 035: Make job_id nullable on parts_requests — parts can be requested without a linked job.
ALTER TABLE parts_requests ALTER COLUMN job_id DROP NOT NULL;
