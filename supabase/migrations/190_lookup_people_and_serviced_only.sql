-- 190: the returning-customer lookup skips companies and corporate records that share a number, and only offers vehicles that
-- have been serviced or booked (cars registered under a number but never serviced no longer show).
CREATE OR REPLACE FUNCTION os_is_company(p_name text, p_type text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_type, '') = 'corporate' OR coalesce(p_name, '') ~* '(\msdn\M|\mbhd\M|\mberhad\M|\menterprise\M|\mtrading\M|\mresources\M|\mplt\M|\mcorporation\M|\mltd\M|\mholdings\M)'
$$;

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

  -- people only: a company that shares the number (or a corporate record) is not "you"
  SELECT initcap(split_part(trim(c.full_name), ' ', 1)) INTO fname
    FROM customers c WHERE c.tenant_id = tid AND os_norm_phone(c.phone) = nph AND os_is_company(c.full_name, c.customer_type) = false
   ORDER BY c.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  -- only vehicles that have actually been serviced or booked, so cars registered under the same number but never serviced do not show
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', v.vehicle_type, 'make', v.make, 'model', v.model,
           'plate_hint', CASE WHEN length(p.pl) >= 5 THEN left(p.pl, 2) || repeat('•', length(p.pl) - 4) || right(p.pl, 2)
                              ELSE repeat('•', length(p.pl)) END) ORDER BY v.created_at DESC), '[]'::jsonb)
    INTO vehicles
    FROM (SELECT DISTINCT ON (upper(regexp_replace(v0.plate_number, '\s', '', 'g'))) v0.* FROM vehicles v0
           WHERE v0.tenant_id = tid AND coalesce(v0.plate_number, '') <> ''
             AND v0.customer_id IN (SELECT c2.id FROM customers c2 WHERE c2.tenant_id = tid AND os_norm_phone(c2.phone) = nph AND os_is_company(c2.full_name, c2.customer_type) = false)
             AND coalesce(v0.make, '') <> '' AND coalesce(v0.model, '') <> ''
             AND (EXISTS (SELECT 1 FROM jobs j WHERE j.vehicle_id = v0.id) OR EXISTS (SELECT 1 FROM os_bookings b WHERE b.vehicle_id = v0.id))
           ORDER BY upper(regexp_replace(v0.plate_number, '\s', '', 'g')), v0.created_at DESC LIMIT 6) v
    CROSS JOIN LATERAL (SELECT upper(regexp_replace(v.plate_number, '\s', '', 'g')) AS pl) p;

  RETURN jsonb_build_object('found', true, 'first_name', nullif(fname, ''), 'vehicles', vehicles);
END $$;
REVOKE ALL ON FUNCTION os_lookup_returning(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION os_lookup_returning(text, text) TO anon, authenticated;
