import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Car, Check, Loader2, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BB_STATUS_LABEL, fmtDate, OS_STATUS_COLOR, OS_STATUS_LABEL, osError, rm, rmShort, type BbDay, type OsStatus } from '@/lib/onsite'
import { BbDayPicker, Button, C, Card, ContactLine, Field, Notice, Page, PAYMENT_METHODS, startPayment, usePageMeta, usePublicContact } from '@/components/onsite/OsUi'

interface BillPlan {
  instalment: 1 | 2; pay_now: number; first_amount: number; second_amount: number
  first_due: string | null; second_due: string | null; amount_paid: number; total: number; overdue: boolean
}
interface Bill { invoice_id: string; status: 'sent' | 'overdue' | 'paid'; total: number; paid: number; balance: number; plan: BillPlan | null }

interface Booking {
  error?: string
  contact_whatsapp?: string | null; access_notes?: string | null; bill?: Bill | null
  service_mode?: 'van' | 'bb_pickup'; staff_id?: string | null; pickup_note?: string | null
  booking_number: string; status: OsStatus; request_type: string
  customer_name: string; vehicle_plate: string; vehicle: string
  package_name: string | null; grade_name: string | null; address: string | null
  service_date: string | null; slot_label: string | null
  price_total: number | null; deposit_amount: number; deposit_status: string
  amount_paid: number; balance_due: number | null; invoice_id: string | null
  hold_expires_at: string | null; decline_reason: string | null; special_reason: string | null
  reschedule_count: number; max_reschedules: number; cancel_cutoff_hours: number; refund_due_hours: number
  can_reschedule: boolean; can_cancel: boolean; refund_eligible: boolean
  refund_due_at: string | null; refunded_at: string | null
  confirmed_at: string | null; en_route_at: string | null; arrived_at: string | null; started_at: string | null; completed_at: string | null
  photos_before: string[]; photos_after: string[]
  health_check: { item: string; status: 'green' | 'amber' | 'red'; note?: string }[]
  technician_name: string | null
  hub_quote: { quote_number: string; total: number } | null
}
interface Day { date: string; slots: { slot_id: string; label: string; available: boolean }[] }

const STAGES: { key: OsStatus[]; label: string }[] = [
  { key: ['awaiting_deposit', 'requested'], label: 'Booked' },
  { key: ['confirmed'], label: 'Confirmed' },
  { key: ['en_route', 'arrived'], label: 'On the way' },
  { key: ['in_progress'], label: 'Servicing' },
  { key: ['completed'], label: 'Done' },
]

// BB Staff Car Care Day: we collect the car, service it and return it
const BB_STAGES: { key: OsStatus[]; label: string }[] = [
  { key: ['confirmed'], label: 'Booked' },
  { key: ['en_route'], label: 'Collecting' },
  { key: ['arrived'], label: 'Collected' },
  { key: ['in_progress'], label: 'In service' },
  { key: ['completed'], label: 'Returned' },
]

const FINISHED: OsStatus[] = ['completed', 'cancelled', 'declined', 'expired', 'no_show']
const DEAD: OsStatus[] = ['cancelled', 'declined', 'expired', 'no_show']

// "2026-11-05" (or a full timestamp) as a short date
const billDate = (d: string | null | undefined) => (d ? fmtDate(d.slice(0, 10)) : '')

// is the customer still expected to pay something?
function owesMoney(b: Booking): boolean {
  if (b.service_mode === 'bb_pickup') return !!b.bill && b.bill.status !== 'paid' && b.bill.balance > 0.009
  return b.status === 'completed' && (b.balance_due ?? 0) > 0.009
}

// how often to refresh, in ms (0 = not at all)
function pollInterval(b: Booking | null): number {
  if (!b) return 0
  if (b.status === 'awaiting_deposit') return 5000
  // someone may be paying right now: pick up "Fully paid" without a refresh
  if (owesMoney(b) && !DEAD.includes(b.status)) return 5000
  if (FINISHED.includes(b.status)) return 0
  return 20000
}

function fmtTime(ts: string | null) {
  return ts ? new Date(ts).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
}

