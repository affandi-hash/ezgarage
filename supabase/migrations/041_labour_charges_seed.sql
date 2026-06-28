-- 041: Schema amendments + full labour charges seed data
-- Run this entire block in Supabase SQL Editor

-- ── Step 1: Add all missing columns (safe to re-run) ─────────────────────────
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS labour_code          TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS category             TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS standard_duration    INTEGER;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS required_skill_level TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS bay_required         TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS taxable              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS division             TEXT NOT NULL DEFAULT 'both'
  CHECK (division IN ('car', 'bike', 'both'));

-- ── Step 2: Remove any existing records to avoid duplicates ──────────────────
DELETE FROM labour_charges WHERE labour_code IN (
  'LAB-RM-001','LAB-RM-002','LAB-RM-003','LAB-RM-004','LAB-RM-005',
  'LAB-RM-006','LAB-RM-007','LAB-RM-008','LAB-RM-009','LAB-RM-010',
  'LAB-RM-011','LAB-RM-012','LAB-RM-013',
  'LAB-DI-001','LAB-DI-002','LAB-DI-003','LAB-DI-004','LAB-DI-005',
  'LAB-DI-006','LAB-DI-007','LAB-DI-008','LAB-DI-009','LAB-DI-010',
  'LAB-BR-001','LAB-BR-002','LAB-BR-003','LAB-BR-004','LAB-BR-005',
  'LAB-BR-006','LAB-BR-007',
  'LAB-SU-001','LAB-SU-002','LAB-SU-003','LAB-SU-004','LAB-SU-005',
  'LAB-SU-006','LAB-SU-007',
  'LAB-TY-001','LAB-TY-002','LAB-TY-003','LAB-TY-004','LAB-TY-005',
  'LAB-AC-001','LAB-AC-002','LAB-AC-003','LAB-AC-004','LAB-AC-005',
  'LAB-EN-001','LAB-EN-002','LAB-EN-003','LAB-EN-004','LAB-EN-005',
  'LAB-EN-006','LAB-EN-007',
  'LAB-TR-001','LAB-TR-002','LAB-TR-003','LAB-TR-004',
  'LAB-EL-001','LAB-EL-002','LAB-EL-003','LAB-EL-004',
  'LAB-BD-001','LAB-BD-002','LAB-BD-003','LAB-BD-004','LAB-BD-005','LAB-BD-006'
);
-- Also remove the manually-added record with no code
DELETE FROM labour_charges WHERE labour_code IS NULL AND name = 'Vehicle Health Check';

-- ── Step 3: Insert all 68 records ────────────────────────────────────────────
INSERT INTO labour_charges (labour_code, name, category, standard_duration, unit_price, unit, required_skill_level, bay_required, taxable, division, is_active)
VALUES

-- ROUTINE MAINTENANCE
('LAB-RM-001', 'Vehicle Health Check',                 'Routine Maintenance', 20,   50,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-002', 'Engine Oil Service',                   'Routine Maintenance', 45,   35,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-003', 'Minor Service',                        'Routine Maintenance', 90,   60,   'job', 'Mechanic',             'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-004', 'Major Service',                        'Routine Maintenance', 180,  150,  'job', 'Senior Mechanic',      'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-005', 'Gear Oil Replacement',                 'Routine Maintenance', 45,   40,   'job', 'Mechanic',             'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-006', 'Automatic Transmission Fluid Service', 'Routine Maintenance', 90,   120,  'job', 'Senior Mechanic',      'General Service Bay', TRUE,  'car',  TRUE),
('LAB-RM-007', 'Coolant Flush',                        'Routine Maintenance', 60,   80,   'job', 'Mechanic',             'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-008', 'Brake Fluid Flush',                    'Routine Maintenance', 60,   80,   'job', 'Mechanic',             'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-009', 'Power Steering Fluid Service',         'Routine Maintenance', 45,   50,   'job', 'Mechanic',             'General Service Bay', TRUE,  'car',  TRUE),
('LAB-RM-010', 'Spark Plug Replacement',               'Routine Maintenance', 45,   50,   'job', 'Mechanic',             'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-011', 'Air Filter Replacement',               'Routine Maintenance', 15,   15,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'both', TRUE),
('LAB-RM-012', 'Cabin Filter Replacement',             'Routine Maintenance', 15,   15,   'job', 'Junior Mechanic',      'General Service Bay', TRUE,  'car',  TRUE),
('LAB-RM-013', 'Battery Replacement',                  'Routine Maintenance', 20,   0,    'job', 'Junior Mechanic',      'General Service Bay', FALSE, 'both', TRUE),

