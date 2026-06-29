-- ============================================================
-- Migration: 061_jobs_rls_finance_read.sql
-- Fix: finance role could not read the jobs table, causing
--      Reports to return all-zero data for finance users.
-- ============================================================

DROP POLICY IF EXISTS "jobs_select" ON jobs;

CREATE POLICY "jobs_select"
  ON jobs FOR SELECT
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager', 'foreman', 'mechanic', 'front_desk', 'finance')
    AND (branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  );
