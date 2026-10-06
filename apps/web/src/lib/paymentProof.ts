import { supabase } from '@/lib/supabase'

// Payments that must come with a bank slip or receipt screenshot. Cash, card
// and the online gateway methods (which have their own record) are left out.
const NEEDS_PROOF = ['bank_transfer', 'qr', 'duitnow', 'cheque', 'online', 'other']

export function proofMissing(r: { payment_method: string | null; proof_url: string | null; gateway_ref?: string | null; voided_at?: string | null }): boolean {
  return !r.proof_url && !r.voided_at && !r.gateway_ref && NEEDS_PROOF.includes(r.payment_method ?? '')
}

// Adding or replacing proof after the payment is limited to ops managers.
export const canManageProof = (role?: string | null) => role === 'ops_manager' || role === 'super_admin'

export const PROOF_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
export const PROOF_MAX_BYTES = 10 * 1024 * 1024

export function proofFileError(file: File): string | null {
  if (!PROOF_TYPES.includes(file.type)) return 'Only JPG, PNG, WEBP or PDF files are allowed'
  if (file.size > PROOF_MAX_BYTES) return 'File must be under 10 MB'
  return null
}

// Uploads the file under the receipt's own folder, then attaches it through the
// database function (which keeps the old file in history when replacing).
export async function attachReceiptProof(receiptId: string, file: File, reference?: string): Promise<{ ok: boolean; replaced?: boolean; error?: string }> {
  const bad = proofFileError(file)
  if (bad) return { ok: false, error: bad }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${receiptId}/${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false })
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` }
  const { data, error } = await supabase.rpc('set_receipt_proof', { p_receipt_id: receiptId, p_path: path, p_reference: reference ?? null })
  if (error || data?.error) {
    await supabase.storage.from('payment-proofs').remove([path])
    const msgs: Record<string, string> = { forbidden: 'Only an ops manager can add or replace proof', voided: 'This payment was voided', not_found: 'Payment not found', bad_path: 'Could not attach the file' }
    return { ok: false, error: msgs[data?.error] ?? error?.message ?? 'Could not attach the proof' }
  }
  return { ok: true, replaced: !!data?.replaced }
}
