-- ============================================================
-- Migration: 012_rls_policies.sql
-- Description: Row Level Security policies for Motoverse MGOD V3
-- Created: 2026-06-21
-- ============================================================

-- ------------------------------------------------------------
-- HELPER FUNCTIONS
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_my_role() RETURNS text AS $$
  SELECT role::text FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_branch() RETURNS uuid AS $$
  SELECT branch_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_active_user() RETURNS boolean AS $$
  SELECT is_active AND approval_status = 'approved' FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- TABLE: branches
-- ============================================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branches_select" ON branches;
CREATE POLICY "branches_select"
  ON branches FOR SELECT
  TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS "branches_insert" ON branches;
CREATE POLICY "branches_insert"
  ON branches FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "branches_update" ON branches;
CREATE POLICY "branches_update"
  ON branches FOR UPDATE
  TO authenticated
  USING (is_active_user() AND get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "branches_delete" ON branches;
CREATE POLICY "branches_delete"
  ON branches FOR DELETE
  TO authenticated
  USING (get_my_role() = 'super_admin');


-- ============================================================
-- TABLE: users
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can see their own row, ops_manager sees branch, super_admin sees all
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select"
  ON users FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (
      id = auth.uid()
      OR get_my_role() = 'super_admin'
      OR (get_my_role() = 'ops_manager' AND branch_id = get_my_branch())
    )
  );

DROP POLICY IF EXISTS "users_insert" ON users;
CREATE POLICY "users_insert"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "users_update" ON users;
CREATE POLICY "users_update"
  ON users FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (
      id = auth.uid()
      OR get_my_role() = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "users_delete" ON users;
CREATE POLICY "users_delete"
  ON users FOR DELETE
  TO authenticated
  USING (get_my_role() = 'super_admin');


-- ============================================================
-- TABLE: customers
-- ============================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select"
  ON customers FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_delete"
  ON customers FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: vehicles
-- ============================================================
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select"
  ON vehicles FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "vehicles_insert" ON vehicles;
CREATE POLICY "vehicles_insert"
  ON vehicles FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "vehicles_update" ON vehicles;
CREATE POLICY "vehicles_update"
  ON vehicles FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "vehicles_delete" ON vehicles;
CREATE POLICY "vehicles_delete"
  ON vehicles FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: bookings
-- ============================================================
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_select" ON bookings;
CREATE POLICY "bookings_select"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'foreman')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "bookings_insert" ON bookings;
CREATE POLICY "bookings_insert"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'foreman')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "bookings_update" ON bookings;
CREATE POLICY "bookings_update"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'foreman')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "bookings_delete" ON bookings;
CREATE POLICY "bookings_delete"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: jobs
-- ============================================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_select" ON jobs;
CREATE POLICY "jobs_select"
  ON jobs FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'front_desk')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "jobs_insert" ON jobs;
CREATE POLICY "jobs_insert"
  ON jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "jobs_update" ON jobs;
CREATE POLICY "jobs_update"
  ON jobs FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "jobs_delete" ON jobs;
CREATE POLICY "jobs_delete"
  ON jobs FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: parts_requests
-- ============================================================
ALTER TABLE parts_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parts_requests_select" ON parts_requests;
CREATE POLICY "parts_requests_select"
  ON parts_requests FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'parts_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "parts_requests_insert" ON parts_requests;
CREATE POLICY "parts_requests_insert"
  ON parts_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'parts_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "parts_requests_update" ON parts_requests;
CREATE POLICY "parts_requests_update"
  ON parts_requests FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'parts_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "parts_requests_delete" ON parts_requests;
CREATE POLICY "parts_requests_delete"
  ON parts_requests FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: job_photos
-- ============================================================
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_photos_select" ON job_photos;
CREATE POLICY "job_photos_select"
  ON job_photos FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "job_photos_insert" ON job_photos;
CREATE POLICY "job_photos_insert"
  ON job_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "job_photos_update" ON job_photos;
