-- 033: Parts Catalogue and Suppliers tables for light inventory module.

CREATE TABLE IF NOT EXISTS suppliers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id),
  branch_id   UUID REFERENCES branches(id),
  name        TEXT NOT NULL,
  contact_person TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parts_catalogue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES tenants(id),
  branch_id       UUID REFERENCES branches(id),
  supplier_id     UUID REFERENCES suppliers(id),
  name            TEXT NOT NULL,
  part_number     TEXT,
  category        TEXT,
  unit            TEXT DEFAULT 'unit',
  stock_qty       INTEGER DEFAULT 0,
  reorder_level   INTEGER DEFAULT 5,
  cost_price      DECIMAL(10,2),
  selling_price   DECIMAL(10,2),
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- RLS: open read/write for authenticated users within tenant
ALTER TABLE suppliers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_catalogue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_rw"       ON suppliers       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "parts_catalogue_rw" ON parts_catalogue FOR ALL TO authenticated USING (true) WITH CHECK (true);
