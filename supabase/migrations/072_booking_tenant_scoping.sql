-- 072: Fix the public online-booking flow for multi-branch SaaS
--
-- Found while making the portal multi-tenant-safe: the branches table had a
-- fully open anon SELECT policy (`qual: true`) — OnlineBookingPage's direct
-- `supabase.from('branches').select(...)` leaked every tenant's branch list
-- to any visitor. Separately, the booking INSERT itself referenced columns
-- that don't exist on `bookings` (scheduled_at, customer_email) and never
-- set tenant_id at all — so no online booking has ever actually succeeded
-- (see the empty `select * from bookings where source='online'` result).
-- Fixing both: close the branches leak and add the columns/RPC the
-- frontend actually needs.

-- customer_email was already collected by the form but had nowhere to go.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Close the cross-tenant branches leak. Public callers now go through
-- get_portal_branches() instead of querying the table directly.
DROP POLICY IF EXISTS branches_anon_select ON branches;

CREATE OR REPLACE FUNCTION get_portal_branches(p_tenant_slug TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(json_agg(json_build_object('id', b.id, 'name', b.name, 'city', b.city) ORDER BY b.name), '[]'::json)
  FROM branches b
  WHERE b.tenant_id = resolve_portal_tenant(p_tenant_slug)
    AND b.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION get_portal_branches(TEXT) TO anon, authenticated;

-- Tighten the anon booking insert so a branch_id/tenant_id mismatch (bug or
-- otherwise) can't attach a booking to the wrong tenant.
DROP POLICY IF EXISTS bookings_anon_insert ON bookings;

CREATE POLICY bookings_anon_insert ON bookings FOR INSERT TO anon
WITH CHECK (
  source = 'online'
  AND tenant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM branches b
     WHERE b.id = bookings.branch_id
       AND b.tenant_id = bookings.tenant_id
       AND b.is_active = true
  )
);