-- DIAGNOSTICS & INSPECTION
('LAB-DI-001', 'Computer Diagnostic Scan',   'Diagnostics', 30,  50,  'job', 'Diagnostic Technician', 'Diagnostic Bay', TRUE, 'both', TRUE),
('LAB-DI-002', 'Advanced Vehicle Diagnosis', 'Diagnostics', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'both', TRUE),
('LAB-DI-003', 'Engine Diagnosis',           'Diagnostics', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'both', TRUE),
('LAB-DI-004', 'Brake Diagnosis',            'Diagnostics', 30,  50,  'job', 'Mechanic',              'Diagnostic Bay', TRUE, 'both', TRUE),
('LAB-DI-005', 'Suspension Diagnosis',       'Diagnostics', 45,  80,  'job', 'Senior Mechanic',       'Diagnostic Bay', TRUE, 'both', TRUE),
('LAB-DI-006', 'Steering Diagnosis',         'Diagnostics', 45,  80,  'job', 'Senior Mechanic',       'Diagnostic Bay', TRUE, 'car',  TRUE),
('LAB-DI-007', 'Electrical Diagnosis',       'Diagnostics', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'both', TRUE),
('LAB-DI-008', 'Air Conditioning Diagnosis', 'Diagnostics', 45,  80,  'job', 'AC Specialist',         'AC Bay',         TRUE, 'car',  TRUE),
('LAB-DI-009', 'Road Test & Diagnosis',      'Diagnostics', 30,  50,  'job', 'Senior Mechanic',       'Road Test',      TRUE, 'both', TRUE),
('LAB-DI-010', 'Pre-Purchase Inspection',    'Inspection',  120, 180, 'job', 'Senior Mechanic',       'Inspection Bay', TRUE, 'both', TRUE),

-- BRAKE SYSTEM
('LAB-BR-001', 'Front Brake Pad Replacement',        'Brake System', 60,  80,  'job', 'Mechanic',          'Brake Bay', TRUE, 'both', TRUE),
('LAB-BR-002', 'Rear Brake Pad Replacement',         'Brake System', 60,  80,  'job', 'Mechanic',          'Brake Bay', TRUE, 'both', TRUE),
('LAB-BR-003', 'Front & Rear Brake Pad Replacement', 'Brake System', 90,  150, 'job', 'Mechanic',          'Brake Bay', TRUE, 'both', TRUE),
('LAB-BR-004', 'Brake Disc Replacement',             'Brake System', 120, 120, 'job', 'Senior Mechanic',   'Brake Bay', TRUE, 'car',  TRUE),
('LAB-BR-005', 'Brake Disc Skimming',                'Brake System', 90,  80,  'job', 'Mechanic',          'Brake Bay', TRUE, 'car',  TRUE),
('LAB-BR-006', 'Brake Caliper Service',              'Brake System', 120, 180, 'job', 'Senior Mechanic',   'Brake Bay', TRUE, 'car',  TRUE),
('LAB-BR-007', 'Brake System Overhaul',              'Brake System', 240, 350, 'job', 'Master Technician', 'Brake Bay', TRUE, 'both', TRUE),

-- SUSPENSION & STEERING
('LAB-SU-001', 'Absorber Replacement',        'Suspension', 120, 180, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'both', TRUE),
('LAB-SU-002', 'Lower Arm Replacement',       'Suspension', 120, 180, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'car',  TRUE),
('LAB-SU-003', 'Suspension Bush Replacement', 'Suspension', 180, 200, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'both', TRUE),
('LAB-SU-004', 'Ball Joint Replacement',      'Suspension', 90,  120, 'job', 'Mechanic',          'Suspension Bay', TRUE, 'both', TRUE),
('LAB-SU-005', 'Tie Rod Replacement',         'Steering',   60,  120, 'job', 'Mechanic',          'Alignment Bay',  TRUE, 'car',  TRUE),
('LAB-SU-006', 'Steering Rack Replacement',   'Steering',   360, 350, 'job', 'Master Technician', 'Alignment Bay',  TRUE, 'car',  TRUE),
('LAB-SU-007', 'Wheel Bearing Replacement',   'Suspension', 120, 180, 'job', 'Senior Mechanic',   'Suspension Bay', TRUE, 'both', TRUE),

-- TYRES & ALIGNMENT
('LAB-TY-001', 'Tyre Installation', 'Tyres',     15, 15, 'unit', 'Tyre Technician',      'Tyre Bay',      TRUE, 'both', TRUE),
('LAB-TY-002', 'Wheel Balancing',   'Tyres',     15, 10, 'unit', 'Tyre Technician',      'Tyre Bay',      TRUE, 'both', TRUE),
('LAB-TY-003', 'Tyre Rotation',     'Tyres',     30, 40, 'job',  'Tyre Technician',      'Tyre Bay',      TRUE, 'both', TRUE),
('LAB-TY-004', 'Wheel Alignment',   'Alignment', 45, 45, 'job',  'Alignment Technician', 'Alignment Bay', TRUE, 'car',  TRUE),
('LAB-TY-005', 'Puncture Repair',   'Tyres',     20, 20, 'unit', 'Tyre Technician',      'Tyre Bay',      TRUE, 'both', TRUE),

