-- Trigger function to auto-generate job_number before insert
create or replace function set_job_number()
returns trigger as $$
begin
  if NEW.job_number is null or NEW.job_number = '' then
    NEW.job_number := generate_job_number(NEW.branch_id);
  end if;
  return NEW;
end;
$$ language plpgsql;

-- Attach trigger to job_orders
drop trigger if exists trg_set_job_number on job_orders;
create trigger trg_set_job_number
  before insert on job_orders
  for each row
  execute function set_job_number();
