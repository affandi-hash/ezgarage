-- 184: Chinese-brand cars are priced as local (tier 1); the Harley-Davidson Pan America takes the Softail / Touring price.
DO $$
DECLARE t uuid; mk text;
BEGIN
  SELECT id INTO t FROM tenants WHERE slug = 'motoverse-garage';
  IF t IS NULL THEN RETURN; END IF;
  FOREACH mk IN ARRAY ARRAY['Chery', 'Haval', 'Geely', 'MG', 'Jaecoo', 'Omoda'] LOOP
    INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, model, tier)
    SELECT t, 'car', mk, NULL, 'tier1'
     WHERE NOT EXISTS (SELECT 1 FROM os_vehicle_rules r WHERE r.tenant_id = t AND r.vehicle_type = 'car' AND r.make = mk AND r.model IS NULL);
  END LOOP;
  INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, model, tier)
  SELECT t, 'bike', 'Harley-Davidson', 'Pan America', 'harley_softail'
   WHERE NOT EXISTS (SELECT 1 FROM os_vehicle_rules r WHERE r.tenant_id = t AND r.vehicle_type = 'bike' AND r.make = 'Harley-Davidson' AND r.model = 'Pan America');
END $$;
