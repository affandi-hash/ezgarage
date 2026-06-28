-- 023: Add insert policy for audit_logs
-- No insert policy existed, so all logAudit() calls silently failed.
-- Any authenticated active user can insert their own tenant's logs.

DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE POLICY "audit_logs_insert"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );
