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
