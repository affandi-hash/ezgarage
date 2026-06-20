# Motoverse Garage Management System
## Complete Foundation Document — Phase 1

---

## 1. Project Overview

**Product Name:** Motoverse Garage Management System (MGMS)
**Branches:** Putra Perdana Puchong | Kota Bharu
**Apps:** Web Dashboard (staff) + Staff Mobile App + Customer Mobile App
**Stack:** React + Vite (web) | React Native Expo (mobile) | Node.js + Express (API) | Supabase (DB + Auth + Storage + Realtime)

---

## 2. Project Structure (Claude Code)

```
motoverse/
├── apps/
│   ├── web/                    # React + Vite (staff web dashboard)
│   ├── staff-app/              # React Native Expo (staff mobile)
│   └── customer-app/           # React Native Expo (customer mobile)
├── backend/
│   ├── src/
│   │   ├── routes/             # Express routes
│   │   ├── controllers/        # Business logic
│   │   ├── middleware/         # Auth, branch isolation
│   │   ├── services/           # Supabase, WhatsApp, notifications
│   │   └── index.js            # Entry point
│   └── package.json
├── supabase/
│   ├── migrations/             # SQL migration files
│   └── seed.sql                # Initial data (branches, roles)
├── CONTEXT.md                  # Claude Code reads this every session
└── README.md
```

---

## 3. CONTEXT.md (Copy this into your project root)

```markdown
# Motoverse Garage Management System — Project Context

## What This Is
A multi-branch garage management system for Motoverse Garage.
2 branches: Putra Perdana Puchong + Kota Bharu.
3 apps: Web Dashboard, Staff Mobile App, Customer Mobile App.

## Stack
- Web: React + Vite + Tailwind CSS
- Mobile: React Native + Expo + NativeWind
- Backend: Node.js + Express
- Database: Supabase (PostgreSQL + Auth + Storage + Realtime)
- State: Zustand

## Branch Isolation
Every branch-specific table has a branch_id column.
Supabase RLS enforces that staff only see their own branch data.
CEO role bypasses RLS and sees all branches.

## User Roles
1. CEO - cross-branch view + user management only
2. branch_manager - full branch access
3. operation_manager - jobs, stock, invoicing, scheduling
4. hr_manager - staff records, scheduling
5. staff - workshop floor view, assigned jobs
6. customer - customer app only

## Current Build Phase
[UPDATE THIS EVERY SESSION]

## Key Decisions
- Customers are per-branch (separate records)
- Parts transfer between branches requires approval from both branch managers
- Stock only updates after receiving branch confirms transfer
- Mia (WhatsApp bot) feeds bookings via Google Apps Script webhook
- Invoice created from completed job order by operation_manager or branch_manager
- Customer notified via push notification at every job status change
```

---

## 4. Database Schema (Supabase SQL)

Run these migrations in order in your Supabase SQL editor.

---

### Migration 001 — Branches & Users

```sql
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

-- Insert initial branches
insert into branches (name, location, address, phone) values
  ('Motoverse Puchong', 'Putra Perdana, Puchong', 'Putra Perdana, Puchong, Selangor', '+60XXXXXXXXXX'),
  ('Motoverse Kota Bharu', 'Kota Bharu', 'Kota Bharu, Kelantan', '+60XXXXXXXXXX');

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
```

---

### Migration 002 — Customers & Vehicles

