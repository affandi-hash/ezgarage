-- 151: Cross-branch visibility inside ONE tenant, for the ON-SITE van branch.
--
-- A business with several outlets (the Hub plus one or more ON-SITE vans)
-- shares its customers and vehicles; only writes stay branch-scoped.
--
-- 1. customers / vehicles: SELECT becomes tenant-wide (was branch-locked
--    for everyone except super_admin/ops_manager). A van technician must be
--    able to read an existing Hub customer's name, phone and plate.
-- 2. invoices: finance joins super_admin/ops_manager as a role that can read
--    every branch of its own tenant (consolidated accounting).
-- 3. jobs: ops_manager and finance can read every branch of their own
--    tenant. NOTE the explicit tenant_id condition -- the old jobs_select had
--    none, so adding roles to its branch clause without one would leak rows
--    across tenants.

DROP POLICY IF EXISTS customers_select ON customers;
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS vehicles_select ON vehicles;
CREATE POLICY vehicles_select ON vehicles FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS invoices_select ON invoices;
CREATE POLICY invoices_select ON invoices FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND ((branch_id = get_my_branch()) OR (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])))
  );

DROP POLICY IF EXISTS jobs_select ON jobs;
CREATE POLICY jobs_select ON jobs FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','mechanic','front_desk','finance']))
    AND (
      (branch_id = get_my_branch())
      OR (get_my_role() = 'super_admin')
      OR (get_my_role() = ANY (ARRAY['ops_manager','finance']) AND tenant_id = get_my_tenant())
    )
  );
