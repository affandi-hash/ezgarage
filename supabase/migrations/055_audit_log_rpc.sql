-- 055: SECURITY DEFINER RPC for audit log inserts
-- The existing INSERT policy uses is_active_user() which can silently fail.
-- A SECURITY DEFINER function bypasses RLS entirely, guaranteeing inserts land.

CREATE OR REPLACE FUNCTION insert_audit_log(
  p_action      text,
  p_module      text,
  p_record_id   uuid    DEFAULT NULL,
  p_record_type text    DEFAULT NULL,
  p_details     jsonb   DEFAULT NULL,
  p_branch_id   uuid    DEFAULT NULL,
  p_user_id     uuid    DEFAULT NULL,
  p_tenant_id   uuid    DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO audit_logs (action, module, record_id, record_type, details, branch_id, user_id, tenant_id)
  VALUES (p_action, p_module, p_record_id, p_record_type, p_details, p_branch_id, p_user_id, p_tenant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION insert_audit_log TO authenticated;
