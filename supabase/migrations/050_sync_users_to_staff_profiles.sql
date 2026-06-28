-- 050: Sync users → staff_profiles
--
-- 1. Backfill existing users with workshop/management roles
-- 2. Trigger: auto-create staff_profile on INSERT or role UPDATE on users
--
-- Roles covered: foreman, mechanic, ops_manager, super_admin, front_desk,
--                parts_admin, finance, fleet_admin

-- ── 0. Allow null branch_id for super_admin / ceo users ─────────────────────
ALTER TABLE staff_profiles ALTER COLUMN branch_id DROP NOT NULL;

-- ── 1. Backfill ──────────────────────────────────────────────────────────────
INSERT INTO staff_profiles (
  user_id, full_name, phone, email,
  department, position,
  branch_id, tenant_id,
  is_active, employment_type, hire_date
)
SELECT
  u.id,
  u.full_name,
  u.phone,
  u.email,
  CASE u.role::text
    WHEN 'foreman'      THEN 'Workshop'
    WHEN 'mechanic'     THEN 'Workshop'
    WHEN 'parts_admin'  THEN 'Workshop'
    WHEN 'ops_manager'  THEN 'Management'
    WHEN 'super_admin'  THEN 'Management'
    WHEN 'front_desk'   THEN 'Customer Service'
    WHEN 'finance'      THEN 'Finance'
    WHEN 'fleet_admin'  THEN 'Fleet'
    ELSE 'General'
  END,
  INITCAP(REPLACE(u.role::text, '_', ' ')),
  u.branch_id,
  u.tenant_id,
  true,
  'Full-time',
  NOW()::date
FROM users u
WHERE u.role::text NOT IN ('customer', 'driver')
  AND NOT EXISTS (
    SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id
  );

-- ── 2. Trigger function ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_user_to_staff_profile()
RETURNS TRIGGER AS $$
DECLARE
  v_dept     TEXT;
  v_position TEXT;
BEGIN
  -- Skip non-staff roles
  IF NEW.role::text IN ('customer', 'driver') THEN
    RETURN NEW;
  END IF;

  -- Derive department & position from role
  v_dept := CASE NEW.role::text
    WHEN 'foreman'      THEN 'Workshop'
    WHEN 'mechanic'     THEN 'Workshop'
    WHEN 'parts_admin'  THEN 'Workshop'
    WHEN 'ops_manager'  THEN 'Management'
    WHEN 'super_admin'  THEN 'Management'
    WHEN 'front_desk'   THEN 'Customer Service'
    WHEN 'finance'      THEN 'Finance'
    WHEN 'fleet_admin'  THEN 'Fleet'
    ELSE 'General'
  END;
  v_position := INITCAP(REPLACE(NEW.role::text, '_', ' '));

  IF EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = NEW.id) THEN
    -- Role changed — update position/department to match
    IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
      UPDATE staff_profiles
      SET position   = v_position,
          department = v_dept
      WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- New staff — create profile
  INSERT INTO staff_profiles (
    user_id, full_name, phone, email,
    department, position,
    branch_id, tenant_id,
    is_active, employment_type, hire_date
  ) VALUES (
    NEW.id, NEW.full_name, NEW.phone, NEW.email,
    v_dept, v_position,
    NEW.branch_id, NEW.tenant_id,
    true, 'Full-time', NOW()::date
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Attach trigger ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_user_staff ON users;
CREATE TRIGGER trg_sync_user_staff
  AFTER INSERT OR UPDATE OF role ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_to_staff_profile();
