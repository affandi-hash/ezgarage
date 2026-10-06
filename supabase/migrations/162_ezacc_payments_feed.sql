-- 162: supplier payments made in ezAcc (Account360) flow into ezWF.
--
-- ezAcc pushes its payments daily (webhook) and ezWF can pull them (REST API).
-- Both paths call ezacc_ingest(), which stores each payment once (keyed by its
-- ezAcc id), then applies its allocations to supplier invoices:
--   * matched by the supplier's invoice number (dashes, spaces and case ignored)
--   * a payment already keyed in by hand (same invoice, amount, within 7 days) is
--     linked, never added twice
--   * voided or deleted payments are undone
-- Anything that cannot be matched safely waits in a short list for a person.

ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS ezacc_payment_id uuid;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS ezacc_alloc_idx int;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_ezacc_unique ON supplier_payments (ezacc_payment_id, ezacc_alloc_idx) WHERE ezacc_payment_id IS NOT NULL;

-- one row per company feed: secrets live here, readable by the service role only
CREATE TABLE IF NOT EXISTS ezacc_feeds (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  company_name   text,
  company_id     text,
  signing_secret text NOT NULL,
  api_key        text,
  api_base       text NOT NULL DEFAULT 'https://qknjrafndturzpmmcwcp.supabase.co/functions/v1/api/v1',
  start_date     date NOT NULL DEFAULT '2026-07-01',
  enabled        boolean NOT NULL DEFAULT true,
  pull_cursor    text,
  last_push_at   timestamptz,
  last_pull_at   timestamptz,
  last_status    text
);
ALTER TABLE ezacc_feeds ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ezacc_payments (
  ezacc_id       uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type           text NOT NULL DEFAULT 'made',
  status         text NOT NULL DEFAULT 'posted',
  payment_date   date,
  amount         numeric(14,2),
  currency       text,
  method         text,
  reference      text,
  notes          text,
  bank_account   jsonb,
  party          jsonb,
  allocations    jsonb NOT NULL DEFAULT '[]',
  voided_at      timestamptz,
  void_reason    text,
  changed_at     timestamptz,
  state          text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processed','ignored')),
  note           text,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ezacc_payments_tenant_date ON ezacc_payments (tenant_id, payment_date DESC);

CREATE TABLE IF NOT EXISTS ezacc_allocations (
  ezacc_payment_id  uuid NOT NULL REFERENCES ezacc_payments(ezacc_id) ON DELETE CASCADE,
  idx               int  NOT NULL,
  tenant_id         uuid NOT NULL,
  bill_number       text,
  bill_date         date,
  bill_total        numeric(14,2),
  supplier_name     text,
  amount            numeric(14,2) NOT NULL,
  state             text NOT NULL DEFAULT 'unmatched' CHECK (state IN ('applied','linked','unmatched','ignored')),
  supplier_invoice_id uuid,
  note              text,
  forced_invoice_id uuid,          -- a person chose this invoice
  user_ignored      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (ezacc_payment_id, idx)
);
CREATE INDEX IF NOT EXISTS ezacc_allocations_open ON ezacc_allocations (tenant_id, state);

ALTER TABLE ezacc_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ezacc_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ezacc_payments_select ON ezacc_payments;
CREATE POLICY ezacc_payments_select ON ezacc_payments FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman']));
DROP POLICY IF EXISTS ezacc_allocations_select ON ezacc_allocations;
CREATE POLICY ezacc_allocations_select ON ezacc_allocations FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman']));

-- ── helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ezacc_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9]', '', 'g')) $$;

