-- MGOD V3 Full Schema Rebuild
-- Migration 010: Enums, tables, indexes

-- Drop dependent tables first, then enums, then recreate all

DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS staff_profiles CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS parts_requests CASCADE;
DROP TABLE IF EXISTS job_photos CASCADE;
DROP TABLE IF EXISTS customer_updates CASCADE;
DROP TABLE IF EXISTS job_types CASCADE;
DROP TABLE IF EXISTS wa_templates CASCADE;
DROP TABLE IF EXISTS workshop_rules CASCADE;
DROP TABLE IF EXISTS status_colors CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS staff_schedules CASCADE;
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS leave_requests CASCADE;
DROP TABLE IF EXISTS ot_requests CASCADE;
DROP TABLE IF EXISTS fleet_vehicles CASCADE;
DROP TABLE IF EXISTS fleet_bookings CASCADE;
DROP TABLE IF EXISTS fleet_trips CASCADE;
DROP TABLE IF EXISTS fleet_issues CASCADE;
DROP TABLE IF EXISTS fleet_maintenance CASCADE;
DROP TABLE IF EXISTS fleet_costs CASCADE;
DROP TABLE IF EXISTS fleet_documents CASCADE;
DROP SEQUENCE IF EXISTS booking_seq CASCADE;

DROP TYPE IF EXISTS job_status CASCADE;
DROP TYPE IF EXISTS booking_status CASCADE;
DROP TYPE IF EXISTS arrival_mode CASCADE;
DROP TYPE IF EXISTS vehicle_type CASCADE;
DROP TYPE IF EXISTS customer_type CASCADE;
DROP TYPE IF EXISTS customer_status_type CASCADE;
DROP TYPE IF EXISTS booking_source CASCADE;
DROP TYPE IF EXISTS parts_status CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS user_approval_status CASCADE;
DROP TYPE IF EXISTS attendance_status CASCADE;
DROP TYPE IF EXISTS leave_type CASCADE;
DROP TYPE IF EXISTS approval_status CASCADE;
DROP TYPE IF EXISTS photo_category CASCADE;
DROP TYPE IF EXISTS fleet_vehicle_status CASCADE;
DROP TYPE IF EXISTS fleet_booking_status CASCADE;
DROP TYPE IF EXISTS fleet_issue_severity CASCADE;
DROP TYPE IF EXISTS fleet_issue_status CASCADE;

CREATE TYPE job_status AS ENUM ('new','booked','checked_in','diagnosing','waiting_approval','waiting_parts','in_progress','ready','closed','long_due');

CREATE TYPE booking_status AS ENUM ('tentative','confirmed','checked_in','completed','cancelled','no_show');

CREATE TYPE arrival_mode AS ENUM ('drive_in','on_site_service','pick_up');

CREATE TYPE vehicle_type AS ENUM ('car','bike');

CREATE TYPE customer_type AS ENUM ('walk_in','online_booking','fleet','internal','referral');

CREATE TYPE customer_status_type AS ENUM ('active','inactive','blacklist');

CREATE TYPE booking_source AS ENUM ('website','whatsapp','tiktok','facebook','walk_in','referral','call','other');

CREATE TYPE parts_status AS ENUM ('requested','ordered','received','installed','cancelled');

CREATE TYPE payment_status AS ENUM ('unpaid','partial','paid','waived');

CREATE TYPE user_role AS ENUM ('super_admin','ops_manager','front_desk','foreman','mechanic','parts_admin','finance','fleet_admin','driver','customer');

CREATE TYPE user_approval_status AS ENUM ('pending','approved','rejected','suspended');

CREATE TYPE attendance_status AS ENUM ('present','late','absent','half_day','on_leave','mc','emergency_leave','off_day','overtime','early_checkout');

CREATE TYPE leave_type AS ENUM ('annual','medical','emergency','unpaid');

CREATE TYPE approval_status AS ENUM ('pending','approved','rejected');

CREATE TYPE photo_category AS ENUM ('check_in','diagnosis','parts_condition','repair_progress','before_repair','after_repair','damage_evidence','ready_pickup','customer_approval');

CREATE TYPE fleet_vehicle_status AS ENUM ('available','reserved','in_use','under_service','breakdown','retired','sold');

CREATE TYPE fleet_booking_status AS ENUM ('submitted','pending_approval','approved','rejected','vehicle_assigned','completed','cancelled');

CREATE TYPE fleet_issue_severity AS ENUM ('low','medium','high','critical');

CREATE TYPE fleet_issue_status AS ENUM ('new','under_review','approved_for_repair','under_repair','waiting_parts','fixed','closed','rejected');

-- BRANCHES (expand)

ALTER TABLE branches ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS latitude numeric(10,7);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS longitude numeric(10,7);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS geofence_radius_m integer DEFAULT 500;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS work_start_time time DEFAULT '09:00:00';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS work_end_time time DEFAULT '18:00:00';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS work_days text[] DEFAULT ARRAY['mon','tue','wed','thu','fri','sat'];
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- USERS (system access)

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  role user_role NOT NULL DEFAULT 'mechanic',
  approval_status user_approval_status NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  branch_id uuid REFERENCES branches(id),
  avatar_url text,
  is_active boolean DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- STAFF PROFILES (HR records)

