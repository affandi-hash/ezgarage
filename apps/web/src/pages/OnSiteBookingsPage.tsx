import { useState, useEffect, useCallback, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Loader2, X, Search, Phone, MessageCircle, MapPin, Copy, ExternalLink, AlertTriangle,
  CalendarClock, Ban, UserX, UserCog, Check, Banknote,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { scopedBranchId } from '@/lib/branchScope'
import { toast } from '@/components/ui/Toast'
import {
  OS_STATUS_LABEL, OS_STATUS_COLOR, osError, rm, fmtDate, ymd,
  type OsBooking, type OsStatus, type OsDepositStatus,
} from '@/lib/onsite'

// Ops desk for the ON-SITE vans: special requests, upcoming jobs, completed
// jobs, the finance refund queue, and a searchable list of everything.

type Row = Omit<OsBooking, 'customer_signature'> & { refund_proof_url: string | null }

const COLS = [
  'id', 'tenant_id', 'branch_id', 'booking_number', 'token', 'status', 'request_type', 'special_reason',
  'customer_id', 'vehicle_id', 'customer_name', 'customer_phone', 'customer_email',
  'vehicle_type', 'vehicle_make', 'vehicle_model', 'vehicle_plate', 'tier',
  'package_id', 'package_name', 'grade_id', 'grade_name', 'address', 'postcode', 'zone_name', 'access_notes',
  'slot_id', 'slot_label', 'service_date', 'slot_start', 'slot_end',
  'price_base', 'price_zone', 'price_offhours', 'price_total', 'deposit_amount', 'invoice_id', 'deposit_status',
  'hold_expires_at', 'reschedule_count', 'technician_id',
  'confirmed_at', 'en_route_at', 'arrived_at', 'started_at', 'completed_at', 'cancelled_at', 'cancel_reason',
  'photos_before', 'photos_after', 'parts_used', 'health_check', 'tech_notes', 'customer_signed_at',
  'hub_quote_id', 'refund_due_at', 'refunded_at', 'refund_reference', 'refund_proof_url', 'created_at',
].join(',')

interface Tech { id: string; full_name: string; role: string; branch_id: string | null }
interface SlotRow { id: string; label: string; is_open: boolean; days: number[] }

type TabKey = 'requests' | 'upcoming' | 'completed' | 'refunds' | 'all'
type ModalState =
  | { kind: 'approve' | 'decline' | 'cancel' | 'noshow' | 'reschedule' | 'assign' | 'refund'; b: Row }
  | null

const UPCOMING: OsStatus[] = ['confirmed', 'awaiting_deposit', 'en_route', 'arrived', 'in_progress']
const ALIVE: OsStatus[] = ['awaiting_deposit', 'requested', 'confirmed', 'en_route', 'arrived', 'in_progress', 'completed']
const ACT_ROLES = ['super_admin', 'ops_manager', 'foreman', 'front_desk']
const REFUND_ROLES = ['super_admin', 'ops_manager', 'finance']

const DEPOSIT_LABEL: Record<OsDepositStatus, string> = {
  unpaid: 'Deposit unpaid', paid: 'Deposit paid', refund_due: 'Refund due',
  refunded: 'Refunded', forfeited: 'Deposit kept', none: 'No deposit',
}
const DEPOSIT_COLOR: Record<OsDepositStatus, string> = {
  unpaid: '#F59E0B', paid: '#22C55E', refund_due: '#EF4444', refunded: '#6B7280', forfeited: '#8B5CF6', none: '#6B7280',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDT = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
const statusLink = (token: string) => `${window.location.origin}/on-site/status/${token}`
const vehicleText = (b: Row) => [b.vehicle_make, b.vehicle_model].filter(Boolean).join(' ')
const isoDow = (date: string) => new Date(date + 'T00:00:00').getDay() || 7

function waLink(phone: string) {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('0')) d = '60' + d.slice(1)
  return `https://wa.me/${d}`
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied')
  } catch {
    toast('Could not copy', 'error')
  }
}

// Runs a staff RPC and turns both transport errors and {error:'code'} replies into a toast.
async function callRpc(fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) { toast(error.message, 'error'); return false }
  const res = data as { ok?: boolean; error?: string } | null
  if (res?.error) { toast(osError(res.error), 'error'); return false }
  return true
}

const byDateSlot = (a: Row, b: Row) =>
  (a.service_date ?? '9999').localeCompare(b.service_date ?? '9999') || (a.slot_start ?? '').localeCompare(b.slot_start ?? '')

// ─── Styles ───────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0',
  fontSize: 16, padding: '10px 12px', width: '100%', boxSizing: 'border-box', outline: 'none',
}
const lbl: React.CSSProperties = { fontSize: 12, color: '#A0A0A0', marginBottom: 6, display: 'block', fontWeight: 500 }
const card: React.CSSProperties = { background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, padding: 14 }

