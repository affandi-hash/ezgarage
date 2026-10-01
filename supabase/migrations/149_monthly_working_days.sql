-- 149: Monthly working-days input, used to compute real "Absent" counts
-- on the attendance report (absent = working_days - present_days).
--
-- Public holidays and rest days differ branch to branch (different states,
-- different operating schedules), and there's no holiday-calendar concept
-- in the schema yet -- so this is a manually-entered override per
-- (branch, year, month) rather than something auto-derived.

CREATE TABLE IF NOT EXISTS monthly_working_days (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id),
  branch_id    uuid        NOT NULL REFERENCES branches(id),
  year         int         NOT NULL,
  month        int         NOT NULL CHECK (month BETWEEN 1 AND 12),
  working_days int         NOT NULL CHECK (working_days >= 0 AND working_days <= 31),
  updated_by   uuid        REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_working_days_tenant ON monthly_working_days (tenant_id);
CREATE INDEX IF NOT EXISTS idx_monthly_working_days_branch_period ON monthly_working_days (branch_id, year, month);

ALTER TABLE monthly_working_days ENABLE ROW LEVEL SECURITY;

-- Any staff member in the branch (or a tenant-wide manager) can read the
-- figure -- it's shown on the attendance report, not just to managers.
CREATE POLICY monthly_working_days_select ON monthly_working_days FOR SELECT TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND ((branch_id = get_my_branch()) OR (get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman'])))
  );

-- Only managers set it -- mirrors who can reach the Monthly Report tab /
-- edit attendance records elsewhere in this file.
CREATE POLICY monthly_working_days_insert ON monthly_working_days FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman'])
  );

CREATE POLICY monthly_working_days_update ON monthly_working_days FOR UPDATE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman'])
  )
  WITH CHECK (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman'])
  );
