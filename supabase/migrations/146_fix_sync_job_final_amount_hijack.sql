-- 146: sync_job_final_amount() unconditionally set jobs.invoice_id = NEW.id
-- on every UPDATE to ANY invoice tied to a job -- not just inserts. Editing
-- (or voiding) an old, superseded invoice would silently hijack a job's
-- "current invoice" pointer away from whatever it had actually moved on to,
-- and null out final_amount in the process if the touched invoice happened
-- to be void. Confirmed live: voiding a stale test invoice on a job that
-- had already moved on to a newer one immediately reassigned the job back
-- to the just-voided invoice.
--
-- INSERT still makes a new invoice the job's current one (a job normally
-- only ever gets re-invoiced deliberately). UPDATE now only refreshes the
-- amount for the invoice a job is ALREADY pointed at -- editing a
-- different, non-current invoice can no longer move that pointer.

CREATE OR REPLACE FUNCTION public.sync_job_final_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE jobs SET invoice_id = NULL, final_amount = NULL
     WHERE id = OLD.job_id AND invoice_id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.job_id IS NOT NULL THEN
      UPDATE jobs
         SET final_amount = CASE WHEN NEW.status = 'void' THEN NULL ELSE NEW.total_amount END,
             invoice_id = NEW.id
       WHERE id = NEW.job_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.job_id IS NOT NULL THEN
    UPDATE jobs
       SET final_amount = CASE WHEN NEW.status = 'void' THEN NULL ELSE NEW.total_amount END
     WHERE id = NEW.job_id AND invoice_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
