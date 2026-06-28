-- 037: Add selling_price to parts_requests for markup-based catalogue update on receive.
ALTER TABLE parts_requests ADD COLUMN IF NOT EXISTS selling_price DECIMAL(10,2);
