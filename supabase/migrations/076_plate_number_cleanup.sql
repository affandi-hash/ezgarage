-- 076: Normalize existing plate numbers and scope uniqueness per tenant
--
-- WorkshopBoardPage's walk-in check-in never normalized plate_number (just
-- trim+uppercase), unlike VehiclesPage which strips whitespace via
-- formatPlate() — so the Workshop Board showed inconsistent spacing
-- ("DFH6724" vs "VGF 6120") depending on which flow created the vehicle.
-- Fixed in code; this backfills existing rows to match.
--
-- Also found while checking this was safe to run: vehicles_plate_number_key
-- is a GLOBAL unique constraint on plate_number alone, not scoped to
-- tenant_id. That's a real multi-tenant-SaaS bug — two independent garage
-- businesses servicing a car with the same plate would collide. It was
-- only masked until now by this exact whitespace inconsistency (two
-- differently-spaced strings don't collide). Re-scoping it before the
-- cleanup removes that accidental masking and fixes the actual issue.

UPDATE vehicles
   SET plate_number = upper(regexp_replace(plate_number, '\s+', '', 'g'))
 WHERE plate_number <> upper(regexp_replace(plate_number, '\s+', '', 'g'));

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_plate_number_key;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_tenant_plate_unique UNIQUE (tenant_id, plate_number);
