-- 167: two-payment plans on workshop invoices (BB Staff Car Care Day benefit).
--
-- A BB staff member can pay a larger bill in two instalments: part when the car is returned,
-- the rest about a month later. The plan sits beside the invoice and does not change how
-- payments work: the invoice still takes ordinary partial payments (record_payment, the payment
-- gateway). The plan only says how much is due now, how much later, and when, so the screens,
-- the payment link and the finance list can show it. Money is never tracked twice:
-- instalment 1 is covered once amount_paid reaches first_amount, instalment 2 once the invoice is paid.

ALTER TABLE os_settings ADD COLUMN IF NOT EXISTS bb_instalment_min numeric(12,2) NOT NULL DEFAULT 500 CHECK (bb_instalment_min >= 0);

CREATE TABLE IF NOT EXISTS invoice_payment_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        uuid NOT NULL,
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind             text NOT NULL DEFAULT 'bb_staff',
  staff_id         text NOT NULL CHECK (staff_id ~ '^BB[0-9]{4}$'),
  first_amount     numeric(12,2) NOT NULL CHECK (first_amount > 0),
  second_amount    numeric(12,2) NOT NULL CHECK (second_amount > 0),
  first_due        date NOT NULL,
  second_due       date NOT NULL,
  original_due     date,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  below_minimum    boolean NOT NULL DEFAULT false,
  note             text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz
);
-- one live plan per invoice
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payment_plans_live ON invoice_payment_plans (invoice_id) WHERE status IN ('active', 'completed');
CREATE INDEX IF NOT EXISTS invoice_payment_plans_tenant_status ON invoice_payment_plans (tenant_id, status);

ALTER TABLE invoice_payment_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_payment_plans_select ON invoice_payment_plans;
CREATE POLICY invoice_payment_plans_select ON invoice_payment_plans FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman'])
  AND (branch_id = get_my_branch() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])));

