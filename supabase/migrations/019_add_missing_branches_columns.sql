-- 019: Add missing columns to branches table
-- city and is_main are required by create_tenant_signup RPC (015)
-- but were never added to the branches table definition (001)

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS city     TEXT,
  ADD COLUMN IF NOT EXISTS is_main  BOOLEAN DEFAULT false;
