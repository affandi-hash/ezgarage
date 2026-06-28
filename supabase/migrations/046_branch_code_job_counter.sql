-- 046: Add `code` to branches + job_number_counters table + race-safe generate_job_number

-- 1. Branch code column (short uppercase prefix, e.g. MV, HQ, PJ, KB)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS code TEXT;

-- 2. Counter table — one row per branch per year, updated atomically
CREATE TABLE IF NOT EXISTS job_number_counters (
  branch_id  UUID NOT NULL,
  year       TEXT NOT NULL,
  last_seq   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, year)
);
ALTER TABLE job_number_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_counters_rw" ON job_number_counters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Race-safe generate_job_number using INSERT … ON CONFLICT atomic increment
CREATE OR REPLACE FUNCTION generate_job_number(p_branch_id uuid)
RETURNS text AS $$
DECLARE
  branch_code text;
  year_str    text;
  next_seq    integer;
BEGIN
  SELECT COALESCE(code, 'MV') INTO branch_code
  FROM branches WHERE id = p_branch_id;

  year_str := to_char(NOW(), 'YYYY');

  INSERT INTO job_number_counters (branch_id, year, last_seq)
  VALUES (p_branch_id, year_str, 1)
  ON CONFLICT (branch_id, year)
  DO UPDATE SET last_seq = job_number_counters.last_seq + 1
  RETURNING last_seq INTO next_seq;

  RETURN branch_code || '-' || year_str || '-' || lpad(next_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger function
CREATE OR REPLACE FUNCTION set_job_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := generate_job_number(NEW.branch_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Attach trigger to `jobs`
DROP TRIGGER IF EXISTS trg_set_job_number ON jobs;
CREATE TRIGGER trg_set_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_job_number();
