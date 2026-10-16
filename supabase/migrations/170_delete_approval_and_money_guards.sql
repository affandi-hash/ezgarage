-- 170: deleting records needs super admin approval, and money records cannot be deleted at all.
--
-- Why: a member of staff could register a car, issue an invoice, take the payment into a personal
-- account and delete the record. Before this migration
--   * ops managers could delete invoices and jobs outright,
--   * any signed-in staff member (even a mechanic) could create and delete suppliers, quotations,
--     supplier invoices and payments, receipts and price lists through the API,
--   * nothing recorded a deletion.
--
-- After it
--   * invoices, receipts, supplier invoices and supplier payments can never be deleted from the app
--     (void them instead);
--   * the other important records (jobs, bookings, customers, vehicles, quotations, expenses,
--     suppliers, staff and so on) are deleted only through a request that a super admin approves;
--   * settings and marketing items can still be deleted directly but every deletion is logged;
--   * every deletion keeps a full copy of the record in deleted_records, which nobody can edit;
--   * the tables that had a "same company" rule only are limited to the roles that use them.
-- The database itself and the service role (functions, cron, SQL) are not blocked, but are logged.

-- ── the log and the request queue ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS deleted_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  branch_id     uuid,
  table_name    text NOT NULL,
  record_id     text,
  record_label  text,
  snapshot      jsonb NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('approved', 'super_admin', 'direct', 'system')),
  request_id    uuid,
  reason        text,
  deleted_by    uuid,
  approved_by   uuid,
  deleted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deleted_records_tenant_time ON deleted_records (tenant_id, deleted_at DESC);
ALTER TABLE deleted_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deleted_records_select ON deleted_records;
CREATE POLICY deleted_records_select ON deleted_records FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

CREATE OR REPLACE FUNCTION deleted_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN RAISE EXCEPTION 'The deletion log cannot be changed' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS deleted_records_immutable ON deleted_records;
CREATE TRIGGER deleted_records_immutable BEFORE UPDATE OR DELETE ON deleted_records FOR EACH ROW EXECUTE FUNCTION deleted_records_immutable();

