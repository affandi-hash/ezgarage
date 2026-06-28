-- 021: Allow ops_manager to manage their branch's workshop_rules
-- Original policies (012) restricted insert/update/delete to super_admin only.
-- In the SaaS model, ops_manager is the tenant admin and must be able to manage
-- rules scoped to their own branch.

DROP POLICY IF EXISTS "workshop_rules_insert" ON workshop_rules;
CREATE POLICY "workshop_rules_insert"
  ON workshop_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
  );

DROP POLICY IF EXISTS "workshop_rules_update" ON workshop_rules;
CREATE POLICY "workshop_rules_update"
  ON workshop_rules FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
  );

DROP POLICY IF EXISTS "workshop_rules_delete" ON workshop_rules;
CREATE POLICY "workshop_rules_delete"
  ON workshop_rules FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
  );
