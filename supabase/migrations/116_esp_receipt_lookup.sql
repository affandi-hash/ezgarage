-- 116: EspRegistrationPage shows "Membership Active" after payment but never
-- surfaces the receipt raudhahpay-webhook already generates and stores in
-- payment-proofs/portal-uploads (receipts.proof_url) -- there was no lookup
-- path at all for a public, unauthenticated member to reach it. Both storage
-- buckets are authenticated-only (068/080/105), so this needs the same
-- pattern as portal-job-photos: a SECURITY DEFINER re-verification (mirrors
-- esp_check_status's exact phone-match check) that returns just enough to
-- find the file, paired with an edge function using the service role to
-- actually sign the URL.

CREATE OR REPLACE FUNCTION public.esp_get_receipt(p_membership_number text, p_phone text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_member   RECORD;
  v_customer RECORD;
  v_receipt  RECORD;
BEGIN
  SELECT id, status, customer_id
    INTO v_member
    FROM esp_members
   WHERE membership_number = p_membership_number
   LIMIT 1;

  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  SELECT phone INTO v_customer FROM customers WHERE id = v_member.customer_id;
  IF NOT FOUND OR normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN json_build_object('error', 'phone_mismatch');
  END IF;

  IF v_member.status <> 'active' THEN
    RETURN json_build_object('error', 'not_active');
  END IF;

  SELECT r.id, r.proof_bucket, r.proof_url, r.amount, r.payment_date, r.payment_method, i.invoice_number
    INTO v_receipt
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
   WHERE i.esp_member_id = v_member.id
     AND r.proof_url IS NOT NULL
   ORDER BY r.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN RETURN json_build_object('error', 'no_receipt'); END IF;

  RETURN json_build_object(
    'success', true,
    'proof_bucket', v_receipt.proof_bucket,
    'proof_url', v_receipt.proof_url,
    'amount', v_receipt.amount,
    'payment_date', v_receipt.payment_date,
    'payment_method', v_receipt.payment_method,
    'invoice_number', v_receipt.invoice_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.esp_get_receipt(text, text) TO anon, authenticated;