-- what is payable now on an invoice with an active plan (NULL when there is no plan)
CREATE OR REPLACE FUNCTION invoice_plan_next(p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pl invoice_payment_plans; inv invoices; due numeric; n int;
BEGIN
  SELECT * INTO pl FROM invoice_payment_plans WHERE invoice_id = p_invoice AND status = 'active';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO inv FROM invoices WHERE id = p_invoice;
  IF inv.status = 'void' OR inv.total_amount - inv.amount_paid <= 0 THEN RETURN NULL; END IF;
  IF inv.amount_paid < pl.first_amount - 0.005 THEN n := 1; due := pl.first_amount - inv.amount_paid;
  ELSE n := 2; due := inv.total_amount - inv.amount_paid; END IF;
  RETURN jsonb_build_object('instalment', n, 'pay_now', round(due, 2), 'first_amount', pl.first_amount, 'second_amount', pl.second_amount,
                            'first_due', pl.first_due, 'second_due', pl.second_due, 'amount_paid', inv.amount_paid, 'total', inv.total_amount,
                            'overdue', (n = 2 AND pl.second_due < os_today()) OR (n = 1 AND pl.first_due < os_today()));
END $$;

-- keep the plan in step with the invoice
CREATE OR REPLACE FUNCTION invoice_plan_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'void' THEN
    UPDATE invoice_payment_plans SET status = 'cancelled', cancelled_at = now(), note = coalesce(note || ' | ', '') || 'invoice voided'
     WHERE invoice_id = NEW.id AND status = 'active';
  ELSIF NEW.amount_paid >= NEW.total_amount AND NEW.total_amount > 0 THEN
    UPDATE invoice_payment_plans SET status = 'completed' WHERE invoice_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_plan_sync ON invoices;
CREATE TRIGGER invoice_plan_sync AFTER UPDATE OF amount_paid, status ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_plan_sync();

-- create a plan
CREATE OR REPLACE FUNCTION create_payment_plan(p_invoice uuid, p_staff_id text, p_first_amount numeric DEFAULT NULL, p_second_due date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv invoices; st os_settings; sid text := upper(regexp_replace(coalesce(p_staff_id, ''), '\s', '', 'g'));
  first_amt numeric; second_due date := coalesce(p_second_due, (os_today() + interval '1 month')::date); below boolean := false; priv boolean;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO inv FROM invoices WHERE id = p_invoice;
  IF NOT FOUND OR inv.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'invoice_not_found'); END IF;
  priv := get_my_role() = ANY (ARRAY['super_admin','ops_manager']);
  IF NOT (priv OR get_my_role() = 'finance' OR inv.branch_id = get_my_branch()) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF inv.status NOT IN ('sent', 'overdue') THEN RETURN jsonb_build_object('error', 'invoice_not_open'); END IF;
  IF inv.amount_paid > 0 THEN RETURN jsonb_build_object('error', 'already_part_paid'); END IF;
  IF EXISTS (SELECT 1 FROM invoice_payment_plans WHERE invoice_id = inv.id AND status IN ('active', 'completed')) THEN RETURN jsonb_build_object('error', 'plan_exists'); END IF;
  IF sid !~ '^BB[0-9]{4}$' THEN RETURN jsonb_build_object('error', 'invalid_staff_id'); END IF;

  SELECT * INTO st FROM os_settings WHERE tenant_id = inv.tenant_id;
  IF inv.total_amount < coalesce(st.bb_instalment_min, 500) THEN
    IF NOT priv THEN RETURN jsonb_build_object('error', 'below_minimum', 'minimum', coalesce(st.bb_instalment_min, 500)); END IF;
    below := true;
  END IF;

  first_amt := round(coalesce(p_first_amount, inv.total_amount / 2.0), 2);
  IF first_amt <= 0 OR first_amt >= inv.total_amount THEN RETURN jsonb_build_object('error', 'invalid_amount'); END IF;
  IF second_due < os_today() + 7 OR second_due > os_today() + 62 THEN RETURN jsonb_build_object('error', 'invalid_due_date'); END IF;

  INSERT INTO invoice_payment_plans (tenant_id, branch_id, invoice_id, staff_id, first_amount, second_amount, first_due, second_due, original_due, below_minimum, created_by)
  VALUES (inv.tenant_id, inv.branch_id, inv.id, sid, first_amt, inv.total_amount - first_amt, os_today(), second_due, inv.due_date, below, auth.uid());
  UPDATE invoices SET due_date = second_due, updated_at = now() WHERE id = inv.id;
  PERFORM insert_audit_log('payment_plan', 'invoices', inv.id, 'invoice',
    jsonb_build_object('staff_id', sid, 'first', first_amt, 'second', inv.total_amount - first_amt, 'second_due', second_due, 'below_minimum', below),
    inv.branch_id, auth.uid(), inv.tenant_id);
  RETURN jsonb_build_object('ok', true, 'plan', invoice_plan_next(inv.id));
END $$;

-- cancel a plan (the invoice keeps whatever was paid)
CREATE OR REPLACE FUNCTION cancel_payment_plan(p_invoice uuid, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pl invoice_payment_plans;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO pl FROM invoice_payment_plans WHERE invoice_id = p_invoice AND status = 'active';
  IF NOT FOUND OR pl.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'no_plan'); END IF;
  UPDATE invoice_payment_plans SET status = 'cancelled', cancelled_at = now(), note = coalesce(nullif(trim(p_reason), ''), 'cancelled') WHERE id = pl.id;
  IF pl.original_due IS NOT NULL THEN UPDATE invoices SET due_date = pl.original_due, updated_at = now() WHERE id = p_invoice; END IF;
  PERFORM insert_audit_log('payment_plan_cancelled', 'invoices', p_invoice, 'invoice', jsonb_build_object('reason', p_reason), pl.branch_id, auth.uid(), pl.tenant_id);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION invoice_plan_next(uuid), invoice_plan_sync(), create_payment_plan(uuid, text, numeric, date), cancel_payment_plan(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION invoice_plan_next(uuid) TO anon, authenticated;   -- the customer portal asks what to pay now
GRANT EXECUTE ON FUNCTION create_payment_plan(uuid, text, numeric, date), cancel_payment_plan(uuid, text) TO authenticated;
