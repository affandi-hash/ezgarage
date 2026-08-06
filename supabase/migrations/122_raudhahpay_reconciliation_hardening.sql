-- 122: Two changes, both closing the "customer sees Payment Pending
-- longer than necessary" gap raised right after 121 shipped.
--
-- 1. reconcile_missed_raudhahpay_webhooks() now requires
--    signature_valid = true (119/121 didn't check this at all -- webhook_
--    debug_log logs every incoming POST *before* verification, for
--    diagnostic visibility, which means it also logs genuinely forged
--    requests. Trusting any row regardless of verification outcome would
--    let anyone mark any invoice paid for free by POSTing straight to the
--    public webhook URL with a fabricated payload. raudhahpay-webhook now
--    records signature_valid on every delivery, verified/forged; tested
--    both an unsigned forged POST (recorded false, correctly ignored by
--    this function) and a real signed delivery (recorded true) before
--    this shipped.
-- 2. reconcile_invoice_now(p_invoice_id) -- same logic, single-invoice
--    scope, callable by anon so the customer-facing page can trigger an
--    immediate check instead of waiting for the next cron tick. Cron
--    interval also tightened 10min -> 1min as a backstop for anyone who
--    closes the tab before the on-demand check gets a chance to run.

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
      AND w.signature_valid = true
    ORDER BY (w.raw_body::json->>'bill_id'), w.created_at ASC
  LOOP
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

-- ── reconcile_invoice_now ────────────────────────────────────────────────
-- Single-invoice scope of the same logic, safe for anon to call directly:
-- it can only ever act on a genuinely signature-verified RaudhahPay
-- delivery for the exact invoice asked about, so there's nothing to abuse
-- by guessing invoice ids. Returns the invoice's current status either way
-- (whether or not anything needed fixing) so the caller can just re-render.
CREATE OR REPLACE FUNCTION public.reconcile_invoice_now(p_invoice_id uuid)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  v_invoice RECORD;
  v_new_paid numeric;
  v_did_reconcile boolean := false;
  v_method_map jsonb := '{"duitnow":"qr","credit_card":"card","fpx":"bank_transfer"}'::jsonb;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'invoice_not_found'); END IF;

  SELECT
    (w.raw_body::json->>'bill_id') AS bill_id,
    (w.raw_body::json->>'amount')::numeric AS amount,
    (w.raw_body::json->>'payment_method') AS payment_method,
    (w.raw_body::json->>'reference_number') AS reference_number,
    (w.raw_body::json->>'paid_at')::date AS paid_date
    INTO r
    FROM webhook_debug_log w
   WHERE w.raw_body::json->>'event' = 'payment.success'
     AND w.raw_body::json->>'order_no' = p_invoice_id::text
     AND w.signature_valid = true
     AND NOT EXISTS (SELECT 1 FROM receipts WHERE gateway_ref = (w.raw_body::json->>'bill_id'))
   ORDER BY w.created_at ASC
   LIMIT 1;

  IF FOUND THEN
    INSERT INTO receipts (id, tenant_id, branch_id, invoice_id, amount, payment_method, payment_date, reference_number, gateway_ref, notes)
    VALUES (
      gen_random_uuid(), v_invoice.tenant_id, v_invoice.branch_id, v_invoice.id, r.amount, r.payment_method,
      coalesce(r.paid_date, current_date), r.reference_number, r.bill_id,
      'RaudhahPay online payment (' || r.payment_method || ') -- auto-reconciled by reconcile_invoice_now(); original webhook delivery did not update records'
    )
    ON CONFLICT (gateway_ref) WHERE gateway_ref IS NOT NULL DO NOTHING;

    IF EXISTS (SELECT 1 FROM receipts WHERE gateway_ref = r.bill_id AND invoice_id = v_invoice.id AND amount = r.amount) THEN
      v_new_paid := v_invoice.amount_paid + r.amount;
      UPDATE invoices SET
        amount_paid = v_new_paid,
        status = (CASE WHEN v_new_paid >= v_invoice.total_amount THEN 'paid' ELSE 'sent' END)::invoice_status,
        payment_method = coalesce((v_method_map->>r.payment_method), 'other')::payment_method,
        payment_date = coalesce(r.paid_date, current_date),
        payment_reference = r.bill_id
      WHERE id = v_invoice.id;
      v_did_reconcile := true;
    END IF;
  END IF;

  SELECT status, amount_paid, total_amount INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  RETURN json_build_object('success', true, 'status', v_invoice.status, 'amount_paid', v_invoice.amount_paid, 'total_amount', v_invoice.total_amount, 'reconciled', v_did_reconcile);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_invoice_now(uuid) TO anon, authenticated;

-- Tighten the backstop from 10 minutes to 1 minute -- cheap insurance for
-- anyone who closes the tab before the on-demand check above ever runs.
SELECT cron.unschedule('reconcile-raudhahpay-webhooks') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'reconcile-raudhahpay-webhooks'
);
SELECT cron.schedule(
  'reconcile-raudhahpay-webhooks',
  '* * * * *',
  $$SELECT reconcile_missed_raudhahpay_webhooks()$$
);