CREATE TABLE IF NOT EXISTS deletion_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id     uuid,
  table_name    text NOT NULL,
  record_id     uuid NOT NULL,
  record_label  text,
  snapshot      jsonb NOT NULL,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS deletion_requests_one_pending ON deletion_requests (table_name, record_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS deletion_requests_tenant_status ON deletion_requests (tenant_id, status, requested_at DESC);
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deletion_requests_select ON deletion_requests;
CREATE POLICY deletion_requests_select ON deletion_requests FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND (requested_by = auth.uid() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager'])));

-- a readable name for a record in lists and logs
CREATE OR REPLACE FUNCTION deletion_label(p_table text, r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(coalesce(r->>'invoice_number', r->>'job_number', r->>'booking_number', r->>'quote_number', r->>'full_name', r->>'name',
                       r->>'plate_number', r->>'title', r->>'description', r->>'reason', r->>'category', r->>'id'), 120)
$$;

-- only a trigger may write the log (so the app cannot forge entries)
CREATE OR REPLACE FUNCTION log_deletion(p_table text, p_old jsonb, p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() < 1 THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO deleted_records (tenant_id, branch_id, table_name, record_id, record_label, snapshot, kind, request_id, reason, deleted_by, approved_by)
  VALUES (nullif(p_old->>'tenant_id', '')::uuid, nullif(p_old->>'branch_id', '')::uuid, p_table, p_old->>'id', deletion_label(p_table, p_old), p_old, p_kind,
          nullif(current_setting('app.delete_request', true), '')::uuid, nullif(current_setting('app.delete_reason', true), ''),
          auth.uid(), CASE WHEN p_kind IN ('approved', 'super_admin') THEN auth.uid() END);
END $$;
REVOKE ALL ON FUNCTION log_deletion(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION log_deletion(text, jsonb, text) TO authenticated;

-- ── the guard on every table that can be deleted from ───────────────────
-- tier 'never': app users cannot delete (void instead); 'approval': needs a super admin's approval;
-- 'logged': allowed, and recorded.
CREATE OR REPLACE FUNCTION guard_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tier text := TG_ARGV[0]; snap jsonb := to_jsonb(OLD);
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    -- functions, cron and the service role: allowed, always recorded ('approved' when a super admin released it)
    PERFORM log_deletion(TG_TABLE_NAME, snap, CASE WHEN nullif(current_setting('app.delete_request', true), '') IS NOT NULL THEN 'approved' ELSE 'system' END);
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'jobs' AND EXISTS (SELECT 1 FROM invoices WHERE job_id = OLD.id AND status <> 'void') THEN
    RAISE EXCEPTION 'This job has an invoice. Void the invoice first.' USING ERRCODE = '42501';
  END IF;
  IF tier = 'never' THEN
    RAISE EXCEPTION 'This record cannot be deleted. Void it instead.' USING ERRCODE = '42501';
  END IF;
  IF get_my_role() = 'super_admin' THEN
    PERFORM log_deletion(TG_TABLE_NAME, snap, 'super_admin'); RETURN OLD;
  END IF;
  IF tier = 'logged' THEN
    PERFORM log_deletion(TG_TABLE_NAME, snap, 'direct'); RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Deleting this needs super admin approval. Use Request deletion.' USING ERRCODE = '42501';
END $$;

DO $$
DECLARE t text; tier text; spec jsonb := jsonb_build_object(
  'never', jsonb_build_array('invoices', 'receipts', 'supplier_invoices', 'supplier_payments'),
  'approval', jsonb_build_array('jobs', 'bookings', 'customers', 'vehicles', 'quotations', 'expenses', 'suppliers', 'staff_profiles', 'users', 'branches',
    'attendance_records', 'parts_requests', 'parts_catalogue', 'labour_charges', 'job_complaints', 'leave_requests', 'ot_requests', 'staff_schedules',
    'customer_updates', 'fleet_vehicles', 'fleet_bookings', 'fleet_costs', 'fleet_documents', 'fleet_issues', 'fleet_maintenance', 'fleet_trips',
    'fleet_vendors', 'esp_communities', 'esp_members', 'esp_announcements', 'esp_vehicle_maintenance_log'),
  'logged', jsonb_build_array('job_photos', 'job_types', 'bays', 'wa_templates', 'status_colors', 'workshop_rules', 'weekly_report_snapshots',
    'report_settings', 'os_vehicle_rules', 'os_blackouts', 'os_slots', 'os_zones', 'os_packages', 'os_prices', 'os_oil_grades',
    'esp_maintenance_items', 'esp_vehicle_maintenance_overrides', 'sales_marketing_audience_segments', 'sales_marketing_business_analysis',
    'sales_marketing_campaigns', 'sales_marketing_competitors', 'sales_marketing_goals', 'sales_marketing_period_metrics',
    'sales_marketing_plan_initiatives', 'sales_marketing_plans', 'sales_marketing_seasonal_events'));
BEGIN
  FOR tier IN SELECT jsonb_object_keys(spec) LOOP
    FOR t IN SELECT jsonb_array_elements_text(spec->tier) LOOP
      IF to_regclass('public.' || t) IS NOT NULL THEN
        EXECUTE format('DROP TRIGGER IF EXISTS guard_delete ON public.%I', t);
        EXECUTE format('CREATE TRIGGER guard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION guard_delete(%L)', t, tier);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── asking, deciding, withdrawing ───────────────────────────────────────
CREATE OR REPLACE FUNCTION deletion_roles(p_table text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_table
    WHEN 'jobs' THEN ARRAY['super_admin','ops_manager','front_desk','foreman']
    WHEN 'bookings' THEN ARRAY['super_admin','ops_manager','front_desk','foreman']
    WHEN 'customers' THEN ARRAY['super_admin','ops_manager','front_desk','foreman']
    WHEN 'vehicles' THEN ARRAY['super_admin','ops_manager','front_desk','foreman']
    WHEN 'quotations' THEN ARRAY['super_admin','ops_manager','front_desk','foreman']
    WHEN 'expenses' THEN ARRAY['super_admin','ops_manager','finance','foreman']
    WHEN 'suppliers' THEN ARRAY['super_admin','ops_manager','finance','foreman','parts_admin']
    WHEN 'parts_requests' THEN ARRAY['super_admin','ops_manager','foreman','parts_admin','mechanic']
    WHEN 'parts_catalogue' THEN ARRAY['super_admin','ops_manager','foreman','parts_admin']
    WHEN 'labour_charges' THEN ARRAY['super_admin','ops_manager','foreman']
    WHEN 'job_complaints' THEN ARRAY['super_admin','ops_manager','foreman','front_desk','finance']
    WHEN 'leave_requests' THEN ARRAY['super_admin','ops_manager','foreman']
    WHEN 'ot_requests' THEN ARRAY['super_admin','ops_manager','foreman']
    WHEN 'staff_schedules' THEN ARRAY['super_admin','ops_manager','foreman']
    WHEN 'customer_updates' THEN ARRAY['super_admin','ops_manager','foreman','front_desk']
    WHEN 'attendance_records' THEN ARRAY['super_admin','ops_manager']
    WHEN 'staff_profiles' THEN ARRAY['super_admin','ops_manager']
    WHEN 'users' THEN ARRAY['super_admin','ops_manager']
    WHEN 'branches' THEN ARRAY['super_admin','ops_manager']
    WHEN 'fleet_vehicles' THEN ARRAY['super_admin','ops_manager','fleet_admin']
    WHEN 'fleet_bookings' THEN ARRAY['super_admin','ops_manager','fleet_admin']
    WHEN 'fleet_costs' THEN ARRAY['super_admin','ops_manager','fleet_admin','finance']
    WHEN 'fleet_documents' THEN ARRAY['super_admin','ops_manager','fleet_admin']
    WHEN 'fleet_issues' THEN ARRAY['super_admin','ops_manager','fleet_admin']
    WHEN 'fleet_maintenance' THEN ARRAY['super_admin','ops_manager','fleet_admin']
    WHEN 'fleet_trips' THEN ARRAY['super_admin','ops_manager','fleet_admin']
    WHEN 'fleet_vendors' THEN ARRAY['super_admin','ops_manager','fleet_admin']
    WHEN 'esp_communities' THEN ARRAY['super_admin','ops_manager','foreman']
    WHEN 'esp_members' THEN ARRAY['super_admin','ops_manager','foreman','front_desk']
    WHEN 'esp_announcements' THEN ARRAY['super_admin','ops_manager','foreman','front_desk']
    WHEN 'esp_vehicle_maintenance_log' THEN ARRAY['super_admin','ops_manager','foreman']
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION request_deletion(p_table text, p_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE roles text[] := deletion_roles(p_table); r jsonb; req uuid; existing uuid;
BEGIN
  IF NOT is_active_user() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF roles IS NULL THEN RETURN jsonb_build_object('error', 'not_supported'); END IF;
  IF NOT (get_my_role() = ANY (roles)) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', p_table) INTO r USING p_id;
  IF r IS NULL OR nullif(r->>'tenant_id', '')::uuid IS DISTINCT FROM get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF nullif(r->>'branch_id', '') IS NOT NULL AND NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance']))
     AND (r->>'branch_id')::uuid IS DISTINCT FROM get_my_branch() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  -- a job that has an invoice other than a voided one stays: the money trail must keep its job
  IF p_table = 'jobs' AND EXISTS (SELECT 1 FROM invoices WHERE job_id = p_id AND status <> 'void') THEN
    RETURN jsonb_build_object('error', 'has_invoice');
  END IF;
  SELECT id INTO existing FROM deletion_requests WHERE table_name = p_table AND record_id = p_id AND status = 'pending';
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'request_id', existing, 'already', true); END IF;
  INSERT INTO deletion_requests (tenant_id, branch_id, table_name, record_id, record_label, snapshot, reason, requested_by)
  VALUES (get_my_tenant(), nullif(r->>'branch_id', '')::uuid, p_table, p_id, deletion_label(p_table, r), r, trim(p_reason), auth.uid())
  RETURNING id INTO req;
  RETURN jsonb_build_object('ok', true, 'request_id', req);
END $$;

CREATE OR REPLACE FUNCTION decide_deletion(p_request uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rq deletion_requests; gone boolean;
BEGIN
  IF NOT is_active_user() OR get_my_role() <> 'super_admin' THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO rq FROM deletion_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR rq.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF rq.status <> 'pending' THEN RETURN jsonb_build_object('error', 'already_decided'); END IF;
  IF NOT p_approve THEN
    UPDATE deletion_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') WHERE id = rq.id;
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;
  IF rq.table_name = 'jobs' AND EXISTS (SELECT 1 FROM invoices WHERE job_id = rq.record_id AND status <> 'void') THEN
    RETURN jsonb_build_object('error', 'has_invoice', 'detail', 'This job has an invoice. Void the invoice first.');
  END IF;
  PERFORM set_config('app.delete_request', rq.id::text, true);
  PERFORM set_config('app.delete_reason', rq.reason, true);
  BEGIN
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', rq.table_name) USING rq.record_id;
    GET DIAGNOSTICS gone = ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    PERFORM set_config('app.delete_request', '', true);
    RETURN jsonb_build_object('error', 'in_use', 'detail', 'Other records still depend on this one, so it cannot be deleted.');
  END;
  PERFORM set_config('app.delete_request', '', true);
  PERFORM set_config('app.delete_reason', '', true);
  IF NOT gone THEN
    UPDATE deletion_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'The record no longer exists' WHERE id = rq.id;
    RETURN jsonb_build_object('error', 'already_gone');
  END IF;
  UPDATE deletion_requests SET status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') WHERE id = rq.id;
  RETURN jsonb_build_object('ok', true, 'status', 'approved');
END $$;

CREATE OR REPLACE FUNCTION withdraw_deletion(p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE deletion_requests SET status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
   WHERE id = p_request AND status = 'pending' AND requested_by = auth.uid() AND tenant_id = get_my_tenant();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION deletion_roles(text), request_deletion(text, uuid, text), decide_deletion(uuid, boolean, text), withdraw_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_deletion(text, uuid, text), decide_deletion(uuid, boolean, text), withdraw_deletion(uuid) TO authenticated;

-- ── close the "same company is enough" tables ───────────────────────────
-- suppliers: everyone reads; the roles that deal with suppliers and parts write
DROP POLICY IF EXISTS suppliers_tenant_rw ON suppliers;
CREATE POLICY suppliers_select ON suppliers FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant());
CREATE POLICY suppliers_insert ON suppliers FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman','parts_admin','mechanic']));
CREATE POLICY suppliers_update ON suppliers FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman','parts_admin']))
  WITH CHECK (tenant_id = get_my_tenant());

-- supplier invoices and payments: money roles only
DROP POLICY IF EXISTS tenant_access_supplier_invoices ON supplier_invoices;
CREATE POLICY supplier_invoices_select ON supplier_invoices FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman','parts_admin']));
CREATE POLICY supplier_invoices_insert ON supplier_invoices FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman','parts_admin']));
CREATE POLICY supplier_invoices_update ON supplier_invoices FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman','parts_admin'])) WITH CHECK (tenant_id = get_my_tenant());
DROP POLICY IF EXISTS tenant_access_supplier_payments ON supplier_payments;
CREATE POLICY supplier_payments_select ON supplier_payments FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance','foreman','parts_admin']));
CREATE POLICY supplier_payments_insert ON supplier_payments FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));   -- the manual fallback is for ops managers and super admins only
CREATE POLICY supplier_payments_update ON supplier_payments FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) WITH CHECK (tenant_id = get_my_tenant());

-- receipts: invoice roles read; receipts are created by record_payment / the gateway, never directly
DROP POLICY IF EXISTS receipts_tenant_rw ON receipts;
CREATE POLICY receipts_select ON receipts FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman']));
-- TEMPORARY: the screen deployed before this change still inserts receipts directly (ops managers and super admins only).
-- Migration 172 removes this once the new screens, which use record_payment, are live.
CREATE POLICY receipts_insert_legacy ON receipts FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));
CREATE POLICY receipts_update ON receipts FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman'])) WITH CHECK (tenant_id = get_my_tenant());

CREATE OR REPLACE FUNCTION guard_receipt_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) THEN
    IF (NEW.amount, NEW.invoice_id, NEW.payment_method, NEW.payment_date, NEW.gateway_ref, NEW.voided_at, NEW.tenant_id, NEW.branch_id)
       IS DISTINCT FROM (OLD.amount, OLD.invoice_id, OLD.payment_method, OLD.payment_date, OLD.gateway_ref, OLD.voided_at, OLD.tenant_id, OLD.branch_id) THEN
      RAISE EXCEPTION 'A recorded payment cannot be edited. Void it and record it again.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_receipt_update ON receipts;
CREATE TRIGGER guard_receipt_update BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION guard_receipt_update();

-- quotations and their items
DROP POLICY IF EXISTS tenant_quotations ON quotations;
CREATE POLICY quotations_select ON quotations FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','foreman','finance']));
CREATE POLICY quotations_insert ON quotations FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','foreman']));
CREATE POLICY quotations_update ON quotations FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','foreman'])) WITH CHECK (tenant_id = get_my_tenant());
DROP POLICY IF EXISTS tenant_quotation_items ON quotation_items;
CREATE POLICY quotation_items_select ON quotation_items FOR SELECT TO authenticated USING (is_active_user() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','foreman','finance'])
  AND quotation_id IN (SELECT id FROM quotations WHERE tenant_id = get_my_tenant()));
CREATE POLICY quotation_items_write ON quotation_items FOR ALL TO authenticated USING (is_active_user() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','foreman'])
  AND quotation_id IN (SELECT id FROM quotations WHERE tenant_id = get_my_tenant()))
  WITH CHECK (quotation_id IN (SELECT id FROM quotations WHERE tenant_id = get_my_tenant()));

-- price lists: everyone reads, the people who manage them write
DROP POLICY IF EXISTS parts_catalogue_tenant_rw ON parts_catalogue;
CREATE POLICY parts_catalogue_select ON parts_catalogue FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant());
CREATE POLICY parts_catalogue_insert ON parts_catalogue FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','parts_admin']));
CREATE POLICY parts_catalogue_update ON parts_catalogue FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','parts_admin'])) WITH CHECK (tenant_id = get_my_tenant());
DROP POLICY IF EXISTS labour_charges_tenant_rw ON labour_charges;
CREATE POLICY labour_charges_select ON labour_charges FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant());
CREATE POLICY labour_charges_insert ON labour_charges FOR INSERT TO authenticated WITH CHECK (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman']));
CREATE POLICY labour_charges_update ON labour_charges FOR UPDATE TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman'])) WITH CHECK (tenant_id = get_my_tenant());

-- stock movements and payment failures are written by functions and the gateway only
DROP POLICY IF EXISTS stock_movements_tenant_rw ON stock_movements;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant());
DROP POLICY IF EXISTS invoice_payment_failures_tenant_rw ON invoice_payment_failures;
CREATE POLICY invoice_payment_failures_select ON invoice_payment_failures FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman']));

