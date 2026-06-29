-- 064_receipts.sql
-- Add receipt_number to invoices; auto-generate on first payment

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS receipt_number text;

CREATE SEQUENCE IF NOT EXISTS receipt_seq START 1;

CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Generate when amount_paid is first set (was 0/null, now > 0) and no receipt yet
  IF NEW.amount_paid > 0
     AND (OLD.amount_paid IS NULL OR OLD.amount_paid = 0)
     AND NEW.receipt_number IS NULL THEN
    NEW.receipt_number := 'MVG-RCP-'
      || to_char(now(), 'YYYY')
      || '-'
      || lpad(nextval('receipt_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_number ON invoices;
CREATE TRIGGER trg_receipt_number
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION generate_receipt_number();
