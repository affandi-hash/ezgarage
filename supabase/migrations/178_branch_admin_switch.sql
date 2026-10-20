-- 178: a per-person "Branch Admin" switch.
--
-- Branch Admin is the person trusted with the money powers (voiding payments, changing issued invoices, supplier payments,
-- proof on payments, approving cancellations after work has started). This migration only adds the switch and protects it;
-- nothing checks it yet, so nobody's access changes.
--
-- Only a super admin can turn it on or off, and nobody can change their own. New users start with it off.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_branch_admin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION users_branch_admin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_branch_admin := false;
    ELSIF NEW.is_branch_admin IS DISTINCT FROM OLD.is_branch_admin THEN
      IF get_my_role() IS DISTINCT FROM 'super_admin' THEN
        RAISE EXCEPTION 'Only a super admin can change Branch Admin.' USING ERRCODE = '42501';
      END IF;
      IF NEW.id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot change your own Branch Admin setting.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_branch_admin_guard ON users;
CREATE TRIGGER users_branch_admin_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_branch_admin_guard();
