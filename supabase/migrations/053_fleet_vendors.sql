-- 053: Fleet vendors lookup table
-- Stores workshop/vendor names per tenant for the Log Service dropdown.
-- Seeded with the tenant's own workshop name on first use via frontend.

CREATE TABLE IF NOT EXISTS fleet_vendors (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_fleet_vendors_tenant ON fleet_vendors (tenant_id);

ALTER TABLE fleet_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_vendors_select" ON fleet_vendors;
CREATE POLICY "fleet_vendors_select"
  ON fleet_vendors FOR SELECT
  TO authenticated
  USING (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS "fleet_vendors_insert" ON fleet_vendors;
CREATE POLICY "fleet_vendors_insert"
  ON fleet_vendors FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS "fleet_vendors_delete" ON fleet_vendors;
CREATE POLICY "fleet_vendors_delete"
  ON fleet_vendors FOR DELETE
  TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND get_my_role() IN ('super_admin', 'ops_manager')
  );
