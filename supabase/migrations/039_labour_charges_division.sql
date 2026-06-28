-- 039: Add division field to labour_charges (car / bike / both)
ALTER TABLE labour_charges ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'both'
  CHECK (division IN ('car', 'bike', 'both'));
