-- 096: Direct, self-contained payment tracking on Expenses (OPEX/CAPEX) —
-- simpler than requiring a cross-module link to Accounts Payable (095).
-- Finance can mark a record Paid/Unpaid right here, with its own paid date
-- and a separate Proof of Payment upload (distinct from the original bill
-- document already supported via file_url).
--
-- Existing rows default to 'paid' since they were logged as completed
-- historical transactions, not bills awaiting payment.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('unpaid', 'paid'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_date date;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS pop_file_url text;
