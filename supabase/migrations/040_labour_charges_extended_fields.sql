-- 040: Extend labour_charges with code, category, duration, skill, bay, taxable fields.
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS labour_code        TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS category           TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS standard_duration  INTEGER; -- minutes
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS required_skill_level TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS bay_required       TEXT;
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS taxable            BOOLEAN NOT NULL DEFAULT FALSE;