-- AIR CONDITIONING
('LAB-AC-001', 'Air Conditioning Service',      'Air Conditioning', 120, 120, 'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-002', 'Air Conditioning Gas Recharge', 'Air Conditioning', 45,  80,  'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-003', 'Compressor Replacement',        'Air Conditioning', 240, 250, 'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-004', 'Cooling Coil Replacement',      'Air Conditioning', 360, 450, 'job', 'Master Technician', 'AC Bay', TRUE, 'car', TRUE),
('LAB-AC-005', 'Condenser Replacement',         'Air Conditioning', 180, 180, 'job', 'AC Specialist',     'AC Bay', TRUE, 'car', TRUE),

-- ENGINE REPAIR
('LAB-EN-001', 'Timing Belt Replacement',  'Engine', 240,  450,  'job', 'Master Technician', 'Engine Bay', TRUE, 'car',  TRUE),
('LAB-EN-002', 'Timing Chain Replacement', 'Engine', 360,  650,  'job', 'Master Technician', 'Engine Bay', TRUE, 'car',  TRUE),
('LAB-EN-003', 'Water Pump Replacement',   'Engine', 180,  250,  'job', 'Senior Mechanic',   'Engine Bay', TRUE, 'both', TRUE),
('LAB-EN-004', 'Head Gasket Replacement',  'Engine', 720,  1200, 'job', 'Master Technician', 'Engine Bay', TRUE, 'both', TRUE),
('LAB-EN-005', 'Top Overhaul',             'Engine', 480,  1500, 'job', 'Master Technician', 'Engine Bay', TRUE, 'both', TRUE),
('LAB-EN-006', 'Engine Overhaul',          'Engine', 1440, 3500, 'job', 'Master Technician', 'Engine Bay', TRUE, 'both', TRUE),
('LAB-EN-007', 'Turbocharger Replacement', 'Engine', 240,  300,  'job', 'Master Technician', 'Engine Bay', TRUE, 'car',  TRUE),

-- TRANSMISSION
('LAB-TR-001', 'Clutch Replacement',             'Transmission', 360,  450,  'job', 'Master Technician', 'Transmission Bay', TRUE, 'both', TRUE),
('LAB-TR-002', 'Gearbox Removal & Installation', 'Transmission', 360,  600,  'job', 'Master Technician', 'Transmission Bay', TRUE, 'both', TRUE),
('LAB-TR-003', 'Gearbox Overhaul',               'Transmission', 1440, 1500, 'job', 'Master Technician', 'Transmission Bay', TRUE, 'both', TRUE),
('LAB-TR-004', 'CVT Repair',                     'Transmission', 720,  1200, 'job', 'Master Technician', 'Transmission Bay', TRUE, 'car',  TRUE),

-- ELECTRICAL
('LAB-EL-001', 'Alternator Replacement',    'Electrical', 120, 120, 'job', 'Electrical Technician', 'Electrical Bay', TRUE, 'both', TRUE),
('LAB-EL-002', 'Starter Motor Replacement', 'Electrical', 90,  120, 'job', 'Electrical Technician', 'Electrical Bay', TRUE, 'both', TRUE),
('LAB-EL-003', 'Wiring Repair',             'Electrical', 60,  120, 'hr',  'Master Technician',     'Electrical Bay', TRUE, 'both', TRUE),
('LAB-EL-004', 'ECU Diagnosis',             'Electrical', 60,  150, 'job', 'Master Technician',     'Diagnostic Bay', TRUE, 'both', TRUE),

-- BODY & DETAILING
('LAB-BD-001', 'Headlamp Restoration', 'Detailing', 90,  80,  'job', 'Detailer',        'Detailing Bay', TRUE, 'car',  TRUE),
('LAB-BD-002', 'Exterior Wash',        'Detailing', 30,  20,  'job', 'Detailer',        'Wash Bay',      TRUE, 'both', TRUE),
('LAB-BD-003', 'Wash & Vacuum',        'Detailing', 60,  40,  'job', 'Detailer',        'Wash Bay',      TRUE, 'both', TRUE),
('LAB-BD-004', 'Full Detailing',       'Detailing', 240, 350, 'job', 'Senior Detailer', 'Detailing Bay', TRUE, 'both', TRUE),
('LAB-BD-005', 'Polish & Wax',         'Detailing', 180, 300, 'job', 'Senior Detailer', 'Detailing Bay', TRUE, 'both', TRUE),
('LAB-BD-006', 'Ceramic Coating',      'Detailing', 720, 500, 'job', 'Master Detailer', 'Coating Bay',   TRUE, 'car',  TRUE);
