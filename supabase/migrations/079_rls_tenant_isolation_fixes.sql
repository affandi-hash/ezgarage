-- 079: Multi-tenant SaaS readiness — close remaining RLS gaps found during
-- the full audit (the anon-exploitable RPCs were already fixed in 078).
-- None of these are unauthenticated-exploitable; all require a valid
-- `authenticated` session from ANY tenant to cross into another tenant's
-- data. Still real bugs the moment a second tenant exists.

-- ── 1. users: cross-tenant staff-directory leak ─────────────────────────
-- Migration 031 added a blanket `USING(true)` SELECT policy that ORs with
-- the correct tenant-scoped one, defeating it entirely. Drop the open one;
-- users_select (tenant_id = get_my_tenant() OR super_admin) remains.
DROP POLICY IF EXISTS "authenticated users can read user profiles" ON users;

-- ── 2. status_change_requests: cross-tenant approve/reject ──────────────
-- scr_select/scr_update/scr_insert let any ops_manager/foreman/super_admin
-- act on ANY tenant's requests — the role-based OR branch had no tenant
-- condition at all.
DROP POLICY IF EXISTS scr_select ON status_change_requests;
CREATE POLICY scr_select ON status_change_requests FOR SELECT TO authenticated
  USING (
    (branch_id = get_my_branch())
    OR (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman']) AND tenant_id = get_my_tenant())
  );

DROP POLICY IF EXISTS scr_update ON status_change_requests;
CREATE POLICY scr_update ON status_change_requests FOR UPDATE TO authenticated
  USING (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman']) AND tenant_id = get_my_tenant());

DROP POLICY IF EXISTS scr_insert ON status_change_requests;
CREATE POLICY scr_insert ON status_change_requests FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_my_tenant()
    AND ((branch_id = get_my_branch()) OR (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])))
  );

-- ── 3. job_photos: regression from migration 017 ────────────────────────
-- Migration 014 tenant-scoped this table; 017_job_photos_storage.sql
-- silently recreated select/insert/delete without the tenant check
-- (job_photos_update already has it correctly).
DROP POLICY IF EXISTS job_photos_select ON job_photos;
CREATE POLICY job_photos_select ON job_photos FOR SELECT TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND ((branch_id = get_my_branch()) OR (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])))
  );

DROP POLICY IF EXISTS job_photos_insert ON job_photos;
CREATE POLICY job_photos_insert ON job_photos FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_my_tenant()
    AND ((branch_id = get_my_branch()) OR (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])))
  );

DROP POLICY IF EXISTS job_photos_delete ON job_photos;
CREATE POLICY job_photos_delete ON job_photos FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND ((branch_id = get_my_branch()) OR (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])))
  );

-- ── 4. Eight tables with fully open USING(true)/WITH CHECK(true) ────────
-- Any authenticated user of ANY tenant currently has full read/write on
-- all of these, project-wide.
DROP POLICY IF EXISTS receipts_rw ON receipts;
CREATE POLICY receipts_tenant_rw ON receipts FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant())
  WITH CHECK (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS labour_charges_rw ON labour_charges;
CREATE POLICY labour_charges_tenant_rw ON labour_charges FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant())
  WITH CHECK (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS parts_catalogue_rw ON parts_catalogue;
CREATE POLICY parts_catalogue_tenant_rw ON parts_catalogue FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant())
  WITH CHECK (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS stock_movements_rw ON stock_movements;
CREATE POLICY stock_movements_tenant_rw ON stock_movements FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant())
  WITH CHECK (tenant_id = get_my_tenant());

DROP POLICY IF EXISTS suppliers_rw ON suppliers;
CREATE POLICY suppliers_tenant_rw ON suppliers FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant())
  WITH CHECK (tenant_id = get_my_tenant());

-- doc_number_counters / job_number_counters have no tenant_id column
-- (keyed by branch_id) — scope via the branch's tenant. These are only
-- ever touched by the SECURITY DEFINER generate_*_number() functions
-- (owned by postgres, which bypasses RLS), so tightening this only closes
-- direct-table access — it does not affect document numbering.
DROP POLICY IF EXISTS doc_counters_rw ON doc_number_counters;
CREATE POLICY doc_counters_tenant_rw ON doc_number_counters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = doc_number_counters.branch_id AND b.tenant_id = get_my_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = doc_number_counters.branch_id AND b.tenant_id = get_my_tenant()));

DROP POLICY IF EXISTS job_counters_rw ON job_number_counters;
CREATE POLICY job_counters_tenant_rw ON job_number_counters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = job_number_counters.branch_id AND b.tenant_id = get_my_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = job_number_counters.branch_id AND b.tenant_id = get_my_tenant()));

-- webhook_debug_log: raw RaudhahPay webhook bodies, no tenant/branch
-- column at all (can't be tenant-scoped). No legitimate reason for any
-- staff member to read this from the client — it exists purely for us to
-- debug the webhook edge function. Restrict to service_role only.
DROP POLICY IF EXISTS webhook_debug_log_rw ON webhook_debug_log;
CREATE POLICY webhook_debug_log_service_only ON webhook_debug_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 5. workshop_rules: insert/update/delete missing tenant condition ────
DROP POLICY IF EXISTS workshop_rules_insert ON workshop_rules;
CREATE POLICY workshop_rules_insert ON workshop_rules FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

DROP POLICY IF EXISTS workshop_rules_update ON workshop_rules;
CREATE POLICY workshop_rules_update ON workshop_rules FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

DROP POLICY IF EXISTS workshop_rules_delete ON workshop_rules;
CREATE POLICY workshop_rules_delete ON workshop_rules FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

-- ── 6. attendance_records: duplicate legacy policies ────────────────────
-- attendance_insert/attendance_read/attendance_update predate the proper
-- attendance_records_* policies and let any staff member (no role check)
-- edit any colleague's clock record within their own branch. Superseded —
-- drop them.
DROP POLICY IF EXISTS attendance_insert ON attendance_records;
DROP POLICY IF EXISTS attendance_read ON attendance_records;
DROP POLICY IF EXISTS attendance_update ON attendance_records;
