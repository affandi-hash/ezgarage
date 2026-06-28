-- 045: Create job number functions + trigger on `jobs` table
-- The original functions in 003/009 referenced `job_orders` (old table name)
-- and were never re-created after the v3 schema renamed it to `jobs`.

-- Step 1: generate_job_number — queries `jobs` (not the old `job_orders`)
CREATE OR REPLACE FUNCTION generate_job_number(p_branch_id uuid)
RETURNS text AS $$
DECLARE
  branch_code text;
  year_str    text;
  next_seq    integer;
BEGIN
  SELECT CASE
    WHEN location ILIKE '%puchong%'    THEN 'PJ'
    WHEN location ILIKE '%kota bharu%' THEN 'KB'
    ELSE 'MV'
  END INTO branch_code
  FROM branches WHERE id = p_branch_id;

  year_str := to_char(NOW(), 'YYYY');

  SELECT COALESCE(MAX(
    CAST(split_part(job_number, '-', 3) AS integer)
  ), 0) + 1 INTO next_seq
  FROM jobs
  WHERE branch_id = p_branch_id
    AND job_number LIKE branch_code || '-' || year_str || '-%';

  RETURN branch_code || '-' || year_str || '-' || lpad(next_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Step 2: trigger function
CREATE OR REPLACE FUNCTION set_job_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := generate_job_number(NEW.branch_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: attach trigger to `jobs`
DROP TRIGGER IF EXISTS trg_set_job_number ON jobs;

CREATE TRIGGER trg_set_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_job_number();
