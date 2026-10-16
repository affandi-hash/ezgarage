-- 171: one report that shows the things a fraud would leave behind, for a date range:
-- voided invoices and receipts (who, when, why), gaps in invoice numbers, jobs handed back with no invoice,
-- manual payments with no proof, changes made to issued invoices, and every deletion.
CREATE OR REPLACE FUNCTION integrity_report(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_my_tenant(); a timestamptz := p_from::timestamptz; b timestamptz := (p_to + 1)::timestamptz; res jsonb;
BEGIN
  IF NOT is_active_user() OR NOT (get_my_role() = ANY (ARRAY['super_admin','ops_manager','finance'])) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  res := jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'voided_invoices', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', l.created_at, 'invoice_number', l.details->>'invoice_number', 'reason', l.details->>'reason',
               'total', l.details->'total', 'amount_paid', l.details->'amount_paid', 'by', u.full_name, 'role', u.role) x
          FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.tenant_id = t AND l.action = 'void' AND l.module = 'invoices' AND l.created_at >= a AND l.created_at < b LIMIT 200) q), '[]'::jsonb),
    'voided_receipts', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', r.voided_at, 'invoice_number', i.invoice_number, 'amount', r.amount, 'method', r.payment_method,
               'reason', r.void_reason, 'by', u.full_name, 'role', u.role) x
          FROM receipts r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN users u ON u.id = r.voided_by
         WHERE r.tenant_id = t AND r.voided_at >= a AND r.voided_at < b LIMIT 200) q), '[]'::jsonb),
    'invoice_changes', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', l.created_at, 'invoice_number', l.details->>'invoice_number', 'old_total', l.details->'old_total',
               'new_total', l.details->'new_total', 'old_discount', l.details->'old_discount', 'new_discount', l.details->'new_discount',
               'amount_paid', l.details->'amount_paid', 'by', u.full_name, 'role', u.role) x
          FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.tenant_id = t AND l.action = 'invoice_changed' AND l.created_at >= a AND l.created_at < b LIMIT 200) q), '[]'::jsonb),
    'number_gaps', coalesce((SELECT jsonb_agg(jsonb_build_object('series', s.series, 'missing', s.missing) ORDER BY s.series) FROM (
        SELECT g.series, jsonb_agg(g.n ORDER BY g.n) missing FROM (
          SELECT p.series, gs.n
            FROM (SELECT regexp_replace(invoice_number, '[0-9]+$', '') series, min(substring(invoice_number from '[0-9]+$')::int) lo, max(substring(invoice_number from '[0-9]+$')::int) hi
                    FROM invoices WHERE tenant_id = t AND invoice_number ~ '[0-9]+$' AND created_at >= a GROUP BY 1) p,
                 LATERAL generate_series(p.lo, p.hi) gs(n)
           WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = t AND regexp_replace(i.invoice_number, '[0-9]+$', '') = p.series
                               AND substring(i.invoice_number from '[0-9]+$')::int = gs.n)) g GROUP BY g.series) s), '[]'::jsonb),
    'jobs_without_invoice', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'status', j.status, 'at', coalesce(j.status_updated_at, j.updated_at),
               'created_by', u.full_name) x
          FROM jobs j LEFT JOIN users u ON u.id = j.created_by
         WHERE j.tenant_id = t AND j.status IN ('delivered', 'ready', 'long_due') AND j.archived_at IS NULL
           AND coalesce(j.status_updated_at, j.updated_at) >= a AND coalesce(j.status_updated_at, j.updated_at) < b
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.status <> 'void' AND (i.job_id = j.id OR i.id = j.invoice_id)) LIMIT 200) q), '[]'::jsonb),
    'payments_without_proof', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', r.created_at, 'invoice_number', i.invoice_number, 'amount', r.amount, 'method', r.payment_method,
               'by', u.full_name, 'role', u.role) x
          FROM receipts r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN users u ON u.id = r.created_by
         WHERE r.tenant_id = t AND r.voided_at IS NULL AND r.proof_url IS NULL AND r.gateway_ref IS NULL
           AND r.payment_method IN ('cash', 'bank_transfer', 'duitnow', 'qr', 'card', 'credit_card')
           AND r.created_at >= a AND r.created_at < b LIMIT 200) q), '[]'::jsonb),
    'deletions', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', d.deleted_at, 'table', d.table_name, 'label', d.record_label, 'kind', d.kind, 'reason', d.reason,
               'by', u.full_name, 'approved_by', ap.full_name) x
          FROM deleted_records d LEFT JOIN users u ON u.id = d.deleted_by LEFT JOIN users ap ON ap.id = d.approved_by
         WHERE d.tenant_id = t AND d.deleted_at >= a AND d.deleted_at < b LIMIT 300) q), '[]'::jsonb),
    'pending_deletions', (SELECT count(*) FROM deletion_requests WHERE tenant_id = t AND status = 'pending')
  );
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION integrity_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION integrity_report(date, date) TO authenticated;
