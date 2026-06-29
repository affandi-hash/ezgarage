-- 063_internal_fleet.sql
-- Flag vehicles and invoices belonging to internal company/subsidiary fleet

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS is_internal_fleet boolean NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS is_internal_fleet boolean NOT NULL DEFAULT false;
