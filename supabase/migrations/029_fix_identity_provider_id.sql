-- 029: Fix auth.identities provider_id — must be the user UUID, not the email.
-- GoTrue looks up identities by provider='email' AND provider_id=user_id (UUID).
-- Using the email address as provider_id causes login to silently fail.

CREATE OR REPLACE FUNCTION create_tenant_user(
  p_email         text,
  p_full_name     text,
  p_role          text,
  p_branch_id     uuid    DEFAULT NULL,
  p_phone         text    DEFAULT NULL,
  p_temp_password text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_role text;
  v_tenant_id   uuid;
  v_new_user_id uuid := gen_random_uuid();
  v_password    text;
BEGIN
  SELECT role::text, tenant_id INTO v_caller_role, v_tenant_id
    FROM users WHERE id = auth.uid();

  IF v_caller_role NOT IN ('ops_manager', 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: only ops_manager or super_admin can invite users';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(p_email)) THEN
    RAISE EXCEPTION 'A user with this email already exists';
  END IF;

  v_password := COALESCE(NULLIF(trim(p_temp_password), ''), gen_random_uuid()::text);

  -- 1. Create auth user
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    created_at, updated_at, role, aud
  ) VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    lower(p_email),
    extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name),
    false, now(), now(), 'authenticated', 'authenticated'
  );

  -- 2. Attach email identity.
  --    provider_id MUST be the user UUID (not the email) — that is how GoTrue
  --    resolves email+password logins in this version of the auth schema.
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_new_user_id,
    v_new_user_id::text,   -- UUID, not email
    jsonb_build_object(
      'sub',            v_new_user_id::text,
      'email',          lower(p_email),
      'email_verified', false,
      'phone_verified', false
    ),
    'email',
    now(), now(), now()
  );

  -- 3. Create app user profile
  INSERT INTO users (
    id, tenant_id, branch_id, full_name, email, phone,
    role, approval_status, is_active, must_change_password
  ) VALUES (
    v_new_user_id, v_tenant_id, p_branch_id, p_full_name,
    lower(p_email), p_phone, p_role::user_role, 'approved', true, true
  );

  RETURN v_new_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_tenant_user TO authenticated;
