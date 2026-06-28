-- 042: Complete labour charges seed — Car Division + Bike Division
-- Run this entire block in Supabase SQL Editor

-- ── Step 1: Schema columns (safe to re-run) ───────────────────────────────────
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS labour_code          TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS category             TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS standard_duration    INTEGER;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS required_skill_level TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS bay_required         TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS taxable              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS division             TEXT NOT NULL DEFAULT 'both'
  CHECK (division IN ('car', 'bike', 'both'));

-- ── Step 2: Wipe all existing records (clean slate) ───────────────────────────
DELETE FROM labour_charges;

-- ── Step 3: Insert ALL records ────────────────────────────────────────────────
INSERT INTO labour_charges
  (labour_code, name, category, standard_duration, unit_price, unit, required_skill_level, bay_required, taxable, division, is_active)
VALUES

-- ══════════════════════════════════════════════════════════════════════════════
-- CAR DIVISION
-- ══════════════════════════════════════════════════════════════════════════════

-- ROUTINE MAINTENANCE
('LAB-RM-001', 'Vehicle Health Check',                 'Routine Maintenance', 20,   50,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-002', 'Engine Oil Service',                   'Routine Maintenance', 45,   35,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-003', 'Minor Service',                        'Routine Maintenance', 90,   60,   'job', 'Mechanic',             'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-004', 'Major Service',                        'Routine Maintenance', 180,  150,  'job', 'Senior Mechanic',      'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-005', 'Gear Oil Replacement',                 'Routine Maintenance', 45,   40,   'job', 'Mechanic',             'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-006', 'Automatic Transmission Fluid Service', 'Routine Maintenance', 90,   120,  'job', 'Senior Mechanic',      'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-007', 'Coolant Flush',                        'Routine Maintenance', 60,   80,   'job', 'Mechanic',             'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-008', 'Brake Fluid Flush',                    'Routine Maintenance', 60,   80,   'job', 'Mechanic',             'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-009', 'Power Steering Fluid Service',         'Routine Maintenance', 45,   50,   'job', 'Mechanic',             'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-010', 'Spark Plug Replacement',               'Routine Maintenance', 45,   50,   'job', 'Mechanic',             'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-011', 'Air Filter Replacement',               'Routine Maintenance', 15,   15,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-012', 'Cabin Filter Replacement',             'Routine Maintenance', 15,   15,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'car', TRUE),
('LAB-RM-013', 'Battery Replacement',                  'Routine Maintenance', 20,   0,    'job', 'Junior Mechanic',      'General Service Bay', FALSE, 'car', TRUE),

-- DIAGNOSTICS & INSPECTION
('LAB-DI-001', 'Computer Diagnostic Scan',   'Diagnostics', 30,  50,  'job', 'Diagnostic Technician', 'Diagnostic Bay', TRUE, 'car', TRUE),
('LAB-DI-002', 'Advanced Vehicle Diagnosis', 'Diagnostics', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'car', TRUE),
('LAB-DI-003', 'Engine Diagnosis',           'Diagnostics', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'car', TRUE),
('LAB-DI-004', 'Brake Diagnosis',            'Diagnostics', 30,  50,  'job', 'Mechanic',              'Diagnostic Bay', TRUE, 'car', TRUE),
('LAB-DI-005', 'Suspension Diagnosis',       'Diagnostics', 45,  80,  'job', 'Senior Mechanic',       'Diagnostic Bay', TRUE, 'car', TRUE),
('LAB-DI-006', 'Steering Diagnosis',         'Diagnostics', 45,  80,  'job', 'Senior Mechanic',       'Diagnostic Bay', TRUE, 'car', TRUE),
('LAB-DI-007', 'Electrical Diagnosis',       'Diagnostics', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'car', TRUE),
('LAB-DI-008', 'Air Conditioning Diagnosis', 'Diagnostics', 45,  80,  'job', 'AC Specialist',         'AC Bay',         TRUE, 'car', TRUE),
('LAB-DI-009', 'Road Test & Diagnosis',      'Diagnostics', 30,  50,  'job', 'Senior Mechanic',       'Road Test',      TRUE, 'car', TRUE),
('LAB-DI-010', 'Pre-Purchase Inspection',    'Inspection',  120, 180, 'job', 'Senior Mechanic',       'Inspection Bay', TRUE, 'car', TRUE),

-- BRAKE SYSTEM
('LAB-BR-001', 'Front Brake Pad Replacement',        'Brake System', 60,  80,  'job', 'Mechanic',          'Brake Bay', TRUE, 'car', TRUE),
('LAB-BR-002', 'Rear Brake Pad Replacement',         'Brake System', 60,  80,  'job', 'Mechanic',          'Brake Bay', TRUE, 'car', TRUE),
('LAB-BR-003', 'Front & Rear Brake Pad Replacement', 'Brake System', 90,  150, 'job', 'Mechanic',          'Brake Bay', TRUE, 'car', TRUE),
('LAB-BR-004', 'Brake Disc Replacement',             'Brake System', 120, 120, 'job', 'Senior Mechanic',   'Brake Bay', TRUE, 'car', TRUE),
('LAB-BR-005', 'Brake Disc Skimming',                'Brake System', 90,  80,  'job', 'Mechanic',          'Brake Bay', TRUE, 'car', TRUE),
('LAB-BR-006', 'Brake Caliper Service',              'Brake System', 120, 180, 'job', 'Senior Mechanic',   'Brake Bay', TRUE, 'car', TRUE),
('LAB-BR-007', 'Brake System Overhaul',              'Brake System', 240, 350, 'job', 'Master Technician', 'Brake Bay', TRUE, 'car', TRUE),

-- SUSPENSION & STEERING
('LAB-SU-001', 'Absorber Replacement',        'Suspension', 120, 180, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'car', TRUE),
('LAB-SU-002', 'Lower Arm Replacement',       'Suspension', 120, 180, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'car', TRUE),
('LAB-SU-003', 'Suspension Bush Replacement', 'Suspension', 180, 200, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'car', TRUE),
('LAB-SU-004', 'Ball Joint Replacement',      'Suspension', 90,  120, 'job', 'Mechanic',          'Suspension Bay', TRUE, 'car', TRUE),
('LAB-SU-005', 'Tie Rod Replacement',         'Steering',   60,  120, 'job', 'Mechanic',          'Alignment Bay',  TRUE, 'car', TRUE),
('LAB-SU-006', 'Steering Rack Replacement',   'Steering',   360, 350, 'job', 'Master Technician', 'Alignment Bay',  TRUE, 'car', TRUE),
('LAB-SU-007', 'Wheel Bearing Replacement',   'Suspension', 120, 180, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'car', TRUE),

-- TYRES & ALIGNMENT
('LAB-TY-001', 'Tyre Installation', 'Tyres',     15, 15, 'unit', 'Tyre Technician',      'Tyre Bay',      TRUE, 'car', TRUE),
('LAB-TY-002', 'Wheel Balancing',   'Tyres',     15, 10, 'unit', 'Tyre Technician',      'Tyre Bay',      TRUE, 'car', TRUE),
('LAB-TY-003', 'Tyre Rotation',     'Tyres',     30, 40, 'job',  'Tyre Technician',      'Tyre Bay',      TRUE, 'car', TRUE),
('LAB-TY-004', 'Wheel Alignment',   'Alignment', 45, 45, 'job',  'Alignment Technician', 'Alignment Bay', TRUE, 'car', TRUE),
('LAB-TY-005', 'Puncture Repair',   'Tyres',     20, 20, 'unit', 'Tyre Technician',      'Tyre Bay',      TRUE, 'car', TRUE),

-- AIR CONDITIONING
('LAB-AC-001', 'Air Conditioning Service',      'Air Conditioning', 120, 120, 'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-002', 'Air Conditioning Gas Recharge', 'Air Conditioning', 45,  80,  'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-003', 'Compressor Replacement',        'Air Conditioning', 240, 250, 'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-004', 'Cooling Coil Replacement',      'Air Conditioning', 360, 450, 'job', 'Master Technician', 'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-005', 'Condenser Replacement',         'Air Conditioning', 180, 180, 'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),

-- ENGINE REPAIR
('LAB-EN-001', 'Timing Belt Replacement',  'Engine', 240,  450,  'job', 'Master Technician', 'Engine Bay', TRUE, 'car', TRUE),
('LAB-EN-002', 'Timing Chain Replacement', 'Engine', 360,  650,  'job', 'Master Technician', 'Engine Bay', TRUE, 'car', TRUE),
('LAB-EN-003', 'Water Pump Replacement',   'Engine', 180,  250,  'job', 'Senior Mechanic',   'Engine Bay', TRUE, 'car', TRUE),
('LAB-EN-004', 'Head Gasket Replacement',  'Engine', 720,  1200, 'job', 'Master Technician', 'Engine Bay', TRUE, 'car', TRUE),
('LAB-EN-005', 'Top Overhaul',             'Engine', 480,  1500, 'job', 'Master Technician', 'Engine Bay', TRUE, 'car', TRUE),
('LAB-EN-006', 'Engine Overhaul',          'Engine', 1440, 3500, 'job', 'Master Technician', 'Engine Bay', TRUE, 'car', TRUE),
('LAB-EN-007', 'Turbocharger Replacement', 'Engine', 240,  300,  'job', 'Master Technician', 'Engine Bay', TRUE, 'car', TRUE),

-- TRANSMISSION
('LAB-TR-001', 'Clutch Replacement',             'Transmission', 360,  450,  'job', 'Master Technician', 'Transmission Bay', TRUE, 'car', TRUE),
('LAB-TR-002', 'Gearbox Removal & Installation', 'Transmission', 360,  600,  'job', 'Master Technician', 'Transmission Bay', TRUE, 'car', TRUE),
('LAB-TR-003', 'Gearbox Overhaul',               'Transmission', 1440, 1500, 'job', 'Master Technician', 'Transmission Bay', TRUE, 'car', TRUE),
('LAB-TR-004', 'CVT Repair',                     'Transmission', 720,  1200, 'job', 'Master Technician', 'Transmission Bay', TRUE, 'car', TRUE),

-- ELECTRICAL
('LAB-EL-001', 'Alternator Replacement',    'Electrical', 120, 120, 'job', 'Electrical Technician', 'Electrical Bay', TRUE, 'car', TRUE),
('LAB-EL-002', 'Starter Motor Replacement', 'Electrical', 90,  120, 'job', 'Electrical Technician', 'Electrical Bay', TRUE, 'car', TRUE),
('LAB-EL-003', 'Wiring Repair',             'Electrical', 60,  120, 'hr',  'Master Technician',     'Electrical Bay', TRUE, 'car', TRUE),
('LAB-EL-004', 'ECU Diagnosis',             'Electrical', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'car', TRUE),

-- BODY & DETAILING
('LAB-BD-001', 'Headlamp Restoration', 'Detailing', 90,  80,  'job', 'Detailer',        'Detailing Bay', TRUE, 'car', TRUE),
('LAB-BD-002', 'Exterior Wash',        'Detailing', 30,  20,  'job', 'Detailer',        'Wash Bay',      TRUE, 'car', TRUE),
('LAB-BD-003', 'Wash & Vacuum',        'Detailing', 60,  40,  'job', 'Detailer',        'Wash Bay',      TRUE, 'car', TRUE),
('LAB-BD-004', 'Full Detailing',       'Detailing', 240, 350, 'job', 'Senior Detailer', 'Detailing Bay', TRUE, 'car', TRUE),
('LAB-BD-005', 'Polish & Wax',         'Detailing', 180, 300, 'job', 'Senior Detailer', 'Detailing Bay', TRUE, 'car', TRUE),
('LAB-BD-006', 'Ceramic Coating',      'Detailing', 720, 500, 'job', 'Master Detailer', 'Coating Bay',   TRUE, 'car', TRUE),

-- ══════════════════════════════════════════════════════════════════════════════
-- BIKE DIVISION
-- ══════════════════════════════════════════════════════════════════════════════

-- ROUTINE MAINTENANCE
('LAB-BK-RM-001', 'Bike Safety Inspection',              'Routine Maintenance', 20,  30,  'job', 'Junior Mechanic',      'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-002', 'Engine Oil Change',                   'Routine Maintenance', 30,  25,  'job', 'Junior Mechanic',      'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-003', 'Full Service (Scooter/Moped ≤250cc)', 'Routine Maintenance', 60,  60,  'job', 'Mechanic',             'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-004', 'Full Service (250cc–900cc)',          'Routine Maintenance', 90,  100, 'job', 'Mechanic',             'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-005', 'Full Service (900cc+)',               'Routine Maintenance', 120, 150, 'job', 'Senior Mechanic',      'Premium Bike Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-006', 'Major Service',                       'Routine Maintenance', 180, 250, 'job', 'Senior Mechanic',      'Premium Bike Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-007', 'Coolant Replacement',                 'Routine Maintenance', 45,  50,  'job', 'Mechanic',             'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-008', 'Brake Fluid Replacement',             'Routine Maintenance', 45,  50,  'job', 'Mechanic',             'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-009', 'Fork Oil Replacement',                'Routine Maintenance', 120, 150, 'job', 'Suspension Specialist','Suspension Bay',   TRUE, 'bike', TRUE),
('LAB-BK-RM-010', 'Air Filter Replacement',              'Routine Maintenance', 20,  20,  'job', 'Junior Mechanic',      'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-011', 'Spark Plug Replacement',              'Routine Maintenance', 30,  30,  'job', 'Mechanic',             'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-RM-012', 'Battery Replacement',                 'Routine Maintenance', 20,  20,  'job', 'Junior Mechanic',      'Bike Service Bay', TRUE, 'bike', TRUE),

-- DIAGNOSTICS
('LAB-BK-DI-001', 'Computer Diagnostic Scan', 'Diagnostics', 30, 50,  'job', 'Diagnostic Technician', 'Diagnostic Bay', TRUE, 'bike', TRUE),
('LAB-BK-DI-002', 'Engine Diagnosis',         'Diagnostics', 60, 120, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'bike', TRUE),
('LAB-BK-DI-003', 'Electrical Diagnosis',     'Diagnostics', 60, 120, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'bike', TRUE),
('LAB-BK-DI-004', 'ABS Diagnosis',            'Diagnostics', 45, 100, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'bike', TRUE),
('LAB-BK-DI-005', 'Suspension Diagnosis',     'Diagnostics', 45, 80,  'job', 'Suspension Specialist', 'Suspension Bay', TRUE, 'bike', TRUE),
('LAB-BK-DI-006', 'Road Test & Diagnosis',    'Diagnostics', 30, 50,  'job', 'Senior Mechanic',       'Road Test',      TRUE, 'bike', TRUE),

-- CHAIN / BELT / FINAL DRIVE
('LAB-BK-DR-001', 'Chain Adjustment',             'Final Drive', 20,  20,  'job', 'Junior Mechanic',  'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-DR-002', 'Chain Cleaning & Lubrication', 'Final Drive', 20,  20,  'job', 'Junior Mechanic',  'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-DR-003', 'Chain & Sprocket Replacement', 'Final Drive', 90,  120, 'job', 'Mechanic',         'Bike Service Bay', TRUE, 'bike', TRUE),
('LAB-BK-DR-004', 'Belt Replacement (Harley)',    'Final Drive', 180, 250, 'job', 'Harley Specialist', 'Harley Bay',      TRUE, 'bike', TRUE),

-- BRAKE SYSTEM
('LAB-BK-BR-001', 'Front Brake Pad Replacement', 'Brake System', 45,  50,  'job', 'Mechanic',          'Brake Bay', TRUE, 'bike', TRUE),
('LAB-BK-BR-002', 'Rear Brake Pad Replacement',  'Brake System', 45,  50,  'job', 'Mechanic',          'Brake Bay', TRUE, 'bike', TRUE),
('LAB-BK-BR-003', 'Brake Disc Replacement',      'Brake System', 60,  80,  'job', 'Mechanic',          'Brake Bay', TRUE, 'bike', TRUE),
('LAB-BK-BR-004', 'Brake Caliper Service',       'Brake System', 90,  120, 'job', 'Senior Mechanic',   'Brake Bay', TRUE, 'bike', TRUE),
('LAB-BK-BR-005', 'Brake System Overhaul',       'Brake System', 180, 250, 'job', 'Master Technician', 'Brake Bay', TRUE, 'bike', TRUE),

-- TYRES & WHEELS
('LAB-BK-TY-001', 'Tyre Replacement (Front)', 'Tyres', 30, 35, 'unit', 'Tyre Technician', 'Tyre Bay', TRUE, 'bike', TRUE),
('LAB-BK-TY-002', 'Tyre Replacement (Rear)',  'Tyres', 45, 45, 'unit', 'Tyre Technician', 'Tyre Bay', TRUE, 'bike', TRUE),
('LAB-BK-TY-003', 'Wheel Balancing',          'Tyres', 20, 20, 'unit', 'Tyre Technician', 'Tyre Bay', TRUE, 'bike', TRUE),
('LAB-BK-TY-004', 'Tube Replacement',         'Tyres', 30, 25, 'unit', 'Tyre Technician', 'Tyre Bay', TRUE, 'bike', TRUE),
('LAB-BK-TY-005', 'Puncture Repair',          'Tyres', 20, 20, 'unit', 'Tyre Technician', 'Tyre Bay', TRUE, 'bike', TRUE),

-- SUSPENSION
('LAB-BK-SU-001', 'Front Fork Service',        'Suspension', 120, 150, 'job', 'Suspension Specialist', 'Suspension Bay', TRUE, 'bike', TRUE),
('LAB-BK-SU-002', 'Rear Shock Replacement',    'Suspension', 60,  80,  'job', 'Suspension Specialist', 'Suspension Bay', TRUE, 'bike', TRUE),
('LAB-BK-SU-003', 'Racing Bros Installation',  'Suspension', 180, 250, 'job', 'Suspension Specialist', 'Suspension Bay', TRUE, 'bike', TRUE),
('LAB-BK-SU-004', 'Suspension Setup & Tuning', 'Suspension', 90,  120, 'job', 'Suspension Specialist', 'Suspension Bay', TRUE, 'bike', TRUE),

-- ENGINE REPAIR
('LAB-BK-EN-001', 'Clutch Replacement',                  'Engine', 120, 180,  'job', 'Senior Mechanic',   'Engine Bay', TRUE, 'bike', TRUE),
('LAB-BK-EN-002', 'Top Overhaul',                        'Engine', 480, 800,  'job', 'Master Technician', 'Engine Bay', TRUE, 'bike', TRUE),
('LAB-BK-EN-003', 'Complete Engine Overhaul (≤250cc)',   'Engine', 720, 1200, 'job', 'Master Technician', 'Engine Bay', TRUE, 'bike', TRUE),
('LAB-BK-EN-004', 'Complete Engine Overhaul (250cc+)',   'Engine', 960, 1800, 'job', 'Master Technician', 'Engine Bay', TRUE, 'bike', TRUE),
('LAB-BK-EN-005', 'Harley-Davidson Engine Overhaul',     'Engine', 1440,3500, 'job', 'Harley Specialist',  'Harley Bay', TRUE, 'bike', TRUE),

-- ELECTRICAL
('LAB-BK-EL-001', 'Charging System Diagnosis', 'Electrical', 45, 80,  'job', 'Electrical Technician', 'Electrical Bay', TRUE, 'bike', TRUE),
('LAB-BK-EL-002', 'Starter Motor Replacement', 'Electrical', 60, 80,  'job', 'Electrical Technician', 'Electrical Bay', TRUE, 'bike', TRUE),
('LAB-BK-EL-003', 'Wiring Repair',             'Electrical', 60, 120, 'hr',  'Master Technician',     'Electrical Bay', TRUE, 'bike', TRUE),
('LAB-BK-EL-004', 'Lighting Installation',     'Electrical', 45, 60,  'job', 'Electrical Technician', 'Electrical Bay', TRUE, 'bike', TRUE),
('LAB-BK-EL-005', 'Accessory Wiring',          'Electrical', 90, 150, 'job', 'Master Technician',     'Electrical Bay', TRUE, 'bike', TRUE),

-- HARLEY-DAVIDSON TOURING & BIG BIKE UPGRADES
('LAB-HD-UP-001', 'Handlebar Installation',      'Harley Upgrade', 240, 350, 'job', 'Harley Specialist',       'Harley Bay',      TRUE, 'bike', TRUE),
('LAB-HD-UP-002', 'Exhaust Installation',         'Harley Upgrade', 60,  100, 'job', 'Harley Specialist',       'Harley Bay',      TRUE, 'bike', TRUE),
('LAB-HD-UP-003', 'Audio System Installation',    'Harley Upgrade', 240, 400, 'job', 'Harley Specialist',       'Harley Bay',      TRUE, 'bike', TRUE),
('LAB-HD-UP-004', 'Fairing Installation',         'Harley Upgrade', 240, 350, 'job', 'Harley Specialist',       'Harley Bay',      TRUE, 'bike', TRUE),
('LAB-HD-UP-005', 'Saddlebag Installation',       'Harley Upgrade', 90,  120, 'job', 'Harley Specialist',       'Harley Bay',      TRUE, 'bike', TRUE),
('LAB-HD-UP-006', 'LED Lighting Upgrade',         'Harley Upgrade', 120, 180, 'job', 'Harley Specialist',       'Harley Bay',      TRUE, 'bike', TRUE),
('LAB-HD-UP-007', 'Stage 1 Performance Upgrade',  'Performance',    180, 300, 'job', 'Harley Specialist',       'Dyno/Harley Bay', TRUE, 'bike', TRUE),
('LAB-HD-UP-008', 'Camshaft Upgrade',             'Performance',    480, 800, 'job', 'Harley Master Technician','Harley Bay',      TRUE, 'bike', TRUE),
('LAB-HD-UP-009', 'Suspension Upgrade',           'Harley Upgrade', 180, 250, 'job', 'Suspension Specialist',   'Harley Bay',      TRUE, 'bike', TRUE),

-- DETAILING & PROTECTION
('LAB-BK-DT-001', 'Bike Wash',        'Detailing', 20,  20,  'job', 'Detailer',        'Wash Bay',      TRUE, 'bike', TRUE),
('LAB-BK-DT-002', 'Wash & Polish',    'Detailing', 90,  120, 'job', 'Detailer',        'Detailing Bay', TRUE, 'bike', TRUE),
('LAB-BK-DT-003', 'Ceramic Coating',  'Detailing', 360, 350, 'job', 'Senior Detailer', 'Coating Bay',   TRUE, 'bike', TRUE),
('LAB-BK-DT-004', 'Chrome Polishing', 'Detailing', 120, 150, 'job', 'Detailer',        'Detailing Bay', TRUE, 'bike', TRUE),

-- RECOVERY & MOBILE SERVICES
('LAB-BK-MB-001', 'On-Site Breakdown Inspection', 'Mobile Service', 60, 150, 'job', 'Senior Mechanic', 'Mobile Service', TRUE, 'bike', TRUE),
('LAB-BK-MB-002', 'Jump Start Service',           'Mobile Service', 20, 50,  'job', 'Junior Mechanic', 'Mobile Service', TRUE, 'bike', TRUE),
('LAB-BK-MB-003', 'Battery Installation On-Site', 'Mobile Service', 30, 50,  'job', 'Junior Mechanic', 'Mobile Service', TRUE, 'bike', TRUE),
('LAB-BK-MB-004', 'Pick-Up & Delivery',           'Mobile Service', 60, 80,  'job', 'Driver',          'Transport',      TRUE, 'bike', TRUE);
