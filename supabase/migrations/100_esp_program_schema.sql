-- 100: Exclusive Service Partner (ESP) program -- schema.
-- Tenant-scoped feature: each garage runs its own ESP communities for its
-- own external clubs (e.g. Motoverse x Sportster Malaysia). NOT a
-- cross-tenant directory -- there is no platform-level shared list of
-- communities.
--
-- esp_communities.slug is deliberately a GLOBAL unique constraint, not
-- UNIQUE(tenant_id, slug). The public registration URL is /esp/:communitySlug
-- with no tenant segment at all, so the slug is the sole resolution key --
-- there's no second parameter to disambiguate tenants the way
-- /portal/:tenantSlug does. This mirrors the existing global uniqueness of
-- tenants.slug (014_saas_tenants.sql), just extended to communities.

CREATE TABLE IF NOT EXISTS esp_communities (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES tenants(id),
  home_branch_id                  uuid NOT NULL REFERENCES branches(id),
  name                            text NOT NULL,
  slug                            text NOT NULL,
  description                     text,
  is_active                       boolean NOT NULL DEFAULT true,

  -- Per-community configurable settings -- never hardcoded in application code.
  membership_fee                  numeric(10,2) NOT NULL DEFAULT 0 CHECK (membership_fee >= 0),
  validity_years                  integer NOT NULL DEFAULT 1 CHECK (validity_years >= 1),

  -- Discount tiers, per vehicle division. Staff picks Full-Package vs
  -- Selected-item at apply-time on an invoice/quotation -- there is no
  -- automatic detection of which rate applies (nothing in the schema
  -- distinguishes "full package" from "a la carte" service).
  car_full_package_discount_pct   numeric(5,2) NOT NULL DEFAULT 0 CHECK (car_full_package_discount_pct BETWEEN 0 AND 100),
  car_selected_item_discount_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (car_selected_item_discount_pct BETWEEN 0 AND 100),
  bike_full_package_discount_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (bike_full_package_discount_pct BETWEEN 0 AND 100),
  bike_selected_item_discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (bike_selected_item_discount_pct BETWEEN 0 AND 100),

  created_by                      uuid REFERENCES auth.users(id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT esp_communities_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_esp_communities_tenant_id ON esp_communities (tenant_id);

-- Defense-in-depth: home_branch_id must actually belong to the community's
-- own tenant, so a community can never be pointed at another tenant's branch.
CREATE OR REPLACE FUNCTION public.esp_communities_validate_branch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM branches b WHERE b.id = NEW.home_branch_id AND b.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'home_branch_id must belong to the same tenant as the community';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS esp_communities_branch_check ON esp_communities;
CREATE TRIGGER esp_communities_branch_check
  BEFORE INSERT OR UPDATE ON esp_communities
  FOR EACH ROW EXECUTE FUNCTION esp_communities_validate_branch();

DROP TRIGGER IF EXISTS trg_esp_communities_updated_at ON esp_communities;
CREATE TRIGGER trg_esp_communities_updated_at
  BEFORE UPDATE ON esp_communities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- -----------------------------------------------------------------------------
-- esp_members
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esp_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  community_id      uuid NOT NULL REFERENCES esp_communities(id) ON DELETE RESTRICT,
  customer_id       uuid NOT NULL REFERENCES customers(id),

  -- Set by trigger below; NEVER reissued on renewal.
  membership_number text NOT NULL DEFAULT '',

  status            text NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('pending_payment', 'active', 'expired', 'cancelled')),
  valid_until       date,

  -- Most recent fee invoice (registration OR renewal). A new invoice is
  -- created each cycle only if the previous one isn't still unpaid; this
  -- column just points at "the current one to pay" for the UI.
  fee_invoice_id    uuid REFERENCES invoices(id),

  registered_at     timestamptz NOT NULL DEFAULT now(),
  activated_at      timestamptz,
  created_by        uuid REFERENCES auth.users(id),  -- NULL = public self-registration; set = staff-assisted
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A customer CAN belong to more than one ESP community at once.
  CONSTRAINT esp_members_community_customer_unique UNIQUE (community_id, customer_id),
  CONSTRAINT esp_members_tenant_membership_number_unique UNIQUE (tenant_id, membership_number)
);

