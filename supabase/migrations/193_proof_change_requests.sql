-- 193: staff can ask for a proof of payment to be replaced, or for a second document to be added; the Branch Admin (or super admin)
-- approves. Nothing is deleted: a replaced proof goes to the receipt's history, and extra documents sit beside the main proof.
-- Also: nobody can delete a proof file that a receipt, its history, an extra document or a request points to.

CREATE TABLE IF NOT EXISTS receipt_extra_proofs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id   uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  proof_url    text NOT NULL,
  proof_bucket text NOT NULL DEFAULT 'payment-proofs',
  note         text,
  added_by     uuid,
  approved_by  uuid,
  added_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipt_extra_proofs_receipt ON receipt_extra_proofs (receipt_id);
ALTER TABLE receipt_extra_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipt_extra_proofs_select ON receipt_extra_proofs;
CREATE POLICY receipt_extra_proofs_select ON receipt_extra_proofs FOR SELECT TO authenticated USING (is_active_user() AND tenant_id = get_my_tenant());

CREATE TABLE IF NOT EXISTS proof_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id     uuid,
  receipt_id    uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  invoice_id    uuid,
  kind          text NOT NULL CHECK (kind IN ('replace', 'add')),
  path          text NOT NULL,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS proof_requests_one_pending ON proof_requests (receipt_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS proof_requests_tenant_status ON proof_requests (tenant_id, status, requested_at DESC);
ALTER TABLE proof_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proof_requests_select ON proof_requests;
CREATE POLICY proof_requests_select ON proof_requests FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND (requested_by = auth.uid() OR get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'finance'])));

-- a staff member asks for a change
CREATE OR REPLACE FUNCTION request_proof_change(p_receipt uuid, p_kind text, p_path text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r receipts; rid uuid;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'foreman', 'front_desk', 'finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  IF p_kind NOT IN ('replace', 'add') THEN RETURN jsonb_build_object('error', 'bad_kind'); END IF;
  SELECT * INTO r FROM receipts WHERE id = p_receipt;
  IF NOT FOUND OR r.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT controls_on(r.tenant_id) THEN RETURN jsonb_build_object('error', 'not_needed'); END IF;
  IF r.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'voided'); END IF;
  IF p_path IS NULL OR left(p_path, length(p_receipt::text) + 1) <> p_receipt::text || '/' THEN RETURN jsonb_build_object('error', 'bad_path'); END IF;
  IF NOT reason_ok(p_reason) THEN RETURN jsonb_build_object('error', 'reason_too_short'); END IF;
  SELECT id INTO rid FROM proof_requests WHERE receipt_id = p_receipt AND status = 'pending';
  IF FOUND THEN RETURN jsonb_build_object('error', 'already_pending', 'request_id', rid); END IF;
  INSERT INTO proof_requests (tenant_id, branch_id, receipt_id, invoice_id, kind, path, reason, requested_by)
  VALUES (r.tenant_id, r.branch_id, r.id, r.invoice_id, p_kind, p_path, trim(p_reason), auth.uid()) RETURNING id INTO rid;
  PERFORM insert_audit_log('proof_change_requested', 'receipts', r.id, 'receipt',
    jsonb_build_object('invoice_id', r.invoice_id, 'kind', p_kind, 'reason', trim(p_reason), 'request_id', rid), r.branch_id, auth.uid(), r.tenant_id);
  RETURN jsonb_build_object('ok', true, 'request_id', rid);
END $$;

