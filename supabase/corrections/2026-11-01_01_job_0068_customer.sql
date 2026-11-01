-- Job MVG-2026-0068 (WTU7720) was under "Motoverse Garage"; the vehicle and its invoice belong to Brainy Bunch Pre School Sdn Bhd.
DO $$
DECLARE j jobs; to_c uuid := '539d9abd-1941-41e7-86a5-f76ca93b9ec9'; from_c uuid := 'a56151c2-a099-4765-9bef-c7475e7621d4';
BEGIN
  SELECT * INTO j FROM jobs WHERE job_number = 'MVG-2026-0068' AND customer_id = from_c;
  IF FOUND THEN
    UPDATE jobs SET customer_id = to_c WHERE id = j.id;
    PERFORM insert_audit_log('job_customer_corrected', 'Job', j.id, 'job',
      jsonb_build_object('job_number', j.job_number, 'from_customer', 'Motoverse Garage', 'to_customer', 'BRAINY BUNCH PRE SCHOOL SDN BHD',
                         'reason', 'Vehicle WTU7720 belongs to Brainy Bunch Pre School'), j.branch_id, NULL, j.tenant_id);
  END IF;
END $$;
SELECT j.job_number, c.full_name, j.status, j.invoice_id IS NOT NULL AS has_invoice FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.job_number = 'MVG-2026-0068';
