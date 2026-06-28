-- 020: Make branches.location nullable
-- Original schema (001) had location NOT NULL, but SaaS signup RPC
-- does not collect a location value — address/city fields are used instead.

ALTER TABLE branches ALTER COLUMN location DROP NOT NULL;