```sql
-- Customers (per branch)
create table customers (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid not null references branches(id),
  full_name text not null,
  phone text not null,
  email text,
  ic_number text,
  customer_app_user_id uuid references auth.users(id), -- links to customer app login
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
  make text not null,           -- e.g. Toyota, Honda, Harley-Davidson
  model text not null,          -- e.g. Vios, CBR600
  year integer,
  color text,
  vehicle_type text default 'car', -- car | bike
  mileage integer,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

---

### Migration 003 — Job Orders

```sql
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
  job_number text unique not null,  -- e.g. PJ-2024-001, KB-2024-001
  customer_id uuid not null references customers(id),
  vehicle_id uuid not null references vehicles(id),
  status job_status default 'received',
  service_type text,                -- oil change, brake service, etc.
  description text,                 -- what customer reported
  diagnosis text,                   -- what mechanic found
  customer_approval boolean default false,
  assigned_to uuid references user_profiles(id),  -- lead mechanic
  created_by uuid references user_profiles(id),   -- operation manager
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
```

---

### Migration 004 — Inventory & Parts

```sql
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
  category text,              -- engine, brake, electrical, etc.
  unit text default 'unit',   -- unit, litre, set
  quantity integer default 0,
  low_stock_threshold integer default 5,
  unit_cost decimal(10,2),
  selling_price decimal(10,2),
  location text,              -- shelf/bin location in workshop
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
```

---

### Migration 005 — Scheduling & Appointments

```sql
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
  source text default 'direct',   -- direct | mia_whatsapp
  notes text,
  job_order_id uuid references job_orders(id),  -- linked when job created
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
```

---

### Migration 006 — Financials & Invoicing

```sql
-- Payment method enum
create type payment_method as enum (
  'cash',
  'card',
  'online_transfer',
  'qr'
);

-- Payment status enum
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
  invoice_number text unique not null,  -- e.g. INV-PJ-2024-001
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
```

---

### Migration 007 — Notifications & Customer App

```sql
-- Notifications
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references user_profiles(id),
  customer_id uuid references customers(id),
  branch_id uuid references branches(id),
  title text not null,
  message text not null,
  type text,          -- job_update | stock_alert | transfer | booking | reminder
  reference_id uuid,  -- job_order_id, transfer_id, etc.
  is_read boolean default false,
  sent_via_whatsapp boolean default false,
  created_at timestamptz default now()
);

-- Loyalty points log
create table loyalty_logs (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id),
  branch_id uuid not null references branches(id),
  points integer not null,      -- positive = earned, negative = redeemed
  type text,                    -- earned | redeemed | expired
  reference_id uuid,            -- invoice_id
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
  reminder_type text,      -- oil_change | brake_check | tyre_rotation
  due_date date,
  due_mileage integer,
  is_sent boolean default false,
  is_dismissed boolean default false,
  created_at timestamptz default now()
);
```

---

## 5. Row Level Security (RLS) Policies

```sql
-- Enable RLS on all branch-specific tables
alter table customers enable row level security;
alter table vehicles enable row level security;
alter table job_orders enable row level security;
alter table inventory enable row level security;
alter table suppliers enable row level security;
alter table appointments enable row level security;
alter table invoices enable row level security;
alter table notifications enable row level security;

-- Helper function: get current user's branch_id
create or replace function get_user_branch_id()
returns uuid as $$
  select branch_id from user_profiles where id = auth.uid();
$$ language sql security definer;

-- Helper function: get current user's role
create or replace function get_user_role()
returns user_role as $$
  select role from user_profiles where id = auth.uid();
$$ language sql security definer;

-- RLS Policy: Branch isolation (staff see own branch only)
-- CEO bypasses via role check
-- Apply this pattern to ALL branch-specific tables:

-- Example for job_orders:
create policy "branch_isolation" on job_orders
  for all using (
    get_user_role() = 'ceo'
    or branch_id = get_user_branch_id()
  );

-- Example for customers:
create policy "branch_isolation" on customers
  for all using (
    get_user_role() = 'ceo'
    or branch_id = get_user_branch_id()
  );

-- Repeat for: vehicles, inventory, suppliers,
-- appointments, invoices, notifications
-- (same pattern, just change the table name)

-- Staff can only see their own notifications
create policy "own_notifications" on notifications
  for select using (
    user_id = auth.uid()
    or get_user_role() in ('ceo', 'branch_manager', 'operation_manager')
  );
