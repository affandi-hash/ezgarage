-- 073: Fix bookings_anon_insert — its EXISTS subquery against `branches`
-- was blocked by branches' own RLS (anon has no SELECT policy on branches
-- since 072 closed the open leak), so every anon insert failed with
-- "new row violates row-level security policy". Route the check through a
-- SECURITY DEFINER helper, same pattern as resolve_portal_tenant, so it can
-- read branches regardless of the caller's RLS visibility.

CREATE OR REPLACE FUNCTION branch_belongs_to_active_tenant(p_branch_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM branches
     WHERE id = p_branch_id
       AND tenant_id = p_tenant_id
       AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION branch_belongs_to_active_tenant(UUID, UUID) TO anon, authenticated;

DROP POLICY IF EXISTS bookings_anon_insert ON bookings;

CREATE POLICY bookings_anon_insert ON bookings FOR INSERT TO anon
WITH CHECK (
  source = 'online'
  AND tenant_id IS NOT NULL
  AND branch_belongs_to_active_tenant(branch_id, tenant_id)
);
