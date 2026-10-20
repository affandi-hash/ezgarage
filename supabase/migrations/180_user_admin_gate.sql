-- 180: who may manage accounts.
--
-- Until now any ops manager could change any user's role (including their own) straight through the database, and could
-- create new accounts with any role through the invite service. For a company with the stricter rules on, managing accounts
-- is now for a super admin or the Branch Admin only (with the authenticator step, when the company requires it).
-- For every company, only a super admin can create or promote a super admin or platform admin, or change a super admin's
-- or Branch Admin's account. A company with the rules off (MAC) keeps its ops managers managing ordinary staff.
-- Everyone can still edit their own harmless details (name, phone, photo, last sign-in, the forced password change).

CREATE OR REPLACE FUNCTION users_privilege_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE mc text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;      -- functions, cron, the service role
  IF get_my_role() = 'super_admin' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'super_admin' OR coalesce(NEW.is_platform_admin, false) THEN
      RAISE EXCEPTION 'Only a super admin can create a super admin.' USING ERRCODE = '42501';
    END IF;
    mc := money_check(NEW.tenant_id, ARRAY['super_admin', 'ops_manager']);
    IF mc IS NOT NULL THEN RAISE EXCEPTION 'Only the Branch Admin or a super admin can add accounts.' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: harmless fields (name, phone, photo, last sign-in, must_change_password ...) are left alone
  IF (NEW.role, NEW.is_active, NEW.approval_status, NEW.branch_id, NEW.tenant_id, coalesce(NEW.is_platform_admin, false))
     IS NOT DISTINCT FROM (OLD.role, OLD.is_active, OLD.approval_status, OLD.branch_id, OLD.tenant_id, coalesce(OLD.is_platform_admin, false)) THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'Only a super admin can move an account to another company.' USING ERRCODE = '42501'; END IF;
  IF OLD.role = 'super_admin' OR coalesce(OLD.is_platform_admin, false) OR OLD.is_branch_admin THEN
    RAISE EXCEPTION 'Only a super admin can change this account.' USING ERRCODE = '42501';
  END IF;
  IF NEW.role = 'super_admin' OR coalesce(NEW.is_platform_admin, false) THEN RAISE EXCEPTION 'Only a super admin can make a super admin.' USING ERRCODE = '42501'; END IF;
  IF OLD.id = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own role or access.' USING ERRCODE = '42501'; END IF;
  mc := money_check(OLD.tenant_id, ARRAY['super_admin', 'ops_manager']);
  IF mc = 'mfa_required' THEN RAISE EXCEPTION 'Enter your authenticator code first (Security page).' USING ERRCODE = '42501'; END IF;
  IF mc IS NOT NULL THEN RAISE EXCEPTION 'Only the Branch Admin or a super admin can change roles and access.' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_privilege_guard ON users;
CREATE TRIGGER users_privilege_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_privilege_guard();

-- who can touch which rows
DROP POLICY IF EXISTS users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE TO authenticated
  USING (is_active_user() AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
         AND (id = auth.uid() OR get_my_role() = 'super_admin' OR money_check(tenant_id, ARRAY['super_admin', 'ops_manager']) IS NULL));
DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND (get_my_role() = 'super_admin' OR (tenant_id = get_my_tenant() AND money_check(tenant_id, ARRAY['super_admin', 'ops_manager']) IS NULL)));
DROP POLICY IF EXISTS users_delete ON users;
CREATE POLICY users_delete ON users FOR DELETE TO authenticated
  USING (is_active_user() AND (get_my_role() = 'super_admin' OR (tenant_id = get_my_tenant() AND money_check(tenant_id, ARRAY['super_admin', 'ops_manager']) IS NULL)));

-- every role or access change leaves an audit entry (who, whom, from what to what, from where)
CREATE OR REPLACE FUNCTION audit_user_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (NEW.role, NEW.is_active, NEW.approval_status, NEW.branch_id, coalesce(NEW.is_platform_admin, false), NEW.is_branch_admin)
     IS DISTINCT FROM (OLD.role, OLD.is_active, OLD.approval_status, OLD.branch_id, coalesce(OLD.is_platform_admin, false), OLD.is_branch_admin) THEN
    PERFORM insert_audit_log('user_access_changed', 'users', NEW.id, 'user',
      jsonb_build_object('target', NEW.full_name, 'role', jsonb_build_array(OLD.role, NEW.role), 'active', jsonb_build_array(OLD.is_active, NEW.is_active),
                         'branch_admin', jsonb_build_array(OLD.is_branch_admin, NEW.is_branch_admin)), NEW.branch_id, auth.uid(), NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_user_change ON users;
CREATE TRIGGER audit_user_change AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION audit_user_change();
