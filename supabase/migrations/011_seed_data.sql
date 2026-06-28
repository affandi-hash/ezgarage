-- MGOD V3 Seed Data
-- Migration 011: Sample data for all modules

-- ============================================================
-- UPDATE BRANCHES with full details
-- ============================================================

UPDATE branches SET
  address = 'No. 12, Jalan Puteri 2/3, Bandar Puteri Puchong, 47100 Puchong, Selangor',
  phone = '03-8076 1234',
  email = 'puchong@motoversegarage.com',
  latitude = 3.0319,
  longitude = 101.6200,
  is_active = true
WHERE name ILIKE '%puchong%';

UPDATE branches SET
  address = 'No. 45, Jalan Pengkalan Chepa, 15400 Kota Bharu, Kelantan',
  phone = '09-748 5678',
  email = 'kotabharu@motoversegarage.com',
  latitude = 6.1184,
  longitude = 102.2370,
  is_active = true
WHERE name ILIKE '%kota%' OR name ILIKE '%kb%';

-- ============================================================
-- UPDATE USERS with correct roles and emails
-- ============================================================

-- Update existing users to match the new role system
-- Affandi / CEO -> super_admin
-- Users table is populated from Supabase Auth — seed skips user updates

-- ============================================================
-- INSERT STAFF PROFILES
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
  v_kb_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;
  SELECT id INTO v_kb_id FROM branches WHERE name ILIKE '%kota%' OR name ILIKE '%kb%' LIMIT 1;

  -- Staff profiles (HR records)
  INSERT INTO staff_profiles (branch_id, full_name, phone, email, ic_number, department, position, specialty, hire_date, is_active)
  VALUES
    (v_puchong_id, 'Affandi Hassan', '012-345 6789', 'affandi@motoversegarage.com', '750101015555', 'Management', 'Super Admin / CEO', ARRAY['management','operations'], '2020-01-01', true),
    (v_puchong_id, 'Mia Soraya', '012-456 7890', 'mia@motoversegarage.com', '880202025555', 'Operations', 'Ops Manager', ARRAY['operations','customer_service'], '2020-03-01', true),
    (v_puchong_id, 'Iqbal Ibrahim', '012-567 8901', 'iqbal@motoversegarage.com', '920303035555', 'Front Desk', 'Front Desk Officer', ARRAY['customer_service','booking'], '2021-01-15', true),
    (v_puchong_id, 'Zack Rahim', '012-678 9012', 'zack@motoversegarage.com', '850404045555', 'Workshop', 'Foreman', ARRAY['diagnostics','engine','electrical'], '2020-06-01', true),
    (v_puchong_id, 'Irfan Nasir', '012-789 0123', 'irfan@motoversegarage.com', '930505055555', 'Workshop', 'Mechanic', ARRAY['engine','transmission'], '2021-03-01', true),
    (v_puchong_id, 'Haris Kurnia', '012-890 1234', 'haris@motoversegarage.com', '940606065555', 'Workshop', 'Mechanic', ARRAY['brake','suspension','tyre'], '2021-06-01', true),
    (v_puchong_id, 'Izzneil Zainury', '012-901 2345', 'zayng@motoversegarage.com', '950707075555', 'Workshop', 'Mechanic', ARRAY['bike','engine'], '2022-01-01', true),
    (v_puchong_id, 'Herman Yusof', '012-012 3456', 'herman@motoversegarage.com', '800808085555', 'Fleet', 'Fleet Admin / Logistics Manager', ARRAY['fleet','logistics'], '2020-01-01', true),
    (v_kb_id, 'Razif Azman', '019-234 5678', 'razif@motoversegarage.com', '870909095555', 'Workshop', 'Foreman', ARRAY['engine','diagnostics'], '2022-06-01', true),
    (v_kb_id, 'Syafiq Noor', '019-345 6789', 'syafiq@motoversegarage.com', '961010105555', 'Workshop', 'Mechanic', ARRAY['routine_service','tyres'], '2022-09-01', true)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- INSERT CUSTOMERS
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;

  INSERT INTO customers (branch_id, full_name, phone, email, ic_number, ic_last4, area, customer_type, customer_status)
  VALUES
    (v_puchong_id, 'Indra Awang Sulong', '0108001383', 'indra@email.com', '801201015555', '5555', 'Puchong', 'walk_in', 'active'),
    (v_puchong_id, 'Siti Saleha Mahmud', '01175931383', 'siti@email.com', '851201025555', '5555', 'Subang', 'referral', 'active'),
    (v_puchong_id, 'Zackery Tan', '0182737729', 'zack.tan@email.com', '900101035555', '5555', 'Puchong', 'walk_in', 'active'),
    (v_puchong_id, 'Kamarul Ariffin', '0162820132', 'kamarul@email.com', '781201045555', '5555', 'Cheras', 'referral', 'active'),
    (v_puchong_id, 'Nor Azlina Ahmad', '0112345678', 'azlina@email.com', '820501055555', '5555', 'Puchong', 'online_booking', 'active'),
    (v_puchong_id, 'Hafiz Roslan', '0123456789', 'hafiz@email.com', '950301065555', '5555', 'Shah Alam', 'walk_in', 'active')
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- INSERT VEHICLES
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
  v_indra_id uuid;
  v_siti_id uuid;
  v_zack_id uuid;
  v_kamarul_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;
  SELECT id INTO v_indra_id FROM customers WHERE full_name ILIKE '%indra%' LIMIT 1;
  SELECT id INTO v_siti_id FROM customers WHERE full_name ILIKE '%siti%' LIMIT 1;
  SELECT id INTO v_zack_id FROM customers WHERE full_name ILIKE '%zackery%' LIMIT 1;
  SELECT id INTO v_kamarul_id FROM customers WHERE full_name ILIKE '%kamarul%' LIMIT 1;

  INSERT INTO vehicles (customer_id, branch_id, plate_number, vehicle_type, make, model, year, color, ic_last4, current_mileage)
  VALUES
    (v_indra_id, v_puchong_id, 'H883', 'car', 'Jinbei', 'H883 Blue', 2019, 'Blue', '5555', 85000),
    (v_siti_id, v_puchong_id, 'RT999', 'car', 'Jinbei', 'RT999', 2008, 'Silver', '5555', 152000),
    (v_zack_id, v_puchong_id, 'K50ZAC', 'car', 'Qiantu', 'K50', 2026, 'Black', '5555', 5200),
    (v_kamarul_id, v_puchong_id, 'TR75', 'bike', 'BMW', 'S1000RR', 2022, 'White', '5555', 18000)
  ON CONFLICT (plate_number) DO NOTHING;
