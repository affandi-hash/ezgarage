-- 195: payment slips on supplier bills (Accounts Payable). Staff can add a slip (bank transfer screenshot, receipt) to a bill; nobody can
-- replace or delete one afterwards, and the files cannot be deleted or overwritten in storage.
CREATE TABLE IF NOT EXISTS supplier_invoice_slips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  file_url            text NOT NULL,
  note                text,
  uploaded_by         uuid,
  uploaded_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_invoice_slips_bill ON supplier_invoice_slips (supplier_invoice_id);
ALTER TABLE supplier_invoice_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_invoice_slips_select ON supplier_invoice_slips;
CREATE POLICY supplier_invoice_slips_select ON supplier_invoice_slips FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'finance', 'foreman', 'parts_admin']));
-- no insert, update or delete policy: slips are added only through add_supplier_slip() and never changed

CREATE OR REPLACE FUNCTION add_supplier_slip(p_invoice uuid, p_path text, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE si supplier_invoices;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'finance', 'parts_admin'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT * INTO si FROM supplier_invoices WHERE id = p_invoice;
  IF NOT FOUND OR si.tenant_id <> get_my_tenant() THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF si.status = 'voided' THEN RETURN jsonb_build_object('error', 'voided'); END IF;
  IF p_path IS NULL OR left(p_path, length(p_invoice::text) + 6) <> p_invoice::text || '/slip-' THEN RETURN jsonb_build_object('error', 'bad_path'); END IF;
  INSERT INTO supplier_invoice_slips (tenant_id, supplier_invoice_id, file_url, note, uploaded_by)
  VALUES (si.tenant_id, si.id, p_path, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  PERFORM insert_audit_log('supplier_slip_added', 'supplier_invoices', si.id, 'supplier_invoice',
    jsonb_build_object('invoice_number', si.invoice_number, 'total', si.total_amount), si.branch_id, auth.uid(), si.tenant_id);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION add_supplier_slip(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_supplier_slip(uuid, text, text) TO authenticated;

-- storage: a slip file (or a bill's file) that a record points to cannot be deleted; slip files cannot be overwritten
CREATE OR REPLACE FUNCTION supplier_path_in_use(p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM supplier_invoice_slips WHERE file_url = p_name)
      OR EXISTS (SELECT 1 FROM supplier_invoices WHERE file_url = p_name)
$$;
DROP POLICY IF EXISTS auth_users_delete_supplier_invoices ON storage.objects;
CREATE POLICY auth_users_delete_supplier_invoices ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-invoices' AND storage_supplier_invoices_tenant_ok(name) AND NOT supplier_path_in_use(name));
DROP POLICY IF EXISTS auth_users_update_supplier_invoices ON storage.objects;
CREATE POLICY auth_users_update_supplier_invoices ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-invoices' AND storage_supplier_invoices_tenant_ok(name) AND NOT supplier_path_in_use(name));