export function OnSiteStatusPage() {
  const { token = '' } = useParams()
  const [b, setB] = useState<Booking | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [method, setMethod] = useState('fpx')
  const [mode, setMode] = useState<null | 'change' | 'reschedule' | 'cancel'>(null)
  const [days, setDays] = useState<Day[]>([])
  const [date, setDate] = useState('')
  const [slotId, setSlotId] = useState('')
  const [bbDays, setBbDays] = useState<BbDay[]>([])
  const [now, setNow] = useState(Date.now())
  const publicContact = usePublicContact(null, missing)
  usePageMeta(b ? `Your booking ${b.booking_number} | Motoverse` : 'Your booking | Motoverse',
    'See the latest on your Motoverse booking, and pay or change it here.')

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('os_get_booking', { p_token: token })
    if (error) return
    if (!data || data.error) setMissing(true)
    else setB(data as Booking)
  }, [token])

  useEffect(() => { load() }, [load])
  // poll while something is still moving (payment confirming, technician travelling, money still owed)
  const pollMs = pollInterval(b)
  useEffect(() => {
    if (!pollMs) return
    const t = setInterval(load, pollMs)
    return () => clearInterval(t)
  }, [pollMs, load])
  // coming back from the payment page: refresh at once
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  async function pay(invoiceId: string | null | undefined = b?.invoice_id) {
    if (!invoiceId) return
    setBusy(true); setErr('')
    const r = await startPayment(invoiceId, token, method)
    if (r.url) { window.location.href = r.url; return }
    setBusy(false); setErr(r.error ?? 'Could not start the payment.')
  }

  async function loadBbDays() {
    const { data } = await supabase.rpc('os_bb_available_days', { p_tenant_slug: null })
    setBbDays(Array.isArray(data) ? (data as BbDay[]) : []); setDate('')
  }

  async function openReschedule() {
    setMode('reschedule'); setErr('')
    if (b?.service_mode === 'bb_pickup') { await loadBbDays(); return }
    const { data } = await supabase.rpc('os_available_slots', { p_tenant_slug: null })
    setDays((data as Day[]) ?? []); setDate(''); setSlotId('')
  }

  async function change(action: 'cancel' | 'reschedule') {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('os_change_booking', { p_token: token, p_action: action, p_slot: slotId || null, p_date: date || null, p_reason: null })
    setBusy(false)
    if (error || !data) { setErr('Something went wrong. Please try again.'); return }
    if (data.error) {
      // the day list is stale (full, blocked, too soon): refresh it so the customer can pick again
      if (action === 'reschedule' && b?.service_mode === 'bb_pickup') await loadBbDays()
      setErr(osError(data.error)); return
    }
    setMode(null)
    load()
  }

  if (missing) return <Page><Notice tone="error">We could not find this booking. Please check the link you were sent, or WhatsApp us and we will help.</Notice><ContactLine number={publicContact} inline /></Page>
  if (!b) return <Page><div style={{ textAlign: 'center', padding: 60 }}><Loader2 className="animate-spin" color={C.orange} /></div></Page>

  const live = !DEAD.includes(b.status)
  const isBb = b.service_mode === 'bb_pickup'
  const stages = isBb ? BB_STAGES : STAGES
  const stageIdx = stages.findIndex(s => s.key.includes(b.status))
  const holdLeft = b.hold_expires_at ? Math.max(0, Math.floor((new Date(b.hold_expires_at).getTime() - now) / 1000)) : 0
  const selectedDay = days.find(d => d.date === date)
  const statusColor = OS_STATUS_COLOR[b.status]
  const bill = isBb ? b.bill ?? null : null

  return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        {isBb ? <Car color={C.orange} /> : <Truck color={C.orange} />}<div style={{ fontWeight: 800, fontSize: 20 }}>{isBb ? 'BB Staff Car Care Day' : 'Motoverse ON-SITE'}</div>
      </div>
      <div style={{ color: C.muted, fontSize: 14, marginBottom: 16 }}>Booking {b.booking_number}</div>

      <Card style={{ marginBottom: 12, borderColor: `${statusColor}66` }}>
        <div style={{ display: 'inline-block', background: `${statusColor}22`, color: statusColor, borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 700 }}>
          {b.status === 'requested' && b.deposit_status === 'unpaid' ? 'Request received' : (isBb ? BB_STATUS_LABEL[b.status] : undefined) ?? OS_STATUS_LABEL[b.status]}
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 10 }}>{isBb ? bbHeadline(b) : headline(b)}</div>
        {!isBb && b.status === 'en_route' && <div style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>{b.technician_name ? `${b.technician_name} is` : 'Your technician is'} heading to you{b.en_route_at ? ` (left ${fmtTime(b.en_route_at)})` : ''}.</div>}
        {isBb && b.status === 'en_route' && b.en_route_at && <div style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>Our driver left at {fmtTime(b.en_route_at)}.</div>}
        {isBb && b.status === 'confirmed' && b.pickup_note && <div style={{ color: C.muted, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>{b.pickup_note}</div>}
      </Card>

      {live && stageIdx >= 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {stages.map((s, i) => (
            <div key={s.label} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ height: 4, borderRadius: 2, background: i <= stageIdx ? C.orange : C.border }} />
              <div style={{ fontSize: 11, marginTop: 4, color: i <= stageIdx ? C.text : C.muted }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {err && <Notice tone="error">{err}</Notice>}

      {!isBb && b.status === 'awaiting_deposit' && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Pay {rm(b.deposit_amount)} to confirm</div>
          {holdLeft > 0
            ? <div style={{ color: C.amber, fontSize: 14, marginBottom: 12 }}>We are holding your slot for {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, '0')}</div>
            : <div style={{ color: C.muted, fontSize: 14, marginBottom: 12 }}>Checking your payment…</div>}
          <MethodPicker method={method} setMethod={setMethod} />
          <Button busy={busy} onClick={() => pay()}>Pay deposit {rm(b.deposit_amount)}</Button>
        </Card>
      )}

      {!isBb && b.status === 'completed' && (b.balance_due ?? 0) > 0.009 && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Balance to pay: {rm(b.balance_due)}</div>
          <MethodPicker method={method} setMethod={setMethod} />
          <Button busy={busy} onClick={() => pay()}>Pay balance {rm(b.balance_due)}</Button>
        </Card>
      )}
      {!isBb && b.status === 'completed' && (b.balance_due ?? 1) <= 0.009 && <Notice tone="ok">Fully paid. Thank you!</Notice>}

      {bill && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Your bill</div>
          <Row k="Total" v={rm(bill.total)} />
          <Row k="Paid so far" v={rm(bill.paid)} />
          <Row k="Balance" v={rm(Math.max(0, bill.balance))} />
          {(bill.status === 'paid' || bill.balance <= 0.009) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.green, fontWeight: 700, fontSize: 15, marginTop: 10 }}>
              <Check size={16} /> Paid. Thank you!
            </div>
          ) : (
            <BillDue bill={bill} live={live} busy={busy} method={method} setMethod={setMethod} onPay={() => pay(bill.invoice_id)} />
          )}
        </Card>
      )}

      {isBb ? (
        <Card style={{ marginBottom: 12 }}>
          {b.staff_id && <Row k="Staff ID" v={b.staff_id} />}
          <Row k="Car" v={`${b.vehicle} · ${b.vehicle_plate}`} />
          <Row k="Package" v={b.package_name ?? ''} />
          <Row k="Collect from" v={b.address ?? 'BB HQ'} />
          <Row k="Date" v={b.service_date ? fmtDate(b.service_date) : 'To be confirmed'} />
          {b.access_notes && <Row k="Your note" v={b.access_notes} />}
          {b.price_total != null && !bill && <>
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '8px 0' }} />
            <Row k="Package price" v={`${rmShort(b.price_total)} (BB staff price)`} />
            {live && !bill && (b.status === 'in_progress' || b.status === 'arrived') && <div style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>Your bill will appear here when your car is ready.</div>}
            {live && !bill && b.status !== 'in_progress' && b.status !== 'arrived' && b.status !== 'completed' && <div style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>Payment is made when your car is returned.</div>}
          </>}
        </Card>
      ) : (
      <Card style={{ marginBottom: 12 }}>
        <Row k="Vehicle" v={`${b.vehicle} · ${b.vehicle_plate}`} />
        <Row k="Service" v={`${b.package_name ?? ''}${b.grade_name ? ` (${b.grade_name})` : ''}`} />
        <Row k="Where" v={b.address ?? ''} />
        <Row k="When" v={b.service_date ? `${fmtDate(b.service_date)}${b.slot_label ? `, ${b.slot_label}` : ''}` : 'To be confirmed'} />
        {b.access_notes && <Row k="Your note" v={b.access_notes} />}
        {b.price_total != null && <>
          <div style={{ borderTop: `1px solid ${C.border}`, margin: '8px 0' }} />
          <Row k="Total" v={rm(b.price_total)} />
          <Row k="Paid so far" v={rm(b.amount_paid)} />
          {/* nothing is owed on a booking that was cancelled, declined, expired or missed */}
          {live && <Row k="Balance" v={rm(b.balance_due)} />}
        </>}
      </Card>
      )}

      {(b.photos_before.length > 0 || b.photos_after.length > 0) && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Photos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {[...b.photos_before, ...b.photos_after].map(u => (
              <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} /></a>
            ))}
          </div>
        </Card>
      )}

      {b.health_check.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Health check</div>
          {b.health_check.map(h => (
            <div key={h.item} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 14 }}>
              <span style={{ width: 12, height: 12, borderRadius: 6, flexShrink: 0, background: h.status === 'green' ? C.green : h.status === 'amber' ? C.amber : C.red }} />
              <span style={{ flex: 1 }}>{h.item}{h.note ? <span style={{ color: C.muted }}> · {h.note}</span> : null}</span>
            </div>
          ))}
          {b.hub_quote && <Notice tone="warn">We prepared a quotation {b.hub_quote.quote_number} ({rm(b.hub_quote.total)}) for work we found. Our workshop will contact you.</Notice>}
        </Card>
      )}

      {b.can_cancel && mode === null && (
        <Button variant="ghost" onClick={() => setMode('change')}>Change booking</Button>
      )}

      {mode === 'change' && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>What would you like to do?</div>
          {b.can_reschedule && isBb && <div style={{ marginBottom: 10 }}><Button onClick={openReschedule}>Move to another day</Button><div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>{b.max_reschedules - b.reschedule_count} change(s) left.</div></div>}
          {b.can_reschedule && !isBb && <div style={{ marginBottom: 10 }}><Button onClick={openReschedule}>Move to another time</Button><div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>Your deposit carries over. {b.max_reschedules - b.reschedule_count} change(s) left.</div></div>}
          <Button variant="danger" onClick={() => setMode('cancel')}>Cancel booking</Button>
          <div style={{ marginTop: 10 }}><Button variant="ghost" onClick={() => setMode(null)}>Never mind</Button></div>
        </Card>
      )}

      {mode === 'reschedule' && isBb && (
        <Card>
          <Field label="Pick a new day">
            {bbDays.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>No days are open right now. Please check back soon.</div>}
            {bbDays.length > 0 && <BbDayPicker days={bbDays} value={date} onChange={setDate} currentDate={b.service_date} />}
          </Field>
          {!date && <div style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>Pick a new day to continue.</div>}
          <Button busy={busy} disabled={!date} onClick={() => change('reschedule')}>Confirm new day</Button>
          <div style={{ marginTop: 10 }}><Button variant="ghost" onClick={() => setMode('change')}>Back</Button></div>
        </Card>
      )}

      {mode === 'reschedule' && !isBb && (
        <Card>
          <Field label="Pick a day">
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
              {days.map(d => {
                const free = d.slots.some(s => s.available)
                const dt = new Date(d.date + 'T00:00:00')
                return (
                  <button key={d.date} disabled={!free} onClick={() => { setDate(d.date); setSlotId('') }}
                    style={{ minWidth: 64, padding: '10px 6px', borderRadius: 10, border: `1px solid ${date === d.date ? C.orange : C.border}`, background: date === d.date ? `${C.orange}22` : '#111', color: free ? C.text : '#555', flexShrink: 0 }}>
                    <div style={{ fontSize: 11 }}>{dt.toLocaleDateString('en-MY', { weekday: 'short' })}</div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{dt.getDate()}</div>
                    <div style={{ fontSize: 11 }}>{dt.toLocaleDateString('en-MY', { month: 'short' })}</div>
                  </button>
                )
              })}
            </div>
          </Field>
          {selectedDay && (
            <Field label="Pick a time">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selectedDay.slots.map(s => (
                  <button key={s.slot_id} disabled={!s.available} onClick={() => setSlotId(s.slot_id)}
                    style={{ flex: '1 1 40%', padding: 12, borderRadius: 10, border: `1px solid ${slotId === s.slot_id ? C.orange : C.border}`, background: slotId === s.slot_id ? `${C.orange}22` : '#111', color: s.available ? C.text : '#555', fontWeight: 700 }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Button busy={busy} disabled={!slotId} onClick={() => change('reschedule')}>Confirm new time</Button>
          <div style={{ marginTop: 10 }}><Button variant="ghost" onClick={() => setMode('change')}>Back</Button></div>
        </Card>
      )}

      {mode === 'cancel' && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Cancel this booking?</div>
          {isBb
            ? <Notice tone="info">Cancelling is free. You can book another day any time.</Notice>
            : b.deposit_status === 'paid'
            ? b.refund_eligible
              ? <Notice tone="info">You are more than {b.cancel_cutoff_hours} hours ahead, so your {rm(b.deposit_amount)} deposit will be refunded within {b.refund_due_hours} hours. You can also move the booking instead.</Notice>
              : <Notice tone="warn">This is inside {b.cancel_cutoff_hours} hours of your appointment, so the deposit is not refundable.</Notice>
            : <Notice tone="info">No payment has been taken, so there is nothing to refund.</Notice>}
          <Button variant="danger" busy={busy} onClick={() => change('cancel')}>Yes, cancel booking</Button>
          <div style={{ marginTop: 10 }}><Button variant="ghost" onClick={() => setMode('change')}>Back</Button></div>
        </Card>
      )}

      {!isBb && b.deposit_status === 'refund_due' && <Notice tone="info">Your {rm(b.deposit_amount)} refund is being processed and should reach you by {b.refund_due_at ? fmtTime(b.refund_due_at) : `${b.refund_due_hours} hours`}.</Notice>}
      {!isBb && b.deposit_status === 'refunded' && <Notice tone="ok">Your deposit was refunded{b.refunded_at ? ` on ${fmtTime(b.refunded_at)}` : ''}.</Notice>}

      <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 24 }}>
        <Check size={12} style={{ verticalAlign: -2 }} /> Keep this page. It is your private link for this booking.
      </div>
      <ContactLine number={b.contact_whatsapp} />
    </Page>
  )
}

