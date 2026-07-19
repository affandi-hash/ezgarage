-- 090: Same regression class as 084 (foreman), for the remaining
-- WorkshopBoardPage roles. That page's own allowedRoles is
-- ['super_admin','ops_manager','front_desk','foreman','mechanic'] — but
-- users_select's branch-wide visibility clause only ever covered
-- ops_manager/foreman. A mechanic (or front_desk) viewing the board's job
-- cards has the assigned_foreman/assigned_mechanic `users` embed return
-- null for anyone but themselves, showing "FMN —" / "MEC —" instead of
-- colleague names — reported directly by a real tenant.
--
-- Fix: add mechanic and front_desk to the same own-branch clause foreman
-- already has. Tenant and branch scoping are untouched — this only adds
-- more ROLES to the same already-scoped condition, not more reach.

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND (
      (id = auth.uid())
      OR (get_my_role() = 'super_admin')
      OR (get_my_role() = ANY (ARRAY['ops_manager', 'foreman', 'mechanic', 'front_desk']) AND branch_id = get_my_branch())
    )
  );