-- document number counters: only the numbering functions touch them (so nobody can reset them to hide gaps)
ALTER FUNCTION generate_doc_number(uuid, text) SECURITY DEFINER SET search_path = public;
ALTER FUNCTION generate_job_number(uuid) SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION generate_doc_number(uuid, text), generate_job_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_doc_number(uuid, text), generate_job_number(uuid) TO authenticated, service_role;
DROP POLICY IF EXISTS doc_counters_tenant_rw ON doc_number_counters;
DROP POLICY IF EXISTS job_counters_tenant_rw ON job_number_counters;

DROP POLICY IF EXISTS invoices_delete ON invoices;

-- ── invoices: money fields move only through the payment functions ──────
CREATE OR REPLACE FUNCTION guard_invoice_money() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) THEN
    IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
      RAISE EXCEPTION 'Payments are recorded with Record Payment, not by editing the invoice.' USING ERRCODE = '42501';
    END IF;
    -- staff may issue a draft and move between sent/overdue; voiding goes through void_invoice, payment through record_payment
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'draft' AND NEW.status = 'sent')
       AND NOT (OLD.status IN ('sent', 'overdue') AND NEW.status IN ('sent', 'overdue')) THEN
      RAISE EXCEPTION 'This status change is not allowed here. Use Void Invoice or Record Payment.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.subtotal, NEW.discount_pct, NEW.discount_amount, NEW.tax_pct, NEW.tax_amount, NEW.total_amount, NEW.line_items)
       IS DISTINCT FROM (OLD.subtotal, OLD.discount_pct, OLD.discount_amount, OLD.tax_pct, OLD.tax_amount, OLD.total_amount, OLD.line_items) THEN
      RAISE EXCEPTION 'An issued invoice cannot be edited. Ask an operations manager.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_invoice_money ON invoices;
