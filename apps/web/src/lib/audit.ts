import { supabase } from './supabase'

export async function logAudit(params: {
  action: string
  module: string
  record_id?: string | null
  record_type?: string
  details?: Record<string, unknown>
  branch_id?: string | null
  user_id?: string | null
  tenant_id?: string | null
}) {
  // Fire-and-forget via SECURITY DEFINER RPC — bypasses RLS so inserts always land
  supabase.rpc('insert_audit_log', {
    p_action:      params.action,
    p_module:      params.module,
    p_record_id:   params.record_id   ?? null,
    p_record_type: params.record_type ?? null,
    p_details:     params.details     ?? null,
    p_branch_id:   params.branch_id   ?? null,
    p_user_id:     params.user_id     ?? null,
    p_tenant_id:   params.tenant_id   ?? null,
  }).then(({ error }) => {
    if (error) console.warn('[audit]', error.message)
  })
}
