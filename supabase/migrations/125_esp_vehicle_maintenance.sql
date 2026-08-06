-- 125: Vehicle Maintenance (submodule 4) for the ESP member portal.
-- Design agreed with the user: hybrid due-detection (mileage OR time,
-- whichever hits first), per-community default schedule with optional
-- per-vehicle overrides, staff manually tick items done (no fragile
-- free-text matching against jobs.service_type), "due soon" = within
-- 500km or 30 days of the limit, visible to both members and staff.

-- ── esp_maintenance_items ────────────────────────────────────────────────
-- The per-community, per-vehicle-type default schedule. Mirrors
-- esp_communities' own "never hardcoded in application code" convention --
-- staff define what their own club's bikes/cars need.
CREATE TABLE IF NOT EXISTS esp_maintenance_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  community_id  uuid NOT NULL REFERENCES esp_communities(id) ON DELETE CASCADE,
  vehicle_type  text NOT NULL CHECK (vehicle_type IN ('car', 'bike')),
  name          text NOT NULL,
  interval_km     integer CHECK (interval_km IS NULL OR interval_km > 0),
  interval_months integer CHECK (interval_months IS NULL OR interval_months > 0),
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esp_maintenance_items_needs_an_interval
    CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_esp_maintenance_items_community ON esp_maintenance_items (community_id);

-- Defense-in-depth, same shape as esp_communities_validate_branch: a
-- community's maintenance items must belong to that same community's tenant.
CREATE OR REPLACE FUNCTION public.esp_maintenance_items_validate_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM esp_communities ec WHERE ec.id = NEW.community_id AND ec.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'community_id must belong to the same tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS esp_maintenance_items_tenant_check ON esp_maintenance_items;
CREATE TRIGGER esp_maintenance_items_tenant_check
  BEFORE INSERT OR UPDATE ON esp_maintenance_items
  FOR EACH ROW EXECUTE FUNCTION esp_maintenance_items_validate_tenant();

