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
