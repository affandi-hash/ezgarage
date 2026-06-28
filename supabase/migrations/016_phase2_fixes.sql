-- ============================================================
-- 016: Phase 2 fixes
-- BUG-019: Prefix invoice numbers with tenant slug
-- BUG-020: Invoice INSERT/UPDATE policies scoped to branch
-- ============================================================

-- BUG-019: Replace global invoice number trigger with tenant-aware one
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  v_slug   TEXT;
  v_year   TEXT;
  v_seq    BIGINT;
BEGIN
  -- Get tenant's slug prefix (up to 3 uppercase chars, no dashes)
  SELECT UPPER(REGEXP_REPLACE(LEFT(slug, 6), '[^A-Za-z0-9]', '', 'g'))
  INTO v_slug
  FROM tenants
  WHERE id = NEW.tenant_id;

  v_slug := COALESCE(LEFT(v_slug, 3), 'INV');
  v_year := TO_CHAR(NOW(), 'YYYY');

  -- Atomic next value from sequence (safe under concurrency)
  v_seq := nextval('invoice_seq');

  NEW.invoice_number := v_slug || '-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BUG-020: Add branch_id scope to invoice write policies
-- Drop old broad policies and replace with branch-scoped ones

DROP POLICY IF EXISTS "invoices_insert"  ON invoices;
DROP POLICY IF EXISTS "invoices_update"  ON invoices;

-- INSERT: must be for own branch (ops_manager/super_admin can insert for any branch in tenant)
CREATE POLICY "invoices_insert"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_my_tenant()
    AND (
      (SELECT role FROM users WHERE id = auth.uid())
        IN ('super_admin', 'ops_manager')
      OR branch_id = get_my_branch()
    )
  );

-- UPDATE: same branch restriction
CREATE POLICY "invoices_update"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (
      (SELECT role FROM users WHERE id = auth.uid())
        IN ('super_admin', 'ops_manager')
      OR branch_id = get_my_branch()
    )
  );
