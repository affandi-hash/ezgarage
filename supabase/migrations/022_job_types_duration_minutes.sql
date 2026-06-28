-- 022: Change job_types duration from hours to minutes
-- Rename column and convert existing values (1h → 60min, 3h → 180min)

ALTER TABLE job_types RENAME COLUMN default_duration_hours TO default_duration_minutes;
UPDATE job_types SET default_duration_minutes = default_duration_minutes * 60 WHERE default_duration_minutes IS NOT NULL;
