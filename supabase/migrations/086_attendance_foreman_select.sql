-- 086: Same gap as 085, on the SELECT side. attendance_records_select only
-- grants branch-wide visibility to super_admin/ops_manager — foreman can
-- only see their own row (via the staff_id-in-own-profile clause), so the
-- daily attendance overview (WHO'S IN TODAY, with the staff_profiles name
-- join) comes back empty or single-row for foreman, reading as "the
-- staff's name isn't shown."
--
-- Fix: add foreman to the branch-wide visibility clause, mirroring 085's
-- fix to attendance_records_update. Foreman needs this to review the
-- day's roster and approve OT, the same reason they need self-clock-out.
-- attendance_records_delete deliberately stays admin/ops_manager-only —
-- foreman doesn't need to delete attendance records, only view and
-- clock in/out.

DROP POLICY IF EXISTS attendance_records_select ON attendance_records;
CREATE POLICY attendance_records_select ON attendance_records FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND (
      (staff_id IN (SELECT staff_profiles.id FROM staff_profiles WHERE staff_profiles.user_id = auth.uid()))
      OR (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman']) AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin')))
    )
  );