END $$;

-- ============================================================
-- INSERT BOOKINGS & JOB CARDS
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
  v_indra_id uuid;
  v_siti_id uuid;
  v_zack_id uuid;
  v_kamarul_id uuid;
  v_h883_id uuid;
  v_rt999_id uuid;
  v_k50_id uuid;
  v_tr75_id uuid;
  v_zack_staff_id uuid;
  v_irfan_id uuid;
  v_mia_id uuid;
  v_iqbal_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;
  SELECT id INTO v_indra_id FROM customers WHERE full_name ILIKE '%indra%' LIMIT 1;
  SELECT id INTO v_siti_id FROM customers WHERE full_name ILIKE '%siti%' LIMIT 1;
  SELECT id INTO v_zack_id FROM customers WHERE full_name ILIKE '%zackery%' LIMIT 1;
  SELECT id INTO v_kamarul_id FROM customers WHERE full_name ILIKE '%kamarul%' LIMIT 1;
  SELECT id INTO v_h883_id FROM vehicles WHERE plate_number = 'H883' LIMIT 1;
  SELECT id INTO v_rt999_id FROM vehicles WHERE plate_number = 'RT999' LIMIT 1;
  SELECT id INTO v_k50_id FROM vehicles WHERE plate_number = 'K50ZAC' LIMIT 1;
  SELECT id INTO v_tr75_id FROM vehicles WHERE plate_number = 'TR75' LIMIT 1;
  SELECT id INTO v_zack_staff_id FROM users WHERE email ILIKE '%zack%' LIMIT 1;
  SELECT id INTO v_irfan_id FROM users WHERE email ILIKE '%irfan%' LIMIT 1;
  SELECT id INTO v_mia_id FROM users WHERE email ILIKE '%mia%' LIMIT 1;
  SELECT id INTO v_iqbal_id FROM users WHERE email ILIKE '%iqbal%' LIMIT 1;

  -- Bookings
  INSERT INTO bookings (branch_id, customer_id, vehicle_id, customer_name, customer_phone, vehicle_plate, booking_date, booking_time, service_type, source, arrival_mode, status, created_by)
  VALUES
    (v_puchong_id, v_indra_id, v_h883_id, 'Indra Awang Sulong', '0108001383', 'H883', CURRENT_DATE, '09:00', 'Routine Service', 'call', 'drive_in', 'confirmed', v_iqbal_id),
    (v_puchong_id, v_siti_id, v_rt999_id, 'Siti Saleha Mahmud', '01175931383', 'RT999', CURRENT_DATE, '10:30', 'Engine Repair', 'tiktok', 'drive_in', 'checked_in', v_iqbal_id),
    (v_puchong_id, v_zack_id, v_k50_id, 'Zackery Tan', '0182737729', 'K50ZAC', CURRENT_DATE, '14:00', 'Inspection', 'call', 'drive_in', 'tentative', v_iqbal_id),
    (v_puchong_id, v_kamarul_id, v_tr75_id, 'Kamarul Ariffin', '0162820132', 'TR75', CURRENT_DATE + 1, '11:00', 'Bike Full Service', 'whatsapp', 'drive_in', 'confirmed', v_iqbal_id)
  ON CONFLICT DO NOTHING;

  -- Job Cards (active jobs in various statuses for Workshop Board demo)
  INSERT INTO jobs (branch_id, customer_id, vehicle_id, vehicle_type, source, arrival_mode, status, customer_complaint, diagnosis_summary, estimated_cost, assigned_foreman_id, assigned_mechanic_id, next_action, next_update_due, checked_in_at, mileage_in, fuel_level)
  VALUES
    (v_puchong_id, v_indra_id, v_h883_id, 'car', 'call', 'drive_in', 'in_progress', 'Engine oil change + full service', 'Routine maintenance. Oil + filter change, tyre rotation.', 350.00, v_zack_staff_id, v_irfan_id, 'Complete oil change and tyre rotation', NOW() + INTERVAL '2 hours', NOW() - INTERVAL '3 hours', 85120, '3/4'),
    (v_puchong_id, v_siti_id, v_rt999_id, 'car', 'tiktok', 'drive_in', 'diagnosing', 'Engine knocking sound when idle', NULL, NULL, v_zack_staff_id, v_irfan_id, 'Complete engine diagnosis', NOW() + INTERVAL '1 hour', NOW() - INTERVAL '1 hour', 152300, '1/2'),
    (v_puchong_id, v_zack_id, v_k50_id, 'car', 'call', 'drive_in', 'waiting_approval', 'Strange vibration at high speed', 'Front wheel bearing worn. Both front lower arm bushings cracked. Est cost RM1,850.', 1850.00, v_zack_staff_id, v_irfan_id, 'Await customer approval', NOW() + INTERVAL '30 minutes', NOW() - INTERVAL '5 hours', 5250, 'Full'),
    (v_puchong_id, v_kamarul_id, v_tr75_id, 'bike', 'whatsapp', 'drive_in', 'waiting_parts', 'Full service + chain replacement', 'Chain set worn beyond limit. Parts ordered.', 680.00, v_zack_staff_id, v_irfan_id, 'Wait for chain set delivery', NOW() + INTERVAL '4 hours', NOW() - INTERVAL '2 days', 18150, 'Full')
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- INSERT PARTS REQUESTS
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
  v_tr75_job_id uuid;
  v_irfan_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;
  SELECT j.id INTO v_tr75_job_id FROM jobs j
    JOIN vehicles v ON j.vehicle_id = v.id
    WHERE v.plate_number = 'TR75' LIMIT 1;
  SELECT id INTO v_irfan_id FROM users WHERE email ILIKE '%irfan%' LIMIT 1;

  IF v_tr75_job_id IS NOT NULL THEN
    INSERT INTO parts_requests (branch_id, job_id, part_name, part_number, quantity, supplier, cost_price, selling_price, status, requested_by, ordered_at, eta)
    VALUES
      (v_puchong_id, v_tr75_job_id, 'DID 520 Chain Set (Chain + Sprocket)', 'DID-520-108L', 1, 'Bike Parts HQ', 320.00, 420.00, 'ordered', v_irfan_id, NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 day'),
      (v_puchong_id, v_tr75_job_id, 'Engine Oil Shell Advance 10W-40 4T', 'SHELL-ADV-4T-1L', 3, 'Shell Distributor PJ', 28.00, 45.00, 'received', v_irfan_id, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================
-- INSERT JOB TYPES
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
  v_kb_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;
  SELECT id INTO v_kb_id FROM branches WHERE name ILIKE '%kota%' OR name ILIKE '%kb%' LIMIT 1;

  INSERT INTO job_types (branch_id, name, default_duration_hours, sort_order) VALUES
    (NULL, 'Routine Service', 2, 1),
    (NULL, 'Oil Change', 1, 2),
    (NULL, 'Brake Service', 2, 3),
    (NULL, 'Tyre Change', 1, 4),
    (NULL, 'Wheel Alignment', 1, 5),
    (NULL, 'AC Service', 3, 6),
    (NULL, 'Electrical Repair', 4, 7),
    (NULL, 'Engine Repair', 8, 8),
    (NULL, 'Transmission Repair', 6, 9),
    (NULL, 'Body & Paint', 16, 10),
    (NULL, 'Detailing', 4, 11),
    (NULL, 'Ceramic Coating', 8, 12),
    (NULL, 'Windscreen Repair', 2, 13),
    (NULL, 'Inspection', 1, 14),
    (NULL, 'Bike Service', 2, 15),
    (NULL, 'Bike Full Service', 3, 16),
    (NULL, 'Bike Upgrade', 4, 17),
    (NULL, 'On-call Service', 2, 18),
    (NULL, 'Pick-up & Delivery', 2, 19),
    (NULL, 'Home Service', 3, 20),
    (NULL, 'Other', 2, 21)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- INSERT WA TEMPLATES
-- ============================================================

INSERT INTO wa_templates (name, trigger_event, body) VALUES
  ('Car Checked In', 'checked_in', 'Hi {customer_name}, your {vehicle_plate} has been checked in at Motoverse Garage. Your job number is {job_number}. We will update you once the diagnosis is done. Thank you!'),
  ('Diagnosis Complete', 'diagnosis_done', 'Hi {customer_name}, we have completed the diagnosis on your {vehicle_plate}. {diagnosis_summary}. Estimated cost: RM {total_cost}. Do you approve? Reply YES to proceed or NO to decline.'),
  ('Approval Required', 'extra_work', 'Hi {customer_name}, our team found additional work needed on your {vehicle_plate}: {extra_work}. Additional cost: RM {extra_cost}. Please reply YES to approve or NO to decline. Thank you.'),
  ('Parts Delay', 'waiting_parts', 'Hi {customer_name}, we are currently waiting for parts for your {vehicle_plate}. Expected delivery: {expected_date}. We sincerely apologize for the delay and will update you as soon as parts arrive.'),
  ('Ready for Pickup', 'ready', 'Great news! {customer_name}, your {vehicle_plate} is ready for collection at Motoverse Garage. Please collect before 7:00 PM. Please bring your receipt / job card. Thank you for trusting us!'),
  ('Booking Confirmed', 'booking_confirmed', 'Hi {customer_name}, your booking has been confirmed.

Date: {booking_date}
Time: {booking_time}
Vehicle: {vehicle_plate}
Service: {service_type}
Mode: {booking_mode}

See you soon at Motoverse Garage! 🔧')
ON CONFLICT DO NOTHING;

-- ============================================================
-- INSERT WORKSHOP RULES
-- ============================================================

DO $$
DECLARE v_puchong_id uuid; v_kb_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;

  INSERT INTO workshop_rules (branch_id, rule_number, title, description, sort_order) VALUES
    (v_puchong_id, 1, 'Next Action Required', 'Every job must have a next action and next update due date set before leaving for the day.', 1),
    (v_puchong_id, 2, 'Long Due Flag', 'Vehicles in garage more than 3 days with no update must be flagged as Long Due.', 2),
    (v_puchong_id, 3, 'Daily Customer Update', 'Customer must be updated at least once every 24 hours for all active jobs.', 3),
    (v_puchong_id, 4, 'Approval Before Extra Work', 'Approval required before starting any extra work beyond the initial complaint.', 4),
    (v_puchong_id, 5, 'Parts ETA Confirmation', 'Parts orders must be confirmed before committing ETA to customer.', 5),
    (v_puchong_id, 6, 'Long Due Escalation', 'Long due vehicles must have escalation reason documented.', 6),
    (v_puchong_id, 7, 'Ops Manager Escalation', 'Ops Manager is the final escalation point for disputes and blockers.', 7),
    (v_puchong_id, 8, 'Photo Evidence Required', 'Photos must be uploaded for damage, diagnosis, and repair evidence.', 8),
    (v_puchong_id, 9, 'Job Close Requirements', 'No job can be closed without final status, payment status, and pickup confirmation.', 9)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- INSERT STATUS COLORS
-- ============================================================

INSERT INTO status_colors (status_key, label, color_hex, bg_class, text_class) VALUES
  ('new', 'New', '#6B7280', 'bg-gray-500/20', 'text-gray-400'),
  ('booked', 'Booked', '#3B82F6', 'bg-blue-500/20', 'text-blue-400'),
  ('checked_in', 'Checked In', '#8B5CF6', 'bg-violet-500/20', 'text-violet-400'),
  ('diagnosing', 'Diagnosing', '#F59E0B', 'bg-amber-500/20', 'text-amber-400'),
  ('waiting_approval', 'Waiting Approval', '#EF4444', 'bg-red-500/20', 'text-red-400'),
  ('waiting_parts', 'Waiting Parts', '#F97316', 'bg-orange-500/20', 'text-orange-400'),
  ('in_progress', 'In Progress', '#10B981', 'bg-emerald-500/20', 'text-emerald-400'),
  ('ready', 'Ready', '#22C55E', 'bg-green-500/20', 'text-green-400'),
  ('closed', 'Closed', '#6B7280', 'bg-gray-500/20', 'text-gray-500'),
  ('long_due', 'Long Due', '#DC2626', 'bg-red-600/20', 'text-red-500')
ON CONFLICT (status_key) DO UPDATE SET
  label = EXCLUDED.label,
  color_hex = EXCLUDED.color_hex,
  bg_class = EXCLUDED.bg_class,
  text_class = EXCLUDED.text_class;

-- ============================================================
-- INSERT FLEET VEHICLES
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
  v_herman_id uuid;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;
  SELECT id INTO v_herman_id FROM users WHERE email ILIKE '%herman%' LIMIT 1;

  INSERT INTO fleet_vehicles (branch_id, vehicle_id, plate_number, brand, model, year, vehicle_type, color, ownership_status, status, current_mileage, road_tax_expiry, insurance_expiry, next_service_date)
  VALUES
    (v_puchong_id, 'FLT-001', 'ABC1234', 'Toyota', 'Hilux', 2021, 'car', 'White', 'company_owned', 'available', 45000, '2027-03-31', '2027-03-31', '2026-09-01'),
    (v_puchong_id, 'FLT-002', 'MGV8899', 'Perodua', 'Myvi', 2022, 'car', 'Silver', 'company_owned', 'in_use', 28000, '2027-06-30', '2027-06-30', '2026-12-01'),
    (v_puchong_id, 'FLT-003', 'LOG1122', 'Nissan', 'Vanette', 2019, 'car', 'White', 'company_owned', 'under_service', 98000, '2026-08-31', '2026-08-31', '2026-07-01'),
    (v_puchong_id, 'FLT-004', 'MGV150', 'Yamaha', 'Y15ZR', 2023, 'bike', 'Blue', 'company_owned', 'available', 12000, '2027-01-31', '2027-01-31', '2026-09-01')
  ON CONFLICT (plate_number) DO NOTHING;
END $$;

-- ============================================================
-- INSERT ATTENDANCE RECORDS (sample — current week)
-- ============================================================

DO $$
DECLARE
  v_puchong_id uuid;
  v_staff RECORD;
  v_today date := CURRENT_DATE;
BEGIN
  SELECT id INTO v_puchong_id FROM branches WHERE name ILIKE '%puchong%' LIMIT 1;

  FOR v_staff IN SELECT id FROM staff_profiles WHERE branch_id = v_puchong_id LIMIT 5
  LOOP
    INSERT INTO attendance_records (staff_id, branch_id, date, clock_in_time, clock_out_time, status, late_minutes, ot_hours, location_verified)
    VALUES
      (v_staff.id, v_puchong_id, v_today, NOW()::date + TIME '08:55', NOW()::date + TIME '18:05', 'present', 0, 0.08, true),
      (v_staff.id, v_puchong_id, v_today - 1, NOW()::date - 1 + TIME '09:12', NOW()::date - 1 + TIME '18:00', 'late', 12, 0, true),
      (v_staff.id, v_puchong_id, v_today - 2, NOW()::date - 2 + TIME '09:00', NOW()::date - 2 + TIME '19:30', 'overtime', 0, 1.5, true)
    ON CONFLICT (staff_id, date) DO NOTHING;
  END LOOP;
END $$;
