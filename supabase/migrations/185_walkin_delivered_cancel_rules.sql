-- 185: the rest of the "open the invoice at the start" work.
--
--  1. Walk-ins: a job card created on the Workshop Board with no booking opens an empty draft invoice, linked to the job.
--  2. Delivered: a job cannot be marked delivered until its invoice is issued with an amount, or the owner has approved "no charge".
--  3. Cancelling: a job is cancelled through cancel_job with a real reason. Once work has started (anything past "checked in"),
--     only the Branch Admin (or super admin) can cancel; everyone else sends a request that the Branch Admin decides.
--     The job's empty draft invoice is voided automatically.
--  4. "No charge": staff send a request with a reason, only the super admin approves.
--  5. Every job records who opened it. The integrity report lists cancellations, no-charge jobs and stale empty drafts.
--  6. Ford is priced as continental (tier 2).
-- Companies with the stricter rules switched off (MAC) and BB Care Day jobs keep their earlier behaviour.

DO $$
DECLARE t uuid;
BEGIN
  SELECT id INTO t FROM tenants WHERE slug = 'motoverse-garage';
  IF t IS NULL THEN RETURN; END IF;
  INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, model, tier)
  SELECT t, 'car', 'Ford', NULL, 'tier2'
   WHERE NOT EXISTS (SELECT 1 FROM os_vehicle_rules r WHERE r.tenant_id = t AND r.vehicle_type = 'car' AND r.make = 'Ford' AND r.model IS NULL);
END $$;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS no_charge_reason text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS no_charge_approved_by uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS no_charge_approved_at timestamptz;

