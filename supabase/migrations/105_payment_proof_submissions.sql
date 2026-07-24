-- 105: Customer portal "Upload Proof of Payment" (PaymentUpload in
-- CustomerPortalPage.tsx) uploads straight to the portal-uploads bucket and
-- stops there -- no insert anywhere, no invoice_id captured, so staff have
-- zero way to discover the file short of browsing Supabase Storage by
-- hand. This adds a proper submission queue plus the RPC the (still
-- unauthenticated) portal calls right after its storage upload succeeds.

CREATE TABLE payment_proof_submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  branch_id          uuid NOT NULL,
  invoice_id         uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  job_id             uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id        uuid REFERENCES customers(id),
  storage_path       text NOT NULL,
  claimed_amount     numeric(10,2),
  claimed_reference  text,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  receipt_id         uuid REFERENCES receipts(id),
  rejection_reason   text,
  reviewed_by        uuid REFERENCES auth.users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_proof_submissions_tenant_status_idx ON payment_proof_submissions (tenant_id, status);

-- Enforces "at most one pending submission per invoice" at the DB level too
-- -- submit_payment_proof() below already resumes the existing pending row
-- itself, but this partial unique index is the belt-and-braces guarantee
-- against a race between two near-simultaneous submits.
CREATE UNIQUE INDEX payment_proof_submissions_one_pending_per_invoice
  ON payment_proof_submissions (invoice_id) WHERE status = 'pending';

ALTER TABLE payment_proof_submissions ENABLE ROW LEVEL SECURITY;

-- Hardened tenant-scoped pattern (no super_admin OR-bypass -- that older
-- 014_saas_tenants.sql pattern was a known, since-fixed bug class).
CREATE POLICY "payment_proof_submissions_select" ON payment_proof_submissions
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant() AND is_active_user());

CREATE POLICY "payment_proof_submissions_update" ON payment_proof_submissions
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_my_tenant() AND is_active_user()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman'])
  )
  WITH CHECK (
    tenant_id = get_my_tenant() AND is_active_user()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk','finance','foreman'])
  );

-- Deliberately no INSERT policy for anon/authenticated -- every insert goes
-- through submit_payment_proof() (SECURITY DEFINER), which resolves
-- tenant_id/branch_id/customer_id itself from the invoice rather than
-- trusting client-supplied ids (same rule already applied to
-- esp_public_register in migration 101).

-- Which bucket receipts.proof_url lives in. Every existing row keeps
-- reading from 'payment-proofs' exactly as before; approvals sourced from
-- a portal upload point this at 'portal-uploads' instead of copying bytes
-- between buckets.
ALTER TABLE receipts ADD COLUMN proof_bucket text NOT NULL DEFAULT 'payment-proofs';

-- -----------------------------------------------------------------------------
-- Public RPC: called by the (unauthenticated) customer portal right after
-- its existing storage.upload() to portal-uploads succeeds.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_payment_proof(
  p_job_id uuid,
  p_storage_path text,
  p_claimed_amount numeric DEFAULT NULL,
  p_claimed_reference text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice   RECORD;
  v_existing  RECORD;
  v_submission_id uuid;
BEGIN
  IF p_job_id IS NULL OR p_storage_path IS NULL OR trim(p_storage_path) = '' THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;

  -- portal-uploads' own RLS (storage_portal_uploads_tenant_ok) parses the
  -- leading path segment as a job id -- refuse anything that doesn't match
  -- what the portal's own upload code actually produces, so this RPC can
  -- never be used to register an arbitrary/forged path.
  IF split_part(p_storage_path, '/', 1) != p_job_id::text THEN
    RETURN json_build_object('error', 'path_job_mismatch');
  END IF;

  SELECT id, tenant_id, branch_id, customer_id, status
    INTO v_invoice
    FROM invoices
   WHERE job_id = p_job_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invoice_not_found');
  END IF;

  -- Soft, best-effort check only -- record_payment's own balance check at
  -- approval time is the real, race-proof gate.
  IF v_invoice.status = 'paid' THEN
    RETURN json_build_object('error', 'invoice_already_paid');
  END IF;

  -- Resume an existing pending submission for this invoice rather than
  -- creating a duplicate row -- same "second visit resumes the pending
  -- row" pattern esp_public_register uses. Scoped to invoice_id (not
  -- job_id) since a job's invoice is the actual "one payment cycle" unit.
  SELECT * INTO v_existing
    FROM payment_proof_submissions
   WHERE invoice_id = v_invoice.id AND status = 'pending'
   LIMIT 1;

  IF FOUND THEN
    UPDATE payment_proof_submissions
       SET storage_path = p_storage_path,
           claimed_amount = p_claimed_amount,
           claimed_reference = NULLIF(trim(p_claimed_reference), '')
     WHERE id = v_existing.id
     RETURNING id INTO v_submission_id;
  ELSE
    INSERT INTO payment_proof_submissions (
      tenant_id, branch_id, invoice_id, job_id, customer_id,
      storage_path, claimed_amount, claimed_reference
    ) VALUES (
      v_invoice.tenant_id, v_invoice.branch_id, v_invoice.id, p_job_id, v_invoice.customer_id,
      p_storage_path, p_claimed_amount, NULLIF(trim(p_claimed_reference), '')
    )
    RETURNING id INTO v_submission_id;
  END IF;

  RETURN json_build_object('success', true, 'submission_id', v_submission_id);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_payment_proof(uuid, text, numeric, text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- Staff-only RPC: wraps record_payment() so "record the payment" and "mark
-- this submission reviewed" happen in one transaction -- the same
-- atomicity lesson 092_record_payment_rpc.sql already applied to
-- receipt-insert + invoice-update.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_payment_proof_submission(
  p_submission_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_reference text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission RECORD;
  v_result json;
BEGIN
  IF NOT is_active_user() THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_submission FROM payment_proof_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'submission_not_found');
  END IF;
  IF v_submission.tenant_id != get_my_tenant() THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;
  IF v_submission.status != 'pending' THEN
    RETURN json_build_object('error', 'already_reviewed');
  END IF;

  -- record_payment() re-checks role/tenant/branch/balance itself -- not
  -- duplicated here, its errors (forbidden / invalid_amount /
  -- amount_exceeds_balance) are just passed straight through.
  v_result := record_payment(v_submission.invoice_id, p_amount, p_payment_method, p_payment_date, p_reference);
  IF v_result->>'error' IS NOT NULL THEN
    RETURN v_result;
  END IF;

  UPDATE payment_proof_submissions
     SET status = 'approved',
         receipt_id = (v_result->>'receipt_id')::uuid,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = p_submission_id;

  -- Point the new receipt at the customer's original upload instead of
  -- copying bytes into payment-proofs.
  UPDATE receipts
     SET proof_url = v_submission.storage_path,
         proof_bucket = 'portal-uploads'
   WHERE id = (v_result->>'receipt_id')::uuid;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_payment_proof_submission(uuid, numeric, text, date, text) TO authenticated;
