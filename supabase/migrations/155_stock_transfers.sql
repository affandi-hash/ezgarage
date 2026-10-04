-- 155: Hub -> van stock transfers. Each branch keeps its own parts_catalogue
-- row per part, so a transfer moves quantity between two rows (creating the
-- van's row on first use) and leaves a ledger entry. Without this the van's
-- stock would look like fresh purchases and the Hub's would never go down.
CREATE TABLE IF NOT EXISTS stock_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_branch_id uuid NOT NULL REFERENCES branches(id),
  to_branch_id  uuid NOT NULL REFERENCES branches(id),
  from_part_id  uuid NOT NULL REFERENCES parts_catalogue(id),
  to_part_id    uuid NOT NULL REFERENCES parts_catalogue(id),
  part_name     text NOT NULL,
  qty           int  NOT NULL CHECK (qty > 0),
  unit_cost     numeric(12,2),
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_branch_id <> to_branch_id)
);
CREATE INDEX IF NOT EXISTS stock_transfers_tenant_created ON stock_transfers (tenant_id, created_at DESC);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfers_select ON stock_transfers;
CREATE POLICY stock_transfers_select ON stock_transfers FOR SELECT TO authenticated USING (
  is_active_user() AND tenant_id = get_my_tenant()
  AND get_my_role() = ANY (ARRAY['super_admin','ops_manager','parts_admin','foreman','finance'])
);
-- no write policies: rows are created only by transfer_stock()

CREATE OR REPLACE FUNCTION transfer_stock(p_from_part_id uuid, p_to_branch_id uuid, p_qty int, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := get_my_tenant();
  src parts_catalogue; dst parts_catalogue; to_id uuid;
BEGIN
  IF NOT is_active_user() OR v_tenant IS NULL
     OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','parts_admin','foreman'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN jsonb_build_object('error', 'invalid_qty'); END IF;

  SELECT * INTO src FROM parts_catalogue WHERE id = p_from_part_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF src.branch_id = p_to_branch_id THEN RETURN jsonb_build_object('error', 'same_branch'); END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_to_branch_id AND tenant_id = v_tenant) THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;
  -- a branch-bound role may only send out of its own branch
  IF NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager'])) AND src.branch_id IS DISTINCT FROM get_my_branch() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  IF coalesce(src.stock_qty, 0) < p_qty THEN RETURN jsonb_build_object('error', 'insufficient_stock', 'available', coalesce(src.stock_qty, 0)); END IF;

  SELECT * INTO dst FROM parts_catalogue
   WHERE tenant_id = v_tenant AND branch_id = p_to_branch_id
     AND ((src.part_number IS NOT NULL AND part_number = src.part_number) OR (src.part_number IS NULL AND lower(name) = lower(src.name)))
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO parts_catalogue (tenant_id, branch_id, supplier_id, name, part_number, category, unit, stock_qty, reorder_level, cost_price, selling_price, notes, is_active, division)
    VALUES (v_tenant, p_to_branch_id, src.supplier_id, src.name, src.part_number, src.category, src.unit, 0, src.reorder_level, src.cost_price, src.selling_price, 'Created by stock transfer', true, src.division)
    RETURNING * INTO dst;
  END IF;

  UPDATE parts_catalogue SET stock_qty = stock_qty - p_qty WHERE id = src.id;
  UPDATE parts_catalogue SET stock_qty = coalesce(stock_qty, 0) + p_qty WHERE id = dst.id;
  INSERT INTO stock_transfers (tenant_id, from_branch_id, to_branch_id, from_part_id, to_part_id, part_name, qty, unit_cost, note, created_by)
  VALUES (v_tenant, src.branch_id, p_to_branch_id, src.id, dst.id, src.name, p_qty, src.cost_price, nullif(trim(p_note), ''), auth.uid());
  RETURN jsonb_build_object('ok', true, 'from_stock', src.stock_qty - p_qty, 'to_stock', coalesce(dst.stock_qty, 0) + p_qty);
END $$;

REVOKE ALL ON FUNCTION transfer_stock(uuid, uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transfer_stock(uuid, uuid, int, text) TO authenticated;
