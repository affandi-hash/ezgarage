-- 181: once a supplier bill is paid, its priority goes back to Normal.
--
-- "Urgent" and "High" mean "pay this soon". After the payment is made they only clutter the Accounts Payable list.
-- This applies however the payment arrives (recorded by hand, posted by ezAcc, or a paid stock purchase).
-- A bill that is only partly paid keeps its priority. Someone can still change the priority of a paid bill by hand afterwards.
CREATE OR REPLACE FUNCTION supplier_bill_paid_priority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text = 'paid' AND NEW.payment_priority IS DISTINCT FROM 'normal'
     AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'paid') THEN
    NEW.payment_priority := 'normal';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_bill_paid_priority ON supplier_invoices;
CREATE TRIGGER supplier_bill_paid_priority BEFORE INSERT OR UPDATE ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION supplier_bill_paid_priority();

-- bills that are already fully paid
UPDATE supplier_invoices SET payment_priority = 'normal' WHERE status::text = 'paid' AND voided_at IS NULL AND payment_priority IS DISTINCT FROM 'normal';
