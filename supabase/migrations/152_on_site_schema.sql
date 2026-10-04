-- 152: ON-SITE (mobile servicing van) schema.
--
-- A van is a branch inside the Motoverse tenant. Everything here is
-- tenant-scoped; the van's own schedule hangs off its branch. Customers book
-- through public RPCs (migration 153), never by writing these tables
-- directly: config tables are readable by staff and writable only by
-- super_admin / ops_manager, bookings are written only by the RPCs and by
-- staff updating status.

-- ── settings (one row per tenant) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  default_branch_id    uuid REFERENCES branches(id),         -- the van that receives bookings
  deposit_pct          int  NOT NULL DEFAULT 50 CHECK (deposit_pct BETWEEN 0 AND 100),
  cancel_cutoff_hours  int  NOT NULL DEFAULT 24 CHECK (cancel_cutoff_hours >= 0),
  refund_due_hours     int  NOT NULL DEFAULT 48 CHECK (refund_due_hours >= 0),
  max_reschedules      int  NOT NULL DEFAULT 2  CHECK (max_reschedules >= 0),
  booking_window_days  int  NOT NULL DEFAULT 14 CHECK (booking_window_days >= 1),
  booking_cutoff_hours int  NOT NULL DEFAULT 12 CHECK (booking_cutoff_hours >= 0),
  hold_minutes         int  NOT NULL DEFAULT 30 CHECK (hold_minutes >= 1),
  offhours_enabled     boolean NOT NULL DEFAULT true,
  offhours_surcharge   numeric(10,2) CHECK (offhours_surcharge IS NULL OR offhours_surcharge >= 0),
  auto_confirm         boolean NOT NULL DEFAULT true,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);

