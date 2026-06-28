-- 044: Stock movements audit table
CREATE TABLE IF NOT EXISTS stock_movements (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID,
  branch_id           UUID,
  catalogue_part_id   UUID NOT NULL REFERENCES parts_catalogue(id),
  movement_type       TEXT NOT NULL CHECK (movement_type IN ('purchase_in', 'grab_go_out', 'adjustment_in', 'adjustment_out')),
  qty_change          INTEGER NOT NULL,   -- positive = stock in, negative = stock out
  qty_before          INTEGER NOT NULL DEFAULT 0,
  qty_after           INTEGER NOT NULL DEFAULT 0,
  parts_request_id    UUID REFERENCES parts_requests(id),
  job_id              UUID,
  done_by             TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_movements_rw" ON stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
