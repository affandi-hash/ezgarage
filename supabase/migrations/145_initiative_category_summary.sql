ALTER TABLE sales_marketing_plan_initiatives ADD COLUMN IF NOT EXISTS category text CHECK (category IN ('sales', 'fixing', 'other'));
ALTER TABLE sales_marketing_plan_initiatives ADD COLUMN IF NOT EXISTS summary text;
