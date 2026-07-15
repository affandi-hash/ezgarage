-- 080: Tenant-scope storage bucket RLS. Every non-public bucket's policy
-- so far only checked `bucket_id` — never WHO the file actually belongs
-- to — so any authenticated user of ANY tenant could read/overwrite
-- another tenant's uploaded files by guessing or enumerating paths, fully
-- bypassing the tenant scoping already enforced on the owning table.
--
-- Fix: one helper per bucket that maps the leading path segment (the ID
-- convention each upload already uses) back to a tenant, then rewrite
-- each bucket's policies to require it. Also flips attendance-selfies and
-- expense-docs from `public` to private (they were readable by anyone on
-- the internet with no login at all, tenant question aside).

CREATE OR REPLACE FUNCTION storage_job_photos_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = (split_part(p_name, '/', 1))::uuid
      AND b.tenant_id = get_my_tenant()
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION storage_payment_proofs_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM receipts r
    WHERE r.id = (split_part(p_name, '/', 1))::uuid
      AND r.tenant_id = get_my_tenant()
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION storage_supplier_invoices_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM supplier_invoices si
    WHERE si.id = (split_part(p_name, '/', 1))::uuid
      AND si.tenant_id = get_my_tenant()
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION storage_attendance_selfies_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM staff_profiles sp
    WHERE sp.id = (split_part(p_name, '/', 1))::uuid
      AND sp.tenant_id = get_my_tenant()
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION storage_expense_docs_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN split_part(p_name, '/', 1) = get_my_tenant()::text;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION storage_portal_uploads_tenant_ok(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = (split_part(p_name, '/', 1))::uuid
      AND j.tenant_id = get_my_tenant()
  );
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

-- ── job-photos ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_users_read_job_photos" ON storage.objects;
CREATE POLICY "auth_users_read_job_photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-photos' AND storage_job_photos_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_upload_job_photos" ON storage.objects;
CREATE POLICY "auth_users_upload_job_photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-photos' AND storage_job_photos_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_delete_job_photos" ON storage.objects;
CREATE POLICY "auth_users_delete_job_photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-photos' AND storage_job_photos_tenant_ok(name));

-- ── payment-proofs ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_users_read_payment_proofs" ON storage.objects;
CREATE POLICY "auth_users_read_payment_proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND storage_payment_proofs_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_upload_payment_proofs" ON storage.objects;
CREATE POLICY "auth_users_upload_payment_proofs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND storage_payment_proofs_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_delete_payment_proofs" ON storage.objects;
CREATE POLICY "auth_users_delete_payment_proofs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-proofs' AND storage_payment_proofs_tenant_ok(name));

-- ── supplier-invoices (also drops stray legacy duplicate policies that
-- had the exact same bucket_id-only gap under different names) ──────────
DROP POLICY IF EXISTS "auth_users_read_supplier_invoices" ON storage.objects;
DROP POLICY IF EXISTS "read supplier invoices" ON storage.objects;
CREATE POLICY "auth_users_read_supplier_invoices" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'supplier-invoices' AND storage_supplier_invoices_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_upload_supplier_invoices" ON storage.objects;
DROP POLICY IF EXISTS "upload supplier invoices" ON storage.objects;
CREATE POLICY "auth_users_upload_supplier_invoices" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'supplier-invoices' AND storage_supplier_invoices_tenant_ok(name));

DROP POLICY IF EXISTS "auth_users_delete_supplier_invoices" ON storage.objects;
CREATE POLICY "auth_users_delete_supplier_invoices" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-invoices' AND storage_supplier_invoices_tenant_ok(name));

DROP POLICY IF EXISTS "update supplier invoices" ON storage.objects;
CREATE POLICY "auth_users_update_supplier_invoices" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-invoices' AND storage_supplier_invoices_tenant_ok(name));

-- ── attendance-selfies: flip private + tenant scope ──────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'attendance-selfies';

DROP POLICY IF EXISTS "authenticated users can upload selfies" ON storage.objects;
CREATE POLICY "auth_users_upload_attendance_selfies" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-selfies' AND storage_attendance_selfies_tenant_ok(name));

DROP POLICY IF EXISTS "authenticated users can view selfies" ON storage.objects;
CREATE POLICY "auth_users_read_attendance_selfies" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-selfies' AND storage_attendance_selfies_tenant_ok(name));

-- ── expense-docs: flip private + tenant scope ────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'expense-docs';

DROP POLICY IF EXISTS "auth_expense_docs" ON storage.objects;
CREATE POLICY "auth_users_rw_expense_docs" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'expense-docs' AND storage_expense_docs_tenant_ok(name))
  WITH CHECK (bucket_id = 'expense-docs' AND storage_expense_docs_tenant_ok(name));

-- ── portal-uploads: select had no tenant scope at all (insert stays open
-- to anon — that's the customer portal's own unauthenticated upload flow,
-- unavoidable there) ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "portal_uploads_select" ON storage.objects;
CREATE POLICY "portal_uploads_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'portal-uploads' AND is_active_user() AND storage_portal_uploads_tenant_ok(name));