-- true when two supplier names plausibly refer to the same business (or one is blank)
CREATE OR REPLACE FUNCTION ezacc_name_like(a text, b text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN ezacc_norm(a) = '' OR ezacc_norm(b) = '' THEN true
              ELSE left(ezacc_norm(a), 4) = left(ezacc_norm(b), 4)
                OR position(ezacc_norm(a) IN ezacc_norm(b)) > 0 OR position(ezacc_norm(b) IN ezacc_norm(a)) > 0 END
$$;

CREATE OR REPLACE FUNCTION ezacc_inv_status(p_total numeric, p_paid numeric, p_due date) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_paid >= p_total THEN 'paid' WHEN p_paid > 0 THEN 'partial'
              WHEN p_due IS NOT NULL AND p_due < current_date THEN 'overdue' ELSE 'unpaid' END
$$;

-- Undo everything this payment did to supplier invoices.
CREATE OR REPLACE FUNCTION ezacc_reverse(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE al ezacc_allocations; inv supplier_invoices;
BEGIN
  FOR al IN SELECT * FROM ezacc_allocations WHERE ezacc_payment_id = p_id AND state IN ('applied','linked') LOOP
    IF al.state = 'applied' THEN
      DELETE FROM supplier_payments WHERE ezacc_payment_id = p_id AND ezacc_alloc_idx = al.idx AND source = 'ezacc';
      SELECT * INTO inv FROM supplier_invoices WHERE id = al.supplier_invoice_id FOR UPDATE;
      IF FOUND THEN
        UPDATE supplier_invoices SET amount_paid = greatest(0, amount_paid - al.amount),
               status = CASE WHEN voided_at IS NOT NULL THEN status
                             ELSE ezacc_inv_status(total_amount, greatest(0, amount_paid - al.amount), due_date) END,
               updated_at = now()
         WHERE id = inv.id;
      END IF;
    ELSE
      UPDATE supplier_payments SET ezacc_payment_id = NULL, ezacc_alloc_idx = NULL WHERE ezacc_payment_id = p_id AND ezacc_alloc_idx = al.idx;
    END IF;
    UPDATE ezacc_allocations SET state = 'unmatched', supplier_invoice_id = NULL, note = NULL WHERE ezacc_payment_id = p_id AND idx = al.idx;
  END LOOP;
END $$;

-- Apply one stored payment (idempotent: reverses first, then applies again).
CREATE OR REPLACE FUNCTION ezacc_process(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec ezacc_payments; al ezacc_allocations; sd date; cands uuid[]; pick uuid; inv supplier_invoices;
  manual_id uuid; method_txt text;
BEGIN
  SELECT * INTO rec FROM ezacc_payments WHERE ezacc_id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM ezacc_reverse(p_id);
  SELECT start_date INTO sd FROM ezacc_feeds WHERE tenant_id = rec.tenant_id;
  sd := coalesce(sd, date '2026-07-01');

  IF rec.type <> 'made' THEN
    UPDATE ezacc_payments SET state = 'ignored', note = 'customer receipt (not used)' WHERE ezacc_id = p_id; RETURN;
  END IF;
  IF rec.status <> 'posted' THEN
    UPDATE ezacc_allocations SET state = 'ignored', note = rec.status WHERE ezacc_payment_id = p_id;
    UPDATE ezacc_payments SET state = 'processed', note = rec.status WHERE ezacc_id = p_id; RETURN;
  END IF;
  IF rec.payment_date IS NULL OR rec.payment_date < sd THEN
    UPDATE ezacc_allocations SET state = 'ignored', note = 'before the start date' WHERE ezacc_payment_id = p_id;
    UPDATE ezacc_payments SET state = 'ignored', note = 'before the start date' WHERE ezacc_id = p_id; RETURN;
  END IF;

  -- ezWF only knows 'cash' and 'transfer'; cheques, cards and the rest are bank movements
  method_txt := CASE WHEN lower(coalesce(rec.method, '')) LIKE '%cash%' THEN 'cash' ELSE 'transfer' END;
  FOR al IN SELECT * FROM ezacc_allocations WHERE ezacc_payment_id = p_id ORDER BY idx LOOP
    IF al.user_ignored THEN
      UPDATE ezacc_allocations SET state = 'ignored', note = 'ignored by a person' WHERE ezacc_payment_id = p_id AND idx = al.idx;
      CONTINUE;
    END IF;

    pick := NULL; cands := NULL;
    IF al.forced_invoice_id IS NOT NULL THEN
      pick := al.forced_invoice_id;
    ELSIF ezacc_norm(al.bill_number) <> '' THEN
      SELECT array_agg(si.id) INTO cands
        FROM supplier_invoices si LEFT JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.tenant_id = rec.tenant_id AND si.voided_at IS NULL
         AND ezacc_norm(si.invoice_number) = ezacc_norm(al.bill_number)
         AND (ezacc_name_like(s.name, al.supplier_name) OR abs(si.total_amount - coalesce(al.bill_total, al.amount)) < 0.005);
      IF cands IS NULL THEN
        UPDATE ezacc_allocations SET state = 'unmatched', note = 'no invoice with this number for this supplier' WHERE ezacc_payment_id = p_id AND idx = al.idx;
        CONTINUE;
      ELSIF array_length(cands, 1) > 1 THEN
        UPDATE ezacc_allocations SET state = 'unmatched', note = 'several invoices have this number' WHERE ezacc_payment_id = p_id AND idx = al.idx;
        CONTINUE;
      END IF;
      pick := cands[1];
    ELSE
      UPDATE ezacc_allocations SET state = 'unmatched', note = 'no invoice number on the payment' WHERE ezacc_payment_id = p_id AND idx = al.idx;
      CONTINUE;
    END IF;

    SELECT * INTO inv FROM supplier_invoices WHERE id = pick AND tenant_id = rec.tenant_id FOR UPDATE;
    IF NOT FOUND OR inv.voided_at IS NOT NULL THEN
      UPDATE ezacc_allocations SET state = 'unmatched', note = 'the invoice is missing or voided' WHERE ezacc_payment_id = p_id AND idx = al.idx;
      CONTINUE;
    END IF;

    -- already keyed in by hand? link it instead of adding it again
    SELECT id INTO manual_id FROM supplier_payments
     WHERE supplier_invoice_id = inv.id AND ezacc_payment_id IS NULL AND abs(amount - al.amount) < 0.005
       AND abs(payment_date - rec.payment_date) <= 7 LIMIT 1;
    IF manual_id IS NOT NULL THEN
      UPDATE supplier_payments SET ezacc_payment_id = p_id, ezacc_alloc_idx = al.idx WHERE id = manual_id;
      UPDATE ezacc_allocations SET state = 'linked', supplier_invoice_id = inv.id, note = 'already recorded by hand' WHERE ezacc_payment_id = p_id AND idx = al.idx;
    ELSIF inv.amount_paid + al.amount > inv.total_amount + 0.005 THEN
      UPDATE ezacc_allocations SET state = 'unmatched', supplier_invoice_id = inv.id,
             note = 'RM ' || al.amount || ' is more than the RM ' || (inv.total_amount - inv.amount_paid) || ' still owing on the invoice' WHERE ezacc_payment_id = p_id AND idx = al.idx;
    ELSE
      INSERT INTO supplier_payments (tenant_id, supplier_invoice_id, payment_date, amount, payment_method, reference, notes, source, ezacc_payment_id, ezacc_alloc_idx)
      VALUES (rec.tenant_id, inv.id, rec.payment_date, al.amount, method_txt, rec.reference,
              'Paid via ezAcc' || coalesce(' (' || (rec.bank_account->>'name') || ')', ''), 'ezacc', p_id, al.idx);
      UPDATE supplier_invoices SET amount_paid = amount_paid + al.amount,
             status = ezacc_inv_status(total_amount, amount_paid + al.amount, due_date), updated_at = now() WHERE id = inv.id;
      UPDATE ezacc_allocations SET state = 'applied', supplier_invoice_id = inv.id, note = NULL WHERE ezacc_payment_id = p_id AND idx = al.idx;
    END IF;
  END LOOP;
  UPDATE ezacc_payments SET state = 'processed', note = NULL WHERE ezacc_id = p_id;
END $$;

-- Store a batch of payments from ezAcc (push or pull) and apply them.
CREATE OR REPLACE FUNCTION ezacc_ingest(p_tenant uuid, p_payments jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p jsonb; a jsonb; pid uuid; n int := 0; k int; ptype text;
BEGIN
  FOR p IN SELECT value FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
    pid := (p->>'id')::uuid;
    ptype := coalesce(p->>'type', 'made');
    PERFORM ezacc_reverse(pid);
    IF coalesce(p->>'status', 'posted') = 'deleted' THEN
      INSERT INTO ezacc_payments (ezacc_id, tenant_id, type, status, changed_at)
      VALUES (pid, p_tenant, ptype, 'deleted', nullif(p->>'changed_at', '')::timestamptz)
      ON CONFLICT (ezacc_id) DO UPDATE SET status = 'deleted', changed_at = EXCLUDED.changed_at, state = 'pending', last_seen_at = now()
        WHERE ezacc_payments.tenant_id = p_tenant;
    ELSE
      INSERT INTO ezacc_payments (ezacc_id, tenant_id, type, status, payment_date, amount, currency, method, reference, notes,
                                  bank_account, party, allocations, voided_at, void_reason, changed_at)
      VALUES (pid, p_tenant, ptype, coalesce(p->>'status', 'posted'), nullif(p->>'payment_date', '')::date, (p->>'amount')::numeric,
              p->>'currency', p->>'method', p->>'reference', p->>'notes', p->'bank_account', coalesce(p->'supplier', p->'customer'),
              coalesce(p->'allocations', '[]'::jsonb), nullif(p->>'voided_at', '')::timestamptz, p->>'void_reason', nullif(p->>'changed_at', '')::timestamptz)
      ON CONFLICT (ezacc_id) DO UPDATE SET type = EXCLUDED.type, status = EXCLUDED.status, payment_date = EXCLUDED.payment_date,
        amount = EXCLUDED.amount, currency = EXCLUDED.currency, method = EXCLUDED.method, reference = EXCLUDED.reference, notes = EXCLUDED.notes,
        bank_account = EXCLUDED.bank_account, party = EXCLUDED.party, allocations = EXCLUDED.allocations, voided_at = EXCLUDED.voided_at,
        void_reason = EXCLUDED.void_reason, changed_at = EXCLUDED.changed_at, state = 'pending', last_seen_at = now()
        WHERE ezacc_payments.tenant_id = p_tenant;
      IF ptype = 'made' THEN
        k := 0;
        FOR a IN SELECT value FROM jsonb_array_elements(coalesce(p->'allocations', '[]'::jsonb)) LOOP
          INSERT INTO ezacc_allocations (ezacc_payment_id, idx, tenant_id, bill_number, bill_date, bill_total, supplier_name, amount)
          VALUES (pid, k, p_tenant, a->>'bill_number', nullif(a->>'bill_date', '')::date, nullif(a->>'bill_total', '')::numeric,
                  p->'supplier'->>'name', coalesce((a->>'amount')::numeric, 0))
          ON CONFLICT (ezacc_payment_id, idx) DO UPDATE SET bill_number = EXCLUDED.bill_number, bill_date = EXCLUDED.bill_date,
            bill_total = EXCLUDED.bill_total, supplier_name = EXCLUDED.supplier_name, amount = EXCLUDED.amount;
          k := k + 1;
        END LOOP;
        DELETE FROM ezacc_allocations WHERE ezacc_payment_id = pid AND idx >= k;
      END IF;
    END IF;
    PERFORM ezacc_process(pid);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('processed', n);
END $$;

-- A person settles an allocation that could not be matched.
CREATE OR REPLACE FUNCTION ezacc_resolve(p_payment uuid, p_idx int, p_action text, p_invoice uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec ezacc_payments;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO rec FROM ezacc_payments WHERE ezacc_id = p_payment;
  IF NOT FOUND OR rec.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF p_action = 'ignore' THEN
    UPDATE ezacc_allocations SET user_ignored = true, forced_invoice_id = NULL WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'unignore' THEN
    UPDATE ezacc_allocations SET user_ignored = false WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'match' THEN
    IF NOT EXISTS (SELECT 1 FROM supplier_invoices WHERE id = p_invoice AND tenant_id = rec.tenant_id AND voided_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'invoice_not_found');
    END IF;
    UPDATE ezacc_allocations SET forced_invoice_id = p_invoice, user_ignored = false WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSE
    RETURN jsonb_build_object('error', 'bad_action');
  END IF;
  PERFORM ezacc_process(p_payment);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION ezacc_reverse(uuid), ezacc_process(uuid), ezacc_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ezacc_resolve(uuid, int, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ezacc_resolve(uuid, int, text, uuid) TO authenticated;

-- nightly safety-net pull at 03:15 Malaysia time (after ezAcc's own 02:00 push)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT cron.unschedule('ezacc-pull') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ezacc-pull');
SELECT cron.schedule('ezacc-pull', '15 19 * * *', $$
  SELECT net.http_post(
    url := 'https://lgowhzdwriklgdpfdwot.supabase.co/functions/v1/ezacc-pull',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'::jsonb);
$$);
