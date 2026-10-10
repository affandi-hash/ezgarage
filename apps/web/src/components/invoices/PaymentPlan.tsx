import { useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/components/ui/Toast'

// Two-payment plans on workshop invoices (BB staff benefit). The plan only says how much is due
// when; the money itself is still ordinary partial payments on the invoice.

export interface PaymentPlanRow {
  id: string
  invoice_id: string
  staff_id: string
  first_amount: number
  second_amount: number
  first_due: string
  second_due: string
  status: 'active' | 'completed' | 'cancelled'
  below_minimum: boolean
}

export interface PlanNext {
  instalment: 1 | 2
  pay_now: number
  first_amount: number
  second_amount: number
  first_due: string
  second_due: string
  amount_paid: number
  total: number
  overdue: boolean
}

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  text: '#F0F0F0',
  text2: '#A0A0A0',
  green: '#22C55E',
  red: '#EF4444',
}

const money = (n: number | null | undefined) => 'RM ' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function todayLocal(): string { return ymd(new Date()) }

function daysFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return ymd(d)
}

export function fmtPlanDate(s: string, withYear = true): string {
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return String(s ?? '')
  return d.toLocaleDateString('en-GB', withYear ? { day: '2-digit', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })
}

// instalment 1 is covered once amount_paid reaches first_amount; instalment 2 once the invoice is paid
function covered(plan: PaymentPlanRow, n: 1 | 2, amountPaid: number, total: number): boolean {
  if (n === 1) return amountPaid >= plan.first_amount - 0.005 || plan.status === 'completed'
  return plan.status === 'completed' || (total > 0 && amountPaid >= total - 0.005)
}

export function instalmentState(plan: PaymentPlanRow, n: 1 | 2, amountPaid: number, total: number): 'paid' | 'due' | 'overdue' {
  if (covered(plan, n, amountPaid, total)) return 'paid'
  const due = n === 1 ? plan.first_due : plan.second_due
  return String(due).slice(0, 10) < todayLocal() ? 'overdue' : 'due'
}

// the instalment still to be paid on an active plan (used to annotate the list)
export function nextInstalment(plan: PaymentPlanRow, amountPaid: number, total: number) {
  const n: 1 | 2 = amountPaid >= plan.first_amount - 0.005 ? 2 : 1
  const amount = n === 1 ? plan.first_amount - amountPaid : total - amountPaid
  const due = n === 1 ? plan.first_due : plan.second_due
  return { n, amount: Math.max(0, amount), due: String(due).slice(0, 10), overdue: String(due).slice(0, 10) < todayLocal() }
}

