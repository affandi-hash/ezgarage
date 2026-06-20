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
