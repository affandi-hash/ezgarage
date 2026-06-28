-- ============================================================
-- Migration: 014_saas_tenants.sql
-- Description: Multi-tenant SaaS conversion for Motoverse MGOD V3
--              Each tenant is a separate workshop business.
-- Created: 2026-06-22
-- ============================================================


-- ============================================================
-- SECTION 1: tenants table
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  slug          text        UNIQUE NOT NULL,
  email         text        NOT NULL,
  phone         text,
  logo_url      text,
  address       text,
  city          text,
  state         text,
  country       text        NOT NULL DEFAULT 'Malaysia',
  plan          text        NOT NULL DEFAULT 'free',
  is_active     boolean     NOT NULL DEFAULT true,
  trial_ends_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);


-- ============================================================
-- SECTION 2: Add tenant_id to all existing tables
-- ============================================================

ALTER TABLE branches          ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE customers         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE vehicles          ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE jobs               ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE bookings           ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE parts_requests     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE job_photos         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE customer_updates   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE job_types          ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE wa_templates       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE workshop_rules     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE status_colors      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE audit_logs         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE staff_profiles     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE staff_schedules    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE leave_requests     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE ot_requests        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fleet_vehicles     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fleet_bookings     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fleet_trips        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fleet_issues       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fleet_maintenance  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fleet_costs        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fleet_documents    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE invoices           ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE users              ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);