function Pill({ state }: { state: 'paid' | 'due' | 'overdue' }) {
  const map = {
    paid: { bg: 'rgba(34,197,94,0.15)', fg: C.green, label: 'Paid' },
    due: { bg: 'rgba(241,90,34,0.15)', fg: C.orange, label: 'Due' },
    overdue: { bg: 'rgba(239,68,68,0.15)', fg: C.red, label: 'Overdue' },
  }[state]
  return <span style={{ background: map.bg, color: map.fg, border: `1px solid ${map.fg}66`, borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' as const }}>{map.label}</span>
}

// ─── Plan card (detail panel) ──────────────────────────────────────────────────

export function PaymentPlanCard({ plan, amountPaid, total, canCancel, onChanged }: {
  plan: PaymentPlanRow
  amountPaid: number
  total: number
  canCancel: boolean
  onChanged: () => void | Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function cancelPlan() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('cancel_payment_plan', { p_invoice: plan.invoice_id, p_reason: reason.trim() || null })
      if (error || data?.error) {
        const msgs: Record<string, string> = {
          forbidden: 'You do not have permission to cancel payment plans.',
          no_plan: 'There is no active payment plan on this invoice.',
        }
        toast.error(msgs[data?.error] ?? 'Could not cancel the payment plan. Please try again.')
        return
      }
      toast.success('Payment plan cancelled')
      setConfirming(false)
      setReason('')
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const rows: { n: 1 | 2; amount: number; due: string }[] = [
    { n: 1, amount: plan.first_amount, due: plan.first_due },
    { n: 2, amount: plan.second_amount, due: plan.second_due },
  ]

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' as const }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, letterSpacing: 1, textTransform: 'uppercase' as const }}>Payment plan</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {plan.status === 'completed' && <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>Completed</span>}
          <span style={{ fontSize: 12, color: C.text2 }}>Staff ID: <strong style={{ color: C.text, fontFamily: 'monospace' }}>{plan.staff_id}</strong></span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.n} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: C.bg, borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
            <span>Payment {r.n} of 2: <strong>{money(r.amount)}</strong>, due {fmtPlanDate(r.due)}</span>
            <Pill state={instalmentState(plan, r.n, amountPaid, total)} />
          </div>
        ))}
      </div>
      {canCancel && plan.status === 'active' && (
        <div style={{ marginTop: 12 }}>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} style={{ background: 'none', border: 'none', padding: 0, color: C.red, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel plan</button>
          ) : (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: `1px solid ${C.red}55`, borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 12, color: C.text, marginBottom: 8 }}>Cancel this payment plan? Anything already paid stays on the invoice, and the due date goes back to what it was before.</div>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '6px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' as const, marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} onClick={() => { setConfirming(false); setReason('') }} style={{ background: 'transparent', color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Keep plan</button>
                <button disabled={busy} onClick={cancelPlan} style={{ background: '#B91C1C', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Cancelling...' : 'Yes, cancel plan'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Split into 2 payments modal ───────────────────────────────────────────────

export function SplitPaymentModal({ invoiceId, total, onClose, onDone }: {
  invoiceId: string
  total: number
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const minDate = daysFromToday(7)
  const maxDate = daysFromToday(62)
  const defaultDate = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); const s = ymd(d); return s < minDate ? minDate : s > maxDate ? maxDate : s })()
  const [staffId, setStaffId] = useState('')
  const [first, setFirst] = useState((Math.round(total / 2 * 100) / 100).toFixed(2))
  const [dueDate, setDueDate] = useState(defaultDate)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // BB1234, bb 1234 or just 1234 all mean the same staff ID
  const rawId = staffId.replace(/\s+/g, '').toUpperCase()
  const cleanId = /^[0-9]{4}$/.test(rawId) ? `BB${rawId}` : rawId
  const firstNum = Math.round((Number(first) || 0) * 100) / 100
  const secondNum = Math.round((total - firstNum) * 100) / 100
  const idOk = /^BB[0-9]{4}$/.test(cleanId)
  const amountOk = firstNum > 0 && firstNum < total
  const dateOk = !!dueDate && dueDate >= minDate && dueDate <= maxDate

  const inputStyle: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '8px 12px', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }

  async function submit() {
    setError('')
    if (!idOk) { setError('Enter a staff ID like BB1234 (BB followed by 4 digits).'); return }
    if (!amountOk) { setError(`The first payment must be more than RM 0 and less than the invoice total of ${money(total)}.`); return }
    if (!dateOk) { setError('The second payment date must be between 7 and 62 days from today.'); return }
    setBusy(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('create_payment_plan', {
        p_invoice: invoiceId, p_staff_id: cleanId, p_first_amount: firstNum, p_second_due: dueDate,
      })
      if (rpcErr || !data || data.error) {
        const code: string | undefined = data?.error
        const msgs: Record<string, string> = {
          forbidden: 'You do not have permission to set up a payment plan for this invoice.',
          invoice_not_found: 'We could not find this invoice.',
          invoice_not_open: 'Only unpaid invoices that have been sent can be split into two payments.',
          already_part_paid: 'This invoice already has a payment recorded, so it cannot be split.',
          plan_exists: 'This invoice already has a payment plan.',
          invalid_staff_id: 'Enter a staff ID like BB1234 (BB followed by 4 digits).',
          below_minimum: `Plans start at RM ${data?.minimum ?? 500}. Ask an operations manager to approve a smaller bill.`,
          invalid_amount: `The first payment must be more than RM 0 and less than the invoice total of ${money(total)}.`,
          invalid_due_date: 'The second payment date must be between 7 and 62 days from today.',
        }
        setError((code && msgs[code]) || 'Could not set up the payment plan. Please try again.')
        return
      }
      toast.success('Payment plan created')
      await onDone()
    } catch {
      setError('Could not set up the payment plan. Please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, width: '90%', maxWidth: 440, overflow: 'hidden', color: C.text }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Split into 2 payments</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: C.text2 }}>Invoice total is <strong style={{ color: C.text }}>{money(total)}</strong>.</div>
          <div>
            <label style={label}>BB staff ID</label>
            <input style={inputStyle} placeholder="BB1234" value={staffId} onChange={e => setStaffId(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={label}>First payment (RM), paid when the car is returned</label>
            <input type="number" min="0" step="0.01" style={inputStyle} value={first} onChange={e => setFirst(e.target.value)} />
          </div>
          <div>
            <label style={label}>Second payment due date</label>
            <input type="date" style={inputStyle} value={dueDate} min={minDate} max={maxDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          {amountOk && dateOk && (
            <div style={{ background: C.bg, borderRadius: 6, padding: 10, fontSize: 13 }}>
              Pay <strong>{money(firstNum)}</strong> now, <strong>{money(secondNum)}</strong> on <strong>{fmtPlanDate(dueDate)}</strong>.
            </div>
          )}
          {error && <div style={{ fontSize: 13, color: C.red }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} disabled={busy} style={{ background: 'transparent', color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={submit} disabled={busy} style={{ background: C.orange, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving...' : 'Create plan'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
