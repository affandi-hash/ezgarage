-- 093: Give foreman full parity with ops_manager across the Attendance
-- module, per explicit request. 086 already granted foreman branch-wide
-- SELECT on attendance_records ("foreman needs this to review the day's
-- roster and approve OT") but the actual approval/edit policies were never
-- extended to match — foreman could see the roster but not act on it.
-- This closes that gap on every remaining ops_manager-only policy across
-- attendance_records, leave_requests, ot_requests, and staff_schedules.
-- attendance_records_delete is the one exception, kept admin/ops_manager-
-- only per 086's own stated reasoning (foreman doesn't need to delete
-- attendance records) — the user's request is about matching ops_manager's
-- working access, not deletion, and no complaint or need for delete was
-- raised.

DROP POLICY IF EXISTS attendance_records_insert ON attendance_records;
CREATE POLICY attendance_records_insert ON attendance_records FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND (
      (staff_id IN (SELECT staff_profiles.id FROM staff_profiles WHERE staff_profiles.user_id = auth.uid()))
      OR (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']))
    )
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS attendance_records_update ON attendance_records;
CREATE POLICY attendance_records_update ON attendance_records FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND (
      (staff_id IN (SELECT staff_profiles.id FROM staff_profiles WHERE staff_profiles.user_id = auth.uid()))
      OR (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']))
    )
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS leave_requests_select ON leave_requests;
CREATE POLICY leave_requests_select ON leave_requests FOR SELECT TO authenticated
  USING (
    (staff_id = get_my_staff_id())
    OR ((get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman'])) AND ((branch_id = get_my_branch_safe()) OR (get_my_role() = 'super_admin')))
  );

DROP POLICY IF EXISTS leave_requests_update ON leave_requests;
CREATE POLICY leave_requests_update ON leave_requests FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND (
      ((get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman'])) AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin')))
      OR ((staff_id IN (SELECT staff_profiles.id FROM staff_profiles WHERE staff_profiles.user_id = auth.uid())) AND (status = 'pending'))
    )
  );

DROP POLICY IF EXISTS leave_requests_delete ON leave_requests;
CREATE POLICY leave_requests_delete ON leave_requests FOR DELETE TO authenticated
  USING (
    is_active_user()
    AND (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']))
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS ot_requests_select ON ot_requests;
CREATE POLICY ot_requests_select ON ot_requests FOR SELECT TO authenticated
  USING (
    (staff_id = get_my_staff_id())
    OR ((get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman'])) AND ((branch_id = get_my_branch_safe()) OR (get_my_role() = 'super_admin')))
  );

DROP POLICY IF EXISTS ot_requests_update ON ot_requests;
CREATE POLICY ot_requests_update ON ot_requests FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND (
      ((get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman'])) AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin')))
      OR ((staff_id IN (SELECT staff_profiles.id FROM staff_profiles WHERE staff_profiles.user_id = auth.uid())) AND (status = 'pending'))
    )
  );

DROP POLICY IF EXISTS ot_requests_delete ON ot_requests;
CREATE POLICY ot_requests_delete ON ot_requests FOR DELETE TO authenticated
  USING (
    is_active_user()
    AND (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']))
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS staff_schedules_select ON staff_schedules;
CREATE POLICY staff_schedules_select ON staff_schedules FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND (
      (staff_id IN (SELECT staff_profiles.id FROM staff_profiles WHERE staff_profiles.user_id = auth.uid()))
      OR ((get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman'])) AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin')))
    )
  );

DROP POLICY IF EXISTS staff_schedules_insert ON staff_schedules;
CREATE POLICY staff_schedules_insert ON staff_schedules FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']))
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS staff_schedules_update ON staff_schedules;
CREATE POLICY staff_schedules_update ON staff_schedules FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']))
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );

DROP POLICY IF EXISTS staff_schedules_delete ON staff_schedules;
CREATE POLICY staff_schedules_delete ON staff_schedules FOR DELETE TO authenticated
  USING (
    is_active_user()
    AND (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']))
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );
