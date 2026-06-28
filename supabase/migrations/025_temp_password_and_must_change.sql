-- 025: Temporary password flow for invited users
-- Adds must_change_password flag + updates RPC to accept a temp password

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Enable pgcrypto so crypt/gen_salt are available
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- Recreate function with temp password support
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
SET search_path = public
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

  -- Use provided temp password or fall back to a random UUID
  v_password := COALESCE(NULLIF(trim(p_temp_password), ''), gen_random_uuid()::text);

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    created_at, updated_at, role, aud
  ) VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    lower(p_email),
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name),
    false, now(), now(), 'authenticated', 'authenticated'
  );

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
