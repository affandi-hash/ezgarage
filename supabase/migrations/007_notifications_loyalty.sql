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
