-- 111: Staff-facing ESP reporting -- per-community member counts, membership
-- fee revenue collected, and discount given out on service invoices/quotations.
--
-- Fee revenue is a direct join on invoices.esp_member_id (100_esp_program_schema.sql)
-- -- that column exists specifically to mark a fee invoice (initial registration
-- or renewal, esp_renew_member creates a new one each cycle) as belonging to a
-- member, so summing paid amounts across all of a member's fee invoices is exact.
--
-- Discount given has NO direct FK -- applyEspDiscount() in InvoicesPage.tsx/
-- QuotationsPage.tsx only ever writes discount_amount on the invoice/quotation
-- row itself, so the only link back to a community is transient: via the job's
-- (or quotation's) vehicle_id -> vehicles.esp_member_id. This only reflects
-- discounts on invoices/quotations whose vehicle is STILL linked to that esp
-- member today -- acceptable for a reporting view, not meant to be an
-- immutable ledger.
--
-- member_fees/member_discounts are pre-aggregated to exactly one row per
-- member_id before being joined to esp_members -- joining two 1-to-many
-- tables to the same member row without pre-aggregating first would fan out
-- into a cross product and silently double-count one side's sum.
CREATE OR REPLACE FUNCTION public.get_esp_community_stats()
RETURNS TABLE (
  community_id uuid,
  community_name text,
  is_active boolean,
  active_members bigint,
  pending_members bigint,
  expired_members bigint,
  cancelled_members bigint,
  fees_collected numeric,
  discount_given numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  RETURN QUERY
  WITH member_fees AS (
    SELECT esp_member_id AS member_id, SUM(amount_paid) AS fees_collected
    FROM invoices
    WHERE esp_member_id IS NOT NULL AND status = 'paid'
    GROUP BY esp_member_id
  ),
  member_discounts AS (
    SELECT member_id, SUM(discount_amount) AS discount_given
    FROM (
      SELECT v.esp_member_id AS member_id, i.discount_amount
      FROM invoices i
      JOIN jobs j ON j.id = i.job_id
      JOIN vehicles v ON v.id = j.vehicle_id
      WHERE v.esp_member_id IS NOT NULL AND i.discount_amount > 0
      UNION ALL
      SELECT v.esp_member_id AS member_id, q.discount_amount
      FROM quotations q
      JOIN vehicles v ON v.id = q.vehicle_id
      WHERE v.esp_member_id IS NOT NULL AND q.discount_amount > 0
    ) combined
    GROUP BY member_id
  )
  SELECT
    c.id,
    c.name,
    c.is_active,
    COUNT(*) FILTER (WHERE m.status = 'active'),
    COUNT(*) FILTER (WHERE m.status = 'pending_payment'),
    COUNT(*) FILTER (WHERE m.status = 'expired'),
    COUNT(*) FILTER (WHERE m.status = 'cancelled'),
    COALESCE(SUM(mf.fees_collected), 0),
    COALESCE(SUM(md.discount_given), 0)
  FROM esp_communities c
  LEFT JOIN esp_members m ON m.community_id = c.id
  LEFT JOIN member_fees mf ON mf.member_id = m.id
  LEFT JOIN member_discounts md ON md.member_id = m.id
  WHERE c.tenant_id = get_my_tenant()
    AND (c.home_branch_id = get_my_branch() OR get_my_role() = 'super_admin')
  GROUP BY c.id, c.name, c.is_active
  ORDER BY c.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_esp_community_stats() TO authenticated;