CREATE TABLE IF NOT EXISTS staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES branches(id),
  full_name text NOT NULL,
  phone text,
  email text,
  ic_number text,
  address text,
  department text,
  position text,
  specialty text[],
  hire_date date,
  employment_type text DEFAULT 'full_time',
  is_active boolean DEFAULT true,
  bank_name text,
  bank_account text,
  emergency_name text,
  emergency_phone text,
  emergency_relation text,
  insurance_provider text,
  insurance_policy text,
  insurance_expiry date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- CUSTOMERS (expand)

ALTER TABLE customers ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ic_number text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ic_last4 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type text DEFAULT 'walk_in';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_status text DEFAULT 'active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes text;

-- VEHICLES (expand)

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_type text DEFAULT 'car';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS year integer;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ic_last4 text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_mileage integer;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_visit_at timestamptz;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes text;

-- BOOKINGS

CREATE SEQUENCE IF NOT EXISTS booking_seq START 1;

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number text UNIQUE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid REFERENCES customers(id),
  vehicle_id uuid REFERENCES vehicles(id),
  customer_name text,
  customer_phone text,
  customer_ic_last4 text,
  vehicle_plate text,
  vehicle_type text,
  vehicle_brand text,
  vehicle_model text,
  booking_date date NOT NULL,
  booking_time time,
  service_type text NOT NULL,
  arrival_mode text DEFAULT 'drive_in',
  source text DEFAULT 'walk_in',
  problem_description text,
  address text,
  deposit_amount numeric(10,2) DEFAULT 0,
  deposit_paid boolean DEFAULT false,
  assigned_staff_id uuid REFERENCES users(id),
  status text DEFAULT 'tentative',
  notes text,
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  cancelled_reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_booking_number() RETURNS trigger AS $$
BEGIN
  NEW.booking_number := 'BK-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('booking_seq')::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_booking_number ON bookings;
CREATE TRIGGER set_booking_number BEFORE INSERT ON bookings FOR EACH ROW WHEN (NEW.booking_number IS NULL) EXECUTE FUNCTION generate_booking_number();

-- JOB CARDS (expand jobs)

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS vehicle_type text DEFAULT 'car';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status text DEFAULT 'checked_in';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS arrival_mode text DEFAULT 'drive_in';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source text DEFAULT 'walk_in';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mileage_in integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fuel_level text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_complaint text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS diagnosis_summary text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_cost numeric(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_approved boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_approved_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_foreman_id uuid REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_mechanic_id uuid REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_update_due timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS escalation_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS internal_notes text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_update_notes text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS final_amount numeric(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS checked_in_at timestamptz DEFAULT now();
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS days_in_garage integer;

-- PARTS REQUESTS

CREATE TABLE IF NOT EXISTS parts_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id),
  part_name text NOT NULL,
  part_number text,
  quantity integer NOT NULL DEFAULT 1,
  unit text DEFAULT 'pcs',
  supplier text,
  cost_price numeric(10,2),
  selling_price numeric(10,2),
  status text DEFAULT 'requested',
  requested_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  ordered_at timestamptz,
  eta timestamptz,
  received_at timestamptz,
  installed_at timestamptz,
  notes text,
  invoice_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- JOB PHOTOS

CREATE TABLE IF NOT EXISTS job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  category text NOT NULL,
  storage_path text NOT NULL,
  caption text,
  uploaded_by uuid REFERENCES users(id),
  visible_to_customer boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- CUSTOMER UPDATES

CREATE TABLE IF NOT EXISTS customer_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  message text NOT NULL,
  channel text DEFAULT 'whatsapp',
  sent_by uuid REFERENCES users(id),
  sent_at timestamptz DEFAULT now(),
  template_used text
);

-- SETTINGS: JOB TYPES

CREATE TABLE IF NOT EXISTS job_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  name text NOT NULL,
  description text,
  default_duration_hours integer,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- SETTINGS: WA TEMPLATES

CREATE TABLE IF NOT EXISTS wa_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  name text NOT NULL,
  trigger_event text,
  body text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SETTINGS: WORKSHOP RULES

CREATE TABLE IF NOT EXISTS workshop_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  rule_number integer NOT NULL,
  title text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- SETTINGS: STATUS COLORS

CREATE TABLE IF NOT EXISTS status_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_key text NOT NULL UNIQUE,
  label text NOT NULL,
  color_hex text NOT NULL,
  bg_class text,
  text_class text
);

-- AUDIT LOG

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  module text NOT NULL,
  record_id uuid,
  record_type text,
  details jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- STAFF ATTENDANCE: SCHEDULES

CREATE TABLE IF NOT EXISTS staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  work_days text[] DEFAULT ARRAY['mon','tue','wed','thu','fri','sat'],
  start_time time DEFAULT '09:00:00',
  end_time time DEFAULT '18:00:00',
  effective_from date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- STAFF ATTENDANCE: RECORDS

CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  date date NOT NULL,
  clock_in_time timestamptz,
  clock_out_time timestamptz,
  clock_in_lat numeric(10,7),
  clock_in_lng numeric(10,7),
  clock_out_lat numeric(10,7),
  clock_out_lng numeric(10,7),
  clock_in_selfie_url text,
  clock_out_selfie_url text,
  clock_in_device_id text,
  status text,
  late_minutes integer DEFAULT 0,
  ot_hours numeric(4,2) DEFAULT 0,
  location_verified boolean DEFAULT false,
  notes text,
  edited_by uuid REFERENCES users(id),
  edited_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(staff_id, date)
);

-- STAFF ATTENDANCE: LEAVE REQUESTS

CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  leave_type text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  total_days integer,
  reason text,
  attachment_url text,
  status text DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- STAFF ATTENDANCE: OT REQUESTS

CREATE TABLE IF NOT EXISTS ot_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  attendance_id uuid REFERENCES attendance_records(id),
  date date NOT NULL,
  ot_start timestamptz NOT NULL,
  ot_end timestamptz NOT NULL,
  ot_hours numeric(4,2),
  reason text,
  status text DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- FLEET VEHICLES

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  vehicle_id text UNIQUE NOT NULL,
  plate_number text UNIQUE NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  year integer,
  vehicle_type text DEFAULT 'car',
  fuel_type text DEFAULT 'petrol',
  color text,
  department_owner text,
  assigned_driver_id uuid REFERENCES users(id),
  current_mileage integer DEFAULT 0,
  ownership_status text DEFAULT 'company_owned',
  status text DEFAULT 'available',
  photo_url text,
  road_tax_expiry date,
  insurance_expiry date,
  next_service_date date,
  next_service_mileage integer,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- FLEET BOOKINGS

CREATE TABLE IF NOT EXISTS fleet_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  fleet_vehicle_id uuid REFERENCES fleet_vehicles(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  requester_name text,
  department text,
  booking_date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  purpose text NOT NULL,
  destination text,
  preferred_vehicle_type text,
  remarks text,
  status text DEFAULT 'submitted',
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- FLEET TRIPS

CREATE TABLE IF NOT EXISTS fleet_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  fleet_vehicle_id uuid NOT NULL REFERENCES fleet_vehicles(id),
  booking_id uuid REFERENCES fleet_bookings(id),
  driver_id uuid NOT NULL REFERENCES users(id),
  driver_name text,
  purpose text,
  destination text,
  start_time timestamptz,
  start_mileage integer,
  fuel_level_before text,
  condition_before text,
  photo_before_url text,
  start_remarks text,
  end_time timestamptz,
  end_mileage integer,
  fuel_level_after text,
  condition_after text,
  photo_after_url text,
  end_remarks text,
  has_issue boolean DEFAULT false,
  distance_km numeric(8,2),
  duration_minutes integer,
  created_at timestamptz DEFAULT now()
);

-- FLEET ISSUES

CREATE TABLE IF NOT EXISTS fleet_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  fleet_vehicle_id uuid NOT NULL REFERENCES fleet_vehicles(id),
  trip_id uuid REFERENCES fleet_trips(id),
  reported_by uuid REFERENCES users(id),
  category text NOT NULL,
  severity text DEFAULT 'low',
  description text NOT NULL,
  status text DEFAULT 'new',
  photo_urls text[],
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- FLEET MAINTENANCE

CREATE TABLE IF NOT EXISTS fleet_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  fleet_vehicle_id uuid NOT NULL REFERENCES fleet_vehicles(id),
  service_date date NOT NULL,
  service_mileage integer,
  service_type text NOT NULL,
  workshop_vendor text,
  parts_changed text,
  labour_cost numeric(10,2) DEFAULT 0,
  parts_cost numeric(10,2) DEFAULT 0,
  total_cost numeric(10,2) DEFAULT 0,
  next_service_date date,
  next_service_mileage integer,
  invoice_url text,
  remarks text,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- FLEET COSTS

CREATE TABLE IF NOT EXISTS fleet_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  fleet_vehicle_id uuid NOT NULL REFERENCES fleet_vehicles(id),
  category text NOT NULL,
  amount numeric(10,2) NOT NULL,
  date date NOT NULL,
  description text,
  receipt_url text,
  recorded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- FLEET DOCUMENTS

CREATE TABLE IF NOT EXISTS fleet_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  fleet_vehicle_id uuid NOT NULL REFERENCES fleet_vehicles(id),
  document_type text NOT NULL,
  file_url text NOT NULL,
  expiry_date date,
  notes text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- INDEXES

CREATE INDEX IF NOT EXISTS idx_jobs_branch_status ON jobs(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_checked_in_at ON jobs(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_bookings_branch_date ON bookings(branch_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_parts_requests_job ON parts_requests(job_id);
CREATE INDEX IF NOT EXISTS idx_parts_requests_status ON parts_requests(status);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON attendance_records(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_branch_date ON attendance_records(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_staff ON leave_requests(staff_id, status);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_branch ON fleet_vehicles(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_fleet_trips_vehicle ON fleet_trips(fleet_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs(module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_updates_job ON customer_updates(job_id);
CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id, role);
