-- 114: webhook_debug_log retention.
--
-- This table has captured every raw RaudhahPay webhook delivery
-- indefinitely since 070, with no cleanup. Now that 111 records the
-- secret-resolution outcome directly on each row, the raw headers/body are
-- mainly valuable for active, recent debugging -- not worth keeping
-- forever, but still worth keeping short-term (the raw payload is what
-- originally surfaced the flat-vs-nested shape mismatch against
-- RaudhahPay's own docs). A daily sweep keeps 30 days of it rather than
-- growing forever or dropping the table outright.

SELECT cron.schedule(
  'webhook_debug_log_retention',
  '30 2 * * *',
  $$
  DELETE FROM webhook_debug_log WHERE created_at < now() - interval '30 days';
  $$
);
