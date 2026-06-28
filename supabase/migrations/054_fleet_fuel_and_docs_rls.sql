-- 054: Fleet fuel logs table + RLS for fleet_documents and fleet_fuel_logs

-- FUEL LOG TABLE
CREATE TABLE IF NOT EXISTS fleet_fuel_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        uuid        NOT NULL REFERENCES branches(id),
  fleet_vehicle_id uuid        NOT NULL REFERENCES fleet_vehicles(id),
  log_date         date        NOT NULL,
  litres           numeric(8,2) NOT NULL,
  cost_per_litre   numeric(6,3) NOT NULL,
  total_cost       numeric(10,2) NOT NULL,
  odometer_km      integer     NOT NULL,
  station          text,
  full_tank        boolean     NOT NULL DEFAULT true,
  recorded_by      uuid        REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_fuel_vehicle ON fleet_fuel_logs (fleet_vehicle_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_fuel_tenant  ON fleet_fuel_logs (tenant_id);

ALTER TABLE fleet_fuel_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_fuel_select" ON fleet_fuel_logs;
CREATE POLICY "fleet_fuel_select" ON fleet_fuel_logs FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS "fleet_fuel_insert" ON fleet_fuel_logs;
CREATE POLICY "fleet_fuel_insert" ON fleet_fuel_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS "fleet_fuel_delete" ON fleet_fuel_logs;
CREATE POLICY "fleet_fuel_delete" ON fleet_fuel_logs FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant() AND get_my_role() IN ('super_admin','ops_manager'));

-- fleet_documents: add tenant_id if not already there (migration 014 added it)
ALTER TABLE fleet_documents ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

ALTER TABLE fleet_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_docs_select" ON fleet_documents;
CREATE POLICY "fleet_docs_select" ON fleet_documents FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS "fleet_docs_insert" ON fleet_documents;
CREATE POLICY "fleet_docs_insert" ON fleet_documents FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS "fleet_docs_delete" ON fleet_documents;
CREATE POLICY "fleet_docs_delete" ON fleet_documents FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant() AND get_my_role() IN ('super_admin','ops_manager'));
