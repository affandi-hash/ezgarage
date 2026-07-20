-- 091: Archive Job feature. Separate from Cancel — a job can be archived
-- (hidden from the active board) regardless of status, including
-- delivered/closed jobs, without implying it was cancelled. Cancel keeps
-- meaning "this job didn't happen"; Archive just means "stop showing this
-- on the active board".
--
-- No RLS policy change needed: jobs_update already allows
-- super_admin/ops_manager/foreman/mechanic to update jobs scoped by
-- tenant_id/branch_id, which covers writing these two columns too.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);
