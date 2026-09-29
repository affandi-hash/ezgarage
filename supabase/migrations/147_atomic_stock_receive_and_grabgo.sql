-- Fixes two related bugs found in a code audit:
--
-- 1. InventoryPage.tsx's stock-receive flow did `update parts_requests set
--    status='received'` then a SEPARATE `update parts_catalogue set stock_qty
--    = <client-read value> + qty`. A failure between those two calls (or a
--    concurrent receive of the same catalogue part) leaves stock silently
--    wrong forever -- the same non-atomic insert-then-update shape that
--    already produced a real orphaned RM1,181 receipt on an invoice
--    elsewhere in this app. The read-then-write on stock_qty was also a
--    race: two people receiving the same part at once could clobber each
--    other's update.
--
-- 2. InventoryPage.tsx's copy of buildCatalogueUpdate read `part.unit_price`
--    to set parts_catalogue.cost_price, but parts_requests has no
--    unit_price column (it's cost_price) -- so cost_price was NEVER updated
--    when receiving stock via the Inventory page, silently going stale and
--    feeding wrong numbers into the COGS/Gross Profit calculations
--    elsewhere in the app. PartsPage.tsx's own separate copy of the same
--    helper already did this correctly, so the two duplicated
--    implementations had silently diverged.
--
-- receive_stock_request() replaces both pages' buildCatalogueUpdate +
-- separate status/stock updates with one atomic function using a real SQL
-- increment (stock_qty = stock_qty + p_qty), not a client-computed value.

CREATE OR REPLACE FUNCTION public.receive_stock_request(
  p_request_id uuid,
  p_qty integer,
  p_catalogue_part_id uuid DEFAULT NULL,
  p_new_catalogue_name text DEFAULT NULL,
  p_new_catalogue_part_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant uuid;
  v_request RECORD;
  v_catalogue_id uuid;
  v_new_stock int;
BEGIN
  v_tenant := get_my_tenant();
  IF v_tenant IS NULL THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT id, branch_id, status, cost_price, selling_price, supplier, catalogue_part_id
    INTO v_request
    FROM parts_requests
   WHERE id = p_request_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;
  IF v_request.status = 'received' THEN
    RETURN json_build_object('error', 'already_received');
  END IF;

  v_catalogue_id := COALESCE(p_catalogue_part_id, v_request.catalogue_part_id);

  IF v_catalogue_id IS NULL THEN
    IF p_new_catalogue_name IS NULL OR trim(p_new_catalogue_name) = '' THEN
      RETURN json_build_object('error', 'catalogue_part_required');
    END IF;
    INSERT INTO parts_catalogue (name, part_number, stock_qty, tenant_id, branch_id, is_active)
    VALUES (trim(p_new_catalogue_name), NULLIF(trim(p_new_catalogue_part_number), ''), 0, v_tenant, v_request.branch_id, true)
    RETURNING id INTO v_catalogue_id;
  END IF;

  IF p_qty <> 0 THEN
    UPDATE parts_catalogue
       SET stock_qty = stock_qty + p_qty,
           cost_price = COALESCE(v_request.cost_price, cost_price),
           selling_price = COALESCE(v_request.selling_price, selling_price),
           supplier_id = COALESCE(supplier_id, (SELECT id FROM suppliers WHERE name = v_request.supplier AND tenant_id = v_tenant LIMIT 1)),
           updated_at = now()
     WHERE id = v_catalogue_id AND tenant_id = v_tenant
     RETURNING stock_qty INTO v_new_stock;

    IF NOT FOUND THEN
      RETURN json_build_object('error', 'catalogue_not_found');
    END IF;
  ELSE
    SELECT stock_qty INTO v_new_stock FROM parts_catalogue WHERE id = v_catalogue_id;
  END IF;

  UPDATE parts_requests
     SET status = 'received',
         catalogue_part_id = v_catalogue_id,
         received_at = now(),
         updated_at = now()
   WHERE id = p_request_id;

  RETURN json_build_object('success', true, 'catalogue_part_id', v_catalogue_id, 'new_stock_qty', v_new_stock);
END;
$function$;

-- record_grab_go() replaces PartsPage.tsx's three separate, un-transacted
-- writes (stock_qty read-then-write, parts_requests insert, stock_movements
-- insert) with one atomic function. The stock decrement is a real SQL
-- decrement under a row lock, not a client-computed value, so two
-- concurrent Grab & Go's on the same part can no longer race and lose an
-- update; a failure partway through can no longer leave stock decremented
-- with no request/audit row (or vice versa).
CREATE OR REPLACE FUNCTION public.record_grab_go(
  p_catalogue_part_id uuid,
  p_qty integer,
  p_job_id uuid DEFAULT NULL,
  p_selling_price numeric DEFAULT NULL,
  p_supplier_name text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_user uuid;
  v_user_name text;
  v_cat RECORD;
  v_qty_before int;
  v_qty_after int;
  v_request_id uuid;
BEGIN
  v_tenant := get_my_tenant();
  v_branch := get_my_branch();
  v_user := auth.uid();
  IF v_tenant IS NULL THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT full_name INTO v_user_name FROM users WHERE id = v_user;

  SELECT id, name, part_number, stock_qty, selling_price, cost_price
    INTO v_cat
    FROM parts_catalogue
   WHERE id = p_catalogue_part_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;
  v_qty_before := v_cat.stock_qty;

  UPDATE parts_catalogue
     SET stock_qty = stock_qty - p_qty, updated_at = now()
   WHERE id = p_catalogue_part_id
   RETURNING stock_qty INTO v_qty_after;

  INSERT INTO parts_requests (
    branch_id, tenant_id, catalogue_part_id, part_name, part_number,
    quantity, ordered_qty, status, ordered_at, received_at, installed_at,
    urgency, notes, requested_by, job_id, selling_price, cost_price, supplier
  ) VALUES (
    v_branch, v_tenant, p_catalogue_part_id, v_cat.name, v_cat.part_number,
    p_qty, p_qty, 'installed', now(), now(), now(),
    'normal', COALESCE(NULLIF(trim(p_notes), ''), 'Grab & Go'), v_user, p_job_id,
    COALESCE(p_selling_price, v_cat.selling_price), v_cat.cost_price, NULLIF(trim(p_supplier_name), '')
  )
  RETURNING id INTO v_request_id;

  INSERT INTO stock_movements (
    tenant_id, branch_id, catalogue_part_id, movement_type, qty_change,
    qty_before, qty_after, parts_request_id, job_id, done_by, notes
  ) VALUES (
    v_tenant, v_branch, p_catalogue_part_id, 'grab_go_out', -p_qty,
    v_qty_before, v_qty_after, v_request_id, p_job_id, v_user_name, NULLIF(trim(p_notes), '')
  );

  RETURN json_build_object('success', true, 'new_stock_qty', v_qty_after, 'request_id', v_request_id);
END;
$function$;
