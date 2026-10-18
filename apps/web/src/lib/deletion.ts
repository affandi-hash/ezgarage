import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'

// Deleting important records needs a super admin's approval. Super admins delete directly (a copy is kept
// in the deleted-records log); everyone else sends a request with a reason that a super admin approves or rejects.

// Companies with the stricter rules switched off (tenants.tight_controls = false) delete directly, as before.
export const controlsOn = () => useAuthStore.getState().tenant?.tight_controls !== false
export const deletesDirectly = () => useAuthStore.getState().user?.role === 'super_admin' || !controlsOn()

export type DeleteOutcome = 'deleted' | 'requested' | 'cancelled' | 'failed'

export interface DeletionAsk { label: string; needsApproval: boolean; warning?: string }
export type DeletionAnswer = { ok: boolean; reason: string }
type Asker = (ask: DeletionAsk) => Promise<DeletionAnswer>

let asker: Asker | null = null
export function registerDeletionPrompt(fn: Asker | null) { asker = fn }

const REQUEST_ERRORS: Record<string, string> = {
  forbidden: 'Your role cannot request this deletion.',
  not_supported: 'This kind of record cannot be deleted from here.',
  reason_required: 'Please give a reason.',
  not_found: 'This record no longer exists.',
  has_invoice: 'This job has an invoice. Void the invoice first.',
}

export async function deleteWithApproval(opts: {
  table: string
  id: string
  label: string                // e.g. 'job MVG-2026-0157' (shown in the prompt)
  warning?: string             // extra line shown in the prompt
  inUseMessage?: string        // shown when other records still depend on it
  reason?: string              // when the screen already asked for a reason and confirmed, skip the prompt
}): Promise<DeleteOutcome> {
  const direct = deletesDirectly()
  if (!asker) { toast('Deletion is not available right now. Reload the page.', 'error'); return 'failed' }
  const answer = opts.reason
    ? { ok: true, reason: opts.reason }
    : await asker({ label: opts.label, needsApproval: !direct, warning: opts.warning })
  if (!answer.ok) return 'cancelled'

  if (direct) {
    const { error } = await supabase.from(opts.table).delete().eq('id', opts.id)
    if (error) {
      toast(error.code === '23503' && opts.inUseMessage ? opts.inUseMessage : error.message, 'error')
      return 'failed'
    }
    toast('Deleted. A copy is kept in the deleted-records log.')
    return 'deleted'
  }

  const { data, error } = await supabase.rpc('request_deletion', { p_table: opts.table, p_id: opts.id, p_reason: answer.reason })
  const res = data as { ok?: boolean; error?: string; already?: boolean } | null
  if (error || !res?.ok) {
    toast(REQUEST_ERRORS[res?.error ?? ''] ?? error?.message ?? 'Could not send the request', 'error')
    return 'failed'
  }
  toast(res.already ? 'A deletion request for this is already waiting for the super admin.' : 'Deletion request sent to the super admin for approval.', 'info')
  return 'requested'
}