```

---

## 6. Express API Structure

```
backend/src/
├── routes/
│   ├── auth.js           # login, register, refresh
│   ├── branches.js       # branch info (CEO only)
│   ├── users.js          # user management (CEO + branch_manager)
│   ├── customers.js      # customer CRUD
│   ├── vehicles.js       # vehicle CRUD
│   ├── jobs.js           # job order CRUD + status updates
│   ├── inventory.js      # stock management
│   ├── suppliers.js      # supplier CRUD
│   ├── transfers.js      # inter-branch transfers
│   ├── appointments.js   # scheduling + Mia webhook
│   ├── invoices.js       # invoicing
│   ├── notifications.js  # push + WhatsApp
│   └── reports.js        # CEO dashboard data
├── middleware/
│   ├── auth.js           # verify Supabase JWT
│   ├── roleCheck.js      # role-based access control
│   └── branchCheck.js    # enforce branch isolation
└── services/
    ├── supabase.js       # Supabase client
    ├── notifications.js  # Expo push notifications
    └── whatsapp.js       # WhatsApp Business API
```

---

## 7. Mia → Google Apps Script → Backend

Add this script to your Google Sheet (Extensions → Apps Script):

```javascript
function onEdit(e) {
  // Only trigger on new rows in the bookings sheet
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== 'Bookings') return;
  
  var row = e.range.getRow();
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  
  var booking = {
    customer_name: data[0],
    customer_phone: data[1],
    plate_number: data[2],
    vehicle_make: data[3],
    vehicle_model: data[4],
    vehicle_year: data[5],
    service_type: data[6],
    appointment_date: data[7],
    appointment_time: data[8],
    branch: data[9],          // 'puchong' or 'kota_bharu'
    notes: data[10],
    source: 'mia_whatsapp'
  };
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(booking)
  };
  
  UrlFetchApp.fetch('https://your-backend.com/api/appointments/mia', options);
}
```

---

## 8. Job Number Format

```
Puchong:    PJ-YYYY-XXXX   e.g. PJ-2024-0001
Kota Bharu: KB-YYYY-XXXX   e.g. KB-2024-0001
```

Auto-generated in backend when job order is created.

---

## 9. Invoice Number Format

```
Puchong:    INV-PJ-YYYY-XXXX   e.g. INV-PJ-2024-0001
Kota Bharu: INV-KB-YYYY-XXXX   e.g. INV-KB-2024-0001
```

---

## 10. Environment Variables (.env)

```
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key

# Server
PORT=3000
NODE_ENV=development

# WhatsApp (360dialog or Twilio - add later)
WHATSAPP_API_KEY=
WHATSAPP_API_URL=

# Expo Push Notifications
EXPO_ACCESS_TOKEN=

# Branch IDs (fill after running seed)
BRANCH_ID_PUCHONG=
BRANCH_ID_KOTA_BHARU=
```

---

## 11. First Commands for Claude Code

Give Claude Code this prompt to start:

```
I am building a multi-branch garage management system called Motoverse.
Read the CONTEXT.md file first.

Start Phase 1:
1. Initialize the project structure as shown in CONTEXT.md
2. Set up the backend with Node.js + Express
3. Connect to Supabase using the env variables
4. Create the auth middleware that reads the Supabase JWT
5. Create the role check middleware
6. Run the database migrations from MOTOVERSE_FOUNDATION.md in order

Do not move to routes yet. Just foundation first.
```

---

## 12. Build Phases Checklist

- [ ] Phase 1: Foundation (schema, RLS, auth, project structure)
- [ ] Phase 2: Web Dashboard shell (React + Vite, routing, layout)
- [ ] Phase 3: Job Orders module
- [ ] Phase 4: Inventory + Stock
- [ ] Phase 5: Scheduling + Mia webhook
- [ ] Phase 6: Financials + Invoicing
- [ ] Phase 7: HR + Staff management
- [ ] Phase 8: CEO Dashboard + Reports
- [ ] Phase 9: Staff Mobile App (Expo)
- [ ] Phase 10: Customer Mobile App (Expo)
- [ ] Phase 11: WhatsApp notifications
- [ ] Phase 12: Mia full integration (direct API, remove Google Sheet)