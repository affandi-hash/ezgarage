-- 134: esp_get_receipt_paths only ever returned enough to sign a link to
-- the bare pdf-lib PDF (see raudhahpay-webhook). The portal is moving to
-- render receipts with the same ReceiptSheet design used for staff-printed
-- receipts instead, which needs the invoice and branch fields the old
-- shape never carried. Widened alongside portal-receipts (same redesign).

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

  SELECT id, full_name, esp_portal_password_hash INTO v_customer
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
           'receipt_id', r.id, 'invoice_id', r.invoice_id,
           'amount', r.amount, 'payment_date', r.payment_date, 'payment_method', r.payment_method, 'payment_reference', r.gateway_ref,
           'invoice_number', i.invoice_number, 'vehicle_plate', i.vehicle_plate,
           'status', i.status, 'subtotal', i.subtotal, 'discount_amount', i.discount_amount, 'total_amount', i.total_amount,
           'branch', json_build_object('name', b.name, 'address', b.address, 'phone', b.phone, 'email', b.email, 'logo_url', b.logo_url)
         ) ORDER BY r.created_at DESC), '[]'::json)
    INTO v_receipts
    FROM receipts r
    JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN branches b ON b.id = i.branch_id
   WHERE i.customer_id = v_customer.id AND i.tenant_id = v_tenant_id AND r.amount > 0;

  RETURN json_build_object('success', true, 'customer_name', v_customer.full_name, 'receipts', v_receipts);
END;
$$;
