-- 088: Schedule the RaudhahPay daily statement to run every night at
-- 00:00 MYT (16:00 UTC, no DST in Malaysia) via pg_cron + pg_net, calling
-- the raudhahpay-daily-statement edge function with the service role key.
--
-- The service role key itself is deliberately NOT in this file — it's
-- seeded into Supabase Vault (`vault.create_secret`) as a one-off,
-- unversioned operation, so the raw key never lands in git history. This
-- migration only references it by name.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'raudhahpay-daily-statement',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgowhzdwriklgdpfdwot.supabase.co/functions/v1/raudhahpay-daily-statement',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
