-- 033: Add tenant_id to suppliers and inventory for multi-tenant support.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- RLS: suppliers
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant suppliers read" ON suppliers;
DROP POLICY IF EXISTS "tenant suppliers write" ON suppliers;
CREATE POLICY "tenant suppliers read"  ON suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "tenant suppliers write" ON suppliers FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- RLS: inventory
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant inventory read" ON inventory;
DROP POLICY IF EXISTS "tenant inventory write" ON inventory;
CREATE POLICY "tenant inventory read"  ON inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "tenant inventory write" ON inventory FOR ALL    TO authenticated USING (true) WITH CHECK (true);
