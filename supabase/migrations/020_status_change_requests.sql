-- Migration 020: Foreman approval flow for gated status transitions

CREATE TABLE IF NOT EXISTS status_change_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  branch_id           uuid NOT NULL,
  tenant_id           uuid,
  requested_by        uuid REFERENCES users(id),
  requested_by_name   text,
  from_status         text NOT NULL,
  to_status           text NOT NULL,
  checklist_question  text NOT NULL,
  checklist_answer    boolean,
  reviewer_notes      text,
  reviewed_by         uuid REFERENCES users(id),
  reviewed_by_name    text,
  reviewed_at         timestamptz,
  request_status      text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE status_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scr_select" ON status_change_requests FOR SELECT TO authenticated
  USING (branch_id = get_my_branch() OR get_my_role() IN ('super_admin','ops_manager','foreman'));

CREATE POLICY "scr_insert" ON status_change_requests FOR INSERT TO authenticated
  WITH CHECK (branch_id = get_my_branch() OR get_my_role() IN ('super_admin','ops_manager'));

CREATE POLICY "scr_update" ON status_change_requests FOR UPDATE TO authenticated
  USING (get_my_role() IN ('super_admin','ops_manager','foreman'));
