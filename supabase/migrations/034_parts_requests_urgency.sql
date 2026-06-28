-- 034: Add urgency column to parts_requests (was missing from original schema).
ALTER TABLE parts_requests ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'normal' CHECK (urgency IN ('low','normal','urgent','critical'));