-- the Branch Admin (or super admin) decides
CREATE OR REPLACE FUNCTION decide_proof_request(p_request uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q proof_requests; mc text; res json; r receipts;
BEGIN
  IF NOT is_active_user() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO q FROM proof_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF q.status <> 'pending' THEN RETURN jsonb_build_object('error', 'already_decided'); END IF;
  mc := money_check(q.tenant_id, ARRAY['super_admin']);
  IF mc IS NOT NULL THEN RETURN jsonb_build_object('error', mc); END IF;
  SELECT * INTO r FROM receipts WHERE id = q.receipt_id;
  IF p_approve THEN
    IF r.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'voided'); END IF;
    IF q.kind = 'replace' THEN
      res := set_receipt_proof(q.receipt_id, q.path, NULL);
      IF res->>'error' IS NOT NULL THEN RETURN jsonb_build_object('error', res->>'error'); END IF;
    ELSE
      INSERT INTO receipt_extra_proofs (tenant_id, receipt_id, proof_url, note, added_by, approved_by)
      VALUES (q.tenant_id, q.receipt_id, q.path, q.reason, q.requested_by, auth.uid());
    END IF;
  END IF;
  UPDATE proof_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '') WHERE id = q.id;
  PERFORM insert_audit_log(CASE WHEN p_approve THEN 'proof_request_approved' ELSE 'proof_request_rejected' END, 'receipts', q.receipt_id, 'receipt',
    jsonb_build_object('invoice_id', q.invoice_id, 'kind', q.kind, 'reason', q.reason, 'requested_by', q.requested_by, 'note', nullif(trim(coalesce(p_note, '')), '')),
    q.branch_id, auth.uid(), q.tenant_id);
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END $$;

CREATE OR REPLACE FUNCTION withdraw_proof_request(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q proof_requests;
BEGIN
  SELECT * INTO q FROM proof_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.tenant_id <> get_my_tenant() OR q.requested_by <> auth.uid() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF q.status <> 'pending' THEN RETURN jsonb_build_object('error', 'already_decided'); END IF;
  UPDATE proof_requests SET status = 'withdrawn', decided_at = now() WHERE id = q.id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- the Branch Admin (or super admin) can add a second document straight away
CREATE OR REPLACE FUNCTION add_receipt_proof(p_receipt uuid, p_path text, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r receipts; mc text;
BEGIN
  IF NOT is_active_user() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO r FROM receipts WHERE id = p_receipt;
  IF NOT FOUND OR r.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  mc := money_check(r.tenant_id, ARRAY['super_admin', 'ops_manager']);
  IF mc IS NOT NULL THEN RETURN jsonb_build_object('error', mc); END IF;
  IF r.voided_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'voided'); END IF;
  IF p_path IS NULL OR left(p_path, length(p_receipt::text) + 1) <> p_receipt::text || '/' THEN RETURN jsonb_build_object('error', 'bad_path'); END IF;
  INSERT INTO receipt_extra_proofs (tenant_id, receipt_id, proof_url, note, added_by, approved_by)
  VALUES (r.tenant_id, r.id, p_path, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), auth.uid());
  PERFORM insert_audit_log('proof_document_added', 'receipts', r.id, 'receipt', jsonb_build_object('invoice_id', r.invoice_id), r.branch_id, auth.uid(), r.tenant_id);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION request_proof_change(uuid, text, text, text), decide_proof_request(uuid, boolean, text), withdraw_proof_request(uuid), add_receipt_proof(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_proof_change(uuid, text, text, text), decide_proof_request(uuid, boolean, text), withdraw_proof_request(uuid), add_receipt_proof(uuid, text, text) TO authenticated;

-- a proof file that anything points to cannot be deleted from storage (only a file nothing refers to yet, such as a failed upload)
CREATE OR REPLACE FUNCTION proof_path_in_use(p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM receipts WHERE proof_url = p_name)
      OR EXISTS (SELECT 1 FROM receipt_proof_history WHERE proof_url = p_name)
      OR EXISTS (SELECT 1 FROM receipt_extra_proofs WHERE proof_url = p_name)
      OR EXISTS (SELECT 1 FROM proof_requests WHERE path = p_name AND status IN ('pending', 'approved'))
      OR EXISTS (SELECT 1 FROM payment_proof_submissions WHERE storage_path = p_name)
$$;
DROP POLICY IF EXISTS auth_users_delete_payment_proofs ON storage.objects;
CREATE POLICY auth_users_delete_payment_proofs ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-proofs' AND storage_payment_proofs_tenant_ok(name) AND NOT proof_path_in_use(name));
