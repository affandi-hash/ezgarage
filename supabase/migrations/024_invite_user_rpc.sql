-- 024: RPC to invite/create a new user within a tenant
-- Creates both the auth.users entry and the users profile row atomically.
-- Caller must be ops_manager or super_admin of the same tenant.

CREATE OR REPLACE FUNCTION create_tenant_user(
  p_email      text,
  p_full_name  text,
  p_role       text,
  p_branch_id  uuid DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_tenant_id   uuid;
  v_new_user_id uuid := gen_random_uuid();
BEGIN
  -- Verify caller is ops_manager or super_admin
  SELECT role::text, tenant_id
    INTO v_caller_role, v_tenant_id
    FROM users
   WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('ops_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: only ops_manager or super_admin can invite users';
  END IF;

  -- Check email not already taken
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(p_email)) THEN
    RAISE EXCEPTION 'A user with this email already exists';
  END IF;

  -- Create auth.users entry (email confirmed, random password — user will use forgot-password to set theirs)
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    role,
    aud
  ) VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    lower(p_email),
    crypt(gen_random_uuid()::text, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name),
    false,
    now(),
    now(),
    'authenticated',
    'authenticated'
  );

  -- Create users profile
  INSERT INTO users (
    id, tenant_id, branch_id, full_name, email, phone,
    role, approval_status, is_active
  ) VALUES (
    v_new_user_id,
    v_tenant_id,
    p_branch_id,
    p_full_name,
    lower(p_email),
    p_phone,
    p_role::user_role,
    'approved',
    true
  );

  RETURN v_new_user_id;
END;
$$;

-- Grant execute to authenticated users (RLS inside the function enforces role check)
GRANT EXECUTE ON FUNCTION create_tenant_user TO authenticated;
