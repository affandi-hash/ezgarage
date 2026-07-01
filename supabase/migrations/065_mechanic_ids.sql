-- 065_mechanic_ids.sql
-- Allow multiple mechanics per job (Option A: uuid array on jobs table)

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS mechanic_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill existing single mechanic assignments into the array
UPDATE jobs
  SET mechanic_ids = ARRAY[assigned_mechanic_id]
  WHERE assigned_mechanic_id IS NOT NULL
    AND (mechanic_ids IS NULL OR mechanic_ids = '{}');