-- ── packages, oil-grade options, effective-dated prices ─────────────────
CREATE TABLE IF NOT EXISTS os_packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  services     text[] NOT NULL DEFAULT '{}',
  duration_min int  NOT NULL DEFAULT 60 CHECK (duration_min > 0),
  sort_order   int  NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS os_oil_grades (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES os_packages(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);

-- One row per (package, grade, tier, effective date). The price in force on a
-- date is the latest row whose effective_from <= that date. No row for a tier
-- means the package is not offered to that tier.
CREATE TABLE IF NOT EXISTS os_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_id     uuid NOT NULL REFERENCES os_packages(id) ON DELETE CASCADE,
  grade_id       uuid REFERENCES os_oil_grades(id) ON DELETE CASCADE,
  tier           text NOT NULL CHECK (tier IN ('tier1','tier2')),
  price          numeric(10,2) NOT NULL CHECK (price >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS os_prices_unique
  ON os_prices (package_id, COALESCE(grade_id, '00000000-0000-0000-0000-000000000000'::uuid), tier, effective_from);

-- make (and optionally model) -> tier. A model row beats a make row.
-- 'hub_only' means the van does not serve that vehicle.
CREATE TABLE IF NOT EXISTS os_vehicle_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL DEFAULT 'car' CHECK (vehicle_type IN ('car','bike')),
  make         text NOT NULL,
  model        text,
  tier         text NOT NULL CHECK (tier IN ('tier1','tier2','hub_only')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS os_vehicle_rules_unique
  ON os_vehicle_rules (tenant_id, vehicle_type, lower(make), COALESCE(lower(model), ''));

-- A postcode matches a zone when it starts with one of the zone's entries
-- (so '471' covers 47100-47199 and '47100' is exact).
CREATE TABLE IF NOT EXISTS os_zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  postcodes  text[] NOT NULL DEFAULT '{}',
  surcharge  numeric(10,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0),
  note       text,
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);

-- ── slots and blackouts, per van (branch) ───────────────────────────────
CREATE TABLE IF NOT EXISTS os_slots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  label      text NOT NULL,
  start_time time NOT NULL,
  end_time   time NOT NULL,
  is_open    boolean NOT NULL DEFAULT false,
  days       smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',   -- ISO weekday, Mon=1 .. Sun=7
  sort_order int NOT NULL DEFAULT 0,
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS os_blackouts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  blackout_date  date NOT NULL,
  reason         text,
  UNIQUE (branch_id, blackout_date)
);

-- ── bookings ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS os_booking_seq;

CREATE TABLE IF NOT EXISTS os_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES branches(id),
  booking_number  text NOT NULL DEFAULT ('ONS-' || lpad(nextval('os_booking_seq')::text, 5, '0')),
  token           text NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),

  status          text NOT NULL DEFAULT 'awaiting_deposit'
                  CHECK (status IN ('requested','awaiting_deposit','confirmed','en_route','arrived',
                                    'in_progress','completed','cancelled','no_show','declined','expired')),
  request_type    text NOT NULL DEFAULT 'standard' CHECK (request_type IN ('standard','special')),
  special_reason  text,
  source          text NOT NULL DEFAULT 'online',

  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_name   text NOT NULL,
  customer_phone  text NOT NULL,
  customer_email  text,
  vehicle_type    text NOT NULL DEFAULT 'car',
  vehicle_make    text,
  vehicle_model   text,
  vehicle_plate   text NOT NULL,

  tier            text,
  package_id      uuid REFERENCES os_packages(id) ON DELETE SET NULL,
  package_name    text,
  grade_id        uuid REFERENCES os_oil_grades(id) ON DELETE SET NULL,
  grade_name      text,

  address         text,
  postcode        text,
  zone_id         uuid REFERENCES os_zones(id) ON DELETE SET NULL,
  zone_name       text,
  access_notes    text,

  slot_id         uuid REFERENCES os_slots(id) ON DELETE SET NULL,
  slot_label      text,
  service_date    date,
  slot_start      time,
  slot_end        time,

  -- price snapshot: what the customer was shown and agreed to
  price_base      numeric(10,2),
  price_zone      numeric(10,2) NOT NULL DEFAULT 0,
  price_offhours  numeric(10,2) NOT NULL DEFAULT 0,
  price_total     numeric(10,2),
  deposit_amount  numeric(10,2) NOT NULL DEFAULT 0,
  invoice_id      uuid REFERENCES invoices(id) ON DELETE SET NULL,
  deposit_status  text NOT NULL DEFAULT 'unpaid'
                  CHECK (deposit_status IN ('unpaid','paid','refund_due','refunded','forfeited','none')),
  hold_expires_at timestamptz,
  reschedule_count int NOT NULL DEFAULT 0,

  technician_id   uuid REFERENCES users(id),
  confirmed_at    timestamptz,
  en_route_at     timestamptz,
  arrived_at      timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,

  -- job card
  photos_before   text[] NOT NULL DEFAULT '{}',
  photos_after    text[] NOT NULL DEFAULT '{}',
  parts_used      jsonb  NOT NULL DEFAULT '[]',
  health_check    jsonb  NOT NULL DEFAULT '[]',
  tech_notes      text,
  customer_signed_at timestamptz,
  customer_signature text,
  hub_quote_id    uuid REFERENCES quotations(id) ON DELETE SET NULL,

  -- manual refund tracking (finance)
  refund_due_at   timestamptz,
  refunded_at     timestamptz,
  refunded_by     uuid,
  refund_reference text,
  refund_proof_url text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS os_bookings_branch_date ON os_bookings (branch_id, service_date);
CREATE INDEX IF NOT EXISTS os_bookings_tenant_status ON os_bookings (tenant_id, status);
CREATE INDEX IF NOT EXISTS os_bookings_phone ON os_bookings (customer_phone);

-- One booking per slot per van per date while the booking is alive. This is
-- the guarantee that two customers can never take the same slot.
CREATE UNIQUE INDEX IF NOT EXISTS os_bookings_slot_taken
  ON os_bookings (branch_id, service_date, slot_id)
  WHERE slot_id IS NOT NULL
    AND status IN ('awaiting_deposit','requested','confirmed','en_route','arrived','in_progress','completed');

CREATE TABLE IF NOT EXISTS os_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL REFERENCES os_bookings(id) ON DELETE CASCADE,
  event       text NOT NULL,
  channel     text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp')),
  to_address  text,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS os_notifications_queue ON os_notifications (status, created_at);

CREATE OR REPLACE FUNCTION os_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS os_bookings_touch ON os_bookings;
CREATE TRIGGER os_bookings_touch BEFORE UPDATE ON os_bookings FOR EACH ROW EXECUTE FUNCTION os_touch_updated_at();
DROP TRIGGER IF EXISTS os_settings_touch ON os_settings;
CREATE TRIGGER os_settings_touch BEFORE UPDATE ON os_settings FOR EACH ROW EXECUTE FUNCTION os_touch_updated_at();

