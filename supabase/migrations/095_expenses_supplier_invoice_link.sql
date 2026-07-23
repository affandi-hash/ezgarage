-- 095: Link an expense to the Accounts Payable supplier invoice it came
-- from (optional). Expenses and Accounts Payable were two fully separate,
-- unlinked ledgers — this lets an OPEX/CAPEX record show that invoice's
-- live paid/unpaid/partial/overdue status instead of duplicating a
-- separately-editable status field that could drift out of sync.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL;
