-- 164: keep the ezAcc review list to things a person must act on.
--  * "Not a supplier" payees (rent, tax, utilities, personal payees): a payee marked once is
--    left out of every payment, past and future. ezAcc has no way to exclude them yet.
--  * A bill dated before the feed's start date (1 Jul 2026) that has no invoice in ezWF is
--    ignored automatically: ezWF never held it. (Matching is still tried first, so an old
--    invoice that does exist in ezWF is still linked.)
--  * Partial number + same amount is a suggestion even if the supplier name differs
--    (e.g. ezAcc "HS FIX GARAGE" INV-260817-74 vs ezWF "Muhammad Haziq" 260817-74).

CREATE TABLE IF NOT EXISTS ezacc_ignored_payees (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payee_key   text NOT NULL,
  payee_name  text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, payee_key)
);
ALTER TABLE ezacc_ignored_payees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ezacc_ignored_payees_select ON ezacc_ignored_payees;
CREATE POLICY ezacc_ignored_payees_select ON ezacc_ignored_payees FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman']));

-- the payee's ezAcc id, or its normalised name when ezAcc sent no id
CREATE OR REPLACE FUNCTION ezacc_payee_key(party jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(party->>'id', ''), 'name:' || ezacc_norm(party->>'name'))
$$;

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
  IF EXISTS (SELECT 1 FROM ezacc_ignored_payees ip WHERE ip.tenant_id = rec.tenant_id AND ip.payee_key = ezacc_payee_key(rec.party)) THEN
    UPDATE ezacc_allocations SET state = 'ignored', note = 'payee marked as not a supplier' WHERE ezacc_payment_id = p_id;
    UPDATE ezacc_payments SET state = 'ignored', note = 'payee marked as not a supplier' WHERE ezacc_id = p_id; RETURN;
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
      -- 2. partial number: same supplier, or the same amount. A suggestion.
      IF pick IS NULL AND length(nb) >= 3 THEN
        SELECT array_agg(si.id) INTO cands
          FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
         WHERE si.tenant_id = rec.tenant_id AND si.voided_at IS NULL AND length(ezacc_norm2(si.invoice_number)) >= 3
           AND (ezacc_norm2(si.invoice_number) LIKE '%' || nb OR nb LIKE '%' || ezacc_norm2(si.invoice_number))
           AND ( (s.ezacc_supplier_id IS NOT NULL AND s.ezacc_supplier_id = pid)
              OR (s.ezacc_supplier_id IS NULL AND ezacc_norm(s.name) <> '' AND ezacc_norm(al.supplier_name) <> '' AND ezacc_name_like(s.name, al.supplier_name))
              OR abs(si.total_amount - coalesce(al.bill_total, al.amount)) < 0.005 );
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
        IF al.bill_date IS NOT NULL AND al.bill_date < sd THEN
          UPDATE ezacc_allocations SET state = 'ignored',
                 note = 'bill dated before ' || to_char(sd, 'DD Mon YYYY') || ' and not in ezWF' WHERE ezacc_payment_id = p_id AND idx = al.idx;
        ELSE
          UPDATE ezacc_allocations SET state = 'unmatched',
                 note = CASE WHEN nb = '' THEN 'no invoice number on the payment' ELSE 'no invoice with this number for this supplier' END
           WHERE ezacc_payment_id = p_id AND idx = al.idx;
        END IF;
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

-- Mark / unmark the payee of one payment as "not a supplier"; re-applies all of that payee's payments.
CREATE OR REPLACE FUNCTION ezacc_set_payee_ignored(p_payment uuid, p_ignored boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec ezacc_payments; k text; n int := 0; r uuid;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO rec FROM ezacc_payments WHERE ezacc_id = p_payment;
  IF NOT FOUND OR rec.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  k := ezacc_payee_key(rec.party);
  IF k IS NULL OR k = 'name:' THEN RETURN jsonb_build_object('error', 'no_payee'); END IF;
  IF p_ignored THEN
    INSERT INTO ezacc_ignored_payees (tenant_id, payee_key, payee_name, created_by)
    VALUES (rec.tenant_id, k, rec.party->>'name', auth.uid())
    ON CONFLICT (tenant_id, payee_key) DO NOTHING;
  ELSE
    DELETE FROM ezacc_ignored_payees WHERE tenant_id = rec.tenant_id AND payee_key = k;
  END IF;
  FOR r IN SELECT ezacc_id FROM ezacc_payments WHERE tenant_id = rec.tenant_id AND ezacc_payee_key(party) = k LOOP
    PERFORM ezacc_process(r); n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'payments', n);
END $$;

-- Restore a payee from the "not a supplier" list (the list itself has no payment to point at).
CREATE OR REPLACE FUNCTION ezacc_restore_payee(p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_my_tenant(); n int := 0; r uuid;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  DELETE FROM ezacc_ignored_payees WHERE tenant_id = t AND payee_key = p_key;
  FOR r IN SELECT ezacc_id FROM ezacc_payments WHERE tenant_id = t AND ezacc_payee_key(party) = p_key LOOP
    PERFORM ezacc_process(r); n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'payments', n);
END $$;

REVOKE ALL ON FUNCTION ezacc_process(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ezacc_set_payee_ignored(uuid, boolean), ezacc_restore_payee(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ezacc_set_payee_ignored(uuid, boolean), ezacc_restore_payee(text) TO authenticated;
