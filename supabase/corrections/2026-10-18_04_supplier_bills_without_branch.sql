-- Correction 4: supplier bills saved with no branch (14 of them, 5 Oct to 15 Oct) belong to Motoverse Garage (the Hub).
--
-- They were saved while the branch selector was on "All Branches", so they carried no branch and the Google Sheet
-- sync (which sends only the Hub's bills) left out the 5 unpaid ones (RM5,360) from the Account Payable block.
-- This only fills in the branch. Amounts, status, payments and voided bills are not changed.
-- Run with:  supabase db query --linked -f supabase/corrections/2026-10-18_04_supplier_bills_without_branch.sql
DO $$
DECLARE
  tenant constant uuid := 'c20ef6dc-4f38-4291-bb15-a4eb86c17520';   -- Motoverse Garage
  hub    constant uuid := '9adf1a8d-2c46-4c0e-9e7c-a21adb006b86';   -- Motoverse Garage (Hub) branch
  approver constant uuid := '34b8b6ab-4278-4739-99b1-dc555c68624d'; -- Affandi
  n int; total numeric;
BEGIN
  SELECT count(*), coalesce(sum(total_amount), 0) INTO n, total FROM supplier_invoices WHERE tenant_id = tenant AND branch_id IS NULL;
  IF n <> 14 THEN RAISE EXCEPTION 'Expected 14 bills without a branch, found %. Nothing changed.', n; END IF;

  UPDATE supplier_invoices SET branch_id = hub WHERE tenant_id = tenant AND branch_id IS NULL;

  PERFORM insert_audit_log('supplier_bill_correction', 'supplier_invoices', NULL, 'supplier_invoice',
    jsonb_build_object('bills', n, 'total_amount', total, 'branch_set_to', 'Motoverse Garage (Hub)', 'reason', 'saved with All Branches selected; needed for the sheet sync'),
    hub, approver, tenant);

  IF EXISTS (SELECT 1 FROM supplier_invoices WHERE tenant_id = tenant AND branch_id IS NULL) THEN RAISE EXCEPTION 'Some bills still have no branch'; END IF;
END $$;
