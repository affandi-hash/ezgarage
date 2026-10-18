-- 176: a supplier bill must belong to a branch.
--
-- Bills saved while the branch selector said "All Branches" had no branch, so the Google Sheet sync (which sends one
-- branch at a time) left them out of Account Payable. Now a bill saved without a branch takes the saver's own branch;
-- if the saver has none either, the save is refused with a clear message. Functions, cron and the service role are not affected.
CREATE OR REPLACE FUNCTION supplier_invoice_branch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := get_my_branch();
    IF NEW.branch_id IS NULL AND current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Choose a branch for this supplier bill.' USING ERRCODE = '23502';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_invoice_branch ON supplier_invoices;
CREATE TRIGGER supplier_invoice_branch BEFORE INSERT ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION supplier_invoice_branch();
