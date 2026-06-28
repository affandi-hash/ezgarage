-- 028: Admin RPC to directly reset a user's password.
-- No email required — ops_manager/super_admin sets the temp password directly.
-- User is forced to change it on next login via must_change_password flag.

CREATE OR REPLACE FUNCTION reset_user_password(
  p_user_id    uuid,
  p_new_password text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_role text;
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  -- Verify caller is ops_manager or super_admin
  SELECT role::text, tenant_id INTO v_caller_role, v_caller_tenant
    FROM users WHERE id = auth.uid();

  IF v_caller_role NOT IN ('ops_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: only ops_manager or super_admin can reset passwords';
  END IF;

  -- Verify password length
  IF length(trim(p_new_password)) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  -- For non-super_admin: ensure target user is in the same tenant
  IF v_caller_role != 'super_admin' THEN
    SELECT tenant_id INTO v_target_tenant FROM users WHERE id = p_user_id;
    IF v_target_tenant IS DISTINCT FROM v_caller_tenant THEN
      RAISE EXCEPTION 'Permission denied: cannot reset password for user in another tenant';
    END IF;
  END IF;

  -- Update the password with cost-10 bcrypt (required by GoTrue)
  UPDATE auth.users
    SET encrypted_password = extensions.crypt(trim(p_new_password), extensions.gen_salt('bf', 10)),
        updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found in auth system';
  END IF;

  -- Force password change on next login
  UPDATE users SET must_change_password = true WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_user_password TO authenticated;
