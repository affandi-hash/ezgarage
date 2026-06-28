-- 043: Add division field to parts_catalogue (car / bike / both)
ALTER TABLE parts_catalogue ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'both'
  CHECK (division IN ('car', 'bike', 'both'));