-- ============================================================
-- SECTION 3: Indexes on tenant_id for every table
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_branches_tenant_id          ON branches          (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id         ON customers         (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id          ON vehicles          (tenant_id);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id              ON jobs              (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id          ON bookings          (tenant_id);
CREATE INDEX IF NOT EXISTS idx_parts_requests_tenant_id    ON parts_requests    (tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_photos_tenant_id        ON job_photos        (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_updates_tenant_id  ON customer_updates  (tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_types_tenant_id         ON job_types         (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_templates_tenant_id      ON wa_templates      (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workshop_rules_tenant_id    ON workshop_rules    (tenant_id);
CREATE INDEX IF NOT EXISTS idx_status_colors_tenant_id     ON status_colors     (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id        ON audit_logs        (tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_tenant_id    ON staff_profiles    (tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_tenant_id   ON staff_schedules   (tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_id ON attendance_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_id    ON leave_requests    (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ot_requests_tenant_id       ON ot_requests       (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_tenant_id    ON fleet_vehicles    (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_bookings_tenant_id    ON fleet_bookings    (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_trips_tenant_id       ON fleet_trips       (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_issues_tenant_id      ON fleet_issues      (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_maintenance_tenant_id ON fleet_maintenance (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_costs_tenant_id       ON fleet_costs       (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_documents_tenant_id   ON fleet_documents   (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id          ON invoices          (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id             ON users             (tenant_id);


-- ============================================================
-- SECTION 4: Helper functions (updated with get_my_tenant)
-- ============================================================

-- Returns the tenant_id of the currently authenticated user
CREATE OR REPLACE FUNCTION get_my_tenant() RETURNS uuid AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns the role of the currently authenticated user (unchanged)
CREATE OR REPLACE FUNCTION get_my_role() RETURNS text AS $$
  SELECT role::text FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns the branch_id of the currently authenticated user (unchanged)
CREATE OR REPLACE FUNCTION get_my_branch() RETURNS uuid AS $$
  SELECT branch_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns true if the current user is active and approved (unchanged)
CREATE OR REPLACE FUNCTION is_active_user() RETURNS boolean AS $$
  SELECT is_active AND approval_status = 'approved' FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- SECTION 5: Seed default tenant and backfill all existing rows
-- ============================================================

INSERT INTO tenants (id, name, slug, email, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Motoverse Garage', 'motoverse', 'affandi75@gmail.com', 'free')
ON CONFLICT (id) DO NOTHING;

UPDATE branches          SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE users             SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE customers         SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE vehicles          SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE jobs              SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE bookings          SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE parts_requests    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE job_photos        SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE customer_updates  SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE job_types         SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE wa_templates      SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE workshop_rules    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE status_colors     SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE audit_logs        SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE staff_profiles    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE staff_schedules   SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE attendance_records SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE leave_requests    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE ot_requests       SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE fleet_vehicles    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE fleet_bookings    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE fleet_trips       SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE fleet_issues      SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE fleet_maintenance SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE fleet_costs       SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE fleet_documents   SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE invoices          SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;


-- ============================================================
-- SECTION 6: Rebuild all RLS policies with tenant scoping
--
-- Rules:
--   super_admin  = platform-level admin; bypasses tenant filter entirely
--   ops_manager  = highest role within a tenant
--   All other roles are scoped to (tenant_id = get_my_tenant())
--
-- Pattern applied to every policy:
--   tenant_id = get_my_tenant() OR get_my_role() = 'super_admin'
-- ============================================================


-- ------------------------------------------------------------
-- TABLE: branches
-- ------------------------------------------------------------
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branches_select" ON branches;
CREATE POLICY "branches_select"
  ON branches FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "branches_insert" ON branches;
CREATE POLICY "branches_insert"
  ON branches FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "branches_update" ON branches;
CREATE POLICY "branches_update"
  ON branches FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "branches_delete" ON branches;
CREATE POLICY "branches_delete"
  ON branches FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: users
-- ------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select"
  ON users FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "users_update" ON users;
CREATE POLICY "users_update"
  ON users FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (
      id = auth.uid()
      OR get_my_role() = 'super_admin'
      OR get_my_role() = 'ops_manager'
    )
  );

DROP POLICY IF EXISTS "users_delete" ON users;
CREATE POLICY "users_delete"
  ON users FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: customers
-- ------------------------------------------------------------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select"
  ON customers FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_delete"
  ON customers FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: vehicles
-- ------------------------------------------------------------
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select"
  ON vehicles FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "vehicles_insert" ON vehicles;
CREATE POLICY "vehicles_insert"
  ON vehicles FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "vehicles_update" ON vehicles;
CREATE POLICY "vehicles_update"
  ON vehicles FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "vehicles_delete" ON vehicles;
CREATE POLICY "vehicles_delete"
  ON vehicles FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: bookings
-- ------------------------------------------------------------
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_select" ON bookings;
CREATE POLICY "bookings_select"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'foreman')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "bookings_insert" ON bookings;
CREATE POLICY "bookings_insert"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'foreman')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "bookings_update" ON bookings;
CREATE POLICY "bookings_update"
  ON bookings FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'foreman')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "bookings_delete" ON bookings;
CREATE POLICY "bookings_delete"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: jobs
-- ------------------------------------------------------------
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_select" ON jobs;
CREATE POLICY "jobs_select"
  ON jobs FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'front_desk')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "jobs_insert" ON jobs;
CREATE POLICY "jobs_insert"
  ON jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "jobs_update" ON jobs;
CREATE POLICY "jobs_update"
  ON jobs FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "jobs_delete" ON jobs;
CREATE POLICY "jobs_delete"
  ON jobs FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: parts_requests
-- ------------------------------------------------------------
ALTER TABLE parts_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parts_requests_select" ON parts_requests;
CREATE POLICY "parts_requests_select"
  ON parts_requests FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'parts_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "parts_requests_insert" ON parts_requests;
CREATE POLICY "parts_requests_insert"
  ON parts_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'parts_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "parts_requests_update" ON parts_requests;
CREATE POLICY "parts_requests_update"
  ON parts_requests FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'parts_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "parts_requests_delete" ON parts_requests;
CREATE POLICY "parts_requests_delete"
  ON parts_requests FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: job_photos
-- ------------------------------------------------------------
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_photos_select" ON job_photos;
CREATE POLICY "job_photos_select"
  ON job_photos FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "job_photos_insert" ON job_photos;
CREATE POLICY "job_photos_insert"
  ON job_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "job_photos_update" ON job_photos;
CREATE POLICY "job_photos_update"
  ON job_photos FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "job_photos_delete" ON job_photos;
CREATE POLICY "job_photos_delete"
  ON job_photos FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: customer_updates
-- ------------------------------------------------------------
ALTER TABLE customer_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_updates_select" ON customer_updates;
CREATE POLICY "customer_updates_select"
  ON customer_updates FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "customer_updates_insert" ON customer_updates;
CREATE POLICY "customer_updates_insert"
  ON customer_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "customer_updates_update" ON customer_updates;
CREATE POLICY "customer_updates_update"
  ON customer_updates FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "customer_updates_delete" ON customer_updates;
CREATE POLICY "customer_updates_delete"
  ON customer_updates FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: job_types
-- ------------------------------------------------------------
ALTER TABLE job_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_types_select" ON job_types;
CREATE POLICY "job_types_select"
  ON job_types FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "job_types_insert" ON job_types;
CREATE POLICY "job_types_insert"
  ON job_types FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "job_types_update" ON job_types;
CREATE POLICY "job_types_update"
  ON job_types FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "job_types_delete" ON job_types;
CREATE POLICY "job_types_delete"
  ON job_types FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: wa_templates
-- ------------------------------------------------------------
ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_templates_select" ON wa_templates;
CREATE POLICY "wa_templates_select"
  ON wa_templates FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "wa_templates_insert" ON wa_templates;
CREATE POLICY "wa_templates_insert"
  ON wa_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "wa_templates_update" ON wa_templates;
CREATE POLICY "wa_templates_update"
  ON wa_templates FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "wa_templates_delete" ON wa_templates;
CREATE POLICY "wa_templates_delete"
  ON wa_templates FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: workshop_rules
-- ------------------------------------------------------------
ALTER TABLE workshop_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workshop_rules_select" ON workshop_rules;
CREATE POLICY "workshop_rules_select"
  ON workshop_rules FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "workshop_rules_insert" ON workshop_rules;
CREATE POLICY "workshop_rules_insert"
  ON workshop_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "workshop_rules_update" ON workshop_rules;
CREATE POLICY "workshop_rules_update"
  ON workshop_rules FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "workshop_rules_delete" ON workshop_rules;
CREATE POLICY "workshop_rules_delete"
  ON workshop_rules FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: status_colors
-- ------------------------------------------------------------
ALTER TABLE status_colors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_colors_select" ON status_colors;
CREATE POLICY "status_colors_select"
  ON status_colors FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "status_colors_insert" ON status_colors;
CREATE POLICY "status_colors_insert"
  ON status_colors FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "status_colors_update" ON status_colors;
CREATE POLICY "status_colors_update"
  ON status_colors FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "status_colors_delete" ON status_colors;
CREATE POLICY "status_colors_delete"
  ON status_colors FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: staff_profiles
-- ------------------------------------------------------------
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_profiles_select" ON staff_profiles;
CREATE POLICY "staff_profiles_select"
  ON staff_profiles FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "staff_profiles_update" ON staff_profiles;
CREATE POLICY "staff_profiles_update"
  ON staff_profiles FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: staff_schedules
-- ------------------------------------------------------------
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_schedules_select" ON staff_schedules;
CREATE POLICY "staff_schedules_select"
  ON staff_schedules FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "staff_schedules_update" ON staff_schedules;
CREATE POLICY "staff_schedules_update"
  ON staff_schedules FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "staff_schedules_delete" ON staff_schedules;
CREATE POLICY "staff_schedules_delete"
  ON staff_schedules FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: attendance_records
-- ------------------------------------------------------------
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_records_select" ON attendance_records;
CREATE POLICY "attendance_records_select"
  ON attendance_records FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "attendance_records_delete" ON attendance_records;
CREATE POLICY "attendance_records_delete"
  ON attendance_records FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: leave_requests
-- ------------------------------------------------------------
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_requests_select" ON leave_requests;
CREATE POLICY "leave_requests_select"
  ON leave_requests FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "leave_requests_delete" ON leave_requests;
CREATE POLICY "leave_requests_delete"
  ON leave_requests FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: ot_requests
-- ------------------------------------------------------------
ALTER TABLE ot_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ot_requests_select" ON ot_requests;
CREATE POLICY "ot_requests_select"
  ON ot_requests FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
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
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "ot_requests_delete" ON ot_requests;
CREATE POLICY "ot_requests_delete"
  ON ot_requests FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: audit_logs
-- ------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );


-- ------------------------------------------------------------
-- TABLE: fleet_vehicles
-- ------------------------------------------------------------
ALTER TABLE fleet_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_vehicles_select" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_select"
  ON fleet_vehicles FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_vehicles_insert" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_insert"
  ON fleet_vehicles FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_vehicles_update" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_update"
  ON fleet_vehicles FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_vehicles_delete" ON fleet_vehicles;
CREATE POLICY "fleet_vehicles_delete"
  ON fleet_vehicles FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: fleet_bookings
-- ------------------------------------------------------------
ALTER TABLE fleet_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_bookings_select" ON fleet_bookings;
CREATE POLICY "fleet_bookings_select"
  ON fleet_bookings FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_bookings_insert" ON fleet_bookings;
CREATE POLICY "fleet_bookings_insert"
  ON fleet_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_bookings_update" ON fleet_bookings;
CREATE POLICY "fleet_bookings_update"
  ON fleet_bookings FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_bookings_delete" ON fleet_bookings;
CREATE POLICY "fleet_bookings_delete"
  ON fleet_bookings FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: fleet_trips
-- ------------------------------------------------------------
ALTER TABLE fleet_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_trips_select" ON fleet_trips;
CREATE POLICY "fleet_trips_select"
  ON fleet_trips FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'driver')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_trips_insert" ON fleet_trips;
CREATE POLICY "fleet_trips_insert"
  ON fleet_trips FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'driver')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_trips_update" ON fleet_trips;
CREATE POLICY "fleet_trips_update"
  ON fleet_trips FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_trips_delete" ON fleet_trips;
CREATE POLICY "fleet_trips_delete"
  ON fleet_trips FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: fleet_issues
-- ------------------------------------------------------------
ALTER TABLE fleet_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_issues_select" ON fleet_issues;
CREATE POLICY "fleet_issues_select"
  ON fleet_issues FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_issues_insert" ON fleet_issues;
CREATE POLICY "fleet_issues_insert"
  ON fleet_issues FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_issues_update" ON fleet_issues;
CREATE POLICY "fleet_issues_update"
  ON fleet_issues FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_issues_delete" ON fleet_issues;
CREATE POLICY "fleet_issues_delete"
  ON fleet_issues FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: fleet_maintenance
-- ------------------------------------------------------------
ALTER TABLE fleet_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_maintenance_select" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_select"
  ON fleet_maintenance FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_maintenance_insert" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_insert"
  ON fleet_maintenance FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_maintenance_update" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_update"
  ON fleet_maintenance FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_maintenance_delete" ON fleet_maintenance;
CREATE POLICY "fleet_maintenance_delete"
  ON fleet_maintenance FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: fleet_costs
-- ------------------------------------------------------------
ALTER TABLE fleet_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_costs_select" ON fleet_costs;
CREATE POLICY "fleet_costs_select"
  ON fleet_costs FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_costs_insert" ON fleet_costs;
CREATE POLICY "fleet_costs_insert"
  ON fleet_costs FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_costs_update" ON fleet_costs;
CREATE POLICY "fleet_costs_update"
  ON fleet_costs FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_costs_delete" ON fleet_costs;
CREATE POLICY "fleet_costs_delete"
  ON fleet_costs FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin', 'finance')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: fleet_documents
-- ------------------------------------------------------------
ALTER TABLE fleet_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_documents_select" ON fleet_documents;
CREATE POLICY "fleet_documents_select"
  ON fleet_documents FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_documents_insert" ON fleet_documents;
CREATE POLICY "fleet_documents_insert"
  ON fleet_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_documents_update" ON fleet_documents;
CREATE POLICY "fleet_documents_update"
  ON fleet_documents FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "fleet_documents_delete" ON fleet_documents;
CREATE POLICY "fleet_documents_delete"
  ON fleet_documents FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'fleet_admin')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );


-- ------------------------------------------------------------
-- TABLE: invoices
-- ------------------------------------------------------------
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
    AND (branch_id = get_my_branch() OR get_my_role() IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'finance')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "invoices_update" ON invoices;
CREATE POLICY "invoices_update"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'finance')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "invoices_delete" ON invoices;
CREATE POLICY "invoices_delete"
  ON invoices FOR DELETE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (tenant_id = get_my_tenant() OR get_my_role() = 'super_admin')
  );


-- ============================================================
-- END OF MIGRATION: 014_saas_tenants.sql
-- ============================================================
