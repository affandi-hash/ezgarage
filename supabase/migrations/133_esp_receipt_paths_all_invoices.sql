-- 133: esp_get_receipt_paths (120) only ever joined receipts through
-- esp_members, so it could only ever return membership-fee receipts. But
-- esp_get_billing (128) later widened the Billing tab to list EVERY
-- invoice belonging to the customer -- ESP fee invoices AND regular
-- job/service invoices (scoped by invoices.customer_id directly, not
-- esp_member_id) -- without a matching widening here. Net effect: an ESP
-- member who pays a regular service invoice online sees it listed as PAID
-- in Billing, but there was never any way to fetch a receipt for it,
-- anywhere in the portal. Rescope this function to match esp_get_billing's
-- own proven customer_id-based scope instead of the narrower esp_members
-- join, and include invoice_id so the frontend can match a receipt back to
-- a specific bill without relying on invoice_number string equality.

CREATE OR REPLACE FUNCTION public.esp_get_receipt_paths(
  p_phone       text,
  p_password    text,
  p_tenant_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_receipts  JSON;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, esp_portal_password_hash INTO v_customer
    FROM customers
   WHERE tenant_id = v_tenant_id
     AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
     AND normalize_my_phone(phone) <> ''
   LIMIT 1;
  IF NOT FOUND
     OR v_customer.esp_portal_password_hash IS NULL
     OR crypt(p_password, v_customer.esp_portal_password_hash) <> v_customer.esp_portal_password_hash
  THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  SELECT coalesce(json_agg(json_build_object(
           'receipt_id', r.id, 'invoice_id', r.invoice_id, 'proof_bucket', r.proof_bucket, 'proof_url', r.proof_url,
           'amount', r.amount, 'payment_date', r.payment_date, 'payment_method', r.payment_method,
           'invoice_number', i.invoice_number
         ) ORDER BY r.created_at DESC), '[]'::json)
    INTO v_receipts
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
   WHERE i.customer_id = v_customer.id AND i.tenant_id = v_tenant_id AND r.proof_url IS NOT NULL;

  RETURN json_build_object('success', true, 'receipts', v_receipts);
END;
$$;
