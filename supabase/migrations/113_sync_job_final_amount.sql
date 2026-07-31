-- 113: jobs.final_amount duplicates invoices.total_amount but was only ever
-- written once, at invoice-creation time (InvoicesPage.tsx createInvoice(),
-- line ~806) -- editing an invoice's total (saveInvoice), voiding it
-- (voidInvoice), or deleting it never touched final_amount afterward. This
-- silently fed every reader of jobs.final_amount (Dashboard's
-- "Revenue (Month)", ReportsPage's overview stats, VehiclesPage,
-- CustomersPage, and CustomerPortalPage -- shown to actual customers)
-- increasingly stale numbers. Confirmed in production: a job whose
-- invoice_id pointed at an invoice deleted at some point still counted a
-- phantom RM10 with no invoice behind it at all -- jobs.invoice_id has no
-- FK, so nothing ever enforced or cleaned that up.
--
-- Fix: a trigger on invoices keeps final_amount live from here on, instead
-- of relying on every call site remembering to update it by hand (the exact
-- bug class this migration removes). Void is treated as "no valid bill
-- anymore" -- final_amount goes to NULL rather than keeping a cancelled
-- invoice's amount, which also naturally fixes Dashboard's revenue query
-- (no query change needed there: it already treats final_amount=NULL as 0).

-- 1. Backfill every job that currently has an invoice_id, platform-wide
-- (this is a schema-level bug, not scoped to one tenant).
UPDATE jobs j
   SET final_amount = CASE WHEN i.status = 'void' THEN NULL ELSE i.total_amount END
  FROM invoices i
 WHERE j.invoice_id = i.id;

-- Orphans: invoice_id points at a row that no longer exists.
UPDATE jobs
   SET invoice_id = NULL, final_amount = NULL
 WHERE invoice_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = jobs.invoice_id);

-- 2. Trigger to keep it in sync going forward.
CREATE OR REPLACE FUNCTION public.sync_job_final_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Match on both job_id and invoice_id -- guards against clearing a job
    -- that has since moved on to a different, still-valid invoice.
    UPDATE jobs SET invoice_id = NULL, final_amount = NULL
     WHERE id = OLD.job_id AND invoice_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.job_id IS NOT NULL THEN
    UPDATE jobs
       SET final_amount = CASE WHEN NEW.status = 'void' THEN NULL ELSE NEW.total_amount END,
           invoice_id = NEW.id
     WHERE id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_final_amount ON invoices;
CREATE TRIGGER trg_sync_job_final_amount
  AFTER INSERT OR UPDATE OF total_amount, status OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_job_final_amount();
