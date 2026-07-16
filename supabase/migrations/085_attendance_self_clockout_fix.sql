-- 085: Fix a regression from 079 that silently broke clock-out for every
-- non-admin/ops_manager employee.
--
-- 079 dropped the legacy `attendance_update` policy (USING(true)-style,
-- letting any staff edit any colleague's attendance in-branch — a real
-- security gap) without replacing it with a properly-scoped self-service
-- rule. attendance_records_update only ever allowed super_admin/ops_manager
-- to UPDATE a row — there was no "you can update your own row" clause,
-- unlike attendance_records_insert (used for clock-in) which already has
-- exactly that clause.
--
-- Net effect since 079: clock-in worked (INSERT, self-service clause
-- present) but clock-out silently failed for everyone else — the
-- frontend's `.update()` call has no `.select()`, so PostgREST returns
-- success with zero rows affected when RLS blocks it, and the UI reports
-- "Clocked out" while nothing was actually saved. Confirmed against real
-- production data: a real employee's selfie was uploaded to storage three
-- times today while their attendance_records row stayed clock_out_time =
-- null throughout.
--
-- Fix: add the same "own staff_id" clause the INSERT policy already has.
-- This only lets someone touch their OWN row — it does not reopen the
-- any-colleague-in-branch hole that 079 correctly closed.

DROP POLICY IF EXISTS attendance_records_update ON attendance_records;
CREATE POLICY attendance_records_update ON attendance_records FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND (
      (staff_id IN (SELECT staff_profiles.id FROM staff_profiles WHERE staff_profiles.user_id = auth.uid()))
      OR (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']))
    )
    AND ((branch_id = get_my_branch()) OR (get_my_role() = 'super_admin'))
  );
