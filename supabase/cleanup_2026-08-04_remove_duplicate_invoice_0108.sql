-- One-off cleanup, not a schema migration. MVG-INV-2026-0108 was a
-- duplicate ESP fee invoice for sulaiman nasrodin (SMXMG-2026-0001),
-- created 32 minutes after the real registration invoice
-- (MVG-INV-2026-0107, paid, has a receipt) that already activated the
-- membership. Left unpaid ever since with no purpose -- fee_invoice_id
-- repointed to the real paid invoice before deleting the duplicate.

UPDATE esp_members SET fee_invoice_id = '9a1a4ae6-65d7-4102-882c-ae50d3c230d7'
 WHERE id = 'b9c0b8a3-3f73-482f-9eef-b5152fa32032';

DELETE FROM invoices WHERE invoice_number = 'MVG-INV-2026-0108';
