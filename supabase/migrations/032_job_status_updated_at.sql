-- 032: Add status_updated_at to jobs for Long Due auto-flag.
-- Tracks when status last changed so we can auto-flag In Progress > 3 days as Long Due.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT now() NOT NULL;

-- Trigger: update status_updated_at whenever job status changes
CREATE OR REPLACE FUNCTION fn_update_status_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_status_updated_at ON jobs;
CREATE TRIGGER trg_status_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION fn_update_status_updated_at();
