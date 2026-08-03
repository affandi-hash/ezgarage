-- One-off cleanup, not a schema migration. Removes 4 test ESP registrations
-- created while testing the registration/payment flow tonight. Scoped
-- strictly to the ESP membership record and its own membership-fee invoice
-- (both FKs are ON DELETE SET NULL, so nothing else is at risk) -- does NOT
-- touch customers or vehicles, since one of these (Affandi Hamza) shares a
-- customer record with a real job and 5 unrelated vehicles.

-- esp_members.fee_invoice_id references invoices(id), so esp_members must
-- go first (invoices.esp_member_id is ON DELETE SET NULL, not the reverse).
-- Captured each fee_invoice_id beforehand since it auto-nulls on the
-- invoices row the moment its esp_members row is deleted.
DELETE FROM esp_members WHERE id IN (
  '4d7f0c6c-f30a-4974-9032-c2daa0673951', -- SMXMG-2026-0001
  'ea2d3653-9ddf-4bc0-8b7f-7ecfb221a073', -- EC-2026-0002
  '4e970d33-ac77-4b56-912d-4cb277e1571e', -- SMXMG-2026-0026
  '42de6480-bb84-4980-9c5c-29f88aa52990'  -- SMXMG-2026-0030
);

DELETE FROM invoices WHERE id IN (
  '9aaa9d2a-8c33-4250-b6e8-60aa1bb014eb', -- fee invoice for SMXMG-2026-0001
  '29985baf-c000-4896-ade0-af39214c318a', -- fee invoice for EC-2026-0002
  '4fdbed69-47fb-48cf-b63b-8676b7a58bdf', -- fee invoice for SMXMG-2026-0026
  'aa89c417-9301-42d5-944a-91a9943a3200'  -- fee invoice for SMXMG-2026-0030
);
