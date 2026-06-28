-- 038: Labour charges catalogue + extend payment_method enum for invoices.

-- Labour charges price list
CREATE TABLE IF NOT EXISTS labour_charges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id),
  branch_id   UUID REFERENCES branches(id),
  name        TEXT NOT NULL,
  description TEXT,
  unit_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'unit',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE labour_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "labour_charges_rw" ON labour_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Extend payment_method enum to include qr and bank_transfer
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'qr';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'bank_transfer';

-- Add vehicle_mileage snapshot to invoices (was missing)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vehicle_mileage TEXT;
-- Add opened_by name snapshot
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS opened_by TEXT;
