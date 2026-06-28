const { Client } = require('pg');
const client = new Client({
  host: 'db.lgowhzdwriklgdpfdwot.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'motoversegarage123!',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

const sql = `
-- Quotations
CREATE TABLE IF NOT EXISTS quotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  quote_number    text NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  customer_name   text NOT NULL DEFAULT '',
  customer_phone  text NOT NULL DEFAULT '',
  customer_email  text,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_plate   text NOT NULL DEFAULT '',
  vehicle_make    text NOT NULL DEFAULT '',
  vehicle_model   text NOT NULL DEFAULT '',
  vehicle_year    int,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  validity_days   int NOT NULL DEFAULT 7,
  valid_until     date,
  notes           text,
  total_amount    numeric(12,2) NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  converted_to_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Quotation line items
CREATE TABLE IF NOT EXISTS quotation_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id    uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  item_type       text NOT NULL DEFAULT 'service'
                  CHECK (item_type IN ('service','part','labour','other')),
  description     text NOT NULL DEFAULT '',
  qty             numeric(10,2) NOT NULL DEFAULT 1,
  unit_price      numeric(12,2) NOT NULL DEFAULT 0,
  total           numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
  sort_order      int NOT NULL DEFAULT 0
);

-- Quote number sequence function
CREATE OR REPLACE FUNCTION generate_quote_number(p_branch_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  today_str text := to_char(now(), 'YYYYMMDD');
  seq int;
  branch_code text;
BEGIN
  SELECT COUNT(*) + 1 INTO seq
  FROM quotations
  WHERE branch_id = p_branch_id
    AND DATE(created_at) = CURRENT_DATE;
  RETURN 'QT-' || today_str || '-' || LPAD(seq::text, 4, '0');
END;
$$;

-- RLS
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_quotations" ON quotations;
CREATE POLICY "tenant_quotations" ON quotations
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "tenant_quotation_items" ON quotation_items;
CREATE POLICY "tenant_quotation_items" ON quotation_items
  USING (quotation_id IN (
    SELECT id FROM quotations
    WHERE tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
`;

client.connect()
  .then(() => client.query(sql))
  .then(() => { console.log('Quotations tables created OK'); return client.end(); })
  .catch(e => { console.error(e.message); client.end(); });