-- requests for a job: a cancellation after work started (decided by the Branch Admin) or "no charge" (decided by the super admin)
CREATE TABLE IF NOT EXISTS action_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id     uuid,
  kind          text NOT NULL CHECK (kind IN ('cancel_job', 'no_charge')),
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_label     text,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS action_requests_one_pending ON action_requests (kind, job_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS action_requests_tenant_status ON action_requests (tenant_id, status, requested_at DESC);
ALTER TABLE action_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_requests_select ON action_requests;
CREATE POLICY action_requests_select ON action_requests FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND (requested_by = auth.uid() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager'])));

-- a reason that says something
CREATE OR REPLACE FUNCTION reason_ok(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT length(trim(coalesce(p, ''))) >= 10 AND length(regexp_replace(lower(coalesce(p, '')), '[^a-z]', '', 'g')) >= 6
$$;

-- who opened a job card
CREATE OR REPLACE FUNCTION jobs_set_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_set_creator ON jobs;
CREATE TRIGGER jobs_set_creator BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_set_creator();

-- BB Care Day jobs follow their own flow
CREATE OR REPLACE FUNCTION job_is_bb(j jobs) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT j.source = 'bb_staff' OR (j.booking_id IS NOT NULL AND EXISTS (SELECT 1 FROM os_bookings o WHERE o.hub_booking_id = j.booking_id))
$$;

-- 1. walk-in: open the draft invoice at check-in
CREATE OR REPLACE FUNCTION jobs_open_walkin_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv uuid; c customers%ROWTYPE; v vehicles%ROWTYPE; opener text;
BEGIN
  IF NOT controls_on(NEW.tenant_id) THEN RETURN NEW; END IF;
  IF NEW.booking_id IS NOT NULL OR job_is_bb(NEW) THEN RETURN NEW; END IF;   -- bookings open their own draft
  IF NEW.invoice_id IS NOT NULL OR EXISTS (SELECT 1 FROM invoices WHERE job_id = NEW.id AND status <> 'void') THEN RETURN NEW; END IF;
  SELECT * INTO c FROM customers WHERE id = NEW.customer_id;
  SELECT * INTO v FROM vehicles WHERE id = NEW.vehicle_id;
  SELECT full_name INTO opener FROM users WHERE id = coalesce(NEW.created_by, auth.uid());
  INSERT INTO invoices (tenant_id, branch_id, customer_id, customer_name, customer_phone, customer_email, vehicle_plate, vehicle_info,
                        issue_date, due_date, status, line_items, subtotal, total_amount, amount_paid, notes, created_by, opened_by, is_internal_fleet)
  VALUES (NEW.tenant_id, NEW.branch_id, NEW.customer_id, coalesce(nullif(trim(c.full_name), ''), 'Customer'), c.phone, c.email, v.plate_number,
          nullif(trim(coalesce(v.make, '') || ' ' || coalesce(v.model, '')), ''), current_date, current_date + 30, 'draft', '[]'::jsonb, 0, 0, 0,
          'Opened automatically when the car was checked in (job ' || coalesce(NEW.job_number, '') || ')', coalesce(NEW.created_by, auth.uid()), coalesce(opener, 'Check-in'),
          coalesce(v.is_internal_fleet, false))
  RETURNING id INTO inv;
  UPDATE invoices SET job_id = NEW.id WHERE id = inv;
  UPDATE jobs SET invoice_id = inv WHERE id = NEW.id AND invoice_id IS NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_open_walkin_invoice ON jobs;
CREATE TRIGGER jobs_open_walkin_invoice AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_open_walkin_invoice();

-- 2. delivered needs an issued invoice with an amount, or an approved "no charge"
-- 3. cancelling only through cancel_job; the approval columns are changed only by the functions below
CREATE OR REPLACE FUNCTION jobs_money_rules() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR NOT controls_on(NEW.tenant_id) THEN RETURN NEW; END IF;
  IF (NEW.no_charge_reason, NEW.no_charge_approved_by, NEW.no_charge_approved_at, NEW.cancel_reason, NEW.cancelled_by, NEW.cancelled_at)
     IS DISTINCT FROM (OLD.no_charge_reason, OLD.no_charge_approved_by, OLD.no_charge_approved_at, OLD.cancel_reason, OLD.cancelled_by, OLD.cancelled_at) THEN
    RAISE EXCEPTION 'This can only be set through the approval screens.' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Use Cancel Job, so the reason is recorded and, once work has started, approved.' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' AND NOT job_is_bb(NEW) AND NEW.no_charge_approved_by IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM invoices i WHERE i.status IN ('sent', 'paid', 'overdue') AND i.total_amount > 0 AND (i.job_id = NEW.id OR i.id = NEW.invoice_id)) THEN
      RAISE EXCEPTION 'This job cannot be delivered yet. Issue its invoice with an amount, or ask for a no-charge approval.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_money_rules ON jobs;
CREATE TRIGGER jobs_money_rules BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_money_rules();

-- cancelling: the real work, shared by cancel_job and an approved request
CREATE OR REPLACE FUNCTION do_cancel_job(p_job uuid, p_reason text, p_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jobs%ROWTYPE; who text; plate text; inv invoices%ROWTYPE; old_status text;
BEGIN
  SELECT * INTO j FROM jobs WHERE id = p_job FOR UPDATE;
  old_status := j.status;
  SELECT full_name INTO who FROM users WHERE id = p_by;
  SELECT plate_number INTO plate FROM vehicles WHERE id = j.vehicle_id;
  UPDATE jobs SET status = 'cancelled', cancel_reason = trim(p_reason), cancelled_by = p_by, cancelled_at = now(),
         internal_notes = coalesce(internal_notes || E'\n', '') || '[CANCELLED by ' || coalesce(who, 'staff') || '] ' || trim(p_reason)
   WHERE id = p_job;
  -- an empty draft invoice goes with the job; one that already has items or payments is kept and flagged
  SELECT * INTO inv FROM invoices WHERE job_id = p_job AND status = 'draft' ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF inv.total_amount = 0 AND inv.amount_paid = 0 AND jsonb_array_length(coalesce(inv.line_items, '[]'::jsonb)) = 0 THEN
      UPDATE invoices SET status = 'void', updated_at = now(), notes = coalesce(notes || E'\n', '') || 'Voided automatically: job cancelled (' || trim(p_reason) || ')' WHERE id = inv.id;
      PERFORM insert_audit_log('void', 'invoices', inv.id, 'invoice',
        jsonb_build_object('invoice_number', inv.invoice_number, 'reason', 'job cancelled: ' || trim(p_reason), 'job', j.job_number, 'automatic', true), inv.branch_id, auth.uid(), inv.tenant_id);
    ELSE
      PERFORM insert_audit_log('job_cancelled_invoice_kept', 'invoices', inv.id, 'invoice',
        jsonb_build_object('invoice_number', inv.invoice_number, 'job', j.job_number), inv.branch_id, auth.uid(), inv.tenant_id);
    END IF;
  END IF;
  PERFORM insert_audit_log('job_cancelled', 'Job', p_job, 'job',
    jsonb_build_object('job_number', j.job_number, 'plate', plate, 'from_status', old_status, 'reason', trim(p_reason),
                       'requested_by', who, 'decided_by', (SELECT full_name FROM users WHERE id = auth.uid())), j.branch_id, auth.uid(), j.tenant_id);
END $$;
REVOKE ALL ON FUNCTION do_cancel_job(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION cancel_job(p_job uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jobs%ROWTYPE; mc text; rid uuid; plate text;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman', 'front_desk'])) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO j FROM jobs WHERE id = p_job;
  IF NOT FOUND OR j.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']) OR j.branch_id = get_my_branch()) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF j.status IN ('cancelled', 'delivered') THEN RETURN jsonb_build_object('error', 'not_cancellable'); END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RETURN jsonb_build_object('error', 'reason_required'); END IF;
  IF NOT controls_on(j.tenant_id) THEN PERFORM do_cancel_job(p_job, p_reason, auth.uid()); RETURN jsonb_build_object('ok', true, 'cancelled', true); END IF;
  IF NOT reason_ok(p_reason) THEN RETURN jsonb_build_object('error', 'reason_too_short'); END IF;
  mc := money_check(j.tenant_id, ARRAY['super_admin', 'ops_manager']);
  IF j.status = 'checked_in' OR mc IS NULL THEN
    PERFORM do_cancel_job(p_job, p_reason, auth.uid());
    RETURN jsonb_build_object('ok', true, 'cancelled', true);
  END IF;
  IF mc = 'mfa_required' THEN RETURN jsonb_build_object('error', 'mfa_required'); END IF;
  SELECT id INTO rid FROM action_requests WHERE kind = 'cancel_job' AND job_id = p_job AND status = 'pending';
  IF rid IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'requested', true, 'already', true, 'request_id', rid); END IF;
  SELECT plate_number INTO plate FROM vehicles WHERE id = j.vehicle_id;
  INSERT INTO action_requests (tenant_id, branch_id, kind, job_id, job_label, reason, requested_by)
  VALUES (j.tenant_id, j.branch_id, 'cancel_job', p_job, j.job_number || coalesce(' ' || plate, ''), trim(p_reason), auth.uid()) RETURNING id INTO rid;
  PERFORM insert_audit_log('job_cancel_requested', 'Job', p_job, 'job', jsonb_build_object('job_number', j.job_number, 'plate', plate, 'status', j.status, 'reason', trim(p_reason)), j.branch_id, auth.uid(), j.tenant_id);
  RETURN jsonb_build_object('ok', true, 'requested', true, 'request_id', rid);
END $$;

CREATE OR REPLACE FUNCTION request_job_action(p_job uuid, p_kind text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jobs%ROWTYPE; rid uuid; plate text;
BEGIN
  IF p_kind <> 'no_charge' THEN RETURN jsonb_build_object('error', 'not_supported'); END IF;
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman', 'front_desk'])) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO j FROM jobs WHERE id = p_job;
  IF NOT FOUND OR j.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager']) OR j.branch_id = get_my_branch()) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  IF NOT controls_on(j.tenant_id) THEN RETURN jsonb_build_object('error', 'not_needed'); END IF;
  IF j.status IN ('cancelled', 'delivered') OR j.no_charge_approved_by IS NOT NULL THEN RETURN jsonb_build_object('error', 'not_available'); END IF;
  IF NOT reason_ok(p_reason) THEN RETURN jsonb_build_object('error', 'reason_too_short'); END IF;
  SELECT id INTO rid FROM action_requests WHERE kind = 'no_charge' AND job_id = p_job AND status = 'pending';
  IF rid IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true, 'request_id', rid); END IF;
  SELECT plate_number INTO plate FROM vehicles WHERE id = j.vehicle_id;
  INSERT INTO action_requests (tenant_id, branch_id, kind, job_id, job_label, reason, requested_by)
  VALUES (j.tenant_id, j.branch_id, 'no_charge', p_job, j.job_number || coalesce(' ' || plate, ''), trim(p_reason), auth.uid()) RETURNING id INTO rid;
  PERFORM insert_audit_log('no_charge_requested', 'Job', p_job, 'job', jsonb_build_object('job_number', j.job_number, 'plate', plate, 'reason', trim(p_reason)), j.branch_id, auth.uid(), j.tenant_id);
  RETURN jsonb_build_object('ok', true, 'request_id', rid);
END $$;

CREATE OR REPLACE FUNCTION decide_job_action(p_request uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r action_requests%ROWTYPE; mc text; j jobs%ROWTYPE;
BEGIN
  IF NOT is_active_user() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO r FROM action_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR r.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('error', 'already_decided'); END IF;
  IF r.kind = 'cancel_job' THEN
    mc := money_check(r.tenant_id, ARRAY['super_admin', 'ops_manager']);
    IF mc IS NOT NULL THEN RETURN jsonb_build_object('error', CASE WHEN mc = 'mfa_required' THEN 'mfa_required' ELSE 'forbidden' END); END IF;
  ELSE
    IF get_my_role() <> 'super_admin' THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
    IF coalesce((SELECT require_mfa FROM tenants WHERE id = r.tenant_id), false) AND caller_aal() <> 'aal2' THEN RETURN jsonb_build_object('error', 'mfa_required'); END IF;
  END IF;
  SELECT * INTO j FROM jobs WHERE id = r.job_id;
  IF p_approve AND (NOT FOUND OR j.status IN ('cancelled', 'delivered')) THEN
    UPDATE action_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'The job changed before this was decided' WHERE id = r.id;
    RETURN jsonb_build_object('error', 'job_changed');
  END IF;
  IF NOT p_approve THEN
    UPDATE action_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') WHERE id = r.id;
    PERFORM insert_audit_log('job_request_rejected', 'Job', r.job_id, 'job', jsonb_build_object('kind', r.kind, 'job', r.job_label, 'note', nullif(trim(p_note), '')), r.branch_id, auth.uid(), r.tenant_id);
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;
  IF r.kind = 'cancel_job' THEN
    PERFORM do_cancel_job(r.job_id, r.reason, r.requested_by);
  ELSE
    UPDATE jobs SET no_charge_reason = r.reason, no_charge_approved_by = auth.uid(), no_charge_approved_at = now() WHERE id = r.job_id;
    PERFORM insert_audit_log('no_charge_approved', 'Job', r.job_id, 'job', jsonb_build_object('job', r.job_label, 'reason', r.reason), r.branch_id, auth.uid(), r.tenant_id);
  END IF;
  UPDATE action_requests SET status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'status', 'approved');
END $$;

CREATE OR REPLACE FUNCTION withdraw_job_action(p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE action_requests SET status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
   WHERE id = p_request AND status = 'pending' AND requested_by = auth.uid() AND tenant_id = get_my_tenant();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION cancel_job(uuid, text), request_job_action(uuid, text, text), decide_job_action(uuid, boolean, text), withdraw_job_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_job(uuid, text), request_job_action(uuid, text, text), decide_job_action(uuid, boolean, text), withdraw_job_action(uuid) TO authenticated;

-- the integrity report: cancellations, no-charge jobs and stale empty drafts
CREATE OR REPLACE FUNCTION integrity_report(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_my_tenant(); a timestamptz := p_from::timestamptz; b timestamptz := (p_to + 1)::timestamptz; res jsonb;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  res := jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'voided_invoices', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', l.created_at, 'invoice_number', l.details->>'invoice_number', 'reason', l.details->>'reason',
               'total', l.details->'total', 'amount_paid', l.details->'amount_paid', 'by', u.full_name, 'role', u.role) x
          FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.tenant_id = t AND l.action = 'void' AND l.module = 'invoices' AND l.created_at >= a AND l.created_at < b LIMIT 200) q), '[]'::jsonb),
    'voided_receipts', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', r.voided_at, 'invoice_number', i.invoice_number, 'amount', r.amount, 'method', r.payment_method,
               'reason', r.void_reason, 'by', u.full_name, 'role', u.role) x
          FROM receipts r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN users u ON u.id = r.voided_by
         WHERE r.tenant_id = t AND r.voided_at >= a AND r.voided_at < b LIMIT 200) q), '[]'::jsonb),
    'invoice_changes', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', l.created_at, 'invoice_number', l.details->>'invoice_number', 'old_total', l.details->'old_total',
               'new_total', l.details->'new_total', 'old_discount', l.details->'old_discount', 'new_discount', l.details->'new_discount',
               'amount_paid', l.details->'amount_paid', 'by', u.full_name, 'role', u.role) x
          FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.tenant_id = t AND l.action = 'invoice_changed' AND l.created_at >= a AND l.created_at < b LIMIT 200) q), '[]'::jsonb),
    'number_gaps', coalesce((SELECT jsonb_agg(jsonb_build_object('series', s.series, 'missing', s.missing) ORDER BY s.series) FROM (
        SELECT g.series, jsonb_agg(g.n ORDER BY g.n) missing FROM (
          SELECT p.series, gs.n
            FROM (SELECT regexp_replace(invoice_number, '[0-9]+$', '') series, min(substring(invoice_number from '[0-9]+$')::int) lo, max(substring(invoice_number from '[0-9]+$')::int) hi
                    FROM invoices WHERE tenant_id = t AND invoice_number ~ '[0-9]+$' AND created_at >= a GROUP BY 1) p,
                 LATERAL generate_series(p.lo, p.hi) gs(n)
           WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = t AND regexp_replace(i.invoice_number, '[0-9]+$', '') = p.series
                               AND substring(i.invoice_number from '[0-9]+$')::int = gs.n)) g GROUP BY g.series) s), '[]'::jsonb),
    'jobs_without_invoice', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'status', j.status, 'at', coalesce(j.status_updated_at, j.updated_at),
               'created_by', u.full_name, 'customer', cu.full_name, 'plate', v.plate_number) x
          FROM jobs j LEFT JOIN users u ON u.id = j.created_by LEFT JOIN customers cu ON cu.id = j.customer_id LEFT JOIN vehicles v ON v.id = j.vehicle_id
         WHERE j.tenant_id = t AND j.status IN ('delivered', 'ready', 'long_due') AND j.archived_at IS NULL
           AND coalesce(j.status_updated_at, j.updated_at) >= a AND coalesce(j.status_updated_at, j.updated_at) < b
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.status <> 'void' AND (i.job_id = j.id OR i.id = j.invoice_id))
           AND NOT EXISTS (SELECT 1 FROM invoices ii WHERE ii.tenant_id = t AND ii.is_internal_fleet AND ii.status <> 'void'
                         AND (ii.customer_id = j.customer_id
                              OR (v.plate_number IS NOT NULL AND upper(regexp_replace(ii.vehicle_plate, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v.plate_number, '[^A-Za-z0-9]', '', 'g'))))) LIMIT 200) q), '[]'::jsonb),
    'jobs_without_invoice_internal', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'status', j.status, 'at', coalesce(j.status_updated_at, j.updated_at),
               'created_by', u.full_name, 'customer', cu.full_name, 'plate', v.plate_number) x
          FROM jobs j LEFT JOIN users u ON u.id = j.created_by LEFT JOIN customers cu ON cu.id = j.customer_id LEFT JOIN vehicles v ON v.id = j.vehicle_id
         WHERE j.tenant_id = t AND j.status IN ('delivered', 'ready', 'long_due') AND j.archived_at IS NULL
           AND coalesce(j.status_updated_at, j.updated_at) >= a AND coalesce(j.status_updated_at, j.updated_at) < b
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.status <> 'void' AND (i.job_id = j.id OR i.id = j.invoice_id))
           AND EXISTS (SELECT 1 FROM invoices ii WHERE ii.tenant_id = t AND ii.is_internal_fleet AND ii.status <> 'void'
                         AND (ii.customer_id = j.customer_id
                              OR (v.plate_number IS NOT NULL AND upper(regexp_replace(ii.vehicle_plate, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v.plate_number, '[^A-Za-z0-9]', '', 'g'))))) LIMIT 200) q), '[]'::jsonb),
    'payment_mismatches', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'diff')::numeric DESC) FROM (
        SELECT jsonb_build_object('invoice_number', i.invoice_number, 'customer', i.customer_name, 'total', i.total_amount, 'amount_paid', i.amount_paid,
               'receipts', m.rs, 'diff', abs(i.amount_paid - m.rs), 'status', i.status,
               'issue', CASE WHEN m.rs > i.total_amount + 0.005 THEN 'Receipts add up to more than the invoice total'
                             WHEN m.rs > i.amount_paid + 0.005 THEN 'Receipts are more than the amount marked paid'
                             ELSE 'Marked paid, but the receipts are less' END) x
          FROM invoices i
          CROSS JOIN LATERAL (SELECT coalesce(sum(r.amount), 0) rs FROM receipts r WHERE r.invoice_id = i.id AND r.voided_at IS NULL) m
         WHERE i.tenant_id = t AND i.status <> 'void' AND i.status <> 'draft'
           AND (abs(i.amount_paid - m.rs) > 0.005 OR m.rs > i.total_amount + 0.005) LIMIT 200) q), '[]'::jsonb),
    'payments_without_proof', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', r.created_at, 'invoice_number', i.invoice_number, 'amount', r.amount, 'method', r.payment_method,
               'by', u.full_name, 'role', u.role) x
          FROM receipts r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN users u ON u.id = r.created_by
         WHERE r.tenant_id = t AND r.voided_at IS NULL AND r.proof_url IS NULL AND r.gateway_ref IS NULL
           AND r.payment_method IN ('cash', 'bank_transfer', 'duitnow', 'qr', 'card', 'credit_card')
           AND r.created_at >= a AND r.created_at < b LIMIT 200) q), '[]'::jsonb),
    'deletions', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', d.deleted_at, 'table', d.table_name, 'label', d.record_label, 'kind', d.kind, 'reason', d.reason,
               'by', u.full_name, 'approved_by', ap.full_name) x
          FROM deleted_records d LEFT JOIN users u ON u.id = d.deleted_by LEFT JOIN users ap ON ap.id = d.approved_by
         WHERE d.tenant_id = t AND d.deleted_at >= a AND d.deleted_at < b LIMIT 300) q), '[]'::jsonb),
    'pending_deletions', (SELECT count(*) FROM deletion_requests WHERE tenant_id = t AND status = 'pending')
  );
  res := res || jsonb_build_object(
    'job_cancellations', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', coalesce(j.cancelled_at, j.status_updated_at), 'job_number', j.job_number, 'plate', v.plate_number,
               'reason', coalesce(j.cancel_reason, nullif(trim(substring(j.internal_notes from '\[CANCELLED by [^\]]*\]([^\n]*)$')), '')),
               'by', coalesce((SELECT full_name FROM users WHERE id = j.cancelled_by), substring(j.internal_notes from '\[CANCELLED by ([^\]]*)\]')),
               'had_invoice', EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id AND i.status <> 'void'),
               'before_cancel', (SELECT l.details->>'from_status' FROM audit_logs l WHERE l.action = 'job_cancelled' AND l.record_id = j.id ORDER BY l.created_at DESC LIMIT 1)) x
          FROM jobs j LEFT JOIN vehicles v ON v.id = j.vehicle_id
         WHERE j.tenant_id = t AND j.status = 'cancelled' AND coalesce(j.cancelled_at, j.status_updated_at) >= a AND coalesce(j.cancelled_at, j.status_updated_at) < b LIMIT 200) q), '[]'::jsonb),
    'no_charge_jobs', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', j.no_charge_approved_at, 'job_number', j.job_number, 'plate', v.plate_number, 'reason', j.no_charge_reason,
               'approved_by', (SELECT full_name FROM users WHERE id = j.no_charge_approved_by)) x
          FROM jobs j LEFT JOIN vehicles v ON v.id = j.vehicle_id
         WHERE j.tenant_id = t AND j.no_charge_approved_by IS NOT NULL AND j.no_charge_approved_at >= a AND j.no_charge_approved_at < b LIMIT 200) q), '[]'::jsonb),
    'stale_drafts', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'age_days')::int DESC) FROM (
        SELECT jsonb_build_object('invoice_number', i.invoice_number, 'customer', i.customer_name, 'plate', i.vehicle_plate, 'opened', i.created_at,
               'age_days', (current_date - i.created_at::date), 'opened_by', i.opened_by, 'job', (SELECT job_number FROM jobs WHERE id = i.job_id)) x
          FROM invoices i WHERE i.tenant_id = t AND i.status = 'draft' AND i.total_amount = 0 AND i.created_at < now() - interval '7 days'
           AND (i.booking_id IS NOT NULL OR i.job_id IS NOT NULL) LIMIT 200) q), '[]'::jsonb),
    'pending_job_requests', (SELECT count(*) FROM action_requests WHERE tenant_id = t AND status = 'pending'));
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION integrity_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION integrity_report(date, date) TO authenticated;
