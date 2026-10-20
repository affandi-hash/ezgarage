-- Assign Branch Admin to affandi75@gmail.com (the account named Fandi, ops manager, Motoverse Garage), as instructed by Affandi.
-- Run with:  supabase db query --linked -f supabase/corrections/2026-10-20_01_assign_branch_admin.sql
DO $$
DECLARE uid constant uuid := 'a83f466e-7ec1-42e7-a2f8-3a7a69d6c14a'; n int;
BEGIN
  SELECT count(*) INTO n FROM users WHERE id = uid AND email = 'affandi75@gmail.com' AND is_active;
  IF n <> 1 THEN RAISE EXCEPTION 'Account not found as expected. Nothing changed.'; END IF;
  UPDATE users SET is_branch_admin = true WHERE id = uid;
  PERFORM insert_audit_log('branch_admin_assigned', 'users', uid, 'user',
    jsonb_build_object('email', 'affandi75@gmail.com', 'reason', 'assigned by Affandi'), NULL, '34b8b6ab-4278-4739-99b1-dc555c68624d'::uuid, 'c20ef6dc-4f38-4291-bb15-a4eb86c17520'::uuid);
END $$;
