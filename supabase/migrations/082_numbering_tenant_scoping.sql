-- 082: Multi-tenant document numbering fixes.
--
-- 1. branches.code had no uniqueness constraint at all — two branches
--    (even within the same tenant) could share a code, which combined
--    with (2) below would let two branches silently produce identical
--    job/invoice numbers. Enforce uniqueness per tenant now, while there's
--    only one branch, rather than after a second tenant makes it a live
--    collision risk.
--
-- 2. jobs.job_number, invoices.invoice_number and bookings.booking_number
--    are GLOBALLY unique despite being generated per-branch. This was only
--    "safe" because exactly one branch (code MVG) exists today — a second
--    tenant's first invoice of the year would collide with an existing
--    MV-INV-2026-0001-style number the moment branch codes ever matched
--    or fell back to the same default. Re-scope to UNIQUE(tenant_id, ...).
--
-- 3. invoices.receipt_number and quotations.quote_number had NO uniqueness
--    constraint whatsoever. Add UNIQUE(tenant_id, ...) to both.
--
-- 4. generate_receipt_number() used a hardcoded 'MVG-RCP-' prefix (a
--    literal string, not derived from the branch like every other
--    document type) plus a single GLOBAL sequence — a second tenant's
--    receipts would be labelled "MVG-RCP-..." regardless of their own
--    business name, and the sequence would leak Motoverse's total receipt
--    volume to them. generate_booking_number() had the same global-
--    sequence issue. Both now go through generate_doc_number(), the same
--    per-branch-counter helper invoice/quote numbers already use.

ALTER TABLE branches ADD CONSTRAINT branches_tenant_code_unique UNIQUE (tenant_id, code);

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_number_key;
ALTER TABLE jobs ADD CONSTRAINT jobs_tenant_job_number_unique UNIQUE (tenant_id, job_number);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;
ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_invoice_number_unique UNIQUE (tenant_id, invoice_number);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_booking_number_key;
ALTER TABLE bookings ADD CONSTRAINT bookings_tenant_booking_number_unique UNIQUE (tenant_id, booking_number);

ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_receipt_number_unique UNIQUE (tenant_id, receipt_number);
ALTER TABLE quotations ADD CONSTRAINT quotations_tenant_quote_number_unique UNIQUE (tenant_id, quote_number);

-- Generalize the doc-type segment so RCP/BK can reuse the exact same
-- branch-code + per-branch-counter logic as QT/INV (behavior-preserving
-- for existing QT/INV callers: 'QT'/'INV' substituted in produces the
-- identical string as the old hardcoded branches).
CREATE OR REPLACE FUNCTION public.generate_doc_number(p_branch_id uuid, p_doc_type text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code  TEXT;
  v_year  TEXT;
  v_seq   INTEGER;
BEGIN
  SELECT COALESCE(NULLIF(TRIM(code), ''), 'MV')
  INTO v_code
  FROM branches
  WHERE id = p_branch_id;

  v_year := TO_CHAR(NOW(), 'YYYY');

  INSERT INTO doc_number_counters (branch_id, year, doc_type, last_seq)
  VALUES (p_branch_id, v_year, p_doc_type, 1)
  ON CONFLICT (branch_id, year, doc_type)
  DO UPDATE SET last_seq = doc_number_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_code || '-' || p_doc_type || '-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_receipt_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.amount_paid > 0
     AND (OLD.amount_paid IS NULL OR OLD.amount_paid = 0)
     AND NEW.receipt_number IS NULL THEN
    NEW.receipt_number := generate_doc_number(NEW.branch_id, 'RCP');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_booking_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.booking_number := generate_doc_number(NEW.branch_id, 'BK');
  RETURN NEW;
END;
$function$;
