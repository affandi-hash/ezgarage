-- One-off cleanup, not a schema migration. Removes 2 more test dummy ESP
-- entries flagged by the user: SMXMG-2026-0005 "Muhammad Zakwan" and
-- SMXMG-2026-0034 "Reserve 005". Both have zero jobs and their vehicle/
-- customer exist only for this throwaway registration -- safe to fully
-- delete the whole chain.

DELETE FROM esp_members WHERE id IN (
  '76252027-0d66-4cd2-bfbb-fcbbb945edf5', -- SMXMG-2026-0005 "Muhammad Zakwan"
  '1d3f71c3-ddfa-4452-9189-f0623f647c88'  -- SMXMG-2026-0034 "Reserve 005"
);

DELETE FROM invoices WHERE id IN (
  'f5da8610-a74f-4e55-8167-e244d23ba909',
  '429c779f-139e-4603-867c-a8551ee8fa09'
);

DELETE FROM vehicles WHERE customer_id IN (
  'c9ed393d-a087-4334-a38a-cbff4a2775fc',
  '999a9144-93e3-40d4-8639-211090f28fd6'
);

DELETE FROM customers WHERE id IN (
  'c9ed393d-a087-4334-a38a-cbff4a2775fc',
  '999a9144-93e3-40d4-8639-211090f28fd6'
);