CREATE POLICY "job_photos_update"
  ON job_photos FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "job_photos_delete" ON job_photos;
CREATE POLICY "job_photos_delete"
  ON job_photos FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: customer_updates
-- ============================================================
ALTER TABLE customer_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_updates_select" ON customer_updates;
CREATE POLICY "customer_updates_select"
  ON customer_updates FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "customer_updates_insert" ON customer_updates;
CREATE POLICY "customer_updates_insert"
  ON customer_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "customer_updates_update" ON customer_updates;
CREATE POLICY "customer_updates_update"
  ON customer_updates FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "customer_updates_delete" ON customer_updates;
CREATE POLICY "customer_updates_delete"
  ON customer_updates FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: job_types
-- ============================================================
ALTER TABLE job_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_types_select" ON job_types;
CREATE POLICY "job_types_select"
  ON job_types FOR SELECT
  TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS "job_types_insert" ON job_types;
CREATE POLICY "job_types_insert"
  ON job_types FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND get_my_role() IN ('super_admin', 'ops_manager'));

DROP POLICY IF EXISTS "job_types_update" ON job_types;
CREATE POLICY "job_types_update"
  ON job_types FOR UPDATE
  TO authenticated
  USING (is_active_user() AND get_my_role() IN ('super_admin', 'ops_manager'));

DROP POLICY IF EXISTS "job_types_delete" ON job_types;
CREATE POLICY "job_types_delete"
  ON job_types FOR DELETE
  TO authenticated
  USING (get_my_role() IN ('super_admin', 'ops_manager'));


-- ============================================================
-- TABLE: wa_templates
-- ============================================================
ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_templates_select" ON wa_templates;
CREATE POLICY "wa_templates_select"
  ON wa_templates FOR SELECT
  TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS "wa_templates_insert" ON wa_templates;
CREATE POLICY "wa_templates_insert"
  ON wa_templates FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND get_my_role() IN ('super_admin', 'ops_manager'));

DROP POLICY IF EXISTS "wa_templates_update" ON wa_templates;
CREATE POLICY "wa_templates_update"
  ON wa_templates FOR UPDATE
  TO authenticated
  USING (is_active_user() AND get_my_role() IN ('super_admin', 'ops_manager'));

DROP POLICY IF EXISTS "wa_templates_delete" ON wa_templates;
CREATE POLICY "wa_templates_delete"
  ON wa_templates FOR DELETE
  TO authenticated
  USING (get_my_role() IN ('super_admin', 'ops_manager'));


-- ============================================================
-- TABLE: workshop_rules
-- ============================================================
ALTER TABLE workshop_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workshop_rules_select" ON workshop_rules;
CREATE POLICY "workshop_rules_select"
  ON workshop_rules FOR SELECT
  TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS "workshop_rules_insert" ON workshop_rules;
CREATE POLICY "workshop_rules_insert"
  ON workshop_rules FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "workshop_rules_update" ON workshop_rules;
