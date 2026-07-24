-- 102: Quotations have no discount concept at all today (unlike invoices,
-- which already have discount_amount) -- needed so the ESP "Apply discount"
-- banner has a field to write into on QuotationsPage the same way it does
-- on InvoicesPage.

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;