CREATE INDEX IF NOT EXISTS idx_esp_members_tenant_id    ON esp_members (tenant_id);
CREATE INDEX IF NOT EXISTS idx_esp_members_community_id ON esp_members (community_id);
CREATE INDEX IF NOT EXISTS idx_esp_members_customer_id  ON esp_members (customer_id);
CREATE INDEX IF NOT EXISTS idx_esp_members_status       ON esp_members (status);

DROP TRIGGER IF EXISTS trg_esp_members_updated_at ON esp_members;
CREATE TRIGGER trg_esp_members_updated_at
  BEFORE UPDATE ON esp_members
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- -----------------------------------------------------------------------------
-- Per-community-per-year membership number counter (same atomic-upsert
-- pattern as generate_doc_number() in 082_numbering_tenant_scoping.sql)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS esp_membership_counters (
  community_id uuid    NOT NULL REFERENCES esp_communities(id) ON DELETE CASCADE,
  year         text    NOT NULL,
  last_seq     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, year)
);

CREATE OR REPLACE FUNCTION public.generate_esp_membership_number(p_community_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_slug TEXT;
  v_year TEXT;
  v_seq  INTEGER;
BEGIN
  SELECT COALESCE(NULLIF(TRIM(upper(slug)), ''), 'ESP') INTO v_slug
  FROM esp_communities WHERE id = p_community_id;

  v_year := TO_CHAR(NOW(), 'YYYY');

  -- Atomic INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING -- race-safe
  -- because Postgres serializes concurrent upserts on the same
  -- (community_id, year) row via that row's own lock.
  INSERT INTO esp_membership_counters (community_id, year, last_seq)
  VALUES (p_community_id, v_year, 1)
  ON CONFLICT (community_id, year)
  DO UPDATE SET last_seq = esp_membership_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_slug || '-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_generate_esp_membership_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.membership_number IS NULL OR NEW.membership_number = '' THEN
    NEW.membership_number := generate_esp_membership_number(NEW.community_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS esp_members_number_trg ON esp_members;
CREATE TRIGGER esp_members_number_trg
  BEFORE INSERT ON esp_members
  FOR EACH ROW EXECUTE FUNCTION trg_generate_esp_membership_number();


-- -----------------------------------------------------------------------------
-- Nullable FK additions -- same pattern as 095_expenses_supplier_invoice_link.sql
-- -----------------------------------------------------------------------------

-- One member -> many vehicles: each vehicle row points back to its one ESP membership.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS esp_member_id uuid REFERENCES esp_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_esp_member_id ON vehicles (esp_member_id) WHERE esp_member_id IS NOT NULL;

-- Flags an invoice as THE membership-fee invoice for a member (registration
-- or renewal charge) -- distinct from an ordinary service invoice for an ESP
-- member's vehicle, which is instead discovered via
-- invoice.job_id -> jobs.vehicle_id -> vehicles.esp_member_id.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS esp_member_id uuid REFERENCES esp_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_esp_member_id ON invoices (esp_member_id) WHERE esp_member_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- Activation trigger -- fires whenever an ESP fee invoice flips to 'paid',
-- regardless of which path did it: the RaudhahPay webhook's plain
-- UPDATE invoices SET status='paid', OR record_payment()'s (092) identical
-- UPDATE for staff cash-fallback payments. One trigger covers both, so
-- neither the webhook nor record_payment() needs any ESP-specific code.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.esp_activate_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Early renewal doesn't forfeit remaining time: extend from
  -- GREATEST(current valid_until, today), not always from today.
  UPDATE esp_members em
     SET status       = 'active',
         valid_until  = GREATEST(COALESCE(em.valid_until, now()::date), now()::date)
                          + make_interval(years => ec.validity_years),
         activated_at = COALESCE(em.activated_at, now())
    FROM esp_communities ec
   WHERE em.id = p_member_id
     AND ec.id = em.community_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION esp_activate_member(uuid) FROM PUBLIC;
-- No GRANT to authenticated/anon -- only ever called by the trigger below,
-- which runs as SECURITY DEFINER regardless of the invoking session's role.

CREATE OR REPLACE FUNCTION public.trg_esp_activate_on_invoice_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.esp_member_id IS NOT NULL
     AND NEW.status = 'paid'
     AND (OLD.status IS DISTINCT FROM 'paid') THEN
    PERFORM esp_activate_member(NEW.esp_member_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS esp_activate_on_invoice_paid ON invoices;
CREATE TRIGGER esp_activate_on_invoice_paid
  AFTER UPDATE ON invoices
  FOR EACH ROW
  WHEN (NEW.esp_member_id IS NOT NULL)
  EXECUTE FUNCTION trg_esp_activate_on_invoice_paid();


-- -----------------------------------------------------------------------------
-- RLS -- hardened pattern from 079_rls_tenant_isolation_fixes.sql
-- (tenant_id = get_my_tenant(), no OR-super_admin-bypass)
-- -----------------------------------------------------------------------------

ALTER TABLE esp_communities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE esp_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE esp_membership_counters ENABLE ROW LEVEL SECURITY;

-- esp_communities: any active staff of the tenant can read (front_desk,
-- finance, foreman all need this for the invoice/quotation discount banner);
-- only super_admin/ops_manager can create/edit/delete community settings.
DROP POLICY IF EXISTS esp_communities_select ON esp_communities;
CREATE POLICY esp_communities_select ON esp_communities FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant());

DROP POLICY IF EXISTS esp_communities_insert ON esp_communities;
CREATE POLICY esp_communities_insert ON esp_communities FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

DROP POLICY IF EXISTS esp_communities_update ON esp_communities;
CREATE POLICY esp_communities_update ON esp_communities FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

DROP POLICY IF EXISTS esp_communities_delete ON esp_communities;
CREATE POLICY esp_communities_delete ON esp_communities FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

-- esp_members: read open to any active tenant staff (same reasoning as
-- customers/invoices); writes restricted to the roles that run the program
-- day-to-day. Real INSERTs mostly go through esp_public_register() (a
-- SECURITY DEFINER RPC that bypasses RLS as the function owner) -- these
-- policies are defense-in-depth for any future direct-table use.
DROP POLICY IF EXISTS esp_members_select ON esp_members;
CREATE POLICY esp_members_select ON esp_members FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant());

DROP POLICY IF EXISTS esp_members_insert ON esp_members;
CREATE POLICY esp_members_insert ON esp_members FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk']))
  );

DROP POLICY IF EXISTS esp_members_update ON esp_members;
CREATE POLICY esp_members_update ON esp_members FOR UPDATE TO authenticated
  USING (
    is_active_user()
    AND tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk']))
  );

DROP POLICY IF EXISTS esp_members_delete ON esp_members;
CREATE POLICY esp_members_delete ON esp_members FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

-- esp_membership_counters: only ever touched by the SECURITY DEFINER
-- generate_esp_membership_number() (bypasses RLS); restrict direct-table
-- access to staff of the owning community's tenant.
DROP POLICY IF EXISTS esp_membership_counters_rw ON esp_membership_counters;
CREATE POLICY esp_membership_counters_rw ON esp_membership_counters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM esp_communities ec WHERE ec.id = esp_membership_counters.community_id AND ec.tenant_id = get_my_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM esp_communities ec WHERE ec.id = esp_membership_counters.community_id AND ec.tenant_id = get_my_tenant()));
