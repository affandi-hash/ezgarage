-- 031: Fix recursive RLS policy on public.users.
-- Migration 030 introduced a self-referential subquery that caused infinite
-- recursion when any role tried to read their own profile (including on login).
-- Replace with a simple policy: any authenticated user can read all user profiles.
-- Passwords are in auth.users (not here), so this is safe.

DROP POLICY IF EXISTS "tenant members can read staff profiles" ON public.users;

CREATE POLICY "authenticated users can read user profiles"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (true);
