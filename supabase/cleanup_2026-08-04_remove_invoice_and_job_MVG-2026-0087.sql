-- One-off cleanup, not a schema migration. Removes invoice MVG-INV-2026-0102
-- and its related job MVG-2026-0087 (BNK32, delivered, unpaid, zero
-- receipts) at the user's request. Deleting the job cascades to
-- status_change_requests/job_photos/parts_requests/customer_updates rows
-- automatically (all ON DELETE CASCADE); invoices.job_id is ON DELETE SET
-- NULL, not cascade, so the invoice is deleted explicitly first.

DELETE FROM invoices WHERE id = 'f3fef00e-08c5-4f6c-83cc-f55b490976e4';
DELETE FROM jobs WHERE id = '65ff1ee8-f54b-471a-a164-4c3baee34c08';
