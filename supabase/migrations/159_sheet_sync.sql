-- 159: nightly push of daily Sales / COGS / OPEX into a Google Sheet.
-- One config row per tenant. Holds the Apps Script web-app link and its shared
-- secret, so no policies: only the service role (the edge function) reads it.
CREATE TABLE IF NOT EXISTS sheet_sync_config (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  outlet_name text NOT NULL,
  webapp_url  text NOT NULL,
  secret      text NOT NULL,
  gid         bigint,
  window_days int NOT NULL DEFAULT 14 CHECK (window_days BETWEEN 1 AND 90),
  enabled     boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_status text
);
ALTER TABLE sheet_sync_config ENABLE ROW LEVEL SECURITY;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 00:30 Malaysia time (16:30 UTC) every night
SELECT cron.unschedule('sheet-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sheet-sync');
SELECT cron.schedule('sheet-sync', '30 16 * * *', $$
  SELECT net.http_post(
    url := 'https://lgowhzdwriklgdpfdwot.supabase.co/functions/v1/sheet-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'::jsonb);
$$);
