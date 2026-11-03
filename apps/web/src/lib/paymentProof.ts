import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { canUseMoneyPowers, MONEY_ERRORS } from '@/lib/money'

// Payments that must come with proof: a photo or PDF (cash handover, bank slip, QR or transfer screenshot).
// Card and the online gateway methods have their own record and are left out. The database enforces the same list.
const NEEDS_PROOF = ['cash', 'bank_transfer', 'online_transfer', 'qr', 'duitnow', 'cheque', 'other']
// (a company with the stricter rules switched off is not required to attach proof)
export const proofRequired = (method: string | null | undefined) => useAuthStore.getState().tenant?.tight_controls !== false && NEEDS_PROOF.includes(method ?? '')

export function proofMissing(r: { payment_method: string | null; proof_url: string | null; gateway_ref?: string | null; voided_at?: string | null }): boolean {
  return !r.proof_url && !r.voided_at && !r.gateway_ref && NEEDS_PROOF.includes(r.payment_method ?? '')
}

// Adding or replacing proof after the payment is a money power: the Branch Admin (or super admin) only.
export const canManageProof = (_role?: string | null) => canUseMoneyPowers(['ops_manager', 'super_admin'])

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
    const msgs: Record<string, string> = { forbidden: 'Only the Branch Admin can add or replace proof', branch_admin_only: MONEY_ERRORS.branch_admin_only, mfa_required: MONEY_ERRORS.mfa_required, voided: 'This payment was voided', not_found: 'Payment not found', bad_path: 'Could not attach the file' }
    return { ok: false, error: msgs[data?.error] ?? error?.message ?? 'Could not attach the proof' }
  }
  return { ok: true, replaced: !!data?.replaced }
}

// Recording a payment: the file goes up first (into the invoice's folder), then record_payment attaches it to the new
// receipt in the same step. If the payment then fails, the file is removed again.
export async function uploadPaymentProof(invoiceId: string, file: File): Promise<{ path?: string; error?: string }> {
  const bad = proofFileError(file)
  if (bad) return { error: bad }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${invoiceId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false })
  if (error) return { error: `Upload failed: ${error.message}` }
  return { path }
}
export async function discardPaymentProof(path: string) {
  await supabase.storage.from('payment-proofs').remove([path])
}
export const PAYMENT_ERRORS: Record<string, string> = {
  forbidden: 'You do not have permission to record payments for this invoice',
  invoice_not_found: 'Invoice not found',
  invalid_amount: 'Enter a valid amount',
  amount_exceeds_balance: 'Amount exceeds balance',
  proof_required: 'Attach proof of payment (photo or PDF) for cash and transfer payments',
  bad_proof: 'The proof file could not be attached. Please upload it again',
}

// ── asking for a proof to be changed, and extra documents ───────────────────────────────────────────────────────────
export const PROOF_REQUEST_ERRORS: Record<string, string> = {
  forbidden: 'You do not have permission to do this',
  not_found: 'Payment not found',
  voided: 'This payment was voided',
  bad_path: 'Could not attach the file. Please upload it again',
  reason_too_short: 'Please give a proper reason: a short sentence that says what went wrong',
  already_pending: 'A change is already waiting for approval on this payment',
  not_needed: 'This company does not need approval for proof changes',
  branch_admin_only: MONEY_ERRORS.branch_admin_only,
  mfa_required: MONEY_ERRORS.mfa_required,
  already_decided: 'This request was already decided',
}

async function uploadToReceipt(receiptId: string, file: File): Promise<{ path?: string; error?: string }> {
  const bad = proofFileError(file)
  if (bad) return { error: bad }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${receiptId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false })
  if (error) return { error: `Upload failed: ${error.message}` }
  return { path }
}

// Staff: upload the file and ask the Branch Admin to approve swapping it in (replace) or keeping it beside the main proof (add).
export async function requestProofChange(receiptId: string, file: File, kind: 'replace' | 'add', reason: string): Promise<{ ok: boolean; error?: string }> {
  const up = await uploadToReceipt(receiptId, file)
  if (!up.path) return { ok: false, error: up.error }
  const { data, error } = await supabase.rpc('request_proof_change', { p_receipt: receiptId, p_kind: kind, p_path: up.path, p_reason: reason })
  if (error || data?.error) {
    await supabase.storage.from('payment-proofs').remove([up.path])
    return { ok: false, error: PROOF_REQUEST_ERRORS[data?.error] ?? error?.message ?? 'Could not send the request' }
  }
  return { ok: true }
}

// Branch Admin / super admin: add a second document straight away.
export async function addReceiptDocument(receiptId: string, file: File, note?: string): Promise<{ ok: boolean; error?: string }> {
  const up = await uploadToReceipt(receiptId, file)
  if (!up.path) return { ok: false, error: up.error }
  const { data, error } = await supabase.rpc('add_receipt_proof', { p_receipt: receiptId, p_path: up.path, p_note: note ?? null })
  if (error || data?.error) {
    await supabase.storage.from('payment-proofs').remove([up.path])
    return { ok: false, error: PROOF_REQUEST_ERRORS[data?.error] ?? error?.message ?? 'Could not add the document' }
  }
  return { ok: true }
}

export async function openProofFile(path: string, bucket?: string | null): Promise<boolean> {
  const { data, error } = await supabase.storage.from(bucket ?? 'payment-proofs').createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return false
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  return true
}
