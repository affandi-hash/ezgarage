-- 150: Support "carry forward last month's expenses with a blank figure",
-- and close an RLS gap found while building it.
--
-- 1. amount becomes nullable: a carried-forward row is a real line item
--    (category/vendor/description already known) whose figure just hasn't
--    been keyed in yet this month. NULL means "not entered", distinct from
--    0 which would mean "this cost nothing" -- a real, if rare, case for an
--    OPEX line (e.g. a waived fee).
--
-- 2. expenses' only RLS policy today is tenant-scoped with no role check at
--    all ("tenant_expenses", USING tenant_id = caller's tenant, FOR ALL) --
--    meaning any authenticated staff member of the tenant can read or write
--    any expense via a direct API call, regardless of role. The frontend
--    route (/expenses) already restricts to
--    ['super_admin','ops_manager','finance','foreman'] -- this migration
--    makes that real at the database, matching the existing route gate
--    exactly, same pattern as 079_rls_tenant_isolation_fixes.sql.

ALTER TABLE expenses ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_nonnegative CHECK (amount IS NULL OR amount >= 0);

DROP POLICY IF EXISTS tenant_expenses ON expenses;

CREATE POLICY expenses_select ON expenses FOR SELECT TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman'])
  );

CREATE POLICY expenses_insert ON expenses FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman'])
  );

CREATE POLICY expenses_update ON expenses FOR UPDATE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman'])
  )
  WITH CHECK (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman'])
  );

CREATE POLICY expenses_delete ON expenses FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman'])
  );
