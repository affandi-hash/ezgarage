-- Seed: initial branches
-- Run after migrations are applied

insert into branches (name, location, address, phone, email) values
  ('Motoverse Puchong', 'Putra Perdana, Puchong', 'Putra Perdana, Puchong, Selangor', '+60XXXXXXXXXX', 'puchong@motoverse.my'),
  ('Motoverse Kota Bharu', 'Kota Bharu', 'Kota Bharu, Kelantan', '+60XXXXXXXXXX', 'kotabharu@motoverse.my');

-- Note: User accounts are created via Supabase Auth dashboard or invite flow.
-- After creating auth users, insert into user_profiles with the correct branch_id and role.
-- Example (replace UUIDs with real values after auth user creation):
--
-- insert into user_profiles (id, full_name, role, branch_id) values
--   ('auth-user-uuid-here', 'Admin CEO', 'ceo', null);