CREATE TRIGGER guard_invoice_money BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION guard_invoice_money();

-- every change to an issued invoice leaves an audit entry (who, what changed)
CREATE OR REPLACE FUNCTION audit_invoice_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.line_items IS DISTINCT FROM OLD.line_items OR (NEW.status = 'void' AND OLD.status <> 'void' AND nullif(current_setting('app.void_reason', true), '') IS NULL) THEN
    PERFORM insert_audit_log(CASE WHEN NEW.status = 'void' AND OLD.status <> 'void' THEN 'void' ELSE 'invoice_changed' END, 'invoices', NEW.id, 'invoice',
      jsonb_build_object('invoice_number', NEW.invoice_number, 'old_total', OLD.total_amount, 'new_total', NEW.total_amount,
                         'old_discount', OLD.discount_amount, 'new_discount', NEW.discount_amount, 'old_status', OLD.status, 'new_status', NEW.status,
                         'amount_paid', NEW.amount_paid),
      NEW.branch_id, auth.uid(), NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_invoice_change ON invoices;
CREATE TRIGGER audit_invoice_change AFTER UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION audit_invoice_change();

-- voiding an invoice needs a reason and is limited when money has been taken
CREATE OR REPLACE FUNCTION void_invoice(p_invoice uuid, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv invoices; priv boolean;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO inv FROM invoices WHERE id = p_invoice;
  IF NOT FOUND OR inv.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'invoice_not_found'); END IF;
  priv := get_my_role() = ANY (ARRAY['super_admin','ops_manager']);
  IF NOT (priv OR get_my_role() = 'finance' OR inv.branch_id = get_my_branch()) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  IF inv.status = 'void' THEN RETURN jsonb_build_object('error', 'already_void'); END IF;
  IF inv.status = 'paid' OR (inv.amount_paid > 0 AND NOT priv) THEN RETURN jsonb_build_object('error', 'has_payments'); END IF;
  PERFORM set_config('app.void_reason', trim(p_reason), true);
  UPDATE invoices SET status = 'void', updated_at = now() WHERE id = inv.id;
  PERFORM set_config('app.void_reason', '', true);
  PERFORM insert_audit_log('void', 'invoices', inv.id, 'invoice', jsonb_build_object('invoice_number', inv.invoice_number, 'reason', trim(p_reason),
          'total', inv.total_amount, 'amount_paid', inv.amount_paid, 'old_status', inv.status), inv.branch_id, auth.uid(), inv.tenant_id);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION void_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION void_invoice(uuid, text) TO authenticated;
