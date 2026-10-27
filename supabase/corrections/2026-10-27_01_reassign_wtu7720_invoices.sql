-- Invoices MVG-INV-2026-0019 and MVG-INV-2026-0085 (vehicle WTU7720) were raised to "Motoverse Garage".
-- The vehicle belongs to Brainy Bunch Pre School Sdn Bhd, so both invoices move to that customer.
-- Only the customer name/contact changes: totals, status, items and payments are untouched.
DO $$
DECLARE
  from_c uuid := 'a56151c2-a099-4765-9bef-c7475e7621d4';
  to_c   uuid := '539d9abd-1941-41e7-86a5-f76ca93b9ec9';
  c customers; i invoices;
BEGIN
  SELECT * INTO c FROM customers WHERE id = to_c;
  FOR i IN SELECT * FROM invoices WHERE invoice_number IN ('MVG-INV-2026-0019', 'MVG-INV-2026-0085') AND customer_id = from_c LOOP
    UPDATE invoices SET customer_id = c.id, customer_name = c.full_name, customer_phone = c.phone, customer_email = c.email WHERE id = i.id;
    PERFORM insert_audit_log('invoice_customer_corrected', 'Invoice', i.id, 'invoice',
      jsonb_build_object('invoice_number', i.invoice_number, 'from_customer', i.customer_name, 'to_customer', c.full_name,
                         'old_phone', i.customer_phone, 'new_phone', c.phone, 'reason', 'Vehicle WTU7720 belongs to Brainy Bunch Pre School; raised to the wrong customer'),
      i.branch_id, NULL, i.tenant_id);
  END LOOP;
END $$;
SELECT invoice_number, status, customer_name, customer_phone, customer_email, total_amount, amount_paid FROM invoices WHERE invoice_number IN ('MVG-INV-2026-0019', 'MVG-INV-2026-0085') ORDER BY 1;
