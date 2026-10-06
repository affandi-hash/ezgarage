-- 161: add or replace the proof of payment after a payment is recorded.
-- Only ops_manager (and super_admin) may do it. A replaced proof file is kept
-- in receipt_proof_history, and the receipt records who changed it and when.
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS proof_updated_at timestamptz;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS proof_updated_by uuid;

CREATE TABLE IF NOT EXISTS receipt_proof_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  receipt_id  uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  proof_url   text NOT NULL,
  proof_bucket text,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid
);
CREATE INDEX IF NOT EXISTS receipt_proof_history_receipt ON receipt_proof_history (receipt_id);
ALTER TABLE receipt_proof_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipt_proof_history_select ON receipt_proof_history;
CREATE POLICY receipt_proof_history_select ON receipt_proof_history FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance']));

CREATE OR REPLACE FUNCTION set_receipt_proof(p_receipt_id uuid, p_path text, p_reference text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r receipts; replaced boolean := false;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO r FROM receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;
  IF r.tenant_id IS DISTINCT FROM get_my_tenant() AND get_my_role() <> 'super_admin' THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;
  IF r.voided_at IS NOT NULL THEN RETURN json_build_object('error', 'voided'); END IF;
  -- the file must live under this receipt's own folder in the bucket
  IF p_path IS NULL OR left(p_path, length(p_receipt_id::text) + 1) <> p_receipt_id::text || '/' THEN
    RETURN json_build_object('error', 'bad_path');
  END IF;

  IF r.proof_url IS NOT NULL THEN
    INSERT INTO receipt_proof_history (tenant_id, receipt_id, proof_url, proof_bucket, replaced_by)
    VALUES (r.tenant_id, r.id, r.proof_url, r.proof_bucket, auth.uid());
    replaced := true;
  END IF;
  UPDATE receipts SET proof_url = p_path, proof_bucket = 'payment-proofs',
         proof_updated_at = now(), proof_updated_by = auth.uid(),
         reference_number = coalesce(nullif(trim(p_reference), ''), reference_number)
   WHERE id = r.id;
  RETURN json_build_object('ok', true, 'replaced', replaced);
END $$;
REVOKE ALL ON FUNCTION set_receipt_proof(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_receipt_proof(uuid, text, text) TO authenticated;
