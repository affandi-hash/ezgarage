-- 084: Restore foreman's ability to see colleagues in their own branch
-- (needed to populate the mechanic-assignment dropdown in
-- WorkshopBoardPage), without reopening the cross-tenant staff-directory
-- leak that migration 079 closed.
--
-- Before 079, a leftover open policy (migration 031, USING(true)) let any
-- authenticated user read every user row regardless of tenant or role —
-- that's what made WorkshopBoardPage's direct `users` query work for
-- foreman too. Removing that leak also removed foreman's incidental
-- visibility into ops_manager's-only own-branch clause. Fix properly by
-- granting foreman the same own-branch visibility ops_manager already
-- has, rather than reopening it project-wide.
--
-- The outer tenant_id = get_my_tenant() condition (unless super_admin)
-- still applies unchanged, so this can never cross a tenant boundary —
-- only adds same-tenant, same-branch colleague visibility for foreman.

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT TO authenticated
  USING (
    is_active_user()
    AND ((tenant_id = get_my_tenant()) OR (get_my_role() = 'super_admin'))
    AND (
      (id = auth.uid())
      OR (get_my_role() = 'super_admin')
      OR (get_my_role() = ANY (ARRAY['ops_manager', 'foreman']) AND branch_id = get_my_branch())
    )
  );
