-- 036: Add ordered_qty and catalogue_part_id to parts_requests for split-on-receive flow.
ALTER TABLE parts_requests ADD COLUMN IF NOT EXISTS ordered_qty INTEGER;
ALTER TABLE parts_requests ADD COLUMN IF NOT EXISTS catalogue_part_id UUID REFERENCES parts_catalogue(id);
