-- 189: returning-customer lookup on the public ON-SITE page.
-- The caller gives a mobile number. If a customer has it, we return ONLY the first name and their vehicles with the plate
-- partly hidden (WD•••0D). No full name, email, address or full plate leaves the database. Lookups are rate limited by
-- number, by network address and overall, so numbers cannot be walked through.
CREATE TABLE IF NOT EXISTS os_lookup_log (
  id        bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  phone     text NOT NULL,
  ip        text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS os_lookup_log_at ON os_lookup_log (tenant_id, at);
ALTER TABLE os_lookup_log ENABLE ROW LEVEL SECURITY;   -- no policies: only the function below touches it

CREATE OR REPLACE FUNCTION os_lookup_returning(p_tenant_slug text, p_phone text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tid uuid := os_tenant_by_slug(p_tenant_slug); nph text := os_norm_phone(p_phone); caller_ip text := request_meta()->>'ip';
  fname text; vehicles jsonb;
BEGIN
  IF tid IS NULL THEN RETURN jsonb_build_object('error', 'tenant_not_found'); END IF;
  IF length(nph) NOT BETWEEN 8 AND 12 THEN RETURN jsonb_build_object('error', 'bad_phone'); END IF;

  DELETE FROM os_lookup_log WHERE at < now() - interval '1 day';
  IF (SELECT count(*) FROM os_lookup_log WHERE tenant_id = tid AND phone = nph AND at > now() - interval '1 hour') >= 5
     OR (caller_ip IS NOT NULL AND (SELECT count(*) FROM os_lookup_log WHERE tenant_id = tid AND ip = caller_ip AND at > now() - interval '1 hour') >= 10)
     OR (SELECT count(*) FROM os_lookup_log WHERE tenant_id = tid AND at > now() - interval '1 hour') >= 150 THEN
    RETURN jsonb_build_object('error', 'too_many');
  END IF;
  INSERT INTO os_lookup_log (tenant_id, phone, ip) VALUES (tid, nph, caller_ip);

  SELECT initcap(split_part(trim(c.full_name), ' ', 1)) INTO fname
    FROM customers c WHERE c.tenant_id = tid AND os_norm_phone(c.phone) = nph ORDER BY c.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('type', v.vehicle_type, 'make', v.make, 'model', v.model,
           'plate_hint', CASE WHEN length(p.pl) >= 5 THEN left(p.pl, 2) || repeat('•', length(p.pl) - 4) || right(p.pl, 2)
                              ELSE repeat('•', length(p.pl)) END) ORDER BY v.created_at DESC), '[]'::jsonb)
    INTO vehicles
    FROM (SELECT DISTINCT ON (upper(regexp_replace(v0.plate_number, '\s', '', 'g'))) v0.* FROM vehicles v0
           WHERE v0.tenant_id = tid AND coalesce(v0.plate_number, '') <> ''
             AND v0.customer_id IN (SELECT c2.id FROM customers c2 WHERE c2.tenant_id = tid AND os_norm_phone(c2.phone) = nph)
             AND coalesce(v0.make, '') <> '' AND coalesce(v0.model, '') <> ''
           ORDER BY upper(regexp_replace(v0.plate_number, '\s', '', 'g')), v0.created_at DESC LIMIT 6) v
    CROSS JOIN LATERAL (SELECT upper(regexp_replace(v.plate_number, '\s', '', 'g')) AS pl) p;

  RETURN jsonb_build_object('found', true, 'first_name', nullif(fname, ''), 'vehicles', vehicles);
END $$;
REVOKE ALL ON FUNCTION os_lookup_returning(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION os_lookup_returning(text, text) TO anon, authenticated;
