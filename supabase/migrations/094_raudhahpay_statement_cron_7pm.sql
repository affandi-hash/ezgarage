-- 094: Move the RaudhahPay daily statement send time from midnight MYT
-- (00:00, cron 16:00 UTC) to 7pm MYT (19:00, cron 11:00 UTC), per request.
-- The function's own date logic (yesterdayInMYT()) is unaffected — it always
-- reports on the previous full calendar day regardless of what time it
-- runs, so this only changes what time of day the email arrives, not which
-- transactions it covers.

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'raudhahpay-daily-statement'),
  schedule => '0 11 * * *'
);
