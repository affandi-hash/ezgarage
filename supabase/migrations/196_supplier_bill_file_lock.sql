-- 196: once a supplier bill has been paid, its Invoice File cannot be replaced or removed except by the Branch Admin (or super admin).
-- Putting a file on a bill that has none is still allowed for staff. Every replacement keeps the previous file in a history,
-- and a file in that history cannot be deleted from storage.
CREATE TABLE IF NOT EXISTS supplier_invoice_file_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  file_url            text NOT NULL,
  replaced_by         uuid,
  replaced_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_invoice_file_history_bill ON supplier_invoice_file_history (supplier_invoice_id);
ALTER TABLE supplier_invoice_file_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_invoice_file_history_select ON supplier_invoice_file_history;
CREATE POLICY supplier_invoice_file_history_select ON supplier_invoice_file_history FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'finance']));

CREATE OR REPLACE FUNCTION supplier_bill_file_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mc text;
BEGIN
  IF OLD.file_url IS NULL OR NEW.file_url IS NOT DISTINCT FROM OLD.file_url THEN RETURN NEW; END IF;
  -- a company with the stricter rules off (MAC) keeps working as before; background jobs (no signed-in user) are not blocked
  IF auth.uid() IS NOT NULL AND controls_on(OLD.tenant_id) AND (OLD.status = 'paid' OR coalesce(OLD.amount_paid, 0) > 0) THEN
    mc := money_check(OLD.tenant_id, ARRAY['super_admin']);
    IF mc IS NOT NULL THEN
      RAISE EXCEPTION 'This bill has been paid, so its file can only be replaced by the Branch Admin.' USING ERRCODE = '42501';
    END IF;
  END IF;
  INSERT INTO supplier_invoice_file_history (tenant_id, supplier_invoice_id, file_url, replaced_by) VALUES (OLD.tenant_id, OLD.id, OLD.file_url, auth.uid());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_bill_file_guard ON supplier_invoices;
CREATE TRIGGER supplier_bill_file_guard BEFORE UPDATE OF file_url ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION supplier_bill_file_guard();

CREATE OR REPLACE FUNCTION supplier_path_in_use(p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM supplier_invoice_slips WHERE file_url = p_name)
      OR EXISTS (SELECT 1 FROM supplier_invoices WHERE file_url = p_name)
      OR EXISTS (SELECT 1 FROM supplier_invoice_file_history WHERE file_url = p_name)
$$;
