-- 052: Fix leave_requests + ot_requests INSERT policies
-- Original policies used get_my_branch() which reads users.branch_id (can be null)
-- and is_active_user() which requires approval_status='approved'.
-- Staff inserting their own records only need staff_id ownership check.

DROP POLICY IF EXISTS "leave_requests_insert" ON leave_requests;
CREATE POLICY "leave_requests_insert"
  ON leave_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "leave_requests_update" ON leave_requests;
CREATE POLICY "leave_requests_update"
  ON leave_requests FOR UPDATE
  TO authenticated
  USING (
    (get_my_role() IN ('super_admin', 'ops_manager')
      AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin'))
    OR (staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
        AND status = 'pending')
  );

DROP POLICY IF EXISTS "ot_requests_insert" ON ot_requests;
CREATE POLICY "ot_requests_insert"
  ON ot_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "ot_requests_update" ON ot_requests;
CREATE POLICY "ot_requests_update"
  ON ot_requests FOR UPDATE
  TO authenticated
  USING (
    (get_my_role() IN ('super_admin', 'ops_manager')
      AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin'))
    OR (staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
        AND status = 'pending')
  );
