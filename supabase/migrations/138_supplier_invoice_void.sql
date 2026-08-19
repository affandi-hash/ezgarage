-- 138: Let staff void a supplier invoice (accounts payable) instead of
-- deleting it -- a deleted row would silently break the linked
-- supplier_payments/expenses history; a "voided" status keeps the record
-- but excludes it from payable totals, mirroring the existing customer-
-- facing invoices.status 'void' value and the void_receipt (077) audit
-- pattern. supplier_invoices.status has no CHECK constraint (confirmed
-- live), so no constraint widening is needed -- just the audit columns.

ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id);
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS void_reason text;
