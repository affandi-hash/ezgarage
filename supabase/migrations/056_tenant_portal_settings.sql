-- ============================================================
-- Migration: 056_tenant_portal_settings.sql
-- Description: Add customer portal config fields to tenants table
--              + RLS policies for tenants table
-- Created: 2026-06-28
-- ============================================================

-- Add new columns to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS google_review_link  TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number     TEXT,
  ADD COLUMN IF NOT EXISTS wati_api_key        TEXT;

-- ============================================================
-- RLS on tenants table
-- (not covered in 014 — tenants was read by helper functions only)
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Any active authenticated user can read their own tenant row
DROP POLICY IF EXISTS "tenants_select" ON tenants;
CREATE POLICY "tenants_select"
  ON tenants FOR SELECT
  TO authenticated
  USING (
    id = get_my_tenant()
    OR get_my_role() = 'super_admin'
  );

-- Only ops_manager or super_admin can update tenant settings
DROP POLICY IF EXISTS "tenants_update" ON tenants;
CREATE POLICY "tenants_update"
  ON tenants FOR UPDATE
  TO authenticated
  USING (
    is_active_user()
    AND get_my_role() IN ('super_admin', 'ops_manager')
    AND (id = get_my_tenant() OR get_my_role() = 'super_admin')
  );
