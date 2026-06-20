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
