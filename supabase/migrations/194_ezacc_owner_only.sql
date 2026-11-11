-- 194: the ezAcc bank feed (who was paid, how much, bank references) is private.
-- "Owner" = the super admin login and the Branch Admin login. The owner can read it and act on it (match, ignore, restore, sync).
-- Finance can read it (to compare). Everyone else, including ops managers and foremen, can no longer read it, and only the owner can act.
CREATE OR REPLACE FUNCTION is_owner_login() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT u.is_active AND (u.role = 'super_admin' OR u.is_branch_admin) FROM users u WHERE u.id = auth.uid()), false)
$$;
GRANT EXECUTE ON FUNCTION is_owner_login() TO authenticated;
CREATE OR REPLACE FUNCTION can_read_ezacc() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT u.is_active AND (u.role IN ('super_admin', 'finance') OR u.is_branch_admin) FROM users u WHERE u.id = auth.uid()), false)
$$;
GRANT EXECUTE ON FUNCTION can_read_ezacc() TO authenticated;

DROP POLICY IF EXISTS ezacc_payments_select ON ezacc_payments;
CREATE POLICY ezacc_payments_select ON ezacc_payments FOR SELECT TO authenticated USING (can_read_ezacc() AND tenant_id = get_my_tenant());
DROP POLICY IF EXISTS ezacc_allocations_select ON ezacc_allocations;
CREATE POLICY ezacc_allocations_select ON ezacc_allocations FOR SELECT TO authenticated USING (can_read_ezacc() AND tenant_id = get_my_tenant());
DROP POLICY IF EXISTS ezacc_ignored_payees_select ON ezacc_ignored_payees;
CREATE POLICY ezacc_ignored_payees_select ON ezacc_ignored_payees FOR SELECT TO authenticated USING (can_read_ezacc() AND tenant_id = get_my_tenant());

CREATE OR REPLACE FUNCTION public.ezacc_resolve(p_payment uuid, p_idx integer, p_action text, p_invoice uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rec ezacc_payments; al ezacc_allocations; sp supplier_payments; inv supplier_invoices;
BEGIN
  IF NOT is_active_user() OR NOT is_owner_login() THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.ezacc_restore_payee(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t uuid := get_my_tenant(); n int := 0; r uuid;
BEGIN
  IF NOT is_active_user() OR NOT is_owner_login() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  DELETE FROM ezacc_ignored_payees WHERE tenant_id = t AND payee_key = p_key;
  FOR r IN SELECT ezacc_id FROM ezacc_payments WHERE tenant_id = t AND ezacc_payee_key(party) = p_key LOOP
    PERFORM ezacc_process(r); n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'payments', n);
END $function$;

CREATE OR REPLACE FUNCTION public.ezacc_set_payee_ignored(p_payment uuid, p_ignored boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rec ezacc_payments; k text; n int := 0; r uuid;
BEGIN
  IF NOT is_active_user() OR NOT is_owner_login() THEN
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
END $function$;
