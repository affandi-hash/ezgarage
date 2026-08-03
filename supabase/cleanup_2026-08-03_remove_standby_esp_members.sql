-- One-off cleanup, not a schema migration. Removes 4 placeholder "standby"
-- test entries (SMXMG-2026-0007/0008/0009/0010) to free up the 0001-0012
-- range for Sportster Malaysia's committee. Each has zero jobs, zero
-- receipts, and its vehicle/customer exist only for this throwaway
-- registration -- safe to fully delete the whole chain, unlike the earlier
-- cleanup where a shared customer had a real job attached.

DELETE FROM esp_members WHERE id IN (
  '2046189d-fef0-4747-b439-67fb648a132d', -- SMXMG-2026-0007 "standby 07"
  '906d4f45-286f-488d-93d4-27702cbc40a2', -- SMXMG-2026-0008 "stanby 008"
  'a009050f-1238-4d7a-b9b2-3179cbeed26d', -- SMXMG-2026-0009 "stanby 009"
  'b3f90b34-9d80-4296-bbb7-0729bb0ce7f6'  -- SMXMG-2026-0010 "standby 10"
);

DELETE FROM invoices WHERE id IN (
  'e2b1aedf-18ef-4c9d-88bf-0da33175ef53',
  '2a0d3c2a-54ea-47f6-8eb8-86c57fd8ecac',
  '82444981-c1c6-417e-8799-72b004552a43',
  'c7b1f99f-d111-4c37-972e-ca14a32509ca'
);

DELETE FROM vehicles WHERE customer_id IN (
  '45f8ac59-ad4a-4c6f-8a41-0dbcebbc5ad3',
  '6373b352-1263-4353-8a23-e46445c34a18',
  '44795b80-1cd7-409e-9250-752f760ac319',
  '6b38e5a1-4498-46fb-b89e-eeab4aab1bed'
);

DELETE FROM customers WHERE id IN (
  '45f8ac59-ad4a-4c6f-8a41-0dbcebbc5ad3',
  '6373b352-1263-4353-8a23-e46445c34a18',
  '44795b80-1cd7-409e-9250-752f760ac319',
  '6b38e5a1-4498-46fb-b89e-eeab4aab1bed'
);