CREATE POLICY "workshop_rules_update"
  ON workshop_rules FOR UPDATE
  TO authenticated
  USING (is_active_user() AND get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "workshop_rules_delete" ON workshop_rules;
CREATE POLICY "workshop_rules_delete"
  ON workshop_rules FOR DELETE
  TO authenticated
  USING (get_my_role() = 'super_admin');


-- ============================================================
-- TABLE: status_colors
-- ============================================================
ALTER TABLE status_colors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_colors_select" ON status_colors;
CREATE POLICY "status_colors_select"
  ON status_colors FOR SELECT
  TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS "status_colors_insert" ON status_colors;
CREATE POLICY "status_colors_insert"
  ON status_colors FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user() AND get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "status_colors_update" ON status_colors;
CREATE POLICY "status_colors_update"
  ON status_colors FOR UPDATE
  TO authenticated
  USING (is_active_user() AND get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "status_colors_delete" ON status_colors;
CREATE POLICY "status_colors_delete"
  ON status_colors FOR DELETE
  TO authenticated
  USING (get_my_role() = 'super_admin');


-- ============================================================
-- TABLE: staff_profiles
-- ============================================================
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

-- ops_manager/super_admin see all in branch, other staff see only own row
DROP POLICY IF EXISTS "staff_profiles_select" ON staff_profiles;
CREATE POLICY "staff_profiles_select"
  ON staff_profiles FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (
      user_id = auth.uid()
      OR (
        get_my_role() IN ('super_admin', 'ops_manager')
        AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS "staff_profiles_insert" ON staff_profiles;
CREATE POLICY "staff_profiles_insert"
  ON staff_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "staff_profiles_update" ON staff_profiles;
CREATE POLICY "staff_profiles_update"
  ON staff_profiles FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (
      user_id = auth.uid()
      OR (get_my_role() IN ('super_admin', 'ops_manager') AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin'))
    )
  );

DROP POLICY IF EXISTS "staff_profiles_delete" ON staff_profiles;
CREATE POLICY "staff_profiles_delete"
  ON staff_profiles FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: staff_schedules
-- ============================================================
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;

-- Staff can SELECT their own schedule, ops_manager/super_admin manage all
DROP POLICY IF EXISTS "staff_schedules_select" ON staff_schedules;
CREATE POLICY "staff_schedules_select"
  ON staff_schedules FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (
      staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
      OR (
        get_my_role() IN ('super_admin', 'ops_manager')
        AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS "staff_schedules_insert" ON staff_schedules;
CREATE POLICY "staff_schedules_insert"
  ON staff_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "staff_schedules_update" ON staff_schedules;
CREATE POLICY "staff_schedules_update"
  ON staff_schedules FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "staff_schedules_delete" ON staff_schedules;
CREATE POLICY "staff_schedules_delete"
  ON staff_schedules FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: attendance_records
-- ============================================================
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- Staff can INSERT and SELECT their own, ops_manager/super_admin manage all in branch
DROP POLICY IF EXISTS "attendance_records_select" ON attendance_records;
CREATE POLICY "attendance_records_select"
  ON attendance_records FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (
      staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
      OR (
        get_my_role() IN ('super_admin', 'ops_manager')
        AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS "attendance_records_insert" ON attendance_records;
CREATE POLICY "attendance_records_insert"
  ON attendance_records FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (
      staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
      OR get_my_role() IN ('super_admin', 'ops_manager')
    )
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "attendance_records_update" ON attendance_records;
CREATE POLICY "attendance_records_update"
  ON attendance_records FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "attendance_records_delete" ON attendance_records;
CREATE POLICY "attendance_records_delete"
  ON attendance_records FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: leave_requests
-- ============================================================
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_requests_select" ON leave_requests;
CREATE POLICY "leave_requests_select"
  ON leave_requests FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (
      staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
      OR (
        get_my_role() IN ('super_admin', 'ops_manager')
        AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS "leave_requests_insert" ON leave_requests;
CREATE POLICY "leave_requests_insert"
  ON leave_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (
      staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
      OR get_my_role() IN ('super_admin', 'ops_manager')
    )
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "leave_requests_update" ON leave_requests;
CREATE POLICY "leave_requests_update"
  ON leave_requests FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "leave_requests_delete" ON leave_requests;
CREATE POLICY "leave_requests_delete"
  ON leave_requests FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: ot_requests
-- ============================================================
ALTER TABLE ot_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ot_requests_select" ON ot_requests;
CREATE POLICY "ot_requests_select"
  ON ot_requests FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (
      staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
      OR (
        get_my_role() IN ('super_admin', 'ops_manager')
        AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS "ot_requests_insert" ON ot_requests;
CREATE POLICY "ot_requests_insert"
  ON ot_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (
      staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
      OR get_my_role() IN ('super_admin', 'ops_manager')
    )
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "ot_requests_update" ON ot_requests;
CREATE POLICY "ot_requests_update"
  ON ot_requests FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "ot_requests_delete" ON ot_requests;
CREATE POLICY "ot_requests_delete"
  ON ot_requests FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: audit_logs
-- ============================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT only for super_admin/ops_manager, no client INSERT (triggers/functions only)
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: fleet_vehicles
-- ============================================================
ALTER TABLE fleet_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_vehicles_select" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_select"
  ON fleet_vehicles FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_vehicles_insert" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_insert"
  ON fleet_vehicles FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_vehicles_update" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_update"
  ON fleet_vehicles FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_vehicles_delete" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_delete"
  ON fleet_vehicles FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: fleet_trips
-- ============================================================
ALTER TABLE fleet_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_trips_select" ON fleet_trips;
CREATE POLICY "fleet_trips_select"
  ON fleet_trips FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'driver')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_trips_insert" ON fleet_trips;
CREATE POLICY "fleet_trips_insert"
  ON fleet_trips FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'driver')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_trips_update" ON fleet_trips;
CREATE POLICY "fleet_trips_update"
  ON fleet_trips FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_trips_delete" ON fleet_trips;
CREATE POLICY "fleet_trips_delete"
  ON fleet_trips FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: fleet_issues
-- ============================================================
ALTER TABLE fleet_issues ENABLE ROW LEVEL SECURITY;

-- Any active staff can INSERT (report an issue), fleet_admin/ops_manager/super_admin manage
DROP POLICY IF EXISTS "fleet_issues_select" ON fleet_issues;
CREATE POLICY "fleet_issues_select"
  ON fleet_issues FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_issues_insert" ON fleet_issues;
CREATE POLICY "fleet_issues_insert"
  ON fleet_issues FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_issues_update" ON fleet_issues;
CREATE POLICY "fleet_issues_update"
  ON fleet_issues FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_issues_delete" ON fleet_issues;
CREATE POLICY "fleet_issues_delete"
  ON fleet_issues FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: fleet_maintenance
-- ============================================================
ALTER TABLE fleet_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_maintenance_select" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_select"
  ON fleet_maintenance FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_maintenance_insert" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_insert"
  ON fleet_maintenance FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_maintenance_update" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_update"
  ON fleet_maintenance FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_maintenance_delete" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_delete"
  ON fleet_maintenance FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: fleet_costs
-- ============================================================
ALTER TABLE fleet_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_costs_select" ON fleet_costs;
CREATE POLICY "fleet_costs_select"
  ON fleet_costs FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_costs_insert" ON fleet_costs;
CREATE POLICY "fleet_costs_insert"
  ON fleet_costs FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_costs_update" ON fleet_costs;
CREATE POLICY "fleet_costs_update"
  ON fleet_costs FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_costs_delete" ON fleet_costs;
CREATE POLICY "fleet_costs_delete"
  ON fleet_costs FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: fleet_documents
-- ============================================================
ALTER TABLE fleet_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_documents_select" ON fleet_documents;
CREATE POLICY "fleet_documents_select"
  ON fleet_documents FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_documents_insert" ON fleet_documents;
CREATE POLICY "fleet_documents_insert"
  ON fleet_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_documents_update" ON fleet_documents;
CREATE POLICY "fleet_documents_update"
  ON fleet_documents FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_documents_delete" ON fleet_documents;
CREATE POLICY "fleet_documents_delete"
  ON fleet_documents FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- TABLE: fleet_bookings
-- ============================================================
ALTER TABLE fleet_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_bookings_select" ON fleet_bookings;
CREATE POLICY "fleet_bookings_select"
  ON fleet_bookings FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_bookings_insert" ON fleet_bookings;
CREATE POLICY "fleet_bookings_insert"
  ON fleet_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_bookings_update" ON fleet_bookings;
CREATE POLICY "fleet_bookings_update"
  ON fleet_bookings FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "fleet_bookings_delete" ON fleet_bookings;
CREATE POLICY "fleet_bookings_delete"
  ON fleet_bookings FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- END OF MIGRATION: 012_rls_policies.sql
-- ============================================================
