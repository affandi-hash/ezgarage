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
