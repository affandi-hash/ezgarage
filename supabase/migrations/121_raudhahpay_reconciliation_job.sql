-- 121: Automates the exact manual reconciliation performed by hand on
-- 2026-08-03 and 2026-08-06 (root cause of those incidents: a stale
-- RAUDHAHPAY_WEBHOOK_SECRET, fixed the same day this migration was
-- written). This job is the ongoing safety net for whatever the *next*
-- cause of a webhook processing failure turns out to be -- signature
-- drift again, a transient DB error, anything -- as long as RaudhahPay's
-- webhook_debug_log insert (which happens before any verification, at the
-- very top of raudhahpay-webhook) still fires, this job will notice and
-- self-heal within its run interval, with no dependency on RaudhahPay's
-- own API (which, as of writing, we couldn't get "check bill status"
-- access to -- their Production API key returns 401 on their documented
-- REST endpoints despite Full Access being enabled; pending their
-- support's answer). This only requires what we already unconditionally
-- capture ourselves.
--
-- Deliberately scoped to payment.success only -- refunds have their own
-- event type and a distinct signed-amount/gateway_ref-prefix path in the
-- webhook that isn't worth replicating here for a monitoring job.

CREATE OR REPLACE FUNCTION public.reconcile_missed_raudhahpay_webhooks()
RETURNS TABLE(reconciled_invoice_number text, reconciled_bill_id text, reconciled_amount numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  v_invoice RECORD;
  v_new_paid numeric;
  v_method_map jsonb := '{"duitnow":"qr","credit_card":"card","fpx":"bank_transfer"}'::jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (w.raw_body::json->>'bill_id')
      (w.raw_body::json->>'bill_id') AS bill_id,
      (w.raw_body::json->>'order_no') AS invoice_id,
      (w.raw_body::json->>'amount')::numeric AS amount,
      (w.raw_body::json->>'payment_method') AS payment_method,
      (w.raw_body::json->>'reference_number') AS reference_number,
      (w.raw_body::json->>'paid_at')::date AS paid_date
    FROM webhook_debug_log w
    WHERE w.raw_body::json->>'event' = 'payment.success'
      AND w.raw_body::json->>'order_no' IS NOT NULL
    ORDER BY (w.raw_body::json->>'bill_id'), w.created_at ASC
  LOOP
    -- Skip anything already recorded (the normal, fast-path case -- this
    -- loop only ever does real work for genuine gaps).
    IF EXISTS (SELECT 1 FROM receipts WHERE gateway_ref = r.bill_id) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = r.invoice_id::uuid;
    IF NOT FOUND THEN CONTINUE; END IF;

    INSERT INTO receipts (id, tenant_id, branch_id, invoice_id, amount, payment_method, payment_date, reference_number, gateway_ref, notes)
    VALUES (
      gen_random_uuid(), v_invoice.tenant_id, v_invoice.branch_id, v_invoice.id, r.amount, r.payment_method,
      coalesce(r.paid_date, current_date), r.reference_number, r.bill_id,
      'RaudhahPay online payment (' || r.payment_method || ') -- auto-reconciled by reconcile_missed_raudhahpay_webhooks(); original webhook delivery did not update records'
    )
    ON CONFLICT (gateway_ref) WHERE gateway_ref IS NOT NULL DO NOTHING;

    -- The insert may have lost a race to a delivery that landed between our
    -- existence check and here -- re-check before touching the invoice so
    -- a near-simultaneous normal webhook doesn't get double-credited.
    IF NOT EXISTS (SELECT 1 FROM receipts WHERE gateway_ref = r.bill_id AND invoice_id = v_invoice.id AND amount = r.amount) THEN
      CONTINUE;
    END IF;

    v_new_paid := v_invoice.amount_paid + r.amount;
    UPDATE invoices SET
      amount_paid = v_new_paid,
      status = (CASE WHEN v_new_paid >= v_invoice.total_amount THEN 'paid' ELSE 'sent' END)::invoice_status,
      payment_method = coalesce((v_method_map->>r.payment_method), 'other')::payment_method,
      payment_date = coalesce(r.paid_date, current_date),
      payment_reference = r.bill_id
    WHERE id = v_invoice.id;

    reconciled_invoice_number := v_invoice.invoice_number;
    reconciled_bill_id := r.bill_id;
    reconciled_amount := r.amount;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Runs every 10 minutes. Postgres function call directly -- no pg_net/HTTP
-- hop needed, this is pure local-table logic.
SELECT cron.unschedule('reconcile-raudhahpay-webhooks') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'reconcile-raudhahpay-webhooks'
);
SELECT cron.schedule(
  'reconcile-raudhahpay-webhooks',
  '*/10 * * * *',
  $$SELECT reconcile_missed_raudhahpay_webhooks()$$
);