-- ── row-level security ──────────────────────────────────────────────────
-- Config tables: staff can read their tenant's, only super_admin/ops_manager write.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['os_settings','os_packages','os_oil_grades','os_prices','os_vehicle_rules','os_zones','os_slots','os_blackouts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (
      is_active_user() AND tenant_id = get_my_tenant()
      AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','finance','mechanic']))$p$, t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL TO authenticated USING (
      is_active_user() AND tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
      WITH CHECK (tenant_id = get_my_tenant() AND get_my_role() = ANY (ARRAY['super_admin','ops_manager']))$p$, t || '_write', t);
  END LOOP;
END $$;

ALTER TABLE os_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS os_bookings_select ON os_bookings;
CREATE POLICY os_bookings_select ON os_bookings FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','finance','mechanic'])
  AND ((branch_id = get_my_branch()) OR get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance']))
);
DROP POLICY IF EXISTS os_bookings_update ON os_bookings;
CREATE POLICY os_bookings_update ON os_bookings FOR UPDATE TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','mechanic'])
  AND ((branch_id = get_my_branch()) OR get_my_role() = ANY (ARRAY['super_admin','ops_manager']))
) WITH CHECK (
  tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','mechanic'])
);
-- no INSERT/DELETE policy: bookings are created by the RPCs (SECURITY DEFINER).

ALTER TABLE os_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS os_notifications_select ON os_notifications;
CREATE POLICY os_notifications_select ON os_notifications FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','foreman','front_desk','finance'])
);

-- ── seed for the Motoverse tenant (all editable on the Settings page) ───
DO $$
DECLARE
  v_tenant uuid; v_van uuid; v_pkg uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'motoverse-garage';
  IF v_tenant IS NULL THEN RETURN; END IF;
  SELECT id INTO v_van FROM branches WHERE tenant_id = v_tenant AND name = 'ON-SITE Van 1';

  INSERT INTO os_settings (tenant_id, default_branch_id) VALUES (v_tenant, v_van)
  ON CONFLICT (tenant_id) DO NOTHING;

  IF v_van IS NOT NULL AND NOT EXISTS (SELECT 1 FROM os_slots WHERE branch_id = v_van) THEN
    INSERT INTO os_slots (tenant_id, branch_id, label, start_time, end_time, is_open, sort_order) VALUES
      (v_tenant, v_van, '9am - 11am',  '09:00', '11:00', false, 1),
      (v_tenant, v_van, '11am - 1pm',  '11:00', '13:00', true,  2),
      (v_tenant, v_van, '2pm - 4pm',   '14:00', '16:00', true,  3),
      (v_tenant, v_van, '4pm - 6pm',   '16:00', '18:00', false, 4);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM os_packages WHERE tenant_id = v_tenant) THEN
    INSERT INTO os_packages (tenant_id, name, description, services, sort_order, is_active)
    VALUES (v_tenant, 'Engine lube', 'Engine oil and oil filter change at your location.', ARRAY['engine_lube'], 1, true)
    RETURNING id INTO v_pkg;
    INSERT INTO os_prices (tenant_id, package_id, tier, price, effective_from) VALUES (v_tenant, v_pkg, 'tier1', 379.00, current_date);

    INSERT INTO os_packages (tenant_id, name, description, services, sort_order, is_active)
    VALUES (v_tenant, 'Gearbox lube', 'Gearbox fluid change at your location.', ARRAY['gearbox_lube'], 2, false);
    INSERT INTO os_packages (tenant_id, name, description, services, sort_order, is_active)
    VALUES (v_tenant, 'Engine + gearbox lube', 'Engine oil, oil filter and gearbox fluid in one visit.', ARRAY['engine_lube','gearbox_lube'], 3, false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM os_zones WHERE tenant_id = v_tenant) THEN
    INSERT INTO os_zones (tenant_id, name, postcodes, surcharge, note, sort_order)
    VALUES (v_tenant, 'Puchong', ARRAY['471'], 0, 'Starter zone: edit the postcode list to match where the van really goes.', 1);
  END IF;

  INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, tier)
  SELECT v_tenant, 'car', m, 'tier1' FROM unnest(ARRAY['Perodua','Proton','Toyota','Honda','Nissan','Mazda','Mitsubishi','Hyundai','Kia','Suzuki','Isuzu']) AS m
  ON CONFLICT DO NOTHING;
  INSERT INTO os_vehicle_rules (tenant_id, vehicle_type, make, tier)
  SELECT v_tenant, 'car', m, 'tier2' FROM unnest(ARRAY['BMW','Mercedes-Benz','Volkswagen','MINI','Volvo']) AS m
  ON CONFLICT DO NOTHING;
END $$;
