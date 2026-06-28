-- 030: Allow any authenticated user to read basic profile of users in same tenant.
-- Without this, Supabase joins (e.g. assigned_mechanic:users!assigned_mechanic_id)
-- return null for roles like foreman that previously had no SELECT policy on users.

CREATE POLICY "tenant members can read staff profiles"
ON public.users
FOR SELECT
TO authenticated
USING (
  tenant_id = (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);
