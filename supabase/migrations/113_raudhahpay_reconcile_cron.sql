-- 113: Schedule the missed-payment reconciliation job every 15 minutes via
-- pg_cron + pg_net, mirroring the existing raudhahpay-daily-statement cron
-- (088) — same vault-stored service_role_key, same net.http_post shape.
-- Backstops raudhahpay-webhook (see 111/112) for the case a webhook
-- delivery never arrives, or fails signature verification due to a
-- per-tenant secret mismatch (the believed cause of MVG-INV-2026-0075).

SELECT cron.schedule(
  'raudhahpay-reconcile-payments',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgowhzdwriklgdpfdwot.supabase.co/functions/v1/raudhahpay-reconcile-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