function headline(b: Booking): string {
  switch (b.status) {
    case 'awaiting_deposit': return 'Pay the deposit to confirm your slot'
    case 'requested': return b.deposit_status === 'paid' ? 'Deposit received, we are confirming your slot' : 'We will review your request and reply soon'
    case 'confirmed': return `See you ${fmtDate(b.service_date)}, ${b.slot_label ?? ''}`
    case 'en_route': return 'Your technician is on the way'
    case 'arrived': return 'Your technician has arrived'
    case 'in_progress': return 'Your service is in progress'
    case 'completed': return 'Service complete'
    case 'cancelled': return 'This booking was cancelled'
    case 'declined': return b.decline_reason ? `Request declined: ${b.decline_reason}` : 'We could not take this request'
    case 'expired': return 'The held slot was released'
    case 'no_show': return 'We could not reach you at the booked time'
  }
}

function bbHeadline(b: Booking): string {
  switch (b.status) {
    case 'confirmed': return `See you on ${fmtDate(b.service_date)}: we collect your car from BB HQ`
    case 'en_route': return 'Our driver is on the way to collect your car'
    case 'arrived': return 'Your car has been collected'
    case 'in_progress': return 'Your car is being serviced and washed'
    case 'completed': return 'Your car is back at BB HQ'
    case 'no_show': return 'We could not collect your car on the booked day'
    default: return headline(b)
  }
}

