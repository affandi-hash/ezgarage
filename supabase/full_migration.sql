-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Branches
create table branches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  location text not null,
  address text,
  phone text,
  email text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- User roles enum
create type user_role as enum (
  'ceo',
  'branch_manager',
  'operation_manager',
  'hr_manager',
  'staff',
  'customer'
);

-- User profiles (extends Supabase Auth)
create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role user_role not null,
  branch_id uuid references branches(id),  -- null for CEO
  avatar_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Customers (per branch)
create table customers (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  full_name text not null,
  phone text not null,
  email text,
  ic_number text,
  customer_app_user_id uuid references auth.users(id),
  loyalty_points integer default 0,
  notes text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Vehicles (linked to customer)
create table vehicles (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id),
  branch_id uuid not null references branches(id),
  plate_number text not null,
  make text not null,
  model text not null,
  year integer,
  color text,
  vehicle_type text default 'car',  -- car | bike
  mileage integer,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Job status enum
create type job_status as enum (
  'received',
  'inspecting',
  'waiting_approval',
  'in_progress',
  'waiting_for_parts',
  'done',
  'collected'
);

-- Job Orders
create table job_orders (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  job_number text unique not null,  -- e.g. PJ-2024-0001
  customer_id uuid not null references customers(id),
  vehicle_id uuid not null references vehicles(id),
  status job_status default 'received',
  service_type text,
  description text,
  diagnosis text,
  customer_approval boolean default false,
  assigned_to uuid references user_profiles(id),
  created_by uuid references user_profiles(id),
  estimated_cost decimal(10,2),
  final_cost decimal(10,2),
  estimated_completion timestamptz,
  completed_at timestamptz,
  collected_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Job status history (audit log)
create table job_status_logs (
  id uuid primary key default uuid_generate_v4(),
  job_order_id uuid not null references job_orders(id),
  previous_status job_status,
  new_status job_status not null,
  changed_by uuid references user_profiles(id),
  notes text,
  created_at timestamptz default now()
);

-- Job photos
create table job_photos (
  id uuid primary key default uuid_generate_v4(),
  job_order_id uuid not null references job_orders(id),
  url text not null,
  caption text,
  uploaded_by uuid references user_profiles(id),
  created_at timestamptz default now()
);

-- Job mechanics (multiple mechanics per job)
create table job_mechanics (
  id uuid primary key default uuid_generate_v4(),
  job_order_id uuid not null references job_orders(id),
  mechanic_id uuid not null references user_profiles(id),
  assigned_at timestamptz default now(),
  assigned_by uuid references user_profiles(id)
);

-- Job number sequence function
create or replace function generate_job_number(p_branch_id uuid)
returns text as $$
declare
  branch_code text;
  year_str text;
  next_seq integer;
begin
  select case
    when location ilike '%puchong%' then 'PJ'
    when location ilike '%kota bharu%' then 'KB'
    else 'MV'
  end into branch_code
  from branches where id = p_branch_id;

  year_str := to_char(now(), 'YYYY');

  select coalesce(max(
    cast(split_part(job_number, '-', 3) as integer)
  ), 0) + 1 into next_seq
  from job_orders
  where branch_id = p_branch_id
    and job_number like branch_code || '-' || year_str || '-%';

  return branch_code || '-' || year_str || '-' || lpad(next_seq::text, 4, '0');
end;
$$ language plpgsql;
-- Suppliers (per branch)
create table suppliers (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Parts / Inventory (per branch)
create table inventory (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  supplier_id uuid references suppliers(id),
  name text not null,
  sku text,
  category text,
  unit text default 'unit',
  quantity integer default 0,
  low_stock_threshold integer default 5,
  unit_cost decimal(10,2),
  selling_price decimal(10,2),
  location text,
  notes text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Parts used in a job
create table job_parts (
  id uuid primary key default uuid_generate_v4(),
  job_order_id uuid not null references job_orders(id),
  inventory_id uuid not null references inventory(id),
  quantity integer not null,
  unit_cost decimal(10,2),
  selling_price decimal(10,2),
  logged_by uuid references user_profiles(id),
  created_at timestamptz default now()
);

-- Inter-branch transfer requests
create type transfer_status as enum (
  'pending',
  'approved_sender',
  'approved_both',
  'in_transit',
  'received',
  'cancelled'
);

create table transfer_requests (
  id uuid primary key default uuid_generate_v4(),
  from_branch_id uuid not null references branches(id),
  to_branch_id uuid not null references branches(id),
  inventory_id uuid not null references inventory(id),
  quantity integer not null,
  status transfer_status default 'pending',
  requested_by uuid references user_profiles(id),
  approved_by_sender uuid references user_profiles(id),
  approved_by_receiver uuid references user_profiles(id),
  received_by uuid references user_profiles(id),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Appointments (from Mia or direct booking)
create type appointment_status as enum (
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show'
);

create table appointments (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  customer_id uuid references customers(id),
  vehicle_id uuid references vehicles(id),
  -- Fields from Mia booking (before customer profile exists)
  customer_name text,
  customer_phone text,
  plate_number text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  service_type text,
  appointment_date date not null,
  appointment_time time not null,
  status appointment_status default 'pending',
  source text default 'direct',  -- direct | mia_whatsapp
  notes text,
  job_order_id uuid references job_orders(id),
  created_by uuid references user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Mechanic schedules
create table mechanic_schedules (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  mechanic_id uuid not null references user_profiles(id),
  schedule_date date not null,
  shift_start time,
  shift_end time,
  is_off boolean default false,
  notes text,
  created_at timestamptz default now()
);
-- Payment enums
create type payment_method as enum (
  'cash',
  'card',
  'online_transfer',
  'qr'
);

create type payment_status as enum (
  'unpaid',
  'partial',
  'paid'
);

-- Invoices
create table invoices (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  job_order_id uuid not null references job_orders(id),
  invoice_number text unique not null,  -- e.g. INV-PJ-2024-0001
  customer_id uuid not null references customers(id),
  subtotal decimal(10,2) default 0,
  discount decimal(10,2) default 0,
  tax decimal(10,2) default 0,
  total decimal(10,2) default 0,
  payment_status payment_status default 'unpaid',
  payment_method payment_method,
  paid_at timestamptz,
  notes text,
  created_by uuid references user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Invoice line items
create table invoice_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references invoices(id),
  description text not null,
  item_type text default 'service',  -- service | part
  quantity integer default 1,
  unit_price decimal(10,2),
  total decimal(10,2),
  created_at timestamptz default now()
);
-- Notifications
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references user_profiles(id),
  customer_id uuid references customers(id),
  branch_id uuid references branches(id),
  title text not null,
  message text not null,
  type text,  -- job_update | stock_alert | transfer | booking | reminder
  reference_id uuid,
  is_read boolean default false,
  sent_via_whatsapp boolean default false,
  created_at timestamptz default now()
);

-- Loyalty points log
create table loyalty_logs (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id),
  branch_id uuid not null references branches(id),
  points integer not null,  -- positive = earned, negative = redeemed
  type text,                -- earned | redeemed | expired
  reference_id uuid,        -- invoice_id
  notes text,
  created_at timestamptz default now()
);

-- Coupons
create table coupons (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid references branches(id),  -- null = all branches
  code text unique not null,
  description text,
  discount_type text default 'percentage',  -- percentage | fixed
  discount_value decimal(10,2),
  min_spend decimal(10,2),
  max_uses integer,
  used_count integer default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Maintenance reminders
create table maintenance_reminders (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id),
  vehicle_id uuid not null references vehicles(id),
  branch_id uuid not null references branches(id),
  reminder_type text,   -- oil_change | brake_check | tyre_rotation
  due_date date,
  due_mileage integer,
  is_sent boolean default false,
  is_dismissed boolean default false,
  created_at timestamptz default now()
);
-- Helper functions
create or replace function get_user_branch_id()
returns uuid as $$
  select branch_id from user_profiles where id = auth.uid();
$$ language sql security definer;

create or replace function get_user_role()
returns user_role as $$
  select role from user_profiles where id = auth.uid();
$$ language sql security definer;

-- Enable RLS
alter table customers enable row level security;
alter table vehicles enable row level security;
alter table job_orders enable row level security;
alter table job_status_logs enable row level security;
alter table job_photos enable row level security;
alter table job_mechanics enable row level security;
alter table inventory enable row level security;
alter table suppliers enable row level security;
alter table job_parts enable row level security;
alter table transfer_requests enable row level security;
alter table appointments enable row level security;
alter table mechanic_schedules enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table notifications enable row level security;
alter table loyalty_logs enable row level security;
alter table coupons enable row level security;
alter table maintenance_reminders enable row level security;

-- Branch isolation policy (apply to all branch-scoped tables)
create policy "branch_isolation" on customers
  for all using (get_user_role() = 'ceo' or branch_id = get_user_branch_id());

create policy "branch_isolation" on vehicles
  for all using (get_user_role() = 'ceo' or branch_id = get_user_branch_id());

create policy "branch_isolation" on job_orders
  for all using (get_user_role() = 'ceo' or branch_id = get_user_branch_id());

create policy "branch_isolation" on inventory
  for all using (get_user_role() = 'ceo' or branch_id = get_user_branch_id());

create policy "branch_isolation" on suppliers
  for all using (get_user_role() = 'ceo' or branch_id = get_user_branch_id());

create policy "branch_isolation" on appointments
  for all using (get_user_role() = 'ceo' or branch_id = get_user_branch_id());

create policy "branch_isolation" on invoices
  for all using (get_user_role() = 'ceo' or branch_id = get_user_branch_id());

create policy "branch_isolation" on notifications
  for all using (
    get_user_role() in ('ceo', 'branch_manager', 'operation_manager')
    or user_id = auth.uid()
    or customer_id in (
      select id from customers where branch_id = get_user_branch_id()
    )
  );

-- Transfer requests: visible to both branches involved
create policy "transfer_visibility" on transfer_requests
  for all using (
    get_user_role() = 'ceo'
    or from_branch_id = get_user_branch_id()
    or to_branch_id = get_user_branch_id()
  );
