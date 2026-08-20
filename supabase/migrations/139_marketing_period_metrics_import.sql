-- 139: Support importing historical monthly metrics (revenue/net_profit
-- from a tenant's pre-ezgarage system, extracted from an uploaded
-- image/PDF) into sales_marketing_period_metrics, clearly tagged so they
-- can never be confused with a manually-typed live-period entry.

ALTER TABLE sales_marketing_period_metrics ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_extracted_historical'));
ALTER TABLE sales_marketing_period_metrics ADD COLUMN IF NOT EXISTS source_file_url text;

ALTER TABLE sales_marketing_period_metrics DROP CONSTRAINT sales_marketing_period_metrics_metric_key_check;
ALTER TABLE sales_marketing_period_metrics ADD CONSTRAINT sales_marketing_period_metrics_metric_key_check
  CHECK (metric_key IN (
    'reach', 'leads', 'prospects', 'google_reviews_count', 'google_reviews_rating',
    'revenue_target', 'esp_target', 'spend', 'revenue', 'net_profit'
  ));
