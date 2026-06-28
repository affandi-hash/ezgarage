-- Enable RLS on user_profiles
alter table user_profiles enable row level security;

-- Users can read their own profile
create policy "users_read_own_profile" on user_profiles
  for select using (auth.uid() = id);

-- CEO and managers can read profiles in their branch
create policy "managers_read_branch_profiles" on user_profiles
  for select using (
    get_user_role() = 'ceo'
    or (
      get_user_role() in ('branch_manager', 'hr_manager', 'operation_manager')
      and (branch_id = get_user_branch_id() or branch_id is null)
    )
  );

-- Users can update their own profile
create policy "users_update_own_profile" on user_profiles
  for update using (auth.uid() = id);
