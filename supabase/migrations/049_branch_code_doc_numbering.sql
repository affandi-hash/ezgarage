-- 049: Branch-code document numbering for invoices and quotations
--
-- Job card:   MVG-2026-0001   (unchanged, job_number_counters)
-- Invoice:    MVG-INV-2026-0001
-- Quotation:  MVG-QT-2026-0001
--
-- job_number_counters and generate_job_number are NOT touched.
-- invoice_seq is NOT dropped (safe to leave unused).

-- ── 1. Counter table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_number_counters (
  branch_id  UUID    NOT NULL,
  year       TEXT    NOT NULL,
  doc_type   TEXT    NOT NULL,  -- 'INV' or 'QT'
  last_seq   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, year, doc_type)
);

ALTER TABLE doc_number_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_counters_rw" ON doc_number_counters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. Shared atomic counter function ───────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_doc_number(p_branch_id UUID, p_doc_type TEXT)
RETURNS TEXT AS $$
DECLARE
  v_code  TEXT;
  v_year  TEXT;
  v_seq   INTEGER;
  v_fmt   TEXT;
BEGIN
  SELECT COALESCE(NULLIF(TRIM(code), ''), 'MV')
  INTO v_code
  FROM branches
  WHERE id = p_branch_id;

  v_year := TO_CHAR(NOW(), 'YYYY');

  INSERT INTO doc_number_counters (branch_id, year, doc_type, last_seq)
  VALUES (p_branch_id, v_year, p_doc_type, 1)
  ON CONFLICT (branch_id, year, doc_type)
  DO UPDATE SET last_seq = doc_number_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  -- MVG-INV-2026-0001  (INV)
  -- MVG-QT-2026-0001   (QT)
  IF p_doc_type = 'QT' THEN
    v_fmt := v_code || '-QT-'  || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
  ELSE
    v_fmt := v_code || '-INV-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
  END IF;

  RETURN v_fmt;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Invoice trigger function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := generate_doc_number(NEW.branch_id, 'INV');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-attach trigger (function already existed; this is safe to re-run)
DROP TRIGGER IF EXISTS trg_invoice_number ON invoices;
CREATE TRIGGER trg_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION generate_invoice_number();

-- ── 4. Quotation number RPC ─────────────────────────────────────────────────
-- generate_quote_number is called from the frontend; signature unchanged.
CREATE OR REPLACE FUNCTION generate_quote_number(p_branch_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN generate_doc_number(p_branch_id, 'QT');
END;
$$ LANGUAGE plpgsql;