-- ── esp_vehicle_maintenance_overrides ────────────────────────────────────
-- Optional per-vehicle deviation from the community default (e.g. a
-- touring bike that needs oil changed more often than the club's default).
CREATE TABLE IF NOT EXISTS esp_vehicle_maintenance_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES esp_maintenance_items(id) ON DELETE CASCADE,
  interval_km     integer CHECK (interval_km IS NULL OR interval_km > 0),
  interval_months integer CHECK (interval_months IS NULL OR interval_months > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esp_vehicle_maintenance_overrides_unique UNIQUE (vehicle_id, item_id),
  CONSTRAINT esp_vehicle_maintenance_overrides_needs_an_interval
    CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
);

-- ── esp_vehicle_maintenance_log ──────────────────────────────────────────
-- The tick history. This is the ONLY source of "last done" -- deliberately
-- not inferred from jobs.service_type (free text, would misfire constantly).
CREATE TABLE IF NOT EXISTS esp_vehicle_maintenance_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES esp_maintenance_items(id) ON DELETE CASCADE,
  done_at       date NOT NULL DEFAULT current_date,
  done_mileage  integer CHECK (done_mileage IS NULL OR done_mileage >= 0),
  job_id        uuid REFERENCES jobs(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esp_vmlog_vehicle_item ON esp_vehicle_maintenance_log (vehicle_id, item_id, done_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE esp_maintenance_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE esp_vehicle_maintenance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE esp_vehicle_maintenance_log       ENABLE ROW LEVEL SECURITY;

-- esp_maintenance_items: read open to any active tenant staff (front_desk
-- needs to see it at check-in); catalog edits restricted to the roles that
-- own community settings, matching esp_communities exactly.
DROP POLICY IF EXISTS esp_maintenance_items_select ON esp_maintenance_items;
CREATE POLICY esp_maintenance_items_select ON esp_maintenance_items FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant());

DROP POLICY IF EXISTS esp_maintenance_items_insert ON esp_maintenance_items;
CREATE POLICY esp_maintenance_items_insert ON esp_maintenance_items FOR INSERT TO authenticated
  WITH CHECK (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS esp_maintenance_items_update ON esp_maintenance_items;
CREATE POLICY esp_maintenance_items_update ON esp_maintenance_items FOR UPDATE TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS esp_maintenance_items_delete ON esp_maintenance_items;
CREATE POLICY esp_maintenance_items_delete ON esp_maintenance_items FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']));

-- overrides: same role set as esp_members writes (front_desk can action a
-- member's custom-interval request without needing an ops_manager).
DROP POLICY IF EXISTS esp_vmo_select ON esp_vehicle_maintenance_overrides;
CREATE POLICY esp_vmo_select ON esp_vehicle_maintenance_overrides FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant());

DROP POLICY IF EXISTS esp_vmo_insert ON esp_vehicle_maintenance_overrides;
CREATE POLICY esp_vmo_insert ON esp_vehicle_maintenance_overrides FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user() AND tenant_id = get_my_tenant()
    AND (branch_id = get_my_branch() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk'])
  );

DROP POLICY IF EXISTS esp_vmo_update ON esp_vehicle_maintenance_overrides;
CREATE POLICY esp_vmo_update ON esp_vehicle_maintenance_overrides FOR UPDATE TO authenticated
  USING (
    is_active_user() AND tenant_id = get_my_tenant()
    AND (branch_id = get_my_branch() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk'])
  );

DROP POLICY IF EXISTS esp_vmo_delete ON esp_vehicle_maintenance_overrides;
CREATE POLICY esp_vmo_delete ON esp_vehicle_maintenance_overrides FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND (branch_id = get_my_branch() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','front_desk'])
  );

-- log: same role set as jobs_update -- ticking a maintenance item done is
-- part of closing out a job, same people who can update the job itself.
DROP POLICY IF EXISTS esp_vmlog_select ON esp_vehicle_maintenance_log;
CREATE POLICY esp_vmlog_select ON esp_vehicle_maintenance_log FOR SELECT TO authenticated
  USING (is_active_user() AND tenant_id = get_my_tenant());

DROP POLICY IF EXISTS esp_vmlog_insert ON esp_vehicle_maintenance_log;
CREATE POLICY esp_vmlog_insert ON esp_vehicle_maintenance_log FOR INSERT TO authenticated
  WITH CHECK (
    is_active_user() AND tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','mechanic'])
    AND (branch_id = get_my_branch() OR get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
  );

DROP POLICY IF EXISTS esp_vmlog_delete ON esp_vehicle_maintenance_log;
CREATE POLICY esp_vmlog_delete ON esp_vehicle_maintenance_log FOR DELETE TO authenticated
  USING (
    tenant_id = get_my_tenant()
    AND get_my_role() = ANY (ARRAY['super_admin','ops_manager'])
  );

-- ── Mileage freshness: sync vehicles.current_mileage from jobs.mileage_in ──
-- jobs.mileage_in has existed since the original schema but nothing ever
-- wrote to it -- current_mileage on vehicles was only ever set once, at
-- vehicle creation. Without this, "hybrid" due-detection has no mileage
-- signal to work with. Only ever moves current_mileage forward, and only
-- when mileage_in is actually provided.
CREATE OR REPLACE FUNCTION public.sync_vehicle_mileage_from_job()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mileage_in IS NOT NULL AND NEW.vehicle_id IS NOT NULL THEN
    UPDATE vehicles
       SET current_mileage = NEW.mileage_in
     WHERE id = NEW.vehicle_id
       AND (current_mileage IS NULL OR current_mileage < NEW.mileage_in);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vehicle_mileage_from_job ON jobs;
CREATE TRIGGER trg_sync_vehicle_mileage_from_job
  AFTER INSERT OR UPDATE OF mileage_in ON jobs
  FOR EACH ROW EXECUTE FUNCTION sync_vehicle_mileage_from_job();

-- ── esp_vehicle_maintenance_status(vehicle_id) ───────────────────────────
-- The one place "due soon" / "overdue" gets computed, shared by the member
-- RPC and the staff summary RPC below so the logic can never drift between
-- the two surfaces. SECURITY INVOKER (default) -- callers must already be
-- authorized to see the vehicle row, enforced by the RLS-respecting callers
-- below, not by this function itself.
CREATE OR REPLACE FUNCTION public.esp_vehicle_maintenance_status(p_vehicle_id uuid)
RETURNS TABLE (
  item_id uuid, item_name text, interval_km integer, interval_months integer,
  last_done_at date, last_done_mileage integer,
  next_due_at date, next_due_mileage integer, status text
)
LANGUAGE sql STABLE
SET search_path TO public
AS $$
  WITH v AS (
    SELECT vh.id, vh.vehicle_type, vh.current_mileage, em.community_id, em.registered_at
      FROM vehicles vh
      JOIN esp_members em ON em.id = vh.esp_member_id
     WHERE vh.id = p_vehicle_id
  ),
  effective_items AS (
    SELECT mi.id AS item_id, mi.name,
           coalesce(ov.interval_km, mi.interval_km) AS interval_km,
           coalesce(ov.interval_months, mi.interval_months) AS interval_months
      FROM v
      JOIN esp_maintenance_items mi ON mi.community_id = v.community_id AND mi.vehicle_type = v.vehicle_type
      LEFT JOIN esp_vehicle_maintenance_overrides ov ON ov.vehicle_id = v.id AND ov.item_id = mi.id
  ),
  last_log AS (
    SELECT DISTINCT ON (l.item_id) l.item_id, l.done_at, l.done_mileage
      FROM esp_vehicle_maintenance_log l
     WHERE l.vehicle_id = p_vehicle_id
     ORDER BY l.item_id, l.done_at DESC, l.created_at DESC
  ),
  due AS (
    SELECT ei.item_id, ei.name, ei.interval_km, ei.interval_months,
           ll.done_at, ll.done_mileage,
           CASE WHEN ll.done_at IS NOT NULL AND ei.interval_months IS NOT NULL
                THEN (ll.done_at + (ei.interval_months::text || ' months')::interval)::date END AS next_due_at,
           CASE WHEN ll.done_mileage IS NOT NULL AND ei.interval_km IS NOT NULL
                THEN ll.done_mileage + ei.interval_km END AS next_due_mileage
      FROM effective_items ei
      LEFT JOIN last_log ll ON ll.item_id = ei.item_id
  )
  SELECT d.item_id, d.name, d.interval_km, d.interval_months,
         d.done_at, d.done_mileage, d.next_due_at, d.next_due_mileage,
         CASE
           WHEN d.done_at IS NULL THEN 'due_soon'  -- never recorded -- flag for attention
           WHEN (d.next_due_at IS NOT NULL AND current_date > d.next_due_at)
             OR (d.next_due_mileage IS NOT NULL AND (SELECT current_mileage FROM v) IS NOT NULL AND (SELECT current_mileage FROM v) > d.next_due_mileage)
             THEN 'overdue'
           WHEN (d.next_due_at IS NOT NULL AND d.next_due_at - current_date <= 30)
             OR (d.next_due_mileage IS NOT NULL AND (SELECT current_mileage FROM v) IS NOT NULL AND d.next_due_mileage - (SELECT current_mileage FROM v) <= 500)
             THEN 'due_soon'
           ELSE 'ok'
         END AS status
    FROM due d
   ORDER BY d.name;
$$;

-- ── esp_get_vehicle_maintenance (member-facing) ──────────────────────────
-- Same re-verify-phone+password discipline as every other public RPC in
-- this lineage (119-124) -- never trust client-side "logged in" state.
CREATE OR REPLACE FUNCTION public.esp_get_vehicle_maintenance(
  p_phone       text,
  p_password    text,
  p_vehicle_id  uuid,
  p_tenant_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_owns      boolean;
  v_items     json;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, esp_portal_password_hash INTO v_customer
    FROM customers
   WHERE tenant_id = v_tenant_id
     AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
     AND normalize_my_phone(phone) <> ''
   LIMIT 1;
  IF NOT FOUND
     OR v_customer.esp_portal_password_hash IS NULL
     OR crypt(p_password, v_customer.esp_portal_password_hash) <> v_customer.esp_portal_password_hash
  THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM vehicles v JOIN esp_members em ON em.id = v.esp_member_id
     WHERE v.id = p_vehicle_id AND em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id
  ) INTO v_owns;
  IF NOT v_owns THEN RETURN json_build_object('error', 'vehicle_not_found'); END IF;

  SELECT coalesce(json_agg(json_build_object(
           'item_id', s.item_id, 'name', s.item_name,
           'interval_km', s.interval_km, 'interval_months', s.interval_months,
           'last_done_at', s.last_done_at, 'last_done_mileage', s.last_done_mileage,
           'next_due_at', s.next_due_at, 'next_due_mileage', s.next_due_mileage,
           'status', s.status
         )), '[]'::json)
    INTO v_items
    FROM esp_vehicle_maintenance_status(p_vehicle_id) s;

  RETURN json_build_object('success', true, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_get_vehicle_maintenance(text, text, uuid, text) TO anon, authenticated;

-- ── esp_maintenance_badges_for_tenant (staff-facing) ─────────────────────
-- One call for the whole Vehicles page instead of one RPC per row.
-- SECURITY INVOKER (default): relies on the caller's own RLS to only ever
-- see ESP vehicles/items/log rows within their own tenant.
CREATE OR REPLACE FUNCTION public.esp_maintenance_badges_for_tenant()
RETURNS TABLE (vehicle_id uuid, worst_status text, headline text)
LANGUAGE sql STABLE
SET search_path TO public
AS $$
  SELECT v.id,
         CASE
           WHEN bool_or(s.status = 'overdue') THEN 'overdue'
           WHEN bool_or(s.status = 'due_soon') THEN 'due_soon'
           ELSE 'ok'
         END,
         (array_agg(s.item_name ORDER BY (s.status = 'overdue') DESC, (s.status = 'due_soon') DESC))[1]
    FROM vehicles v
    JOIN esp_members em ON em.id = v.esp_member_id
    CROSS JOIN LATERAL esp_vehicle_maintenance_status(v.id) s
   WHERE v.tenant_id = get_my_tenant()
   GROUP BY v.id
  HAVING bool_or(s.status IN ('overdue', 'due_soon'));
$$;

GRANT EXECUTE ON FUNCTION esp_maintenance_badges_for_tenant() TO authenticated;
