-- Tidy vehicle make/model spelling for Motoverse Garage only (MAC Service is not touched).
-- Makes follow the names the price rules use (Harley-Davidson, Mercedes-Benz, BMW, MINI...).
-- A backup of every changed row is kept in vehicles_tidy_backup_20261022 so this can be reversed.
CREATE TABLE IF NOT EXISTS vehicles_tidy_backup_20261022 AS SELECT id, tenant_id, make, model, vehicle_type FROM vehicles WHERE false;
ALTER TABLE vehicles_tidy_backup_20261022 ENABLE ROW LEVEL SECURITY;   -- no policies: readable only with the service key

CREATE TEMP TABLE _fix ON COMMIT DROP AS
SELECT v.id, v.make AS old_make, v.model AS old_model, v.vehicle_type AS old_type,
  nm.make AS new_make, nm.model AS new_model, nm.vtype AS new_type
FROM vehicles v
CROSS JOIN LATERAL (
  SELECT
    -- make
    CASE
      WHEN lower(v.make) IN ('harley davidson', 'harley-davidson') THEN 'Harley-Davidson'
      WHEN lower(v.make) IN ('banneli', 'benelli') THEN 'Benelli'
      WHEN lower(v.make) = 'sym' THEN 'SYM'
      WHEN lower(v.make) = 'bmw' THEN 'BMW'
      WHEN lower(v.make) LIKE 'bmw 3 series%' THEN 'BMW'
      WHEN lower(v.make) LIKE 'mercedes%' THEN 'Mercedes-Benz'
      WHEN lower(v.make) = 'mini cooper' THEN 'MINI'
      WHEN lower(v.make) IN ('perouda', 'perodua', 'myvi') THEN 'Perodua'
      WHEN lower(v.make) = 'volkwagen' THEN 'Volkswagen'
      WHEN lower(v.make) = 'subaru' THEN 'Subaru'
      WHEN lower(v.make) = 'toyota' THEN 'Toyota'
      WHEN lower(v.make) = 'yamaha' THEN 'Yamaha'
      ELSE v.make
    END AS make,
    -- model
    CASE
      WHEN lower(v.make) = 'banneli' THEN regexp_replace(v.model, '^Banneli\s*', '')
      WHEN lower(v.make) LIKE 'bmw 3 series%' THEN '3 Series ' || v.model || ' E46'
      WHEN lower(v.make) = 'bmw' AND lower(v.model) = 'i7' THEN 'i7'
      WHEN lower(v.make) = 'mercedes benz c class w205' THEN 'C-Class ' || v.model || ' W205'
      WHEN lower(v.make) = 'mercedes benz e class' THEN 'E-Class ' || v.model
      WHEN lower(v.make) = 'mini cooper' THEN 'Countryman'
      WHEN lower(v.make) = 'myvi' THEN 'Myvi ' || v.model
      WHEN lower(v.make) = 'volkwagen' AND lower(v.model) = 'tiguain' THEN 'Tiguan'
      WHEN lower(v.make) = 'toyota' AND v.model = 'YARIS' THEN 'Yaris'
      WHEN lower(v.make) = 'nissan' AND lower(v.model) = 'xtrail' THEN 'X-Trail'
      WHEN lower(v.make) = 'nissan' AND lower(v.model) = 'almeera' THEN 'Almera'
      WHEN lower(v.make) = 'nissan' AND lower(v.model) = 'slphy' THEN 'Sylphy'
      WHEN lower(v.make) = 'honda' AND lower(v.model) = 'brv' THEN 'BR-V'
      WHEN lower(v.make) = 'honda' AND lower(v.model) = 'crv' THEN 'CR-V'
      WHEN lower(v.make) = 'honda' AND lower(v.model) = 'crv swa gen3' THEN 'CR-V SWA Gen3'
      WHEN lower(v.make) = 'ford' AND lower(v.model) = 'ford focus' THEN 'Focus'
      WHEN lower(v.make) = 'perodua' AND v.model = 'VIVA ELITE' THEN 'Viva Elite'
      WHEN lower(v.make) IN ('harley davidson', 'harley-davidson') AND lower(v.model) = 'fatboy' THEN 'Fat Boy'
      WHEN lower(v.make) IN ('harley davidson', 'harley-davidson') AND lower(v.model) = 'sportster 48' THEN 'Forty-Eight'
      WHEN lower(v.make) IN ('harley davidson', 'harley-davidson') AND lower(v.model) = 'low rider st' THEN 'Low Rider ST'
      WHEN lower(v.make) = 'proton' AND lower(v.model) = 'saga vvt' THEN 'Saga VVT'
      ELSE v.model
    END AS model,
    -- two bikes were saved as cars
    CASE WHEN v.vehicle_type = 'car' AND lower(v.make) IN ('harley davidson', 'yamaha') THEN 'bike' ELSE v.vehicle_type END AS vtype
) nm
WHERE v.tenant_id = (SELECT id FROM tenants WHERE slug = 'motoverse-garage')
  AND (nm.make IS DISTINCT FROM v.make OR nm.model IS DISTINCT FROM v.model OR nm.vtype IS DISTINCT FROM v.vehicle_type);

INSERT INTO vehicles_tidy_backup_20261022 SELECT v.id, v.tenant_id, v.make, v.model, v.vehicle_type FROM vehicles v JOIN _fix f ON f.id = v.id;
UPDATE vehicles v SET make = f.new_make, model = f.new_model, vehicle_type = f.new_type FROM _fix f WHERE f.id = v.id;
SELECT old_type, old_make, old_model, '->' AS "->", new_type, new_make, new_model FROM _fix ORDER BY new_make, new_model;
