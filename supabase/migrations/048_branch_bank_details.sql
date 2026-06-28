-- 048: Add bank details fields to branches
ALTER TABLE branches ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS bank_account_name TEXT;
