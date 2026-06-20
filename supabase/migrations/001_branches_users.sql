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
