-- 163: ezAcc feed, round two (after the first overnight batch and ezAcc's reply).
--
--  * Matching is looser, with a safety rule:
--      - a payment is attached to an invoice that was ALREADY paid by hand whenever
--        the invoice and amount agree, whatever the date (no money changes),
--      - a payment only CLOSES an unpaid invoice when the invoice number matches
--        exactly (case, dashes, spaces and leading zeros ignored),
--      - a partial number ("0351" = "JYC-260722-0351") or supplier + amount + date
--        is only a suggestion that a person confirms with one click.
--  * ezWF remembers each supplier's ezAcc id, so names like "YOU SENG PUCHONG
--    ENTERPRISE" and "YSP SDN BHD" no longer matter once one match is made.
--  * When a payment is attached to a hand-keyed payment, ezAcc's payment date wins
--    (the old date is kept and restored if the link is undone).
--  * A voided or deleted ezAcc payment that sits on a hand-keyed payment is NOT
--    undone silently: it goes to the review list ("void_review").

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ezacc_supplier_id text;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS ezacc_prev_date date;
ALTER TABLE ezacc_allocations ADD COLUMN IF NOT EXISTS suggested_invoice_id uuid;
ALTER TABLE ezacc_allocations ADD COLUMN IF NOT EXISTS manual_payment_id uuid;
ALTER TABLE ezacc_allocations DROP CONSTRAINT IF EXISTS ezacc_allocations_state_check;
ALTER TABLE ezacc_allocations ADD CONSTRAINT ezacc_allocations_state_check
  CHECK (state IN ('applied','linked','unmatched','ignored','void_review'));

-- lower-case, no punctuation, leading zeros of each number dropped: "CS-2607-0011" = "CS-2607-00011"
CREATE OR REPLACE FUNCTION ezacc_norm2(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(lower(coalesce(t, '')), '(^|[^0-9])0+([0-9])', '\1\2', 'g'), '[^a-z0-9]', '', 'g')
$$;

-- ── undo what a payment did ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS ezacc_reverse(uuid);
CREATE OR REPLACE FUNCTION ezacc_reverse(p_id uuid, p_review boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE al ezacc_allocations; inv supplier_invoices; sp supplier_payments;
BEGIN
  FOR al IN SELECT * FROM ezacc_allocations WHERE ezacc_payment_id = p_id AND state IN ('applied','linked','void_review') LOOP
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
    ELSIF al.state = 'linked' THEN
      SELECT * INTO sp FROM supplier_payments WHERE ezacc_payment_id = p_id AND ezacc_alloc_idx = al.idx;
      IF FOUND THEN
        UPDATE supplier_payments SET payment_date = coalesce(ezacc_prev_date, payment_date), ezacc_prev_date = NULL,
               ezacc_payment_id = NULL, ezacc_alloc_idx = NULL WHERE id = sp.id;
        IF p_review THEN
          UPDATE ezacc_allocations SET state = 'void_review', manual_payment_id = sp.id, suggested_invoice_id = NULL,
                 note = 'cancelled in ezAcc, but RM ' || sp.amount || ' is still recorded in ezWF (keyed by hand)'
           WHERE ezacc_payment_id = p_id AND idx = al.idx;
          CONTINUE;
        END IF;
      END IF;
    ELSIF p_review THEN
      CONTINUE; -- already waiting in the review list
    END IF;
    UPDATE ezacc_allocations SET state = 'unmatched', supplier_invoice_id = NULL, suggested_invoice_id = NULL,
           manual_payment_id = NULL, note = NULL WHERE ezacc_payment_id = p_id AND idx = al.idx;
  END LOOP;
  UPDATE ezacc_allocations SET suggested_invoice_id = NULL WHERE ezacc_payment_id = p_id AND state = 'unmatched';
END $$;

-- ── apply one stored payment (idempotent) ───────────────────────────────
CREATE OR REPLACE FUNCTION ezacc_process(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec ezacc_payments; al ezacc_allocations; sd date; inv supplier_invoices; sp supplier_payments;
  pid text; pname text; method_txt text; cands uuid[]; pick uuid; conf text; why text; learn boolean;
  nb text;
BEGIN
  SELECT * INTO rec FROM ezacc_payments WHERE ezacc_id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM ezacc_reverse(p_id, rec.status <> 'posted');
  SELECT start_date INTO sd FROM ezacc_feeds WHERE tenant_id = rec.tenant_id;
  sd := coalesce(sd, date '2026-07-01');

  IF rec.type <> 'made' THEN
    UPDATE ezacc_payments SET state = 'ignored', note = 'customer receipt (not used)' WHERE ezacc_id = p_id; RETURN;
  END IF;
  IF rec.status <> 'posted' THEN
    UPDATE ezacc_allocations SET state = 'ignored', note = rec.status WHERE ezacc_payment_id = p_id AND state <> 'void_review';
    UPDATE ezacc_payments SET state = 'processed', note = rec.status WHERE ezacc_id = p_id; RETURN;
  END IF;
  IF rec.payment_date IS NULL OR rec.payment_date < sd THEN
    UPDATE ezacc_allocations SET state = 'ignored', note = 'before the start date' WHERE ezacc_payment_id = p_id;
    UPDATE ezacc_payments SET state = 'ignored', note = 'before the start date' WHERE ezacc_id = p_id; RETURN;
  END IF;

  pid := nullif(rec.party->>'id', '');
  pname := rec.party->>'name';
  -- ezWF only knows 'cash' and 'transfer'; cheques, cards and the rest are bank movements
  method_txt := CASE WHEN lower(coalesce(rec.method, '')) LIKE '%cash%' THEN 'cash' ELSE 'transfer' END;

  FOR al IN SELECT * FROM ezacc_allocations WHERE ezacc_payment_id = p_id ORDER BY idx LOOP
    IF al.user_ignored THEN
      UPDATE ezacc_allocations SET state = 'ignored', note = 'ignored by a person' WHERE ezacc_payment_id = p_id AND idx = al.idx;
      CONTINUE;
    END IF;

    pick := NULL; conf := NULL; why := NULL; nb := ezacc_norm2(al.bill_number);
    IF al.forced_invoice_id IS NOT NULL THEN
      pick := al.forced_invoice_id; conf := 'forced';
    ELSE
      -- 1. exact number (supplier by ezAcc id or name, or the amounts agree)
      IF nb <> '' THEN
        SELECT array_agg(si.id) INTO cands
          FROM supplier_invoices si LEFT JOIN suppliers s ON s.id = si.supplier_id
         WHERE si.tenant_id = rec.tenant_id AND si.voided_at IS NULL AND ezacc_norm2(si.invoice_number) = nb
           AND ( (s.ezacc_supplier_id IS NOT NULL AND s.ezacc_supplier_id = pid)
              OR (s.ezacc_supplier_id IS NULL AND ezacc_name_like(s.name, al.supplier_name))
              OR abs(si.total_amount - coalesce(al.bill_total, al.amount)) < 0.005 );
        IF cands IS NOT NULL THEN
          IF array_length(cands, 1) > 1 THEN
            UPDATE ezacc_allocations SET state = 'unmatched', note = 'several invoices have this number' WHERE ezacc_payment_id = p_id AND idx = al.idx;
            CONTINUE;
          END IF;
          pick := cands[1]; conf := 'exact';
        END IF;
      END IF;
      -- 2. partial number, same supplier: a suggestion
      IF pick IS NULL AND length(nb) >= 3 THEN
        SELECT array_agg(si.id) INTO cands
          FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
         WHERE si.tenant_id = rec.tenant_id AND si.voided_at IS NULL AND length(ezacc_norm2(si.invoice_number)) >= 3
           AND (ezacc_norm2(si.invoice_number) LIKE '%' || nb OR nb LIKE '%' || ezacc_norm2(si.invoice_number))
           AND ( (s.ezacc_supplier_id IS NOT NULL AND s.ezacc_supplier_id = pid)
              OR (s.ezacc_supplier_id IS NULL AND ezacc_norm(s.name) <> '' AND ezacc_norm(al.supplier_name) <> '' AND ezacc_name_like(s.name, al.supplier_name)) );
        IF cands IS NOT NULL AND array_length(cands, 1) = 1 THEN
          pick := cands[1]; conf := 'partial'; why := 'the invoice number ends the same way';
        END IF;
      END IF;
      -- 3. same supplier, same amount, bill date within 10 days of the invoice date: a suggestion
      IF pick IS NULL THEN
        SELECT array_agg(si.id) INTO cands
          FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
         WHERE si.tenant_id = rec.tenant_id AND si.voided_at IS NULL
           AND abs(si.total_amount - coalesce(al.bill_total, al.amount)) < 0.005
           AND (al.bill_date IS NULL OR si.invoice_date IS NULL OR abs(si.invoice_date - al.bill_date) <= 10)
           AND ( (s.ezacc_supplier_id IS NOT NULL AND s.ezacc_supplier_id = pid)
              OR (s.ezacc_supplier_id IS NULL AND ezacc_norm(s.name) <> '' AND ezacc_norm(al.supplier_name) <> '' AND ezacc_name_like(s.name, al.supplier_name)) );
        IF cands IS NOT NULL AND array_length(cands, 1) = 1 THEN
          pick := cands[1]; conf := 'amount_date'; why := 'same supplier, amount and date';
        END IF;
      END IF;
      IF pick IS NULL THEN
        UPDATE ezacc_allocations SET state = 'unmatched',
               note = CASE WHEN nb = '' THEN 'no invoice number on the payment' ELSE 'no invoice with this number for this supplier' END
         WHERE ezacc_payment_id = p_id AND idx = al.idx;
        CONTINUE;
      END IF;
    END IF;

    SELECT * INTO inv FROM supplier_invoices WHERE id = pick AND tenant_id = rec.tenant_id FOR UPDATE;
    IF NOT FOUND OR inv.voided_at IS NOT NULL THEN
      UPDATE ezacc_allocations SET state = 'unmatched', note = 'the invoice is missing or voided' WHERE ezacc_payment_id = p_id AND idx = al.idx;
      CONTINUE;
    END IF;
    learn := conf IN ('exact', 'forced');

    -- already keyed by hand (any date)? attach to it; no money changes. ezAcc's date wins.
    SELECT * INTO sp FROM supplier_payments
     WHERE supplier_invoice_id = inv.id AND ezacc_payment_id IS NULL AND abs(amount - al.amount) < 0.005
     ORDER BY abs(payment_date - rec.payment_date), created_at LIMIT 1;
    IF FOUND THEN
      IF sp.payment_date <> rec.payment_date THEN
        UPDATE supplier_payments SET ezacc_payment_id = p_id, ezacc_alloc_idx = al.idx, ezacc_prev_date = sp.payment_date,
               payment_date = rec.payment_date WHERE id = sp.id;
      ELSE
        UPDATE supplier_payments SET ezacc_payment_id = p_id, ezacc_alloc_idx = al.idx WHERE id = sp.id;
      END IF;
      UPDATE ezacc_allocations SET state = 'linked', supplier_invoice_id = inv.id,
             note = 'already recorded by hand' || CASE WHEN sp.payment_date <> rec.payment_date
                    THEN ' (date changed from ' || to_char(sp.payment_date, 'DD Mon YYYY') || ' to ' || to_char(rec.payment_date, 'DD Mon YYYY') || ' to follow ezAcc)' ELSE '' END
       WHERE ezacc_payment_id = p_id AND idx = al.idx;
      learn := true;
    ELSIF conf IN ('partial', 'amount_date') THEN
      UPDATE ezacc_allocations SET state = 'unmatched', suggested_invoice_id = inv.id,
             note = 'possible match: ' || inv.invoice_number || ' (' || why || ')' WHERE ezacc_payment_id = p_id AND idx = al.idx;
      CONTINUE;
    ELSIF inv.amount_paid + al.amount > inv.total_amount + 0.005 THEN
      UPDATE ezacc_allocations SET state = 'unmatched', supplier_invoice_id = inv.id,
             note = 'RM ' || al.amount || ' is more than the RM ' || (inv.total_amount - inv.amount_paid) || ' still owing on the invoice' WHERE ezacc_payment_id = p_id AND idx = al.idx;
      CONTINUE;
    ELSE
      INSERT INTO supplier_payments (tenant_id, supplier_invoice_id, payment_date, amount, payment_method, reference, notes, source, ezacc_payment_id, ezacc_alloc_idx)
      VALUES (rec.tenant_id, inv.id, rec.payment_date, al.amount, method_txt, rec.reference,
              'Paid via ezAcc' || coalesce(' (' || (rec.bank_account->>'name') || ')', ''), 'ezacc', p_id, al.idx);
      UPDATE supplier_invoices SET amount_paid = amount_paid + al.amount,
             status = ezacc_inv_status(total_amount, amount_paid + al.amount, due_date), updated_at = now() WHERE id = inv.id;
      UPDATE ezacc_allocations SET state = 'applied', supplier_invoice_id = inv.id, note = NULL WHERE ezacc_payment_id = p_id AND idx = al.idx;
    END IF;

    -- remember which ezWF supplier is this ezAcc supplier
    IF learn AND pid IS NOT NULL THEN
      UPDATE suppliers SET ezacc_supplier_id = pid WHERE id = inv.supplier_id AND ezacc_supplier_id IS NULL;
    END IF;
  END LOOP;
  UPDATE ezacc_payments SET state = 'processed', note = NULL WHERE ezacc_id = p_id;
END $$;

-- ezacc_ingest: a voided/deleted payment on a hand-keyed payment goes to review
CREATE OR REPLACE FUNCTION ezacc_ingest(p_tenant uuid, p_payments jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p jsonb; a jsonb; pid uuid; n int := 0; k int; ptype text; pstatus text;
BEGIN
  FOR p IN SELECT value FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
    pid := (p->>'id')::uuid;
    ptype := coalesce(p->>'type', 'made');
    pstatus := coalesce(p->>'status', 'posted');
    PERFORM ezacc_reverse(pid, pstatus <> 'posted');
    IF pstatus = 'deleted' THEN
      INSERT INTO ezacc_payments (ezacc_id, tenant_id, type, status, changed_at)
      VALUES (pid, p_tenant, ptype, 'deleted', nullif(p->>'changed_at', '')::timestamptz)
      ON CONFLICT (ezacc_id) DO UPDATE SET status = 'deleted', changed_at = EXCLUDED.changed_at, state = 'pending', last_seen_at = now()
        WHERE ezacc_payments.tenant_id = p_tenant;
    ELSE
      INSERT INTO ezacc_payments (ezacc_id, tenant_id, type, status, payment_date, amount, currency, method, reference, notes,
                                  bank_account, party, allocations, voided_at, void_reason, changed_at)
      VALUES (pid, p_tenant, ptype, pstatus, nullif(p->>'payment_date', '')::date, (p->>'amount')::numeric,
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

-- A person settles an allocation that could not be matched or that needs review.
--   match         attach to the chosen invoice
--   ignore / unignore
--   keep          (void_review) leave the hand-keyed payment in ezWF as it is
--   remove_manual (void_review) delete the hand-keyed payment (ops_manager / super_admin only)
CREATE OR REPLACE FUNCTION ezacc_resolve(p_payment uuid, p_idx int, p_action text, p_invoice uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec ezacc_payments; al ezacc_allocations; sp supplier_payments; inv supplier_invoices;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO rec FROM ezacc_payments WHERE ezacc_id = p_payment;
  IF NOT FOUND OR rec.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT * INTO al FROM ezacc_allocations WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF p_action = 'ignore' THEN
    UPDATE ezacc_allocations SET user_ignored = true, forced_invoice_id = NULL WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'unignore' THEN
    UPDATE ezacc_allocations SET user_ignored = false WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'match' THEN
    IF NOT EXISTS (SELECT 1 FROM supplier_invoices WHERE id = p_invoice AND tenant_id = rec.tenant_id AND voided_at IS NULL) THEN
      RETURN jsonb_build_object('error', 'invoice_not_found');
    END IF;
    UPDATE ezacc_allocations SET forced_invoice_id = p_invoice, user_ignored = false WHERE ezacc_payment_id = p_payment AND idx = p_idx;
  ELSIF p_action = 'keep' THEN
    IF al.state <> 'void_review' THEN RETURN jsonb_build_object('error', 'not_in_review'); END IF;
    UPDATE ezacc_allocations SET state = 'ignored', note = 'kept in ezWF after the ezAcc payment was cancelled' WHERE ezacc_payment_id = p_payment AND idx = p_idx;
    RETURN jsonb_build_object('ok', true);
  ELSIF p_action = 'remove_manual' THEN
    IF NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
    IF al.state <> 'void_review' OR al.manual_payment_id IS NULL THEN RETURN jsonb_build_object('error', 'not_in_review'); END IF;
    SELECT * INTO sp FROM supplier_payments WHERE id = al.manual_payment_id AND tenant_id = rec.tenant_id AND ezacc_payment_id IS NULL;
    IF FOUND THEN
      SELECT * INTO inv FROM supplier_invoices WHERE id = sp.supplier_invoice_id FOR UPDATE;
      DELETE FROM supplier_payments WHERE id = sp.id;
      UPDATE supplier_invoices SET amount_paid = greatest(0, amount_paid - sp.amount),
             status = CASE WHEN voided_at IS NOT NULL THEN status ELSE ezacc_inv_status(total_amount, greatest(0, amount_paid - sp.amount), due_date) END,
             updated_at = now() WHERE id = inv.id;
    END IF;
    UPDATE ezacc_allocations SET state = 'ignored', note = 'hand-keyed payment removed after the ezAcc payment was cancelled' WHERE ezacc_payment_id = p_payment AND idx = p_idx;
    RETURN jsonb_build_object('ok', true);
  ELSE
    RETURN jsonb_build_object('error', 'bad_action');
  END IF;
  PERFORM ezacc_process(p_payment);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION ezacc_reverse(uuid, boolean), ezacc_process(uuid), ezacc_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ezacc_resolve(uuid, int, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ezacc_resolve(uuid, int, text, uuid) TO authenticated;
