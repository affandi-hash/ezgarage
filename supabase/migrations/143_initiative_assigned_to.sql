ALTER TABLE sales_marketing_plan_initiatives ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id);