function btn(kind: 'primary' | 'ghost' | 'danger' | 'success' = 'ghost', disabled = false): React.CSSProperties {
  const map = {
    primary: { background: '#F15A22', color: '#fff', border: '1px solid #F15A22' },
    ghost: { background: '#161616', color: '#F0F0F0', border: '1px solid #2A2A2A' },
    danger: { background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.4)' },
    success: { background: 'rgba(34,197,94,0.12)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.4)' },
  }[kind]
  return {
    ...map, borderRadius: 8, padding: '9px 14px', minHeight: 40, fontSize: 13, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
  }
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, color, background: `${color}22`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

const StatusChip = ({ s }: { s: OsStatus }) => <Chip color={OS_STATUS_COLOR[s]}>{OS_STATUS_LABEL[s]}</Chip>

function Modal({ title, onClose, children, drawer }: { title: string; onClose: () => void; children: React.ReactNode; drawer?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', justifyContent: drawer ? 'flex-end' : 'center', alignItems: drawer ? 'stretch' : 'center', padding: drawer ? 0 : 12 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#161616', border: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column',
        ...(drawer
          ? { width: 'min(520px, 100vw)', height: '100%' }
          : { width: 'min(520px, 100%)', maxHeight: '92vh', borderRadius: 14 }),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #2A2A2A' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#F0F0F0' }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: 6 }}><X size={20} /></button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  )
}

// ─── Slot picker (staff may use closed / off-hours slots) ─────────────────────

function SlotPicker({ branchId, date, excludeId, value, onChange }: {
  branchId: string; date: string; excludeId: string; value: string | null; onChange: (id: string) => void
}) {
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [taken, setTaken] = useState<Set<string>>(new Set())
  const [blackout, setBlackout] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('os_slots').select('id, label, is_open, days').eq('branch_id', branchId).order('sort_order').order('start_time')
      .then(({ data }) => setSlots((data as SlotRow[]) ?? []))
  }, [branchId])

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('os_bookings').select('slot_id').eq('branch_id', branchId).eq('service_date', date).in('status', ALIVE).neq('id', excludeId),
      supabase.from('os_blackouts').select('reason').eq('branch_id', branchId).eq('blackout_date', date).maybeSingle(),
    ]).then(([bk, bo]) => {
      if (cancelled) return
      setTaken(new Set(((bk.data ?? []) as { slot_id: string | null }[]).map(r => r.slot_id ?? '')))
      setBlackout(bo.data ? ((bo.data as { reason: string | null }).reason || 'Van not working') : null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [branchId, date, excludeId])

  if (!date) return null
  const visible = slots.filter(s => (s.days ?? []).includes(isoDow(date)))

  return (
    <div>
      <span style={lbl}>Time slot</span>
      {blackout && <p style={{ color: '#EF4444', fontSize: 12, margin: '0 0 8px' }}>Blocked date: {blackout}</p>}
      {loading ? <Loader2 size={18} className="animate-spin" style={{ color: '#F15A22' }} /> : visible.length === 0 ? (
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>The van does not work on this day.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {visible.map(s => {
            const isTaken = taken.has(s.id)
            const off = blackout != null || isTaken
            const sel = value === s.id
            return (
              <button key={s.id} disabled={off} onClick={() => onChange(s.id)} style={{
                ...btn(sel ? 'primary' : 'ghost', off), flexDirection: 'column', gap: 2, padding: '8px 10px', minHeight: 48,
              }}>
                <span>{s.label}</span>
                <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>{isTaken ? 'Booked' : s.is_open ? 'Open' : 'Off-hours'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Action modals ────────────────────────────────────────────────────────────

interface ModalProps { b: Row; onClose: () => void; onDone: () => void }

function ApproveModal({ b, onClose, onDone }: ModalProps) {
  const [date, setDate] = useState(b.service_date ?? ymd(new Date()))
  const [slot, setSlot] = useState<string | null>(null)
  const [total, setTotal] = useState(b.price_total != null ? String(b.price_total) : '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const amount = Number(total)
    if (!slot) return toast('Pick a time slot', 'error')
    if (!total || !(amount > 0)) return toast(osError('price_required'), 'error')
    setBusy(true)
    const ok = await callRpc('os_approve_request', { p_booking: b.id, p_slot: slot, p_date: date, p_total: amount })
    setBusy(false)
    if (ok) { toast('Request approved; the customer can now pay the deposit'); onDone() }
  }

  return (
    <Modal title={`Approve ${b.booking_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>
          Preferred date: {fmtDate(b.service_date)}. Approving holds the slot and emails the customer a deposit link.
        </p>
        <div>
          <label style={lbl}>Service date</label>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setSlot(null) }} style={inp} />
        </div>
        <SlotPicker branchId={b.branch_id} date={date} excludeId={b.id} value={slot} onChange={setSlot} />
        <div>
          <label style={lbl}>Total price (RM){b.price_total == null ? ' - required' : ''}</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={total} onChange={e => setTotal(e.target.value)} style={inp} />
        </div>
        <button onClick={submit} disabled={busy} style={btn('primary', busy)}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Approve</button>
      </div>
    </Modal>
  )
}

function DeclineModal({ b, onClose, onDone }: ModalProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!reason.trim()) return toast('Enter a reason', 'error')
    setBusy(true)
    const ok = await callRpc('os_decline_request', { p_booking: b.id, p_reason: reason.trim() })
    setBusy(false)
    if (ok) { toast('Request declined'); onDone() }
  }

  return (
    <Modal title={`Decline ${b.booking_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={lbl}>Reason (shown to the customer)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} />
        </div>
        <button onClick={submit} disabled={busy} style={btn('danger', busy)}>{busy && <Loader2 size={16} className="animate-spin" />} Decline request</button>
      </div>
    </Modal>
  )
}

function CancelModal({ b, onClose, onDone, refundHours }: ModalProps & { refundHours: number }) {
  const [refund, setRefund] = useState(true)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const paid = b.deposit_status === 'paid'

  async function submit() {
    setBusy(true)
    const ok = await callRpc('os_staff_cancel', { p_booking: b.id, p_refund: refund, p_reason: reason.trim() || null })
    setBusy(false)
    if (ok) { toast('Booking cancelled'); onDone() }
  }

  return (
    <Modal title={`Cancel ${b.booking_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {paid ? (
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', ...card, cursor: 'pointer' }}>
            <input type="checkbox" checked={refund} onChange={e => setRefund(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
            <span>
              <span style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 600 }}>Refund the deposit ({rm(b.deposit_amount)})</span>
              <span style={{ display: 'block', color: '#A0A0A0', fontSize: 12, marginTop: 4 }}>
                The booking moves to the Refunds due queue and finance transfers the money back within {refundHours} hours.
                Untick to keep the deposit (it becomes the revenue for this booking).
              </span>
            </span>
          </label>
        ) : (
          <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>No deposit has been paid, so there is nothing to refund.</p>
        )}
        <div>
          <label style={lbl}>Reason (optional)</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Van breakdown" style={inp} />
        </div>
        <button onClick={submit} disabled={busy} style={btn('danger', busy)}>{busy && <Loader2 size={16} className="animate-spin" />} Cancel booking</button>
      </div>
    </Modal>
  )
}

function NoShowModal({ b, onClose, onDone }: ModalProps) {
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    const ok = await callRpc('os_staff_no_show', { p_booking: b.id })
    setBusy(false)
    if (ok) { toast('Marked as no-show'); onDone() }
  }
  return (
    <Modal title={`No-show ${b.booking_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>
          Mark {b.customer_name} as not at the location? The deposit is kept and the customer is emailed.
        </p>
        <button onClick={submit} disabled={busy} style={btn('danger', busy)}>{busy && <Loader2 size={16} className="animate-spin" />} Confirm no-show</button>
      </div>
    </Modal>
  )
}

function RescheduleModal({ b, onClose, onDone }: ModalProps) {
  const [date, setDate] = useState(b.service_date ?? ymd(new Date()))
  const [slot, setSlot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!slot) return toast('Pick a time slot', 'error')
    setBusy(true)
    const { data: s } = await supabase.from('os_slots').select('id, label, start_time, end_time').eq('id', slot).single()
    if (!s) { setBusy(false); return toast(osError('slot_not_found'), 'error') }
    const { error } = await supabase.from('os_bookings').update({
      slot_id: s.id, slot_label: s.label, service_date: date, slot_start: s.start_time, slot_end: s.end_time,
    }).eq('id', b.id)
    setBusy(false)
    if (error) return toast(error.code === '23505' ? 'That slot is already booked' : error.message, 'error')
    toast('Booking rescheduled')
    onDone()
  }

  return (
    <Modal title={`Reschedule ${b.booking_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>
          Currently {fmtDate(b.service_date)} {b.slot_label ?? ''}. Staff reschedules do not count toward the customer's limit.
        </p>
        <div>
          <label style={lbl}>New date</label>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setSlot(null) }} style={inp} />
        </div>
        <SlotPicker branchId={b.branch_id} date={date} excludeId={b.id} value={slot} onChange={setSlot} />
        <button onClick={submit} disabled={busy} style={btn('primary', busy)}>{busy && <Loader2 size={16} className="animate-spin" />} Reschedule</button>
      </div>
    </Modal>
  )
}

function AssignModal({ b, onClose, onDone, techs }: ModalProps & { techs: Tech[] }) {
  const [tech, setTech] = useState(b.technician_id ?? '')
  const [busy, setBusy] = useState(false)
  // technicians from this van first
  const sorted = [...techs].sort((x, y) => Number(y.branch_id === b.branch_id) - Number(x.branch_id === b.branch_id) || x.full_name.localeCompare(y.full_name))

  async function submit() {
    setBusy(true)
    const { error } = await supabase.from('os_bookings').update({ technician_id: tech || null }).eq('id', b.id)
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast(tech ? 'Technician assigned' : 'Technician cleared')
    onDone()
  }

  return (
    <Modal title={`Assign technician - ${b.booking_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={lbl}>Technician</label>
          <select value={tech} onChange={e => setTech(e.target.value)} style={inp}>
            <option value="">Unassigned</option>
            {sorted.map(t => <option key={t.id} value={t.id}>{t.full_name} ({t.role})</option>)}
          </select>
        </div>
        <button onClick={submit} disabled={busy} style={btn('primary', busy)}>{busy && <Loader2 size={16} className="animate-spin" />} Save</button>
      </div>
    </Modal>
  )
}

function RefundModal({ b, onClose, onDone }: ModalProps) {
  const [ref, setRef] = useState('')
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!ref.trim()) return toast(osError('reference_required'), 'error')
    setBusy(true)
    const ok = await callRpc('os_mark_refunded', { p_booking: b.id, p_reference: ref.trim(), p_proof_url: proof.trim() || null })
    setBusy(false)
    if (ok) { toast('Refund recorded'); onDone() }
  }

  return (
    <Modal title={`Mark refunded - ${b.booking_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>
          Refund {rm(b.deposit_amount)} to {b.customer_name} by bank transfer, then record it here. The deposit receipt is voided and the customer is emailed.
        </p>
        <div>
          <label style={lbl}>Bank transfer reference *</label>
          <input value={ref} onChange={e => setRef(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Proof link or note (optional)</label>
          <input value={proof} onChange={e => setProof(e.target.value)} style={inp} />
        </div>
        <button onClick={submit} disabled={busy} style={btn('primary', busy)}>{busy && <Loader2 size={16} className="animate-spin" />} Mark refunded</button>
      </div>
    </Modal>
  )
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#A0A0A0' }}>{title}</p>
      {children}
    </div>
  )
}

function KV({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: '#A0A0A0' }}>{k}</span>
      <span style={{ color: '#F0F0F0', fontWeight: strong ? 700 : 500, textAlign: 'right' }}>{v}</span>
    </div>
  )
}

function Photos({ urls }: { urls: string[] }) {
  if (!urls?.length) return <p style={{ color: '#4A4A4A', fontSize: 13, margin: 0 }}>None</p>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {urls.map(u => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          <img src={u} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #2A2A2A', background: '#1E1E1E' }} />
        </a>
      ))}
    </div>
  )
}

const HEALTH_COLOR = { green: '#22C55E', amber: '#F59E0B', red: '#EF4444' }

function DetailDrawer({ b, techName, onClose }: { b: Row; techName: string | null; onClose: () => void }) {
  const [signature, setSignature] = useState<string | null>(null)
  const [quoteNo, setQuoteNo] = useState<string | null>(null)

  useEffect(() => {
    setSignature(null)
    setQuoteNo(null)
    if (b.customer_signed_at) {
      supabase.from('os_bookings').select('customer_signature').eq('id', b.id).single()
        .then(({ data }) => setSignature((data as { customer_signature: string | null } | null)?.customer_signature ?? null))
    }
    if (b.hub_quote_id) {
      supabase.from('quotations').select('quote_number').eq('id', b.hub_quote_id).maybeSingle()
        .then(({ data }) => setQuoteNo((data as { quote_number: string } | null)?.quote_number ?? null))
    }
  }, [b.id, b.customer_signed_at, b.hub_quote_id])

  const link = statusLink(b.token)
  const balance = b.price_total != null && b.deposit_status === 'paid' ? b.price_total - b.deposit_amount : null
  const timeline: [string, string | null][] = [
    ['Booked', b.created_at], ['Confirmed', b.confirmed_at], ['En route', b.en_route_at], ['Arrived', b.arrived_at],
    ['Started', b.started_at], ['Completed', b.completed_at], ['Cancelled', b.cancelled_at],
    ['Refund due by', b.refund_due_at], ['Refunded', b.refunded_at],
  ]

  return (
    <Modal title={b.booking_number} onClose={onClose} drawer>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatusChip s={b.status} />
        <Chip color={DEPOSIT_COLOR[b.deposit_status]}>{DEPOSIT_LABEL[b.deposit_status]}</Chip>
        {b.request_type === 'special' && <Chip color="#F59E0B">Special request</Chip>}
      </div>

      <Section title="Customer">
        <p style={{ margin: '0 0 8px', color: '#F0F0F0', fontSize: 15, fontWeight: 600 }}>{b.customer_name}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={`tel:${b.customer_phone}`} style={{ ...btn(), textDecoration: 'none' }}><Phone size={14} /> {b.customer_phone}</a>
          <a href={waLink(b.customer_phone)} target="_blank" rel="noreferrer" style={{ ...btn('success'), textDecoration: 'none' }}><MessageCircle size={14} /> WhatsApp</a>
        </div>
        {b.customer_email && <p style={{ margin: '8px 0 0', color: '#A0A0A0', fontSize: 13 }}>{b.customer_email}</p>}
      </Section>

      <Section title="Location">
        <p style={{ margin: '0 0 8px', color: '#F0F0F0', fontSize: 13, lineHeight: 1.5 }}>{b.address ?? '-'}</p>
        {b.zone_name && <p style={{ margin: '0 0 8px', color: '#A0A0A0', fontSize: 12 }}>Zone: {b.zone_name}{b.postcode ? ` (${b.postcode})` : ''}</p>}
        {b.address && <a href={mapsUrl(b.address)} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: 'none' }}><MapPin size={14} /> Open in Google Maps</a>}
        {b.access_notes && <p style={{ margin: '8px 0 0', color: '#A0A0A0', fontSize: 13 }}>Access notes: {b.access_notes}</p>}
      </Section>

      <Section title="Service">
        <KV k="Vehicle" v={`${b.vehicle_plate}${vehicleText(b) ? ` - ${vehicleText(b)}` : ''}`} />
        <KV k="Package" v={`${b.package_name ?? '-'}${b.grade_name ? ` (${b.grade_name})` : ''}`} />
        {b.tier && <KV k="Tier" v={b.tier === 'tier1' ? 'Tier 1' : 'Tier 2'} />}
        <KV k="Date" v={`${fmtDate(b.service_date)}${b.slot_label ? ` - ${b.slot_label}` : ''}`} />
        <KV k="Technician" v={techName ?? 'Unassigned'} />
        <KV k="Customer reschedules" v={b.reschedule_count} />
        {b.special_reason && <KV k="Special reason" v={b.special_reason} />}
        {b.cancel_reason && <KV k="Reason" v={b.cancel_reason} />}
      </Section>

      <Section title="Price">
        <KV k="Base" v={rm(b.price_base)} />
        {b.price_zone > 0 && <KV k="Zone surcharge" v={rm(b.price_zone)} />}
        {b.price_offhours > 0 && <KV k="Off-hours surcharge" v={rm(b.price_offhours)} />}
        <KV k="Total" v={rm(b.price_total)} strong />
        <KV k="Deposit" v={`${rm(b.deposit_amount)} - ${DEPOSIT_LABEL[b.deposit_status]}`} />
        {balance != null && <KV k="Balance after service" v={rm(balance)} strong />}
        {b.refund_reference && <KV k="Refund reference" v={b.refund_reference} />}
        {b.refund_proof_url && <KV k="Refund proof" v={/^https?:/.test(b.refund_proof_url) ? <a href={b.refund_proof_url} target="_blank" rel="noreferrer" style={{ color: '#F15A22' }}>Open</a> : b.refund_proof_url} />}
      </Section>

      <Section title="Timeline">
        {timeline.filter(([, v]) => v).map(([k, v]) => <KV key={k} k={k} v={fmtDT(v)} />)}
      </Section>

      <Section title="Customer status link">
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={link} onFocus={e => e.target.select()} style={{ ...inp, fontSize: 12 }} />
          <button onClick={() => copyText(link)} style={btn()} aria-label="Copy link"><Copy size={14} /></button>
          <a href={link} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: 'none' }} aria-label="Open link"><ExternalLink size={14} /></a>
        </div>
      </Section>

      {(b.status === 'completed' || b.photos_before?.length > 0 || b.tech_notes || b.parts_used?.length > 0) && (
        <>
          <Section title="Photos before"><Photos urls={b.photos_before} /></Section>
          <Section title="Photos after"><Photos urls={b.photos_after} /></Section>
          <Section title="Parts used">
            {b.parts_used?.length ? b.parts_used.map((p, i) => (
              <KV key={i} k={`${p.qty} × ${p.name}`} v={p.note ?? ''} />
            )) : <p style={{ color: '#4A4A4A', fontSize: 13, margin: 0 }}>None recorded</p>}
          </Section>
          <Section title="Health check">
            {b.health_check?.length ? b.health_check.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 9999, background: HEALTH_COLOR[h.status], flexShrink: 0 }} />
                <span style={{ color: '#F0F0F0' }}>{h.item}</span>
                {h.note && <span style={{ color: '#A0A0A0' }}>- {h.note}</span>}
              </div>
            )) : <p style={{ color: '#4A4A4A', fontSize: 13, margin: 0 }}>None recorded</p>}
          </Section>
          <Section title="Technician notes">
            <p style={{ margin: 0, color: b.tech_notes ? '#F0F0F0' : '#4A4A4A', fontSize: 13, whiteSpace: 'pre-wrap' }}>{b.tech_notes || 'None'}</p>
          </Section>
          {b.customer_signed_at && (
            <Section title="Customer sign-off">
              <p style={{ margin: '0 0 8px', color: '#A0A0A0', fontSize: 12 }}>Signed {fmtDT(b.customer_signed_at)}</p>
              {signature && <img src={signature} alt="Signature" style={{ maxWidth: '100%', background: '#fff', borderRadius: 8 }} />}
            </Section>
          )}
        </>
      )}

      {b.hub_quote_id && (
        <Section title="Hub quotation">
          <p style={{ margin: 0, color: '#F0F0F0', fontSize: 13 }}>{quoteNo ?? 'Quotation created in the Hub'}</p>
        </Section>
      )}
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function OnSiteBookingsPage() {
  const user = useAuthStore(s => s.user)
  const ctx = useOutletContext<{ selectedBranchId: string | null }>()
  const role = user?.role ?? ''
  const tenantId = user?.tenant_id ?? ''
  const branchId = scopedBranchId(user, ctx?.selectedBranchId)
  const canAct = ACT_ROLES.includes(role)
  const canRefund = REFUND_ROLES.includes(role)

  const tabs: { key: TabKey; label: string }[] = role === 'finance'
    ? [{ key: 'refunds', label: 'Refunds due' }, { key: 'all', label: 'All' }]
    : [{ key: 'requests', label: 'Requests' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'completed', label: 'Completed' },
       { key: 'refunds', label: 'Refunds due' }, { key: 'all', label: 'All' }]

  const [tab, setTab] = useState<TabKey>(tabs[0].key)
  const [rows, setRows] = useState<Row[]>([])
  const [techs, setTechs] = useState<Tech[]>([])
  const [refundHours, setRefundHours] = useState(48)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalState>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | OsStatus>('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    let q = supabase.from('os_bookings').select(COLS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1500)
    if (branchId) q = q.eq('branch_id', branchId)
    const { data, error } = await q
    if (error) toast(error.message, 'error')
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }, [tenantId, branchId])

  useEffect(() => { setLoading(true); load() }, [load])

  useEffect(() => {
    if (!tenantId) return
    supabase.from('users').select('id, full_name, role, branch_id').eq('tenant_id', tenantId)
      .in('role', ['mechanic', 'foreman']).eq('is_active', true)
      .then(({ data }) => setTechs((data as Tech[]) ?? []))
    supabase.from('os_settings').select('refund_due_hours').eq('tenant_id', tenantId).maybeSingle()
      .then(({ data }) => { if (data?.refund_due_hours != null) setRefundHours(data.refund_due_hours) })
  }, [tenantId])

  const techName = useCallback((id: string | null) => techs.find(t => t.id === id)?.full_name ?? null, [techs])
  const closeModal = () => setModal(null)
  const done = () => { setModal(null); load() }

  const now = Date.now()
  const lists = useMemo(() => {
    const requests = rows.filter(r => r.status === 'requested' && r.deposit_status === 'unpaid')
      .sort((a, b) => byDateSlot(a, b))
    // a request that already paid its deposit (auto-confirm off) only needs confirming
    const upcoming = rows.filter(r => UPCOMING.includes(r.status) || (r.status === 'requested' && r.deposit_status === 'paid'))
      .sort(byDateSlot)
    const completed = rows.filter(r => r.status === 'completed')
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    const refunds = rows.filter(r => r.deposit_status === 'refund_due')
      .sort((a, b) => (a.refund_due_at ?? '').localeCompare(b.refund_due_at ?? ''))
    const refunded = rows.filter(r => r.deposit_status === 'refunded')
      .sort((a, b) => (b.refunded_at ?? '').localeCompare(a.refunded_at ?? '')).slice(0, 15)
    const overdue = refunds.filter(r => r.refund_due_at && new Date(r.refund_due_at).getTime() < now)
    return { requests, upcoming, completed, refunds, refunded, overdue }
  }, [rows, now])

  const allList = useMemo(() => {
    const s = search.trim().toLowerCase()
    const digits = s.replace(/\D/g, '')
    return rows.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false
      if (!s) return true
      return r.booking_number.toLowerCase().includes(s) || r.customer_name.toLowerCase().includes(s)
        || r.vehicle_plate.toLowerCase().replace(/\s/g, '').includes(s.replace(/\s/g, ''))
        || (digits.length >= 3 && r.customer_phone.replace(/\D/g, '').includes(digits))
    })
  }, [rows, search, statusFilter])

  const counts: Record<TabKey, number> = {
    requests: lists.requests.length, upcoming: lists.upcoming.length, completed: lists.completed.length,
    refunds: lists.refunds.length, all: rows.length,
  }

  async function confirmPaidRequest(b: Row) {
    setConfirming(b.id)
    const { error } = await supabase.from('os_bookings').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', b.id)
    setConfirming(null)
    if (error) return toast(error.message, 'error')
    toast('Booking confirmed')
    load()
  }

  // One booking card, shared by every tab; `actions` differ per tab.
  function bookingCard(b: Row, actions?: React.ReactNode) {
    return (
      <div key={b.id} style={card}>
        <div onClick={() => setDetailId(b.id)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: '#F15A22', fontSize: 13, fontWeight: 700 }}>{b.booking_number}</span>
              <p style={{ margin: '2px 0 0', color: '#F0F0F0', fontSize: 15, fontWeight: 600 }}>{b.customer_name}</p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <StatusChip s={b.status} />
              {b.deposit_status !== 'unpaid' && b.deposit_status !== 'none' && <Chip color={DEPOSIT_COLOR[b.deposit_status]}>{DEPOSIT_LABEL[b.deposit_status]}</Chip>}
            </div>
          </div>
          <p style={{ margin: '8px 0 0', color: '#A0A0A0', fontSize: 13 }}>
            {b.vehicle_plate}{vehicleText(b) ? ` - ${vehicleText(b)}` : ''} · {b.package_name ?? '-'}{b.grade_name ? ` (${b.grade_name})` : ''}
          </p>
          <p style={{ margin: '4px 0 0', color: '#A0A0A0', fontSize: 13 }}>
            {b.service_date ? `${fmtDate(b.service_date)}${b.slot_label ? ` · ${b.slot_label}` : ''}` : 'No date yet'} · {rm(b.price_total)}
            {b.technician_id && techName(b.technician_id) ? ` · ${techName(b.technician_id)}` : ''}
          </p>
          {b.status === 'requested' && b.deposit_status === 'unpaid' && (
            <>
              {b.special_reason && <p style={{ margin: '8px 0 0', color: '#F59E0B', fontSize: 13 }}>Reason: {b.special_reason}</p>}
              {b.address && <p style={{ margin: '4px 0 0', color: '#A0A0A0', fontSize: 13 }}>{b.address}</p>}
            </>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>{actions}</div>}
      </div>
    )
  }

  function upcomingActions(b: Row) {
    if (!canAct) return null
    const cancellable = ['awaiting_deposit', 'requested', 'confirmed', 'en_route', 'arrived'].includes(b.status)
    const noShowable = ['confirmed', 'en_route', 'arrived'].includes(b.status)
    const open = (kind: NonNullable<ModalState>['kind']) => () => setModal({ kind, b })
    return (
      <>
        {b.status === 'requested' && (
          <button style={btn('success', confirming === b.id)} disabled={confirming === b.id} onClick={() => confirmPaidRequest(b)}><Check size={14} /> Confirm</button>
        )}
        {(b.status === 'confirmed' || b.status === 'requested') && (
          <button style={btn()} onClick={open('reschedule')}><CalendarClock size={14} /> Reschedule</button>
        )}
        <button style={btn()} onClick={open('assign')}><UserCog size={14} /> Technician</button>
        {noShowable && <button style={btn('danger')} onClick={open('noshow')}><UserX size={14} /> No-show</button>}
        {cancellable && <button style={btn('danger')} onClick={open('cancel')}><Ban size={14} /> Cancel</button>}
      </>
    )
  }

  function list(items: Row[], empty: string, actions?: (b: Row) => React.ReactNode) {
    if (items.length === 0) return <p style={{ color: '#4A4A4A', fontSize: 14, textAlign: 'center', padding: 40, margin: 0 }}>{empty}</p>
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{items.map(b => bookingCard(b, actions?.(b)))}</div>
  }

  const detail = rows.find(r => r.id === detailId) ?? null

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0 }}>ON-SITE Bookings</h1>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>Requests, upcoming van jobs, and deposit refunds</p>
      </div>

      {lists.overdue.length > 0 && (
        <div onClick={() => setTab('refunds')} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#EF4444', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <AlertTriangle size={16} />
          {lists.overdue.length} refund{lists.overdue.length === 1 ? ' is' : 's are'} overdue
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        {tabs.map(t => {
          const active = tab === t.key
          const alert = t.key === 'refunds' && lists.overdue.length > 0
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              ...btn(active ? 'primary' : 'ghost'), borderRadius: 9999, minHeight: 40, padding: '8px 16px',
            }}>
              {t.label}
              <span style={{ background: alert ? '#EF4444' : active ? 'rgba(255,255,255,0.25)' : '#2A2A2A', color: '#fff', borderRadius: 9999, fontSize: 11, padding: '1px 7px' }}>{counts[t.key]}</span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={28} style={{ color: '#F15A22' }} className="animate-spin" /></div>
      ) : (
        <>
          {tab === 'requests' && list(lists.requests, 'No requests waiting for approval', b => canAct && (
            <>
              <button style={btn('primary')} onClick={() => setModal({ kind: 'approve', b })}><Check size={14} /> Approve</button>
              <button style={btn('danger')} onClick={() => setModal({ kind: 'decline', b })}><X size={14} /> Decline</button>
            </>
          ))}

          {tab === 'upcoming' && list(lists.upcoming, 'No upcoming bookings', upcomingActions)}

          {tab === 'completed' && list(lists.completed, 'No completed jobs yet')}

          {tab === 'refunds' && (
            <>
              {lists.refunds.length === 0 ? (
                <p style={{ color: '#4A4A4A', fontSize: 14, textAlign: 'center', padding: 40, margin: 0 }}>No refunds due</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {lists.refunds.map(b => {
                    const late = !!b.refund_due_at && new Date(b.refund_due_at).getTime() < now
                    return (
                      <div key={b.id} style={{ ...card, borderColor: late ? 'rgba(239,68,68,0.5)' : '#2A2A2A' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, cursor: 'pointer' }} onClick={() => setDetailId(b.id)}>
                          <div><span style={lbl}>Booking</span><span style={{ color: '#F15A22', fontWeight: 700, fontSize: 13 }}>{b.booking_number}</span></div>
                          <div><span style={lbl}>Customer</span><span style={{ color: '#F0F0F0', fontSize: 13 }}>{b.customer_name}</span></div>
                          <div><span style={lbl}>Amount</span><span style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 700 }}>{rm(b.deposit_amount)}</span></div>
                          <div>
                            <span style={lbl}>Due</span>
                            <span style={{ color: late ? '#EF4444' : '#F0F0F0', fontSize: 13, fontWeight: late ? 700 : 500 }}>{fmtDT(b.refund_due_at)}{late ? ' (overdue)' : ''}</span>
                          </div>
                        </div>
                        {canRefund && (
                          <div style={{ marginTop: 12 }}>
                            <button style={btn('primary')} onClick={() => setModal({ kind: 'refund', b })}><Banknote size={14} /> Mark refunded</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {lists.refunded.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <h3 style={{ color: '#A0A0A0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Recently refunded</h3>
                  <div style={{ ...card, padding: '4px 14px' }}>
                    {lists.refunded.map(b => (
                      <div key={b.id} onClick={() => setDetailId(b.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid #2A2A2A', fontSize: 13, cursor: 'pointer' }}>
                        <span style={{ color: '#F0F0F0' }}>{b.booking_number} · {b.customer_name} · {rm(b.deposit_amount)}</span>
                        <span style={{ color: '#A0A0A0' }}>{fmtDT(b.refunded_at)} · ref {b.refund_reference ?? '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'all' && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <div style={{ position: 'relative', flex: '1 1 220px' }}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: '#4A4A4A' }} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Booking no, name, plate, phone" style={{ ...inp, paddingLeft: 36 }} />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as '' | OsStatus)} style={{ ...inp, width: 'auto', flex: '0 1 180px' }}>
                  <option value="">All statuses</option>
                  {(Object.keys(OS_STATUS_LABEL) as OsStatus[]).map(s => <option key={s} value={s}>{OS_STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              {list(allList.slice(0, 200), 'No bookings match')}
              {allList.length > 200 && <p style={{ color: '#4A4A4A', fontSize: 12, textAlign: 'center' }}>Showing the first 200 of {allList.length}. Narrow the search to see more.</p>}
            </>
          )}
        </>
      )}

      {detail && <DetailDrawer b={detail} techName={techName(detail.technician_id)} onClose={() => setDetailId(null)} />}

      {modal?.kind === 'approve' && <ApproveModal b={modal.b} onClose={closeModal} onDone={done} />}
      {modal?.kind === 'decline' && <DeclineModal b={modal.b} onClose={closeModal} onDone={done} />}
      {modal?.kind === 'cancel' && <CancelModal b={modal.b} onClose={closeModal} onDone={done} refundHours={refundHours} />}
      {modal?.kind === 'noshow' && <NoShowModal b={modal.b} onClose={closeModal} onDone={done} />}
      {modal?.kind === 'reschedule' && <RescheduleModal b={modal.b} onClose={closeModal} onDone={done} />}
      {modal?.kind === 'assign' && <AssignModal b={modal.b} onClose={closeModal} onDone={done} techs={techs} />}
      {modal?.kind === 'refund' && <RefundModal b={modal.b} onClose={closeModal} onDone={done} />}
    </div>
  )
}
