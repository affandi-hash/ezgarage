-- 081: fleet_vehicles has the identical global-unique-plate bug that
-- migration 076 fixed on `vehicles` — missed because it's a separate
-- table (internal company fleet, not customer vehicles). Two independent
-- tenants each running their own fleet could collide on a shared plate.
-- No data currently in the table, but fixing the schema regardless.

UPDATE fleet_vehicles
   SET plate_number = upper(regexp_replace(plate_number, '\s+', '', 'g'))
 WHERE plate_number <> upper(regexp_replace(plate_number, '\s+', '', 'g'));

ALTER TABLE fleet_vehicles DROP CONSTRAINT IF EXISTS fleet_vehicles_plate_number_key;
ALTER TABLE fleet_vehicles ADD CONSTRAINT fleet_vehicles_tenant_plate_unique UNIQUE (tenant_id, plate_number);
