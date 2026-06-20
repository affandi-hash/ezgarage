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