function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '3px 0' }}><span style={{ color: C.muted, flexShrink: 0 }}>{k}</span><span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</span></div>
}

// What is still owed on a BB bill: the plan wording, the payment method and the pay button.
function BillDue({ bill, live, busy, method, setMethod, onPay }: {
  bill: Bill; live: boolean; busy: boolean; method: string; setMethod: (m: string) => void; onPay: () => void
}) {
  const plan = bill.plan
  const amount = plan ? plan.pay_now : bill.balance
  const overdue = plan ? plan.overdue : bill.status === 'overdue'
  let planText = ''
  if (plan) {
    const due = billDate(plan.second_due)
    planText = plan.instalment === 2
      ? `This is your last payment${due ? `, due on ${due}` : ''}.`
      : `Payment plan: pay ${rm(plan.pay_now)} now (payment 1 of 2). The other payment, ${rm(plan.second_amount)}, is due${due ? ` on ${due}` : ' later'}.`
    if (plan.instalment === 2) planText = `Payment plan: pay ${rm(plan.pay_now)} now (payment 2 of 2). ${planText}`
  }
  return (
    <div style={{ marginTop: 10 }}>
      {overdue && (
        <span style={{ display: 'inline-block', background: `${C.red}22`, color: C.red, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Overdue</span>
      )}
      {planText && <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>{planText}</div>}
      {live && amount > 0.009 && (
        <>
          <MethodPicker method={method} setMethod={setMethod} />
          <Button busy={busy} onClick={onPay}>Pay {rm(amount)}</Button>
        </>
      )}
    </div>
  )
}

function MethodPicker({ method, setMethod }: { method: string; setMethod: (m: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
      {PAYMENT_METHODS.map(m => (
        <label key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12, borderRadius: 10, border: `1px solid ${method === m.id ? C.orange : C.border}`, background: '#111' }}>
          <input type="radio" checked={method === m.id} onChange={() => setMethod(m.id)} /> {m.label}
        </label>
      ))}
    </div>
  )
}
