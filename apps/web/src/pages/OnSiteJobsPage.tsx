import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Loader2, X, Phone, MapPin, ChevronLeft, ChevronRight, Camera, Plus, Trash2, Copy, ExternalLink,
  Truck, Flag, Play, CheckCircle2, UserX, ClipboardList, Package,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { scopedBranchId } from '@/lib/branchScope'
import { toast } from '@/components/ui/Toast'
import {
  OS_STATUS_LABEL, OS_STATUS_COLOR, osError, rm, fmtDate, ymd,
  type OsBooking, type OsStatus,
} from '@/lib/onsite'

// Technician / foreman view of the van's day: what to load, and each job from
// "start driving" through to the completion flow (photos, parts, health check,
// signature, optional Hub referral).

type Row = Omit<OsBooking, 'customer_signature'>
type HealthStatus = 'green' | 'amber' | 'red'

const COLS = [
  'id', 'tenant_id', 'branch_id', 'booking_number', 'token', 'status', 'customer_name', 'customer_phone',
  'vehicle_make', 'vehicle_model', 'vehicle_plate', 'tier', 'package_name', 'grade_name', 'address', 'access_notes',
  'slot_label', 'service_date', 'slot_start', 'slot_end', 'price_total', 'deposit_amount', 'deposit_status',
  'technician_id', 'photos_before', 'photos_after', 'parts_used', 'health_check', 'tech_notes', 'hub_quote_id',
].join(',')

const JOB_STATUSES: OsStatus[] = ['confirmed', 'en_route', 'arrived', 'in_progress', 'completed']
const HEALTH_ITEMS = ['Tyres', 'Brakes', 'Battery', 'Wipers', 'Lights', 'Coolant', 'Belts/hoses', 'Air filter']
const HEALTH_COLOR: Record<HealthStatus, string> = { green: '#22C55E', amber: '#F59E0B', red: '#EF4444' }
const BUCKET = 'onsite-photos'

// Primary action per status; in_progress opens the completion flow instead.
const NEXT: Partial<Record<OsStatus, { label: string; to: OsStatus; icon: React.ElementType }>> = {
  confirmed: { label: 'Start driving', to: 'en_route', icon: Truck },
  en_route: { label: 'I have arrived', to: 'arrived', icon: Flag },
  arrived: { label: 'Start service', to: 'in_progress', icon: Play },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : '')
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
const statusLink = (token: string) => `${window.location.origin}/on-site/status/${token}`
const vehicleText = (b: Row) => [b.vehicle_make, b.vehicle_model].filter(Boolean).join(' ')
const balanceDue = (b: Row) => (b.price_total == null ? null : b.price_total - (b.deposit_status === 'paid' ? b.deposit_amount : 0))

function addDays(date: string, n: number) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return ymd(d)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied')
  } catch {
    toast('Could not copy', 'error')
  }
}

// Resize to max 1600px and re-encode as JPEG to save mobile data. Falls back
// to the original file when the browser cannot decode it.
function compressImage(file: File, maxDim = 1600, quality = 0.8): Promise<Blob> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => { URL.revokeObjectURL(url); resolve(blob ?? file) }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0',
  fontSize: 16, padding: '12px', width: '100%', boxSizing: 'border-box', outline: 'none',
}
const lbl: React.CSSProperties = { fontSize: 12, color: '#A0A0A0', marginBottom: 6, display: 'block', fontWeight: 500 }
const card: React.CSSProperties = { background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, padding: 14 }

function btn(kind: 'primary' | 'ghost' | 'danger' | 'success' = 'ghost', disabled = false, big = false): React.CSSProperties {
  const map = {
    primary: { background: '#F15A22', color: '#fff', border: '1px solid #F15A22' },
    ghost: { background: '#161616', color: '#F0F0F0', border: '1px solid #2A2A2A' },
    danger: { background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.4)' },
    success: { background: 'rgba(34,197,94,0.12)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.4)' },
  }[kind]
  return {
    ...map, borderRadius: 10, padding: big ? '14px 18px' : '10px 14px', minHeight: big ? 54 : 46, fontSize: big ? 16 : 14, fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, boxSizing: 'border-box',
  }
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, color, background: `${color}22`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 8 }}>
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, width: 'min(640px, 100%)', maxHeight: '96vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #2A2A2A' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#F0F0F0' }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer', padding: 8 }}><X size={22} /></button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <p style={{ margin: '0 0 10px', color: '#F0F0F0', fontSize: 14, fontWeight: 700 }}>
        <span style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: 9999, background: '#F15A22', color: '#fff', fontSize: 12, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>{n}</span>
        {title}
      </p>
      {children}
    </div>
  )
}

// ─── Photo block ──────────────────────────────────────────────────────────────

function PhotoBlock({ bookingId, urls, onChange, label }: { bookingId: string; urls: string[]; onChange: (u: string[]) => void; label: string }) {
  const [uploading, setUploading] = useState(false)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    const added: string[] = []
    for (const file of Array.from(files)) {
      const blob = await compressImage(file)
      const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg')
      const path = `${bookingId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' })
      if (error) { toast(`Photo upload failed: ${error.message}`, 'error'); continue }
      added.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    }
    setUploading(false)
    if (added.length) onChange([...urls, ...added])
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {urls.map(u => (
          <div key={u} style={{ position: 'relative' }}>
            <img src={u} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #2A2A2A', background: '#1E1E1E' }} />
            <button onClick={() => onChange(urls.filter(x => x !== u))} aria-label="Remove photo" style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 9999, background: '#EF4444', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={14} /></button>
          </div>
        ))}
      </div>
      <label style={{ ...btn('ghost', uploading), cursor: uploading ? 'wait' : 'pointer' }}>
        {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />} {label}
        <input type="file" accept="image/*" capture="environment" multiple disabled={uploading} style={{ display: 'none' }}
          onChange={e => { add(e.target.files); e.target.value = '' }} />
      </label>
    </div>
  )
}

// ─── Signature pad (touch + mouse via pointer events) ─────────────────────────

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  const blank = useCallback(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  useEffect(() => { blank() }, [blank])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const { x, y } = point(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 0.1, y)
    ctx.stroke()
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = point(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function up() {
    if (!drawing.current) return
    drawing.current = false
    onChange(ref.current!.toDataURL('image/png'))
  }

  return (
    <div>
      <canvas ref={ref} width={640} height={220} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ width: '100%', height: 'auto', aspectRatio: '640 / 220', borderRadius: 8, touchAction: 'none', display: 'block', border: '1px solid #2A2A2A' }} />
      <button onClick={() => { blank(); onChange(null) }} style={{ ...btn('ghost'), marginTop: 8 }}>Clear signature</button>
    </div>
  )
}

// ─── Completion flow ──────────────────────────────────────────────────────────

interface Part { name: string; qty: string; note: string }
interface Health { status: HealthStatus; note: string }

function CompleteFlow({ b, onClose, onDone }: { b: Row; onClose: () => void; onDone: () => void }) {
  const user = useAuthStore(s => s.user)
  const [before, setBefore] = useState<string[]>(b.photos_before ?? [])
  const [after, setAfter] = useState<string[]>(b.photos_after ?? [])
  const [parts, setParts] = useState<Part[]>([])
  const [health, setHealth] = useState<Record<string, Health>>(
    Object.fromEntries(HEALTH_ITEMS.map(i => [i, { status: 'green' as HealthStatus, note: '' }])),
  )
  const [notes, setNotes] = useState(b.tech_notes ?? '')
  const [signature, setSignature] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false)

  const [quoteNo, setQuoteNo] = useState<string | null>(null)
  const [quoteTotal, setQuoteTotal] = useState('')
  const [quoteNotes, setQuoteNotes] = useState('')
  const [quoting, setQuoting] = useState(false)

  const flagged = HEALTH_ITEMS.filter(i => health[i].status !== 'green')
  const link = statusLink(b.token)
  const balance = balanceDue(b)

  function close() {
    const dirty = before.length > (b.photos_before?.length ?? 0) || after.length > 0 || parts.length > 0 || notes !== (b.tech_notes ?? '') || !!signature
    if (finished || !dirty || window.confirm('Discard what you entered for this job?')) onClose()
  }

  const setItem = (item: string, patch: Partial<Health>) => setHealth(h => ({ ...h, [item]: { ...h[item], ...patch } }))

  // Returns true when the quotation was created.
  async function createQuote(): Promise<boolean> {
    const total = Number(quoteTotal)
    if (!(total >= 0) || quoteTotal === '') { toast('Enter the quotation total', 'error'); return false }
    setQuoting(true)
    const notesText = quoteNotes.trim()
      || flagged.map(i => `${i} (${health[i].status})${health[i].note ? `: ${health[i].note}` : ''}`).join('\n')
    const { data, error } = await supabase.rpc('os_create_hub_quote', { p_booking: b.id, p_total: total, p_notes: notesText })
    setQuoting(false)
    if (error) { toast(error.message, 'error'); return false }
    const res = data as { ok?: boolean; error?: string; quote_number?: string }
    if (res?.error) { toast(osError(res.error), 'error'); return false }
    setQuoteNo(res.quote_number ?? null)
    toast('Hub quotation created')
    return true
  }

  async function save() {
    if (saving || quoting) return
    setSaving(true)
    // A total was typed but the quotation button was never pressed: create it first.
    if (flagged.length > 0 && quoteTotal.trim() !== '' && !b.hub_quote_id && !quoteNo) {
      const ok = await createQuote()
      if (!ok) { setSaving(false); return }
    }
    const { error } = await supabase.from('os_bookings').update({
      photos_before: before,
      photos_after: after,
      parts_used: parts.filter(p => p.name.trim()).map(p => ({ name: p.name.trim(), qty: Number(p.qty) || 1, ...(p.note.trim() ? { note: p.note.trim() } : {}) })),
      health_check: HEALTH_ITEMS.map(item => ({ item, status: health[item].status, ...(health[item].note.trim() ? { note: health[item].note.trim() } : {}) })),
      tech_notes: notes.trim() || null,
      ...(signature ? { customer_signature: signature, customer_signed_at: new Date().toISOString() } : {}),
      ...(b.technician_id == null && user?.role === 'mechanic' ? { technician_id: user.id } : {}),
      status: 'completed',
    }).eq('id', b.id)
    setSaving(false)
    if (error) return toast(error.message, 'error')
    toast('Job completed')
    setFinished(true)
  }

  if (finished) {
    return (
      <Sheet title="Job completed" onClose={() => { onClose(); onDone() }}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <CheckCircle2 size={44} style={{ color: '#22C55E' }} />
          <p style={{ color: '#F0F0F0', fontSize: 18, fontWeight: 700, margin: '12px 0 4px' }}>Balance due {rm(balance)}</p>
          <p style={{ color: '#A0A0A0', fontSize: 13, margin: '0 0 18px', lineHeight: 1.5 }}>
            The customer pays through the link we email them. You can also show them the link now.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => copyText(link)} style={btn('ghost', false, true)}><Copy size={18} /> Copy payment link</button>
            <a href={link} target="_blank" rel="noreferrer" style={btn('ghost', false, true)}><ExternalLink size={18} /> Open payment page</a>
            <button onClick={() => { onClose(); onDone() }} style={btn('primary', false, true)}>Done</button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={`Complete ${b.booking_number}`} onClose={close}>
      <Step n={1} title="Photos">
        <span style={lbl}>Before</span>
        <PhotoBlock bookingId={b.id} urls={before} onChange={setBefore} label="Add before photos" />
        <span style={{ ...lbl, marginTop: 14 }}>After</span>
        <PhotoBlock bookingId={b.id} urls={after} onChange={setAfter} label="Add after photos" />
      </Step>

      <Step n={2} title="Parts used">
        {parts.map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 44px', gap: 8, marginBottom: 8 }}>
            <input placeholder="Part name" value={p.name} onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={inp} />
            <input type="number" inputMode="numeric" min="1" placeholder="Qty" value={p.qty} onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} style={inp} />
            <button onClick={() => setParts(ps => ps.filter((_, j) => j !== i))} aria-label="Remove part" style={{ ...btn('danger'), padding: 0 }}><Trash2 size={16} /></button>
            <input placeholder="Note (optional)" value={p.note} onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} style={{ ...inp, gridColumn: '1 / -1' }} />
          </div>
        ))}
        <button onClick={() => setParts(ps => [...ps, { name: '', qty: '1', note: '' }])} style={btn()}><Plus size={16} /> Add part</button>
      </Step>

      <Step n={3} title="Health check">
        {HEALTH_ITEMS.map(item => (
          <div key={item} style={{ ...card, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 600 }}>{item}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['green', 'amber', 'red'] as HealthStatus[]).map(s => {
                  const on = health[item].status === s
                  return (
                    <button key={s} onClick={() => setItem(item, { status: s })} aria-label={`${item} ${s}`} aria-pressed={on} style={{
                      width: 44, height: 44, borderRadius: 9999, cursor: 'pointer',
                      background: on ? HEALTH_COLOR[s] : 'transparent', border: `2px solid ${HEALTH_COLOR[s]}`,
                    }} />
                  )
                })}
              </div>
            </div>
            {health[item].status !== 'green' && (
              <input placeholder="Note (optional)" value={health[item].note} onChange={e => setItem(item, { note: e.target.value })} style={{ ...inp, marginTop: 8 }} />
            )}
          </div>
        ))}
      </Step>

      <Step n={4} title="Technician notes">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} />
      </Step>

      <Step n={5} title="Customer sign-off">
        <SignaturePad onChange={setSignature} />
      </Step>

      {flagged.length > 0 && (
        <Step n={6} title="Refer to Hub (optional)">
          <p style={{ color: '#A0A0A0', fontSize: 13, margin: '0 0 10px' }}>Needs attention: {flagged.join(', ')}.</p>
          {b.hub_quote_id || quoteNo ? (
            <p style={{ color: '#22C55E', fontSize: 14, fontWeight: 600, margin: 0 }}>
              {quoteNo ? `Hub quotation ${quoteNo} created` : 'A Hub quotation already exists for this booking'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Quotation total (RM)" value={quoteTotal} onChange={e => setQuoteTotal(e.target.value)} style={inp} />
              <textarea placeholder="Notes (defaults to the flagged items)" value={quoteNotes} onChange={e => setQuoteNotes(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} />
              <button onClick={() => { void createQuote() }} disabled={quoting || saving} style={btn('ghost', quoting || saving)}>{quoting && <Loader2 size={16} className="animate-spin" />} Create Hub quotation</button>
            </div>
          )}
        </Step>
      )}

      <div style={{ ...card, marginBottom: 14 }}>
        <p style={{ margin: 0, color: '#F0F0F0', fontSize: 14, fontWeight: 600 }}>Balance due {rm(balance)}</p>
        <p style={{ margin: '4px 0 0', color: '#A0A0A0', fontSize: 12 }}>The customer pays through the link we email after you complete the job.</p>
      </div>

      {flagged.length > 0 && quoteTotal.trim() === '' && !b.hub_quote_id && !quoteNo && (
        <p style={{ margin: '0 0 10px', color: '#F59E0B', fontSize: 13, lineHeight: 1.5 }}>
          Items need attention. Add a quotation total above if the customer should get a quote.
        </p>
      )}

      <button onClick={save} disabled={saving} style={{ ...btn('primary', saving, true), width: '100%' }}>
        {saving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} Complete service
      </button>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function OnSiteJobsPage() {
  const user = useAuthStore(s => s.user)
  const ctx = useOutletContext<{ selectedBranchId: string | null } | null>()
  const role = user?.role ?? ''
  const tenantId = user?.tenant_id ?? ''
  const branchId = scopedBranchId(user, ctx?.selectedBranchId)

  const [date, setDate] = useState(ymd(new Date()))
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [completing, setCompleting] = useState<Row | null>(null)
  const [noShow, setNoShow] = useState<Row | null>(null)
  const [noShowBusy, setNoShowBusy] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId || !user) return
    let q = supabase.from('os_bookings').select(COLS).eq('tenant_id', tenantId).eq('service_date', date)
      .eq('service_mode', 'van') // BB Care Day cars are handled from the Bookings page and the workshop
      .in('status', [...JOB_STATUSES, 'awaiting_deposit']).order('slot_start')
    if (branchId) q = q.eq('branch_id', branchId)
    // mechanics see their own jobs plus unassigned ones for their van
    if (role === 'mechanic') q = q.or(`technician_id.eq.${user.id},technician_id.is.null`)
    const { data, error } = await q
    if (error) toast(error.message, 'error')
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }, [tenantId, user, date, branchId, role])

  useEffect(() => { setLoading(true); load() }, [load])

  const jobs = useMemo(() => rows.filter(r => JOB_STATUSES.includes(r.status)).sort((a, b) => (a.slot_start ?? '').localeCompare(b.slot_start ?? '')), [rows])
  const pending = rows.length - jobs.length

  // Van load list: what the foreman must pull from Hub stock for this day.
  const loadList = useMemo(() => {
    const map = new Map<string, { name: string; count: number; tier1: number; tier2: number }>()
    jobs.forEach(j => {
      const name = `${j.package_name ?? 'Service'}${j.grade_name ? ` (${j.grade_name})` : ''}`
      const e = map.get(name) ?? { name, count: 0, tier1: 0, tier2: 0 }
      e.count += 1
      if (j.tier === 'tier1') e.tier1 += 1
      if (j.tier === 'tier2') e.tier2 += 1
      map.set(name, e)
    })
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [jobs])

  async function advance(b: Row, to: OsStatus) {
    setBusyId(b.id)
    const { error } = await supabase.from('os_bookings').update({
      status: to,
      ...(b.technician_id == null && role === 'mechanic' ? { technician_id: user?.id } : {}),
    }).eq('id', b.id)
    setBusyId(null)
    if (error) return toast(error.message, 'error')
    load()
  }

  async function confirmNoShow() {
    if (!noShow) return
    setNoShowBusy(true)
    const { data, error } = await supabase.rpc('os_staff_no_show', { p_booking: noShow.id })
    setNoShowBusy(false)
    const res = data as { error?: string } | null
    if (error) return toast(error.message, 'error')
    if (res?.error) return toast(osError(res.error), 'error')
    toast('Marked as no-show')
    setNoShow(null)
    load()
  }

  const isToday = date === ymd(new Date())

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: '0 0 14px' }}>ON-SITE Jobs</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" style={{ ...btn(), padding: 0, width: 50 }}><ChevronLeft size={20} /></button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ ...inp, flex: 1, textAlign: 'center', fontWeight: 600 }} />
        <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day" style={{ ...btn(), padding: 0, width: 50 }}><ChevronRight size={20} /></button>
        {!isToday && <button onClick={() => setDate(ymd(new Date()))} style={btn('primary')}>Today</button>}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={28} style={{ color: '#F15A22' }} className="animate-spin" /></div>
      ) : (
        <>
          <section style={{ ...card, marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <h2 style={{ margin: 0, color: '#F0F0F0', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Package size={16} color="#F15A22" /> Van load list</h2>
              {loadList.length > 0 && (
                <button onClick={() => copyText(loadList.map(l => `${l.count} × ${l.name}`).join('\n'))} style={{ ...btn(), minHeight: 36, padding: '6px 12px', fontSize: 12 }}><Copy size={14} /> Copy</button>
              )}
            </div>
            {loadList.length === 0 ? (
              <p style={{ margin: 0, color: '#4A4A4A', fontSize: 13 }}>Nothing to load for {fmtDate(date)}.</p>
            ) : (
              <>
                <p style={{ margin: '0 0 8px', color: '#A0A0A0', fontSize: 12 }}>
                  {jobs.length} job{jobs.length === 1 ? '' : 's'} on {fmtDate(date)}. Hub stock needed:
                </p>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {loadList.map(l => (
                    <li key={l.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: '1px solid #2A2A2A', fontSize: 14, color: '#F0F0F0' }}>
                      <span style={{ fontWeight: 600 }}>{l.count} × {l.name}</span>
                      <span style={{ color: '#A0A0A0', fontSize: 12 }}>
                        {[l.tier1 ? `Tier 1 ×${l.tier1}` : '', l.tier2 ? `Tier 2 ×${l.tier2}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {pending > 0 && <p style={{ margin: '8px 0 0', color: '#F59E0B', fontSize: 12 }}>{pending} more booking{pending === 1 ? ' is' : 's are'} still awaiting a deposit and not counted.</p>}
            <p style={{ margin: '10px 0 0', color: '#4A4A4A', fontSize: 12 }}>Parts are transferred from the Hub stock in Inventory.</p>
          </section>

          <h2 style={{ margin: '0 0 10px', color: '#F0F0F0', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={16} color="#F15A22" /> {isToday ? "Today's jobs" : `Jobs on ${fmtDate(date)}`}
          </h2>

          {jobs.length === 0 ? (
            <p style={{ color: '#4A4A4A', fontSize: 14, textAlign: 'center', padding: 40, margin: 0 }}>No ON-SITE jobs for this day</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {jobs.map(b => {
                const next = NEXT[b.status]
                const NextIcon = next?.icon
                const busy = busyId === b.id
                const balance = balanceDue(b)
                return (
                  <div key={b.id} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: '#F15A22', fontSize: 15, fontWeight: 800 }}>{b.slot_label ?? fmtTime(b.slot_start)}</span>
                      <Chip color={OS_STATUS_COLOR[b.status]}>{OS_STATUS_LABEL[b.status]}</Chip>
                    </div>
                    <p style={{ margin: 0, color: '#F0F0F0', fontSize: 17, fontWeight: 700 }}>{b.customer_name}</p>
                    <p style={{ margin: '4px 0 0', color: '#F0F0F0', fontSize: 14 }}>
                      <strong>{b.vehicle_plate}</strong>{vehicleText(b) ? ` · ${vehicleText(b)}` : ''}
                    </p>
                    <p style={{ margin: '4px 0 0', color: '#A0A0A0', fontSize: 13 }}>
                      {b.package_name ?? '-'}{b.grade_name ? ` (${b.grade_name})` : ''}
                    </p>
                    {b.address && <p style={{ margin: '8px 0 0', color: '#F0F0F0', fontSize: 13, lineHeight: 1.5 }}>{b.address}</p>}
                    {b.access_notes && <p style={{ margin: '6px 0 0', color: '#F59E0B', fontSize: 13 }}>Access: {b.access_notes}</p>}
                    <p style={{ margin: '8px 0 0', color: '#A0A0A0', fontSize: 13 }}>
                      {b.deposit_status === 'paid'
                        ? `Deposit paid ${rm(b.deposit_amount)} · Balance due ${rm(balance)}`
                        : `Total ${rm(b.price_total)} · deposit ${b.deposit_status.replace('_', ' ')}`}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                      {b.address
                        ? <a href={mapsUrl(b.address)} target="_blank" rel="noreferrer" style={btn()}><MapPin size={18} /> Open in Maps</a>
                        : <span />}
                      <a href={`tel:${b.customer_phone}`} style={btn()}><Phone size={18} /> Call</a>
                    </div>

                    {next && NextIcon && (
                      <button onClick={() => advance(b, next.to)} disabled={busy} style={{ ...btn('primary', busy, true), width: '100%', marginTop: 10 }}>
                        {busy ? <Loader2 size={18} className="animate-spin" /> : <NextIcon size={18} />} {next.label}
                      </button>
                    )}
                    {b.status === 'in_progress' && (
                      <button onClick={() => setCompleting(b)} style={{ ...btn('primary', false, true), width: '100%', marginTop: 10 }}>
                        <CheckCircle2 size={18} /> Complete service
                      </button>
                    )}
                    {b.status === 'completed' && (
                      <button onClick={() => copyText(statusLink(b.token))} style={{ ...btn('ghost'), width: '100%', marginTop: 10 }}>
                        <Copy size={16} /> Copy payment link{balance != null ? ` (balance ${rm(balance)})` : ''}
                      </button>
                    )}
                    {['confirmed', 'en_route', 'arrived'].includes(b.status) && (
                      <button onClick={() => setNoShow(b)} style={{ ...btn('danger'), width: '100%', marginTop: 8 }}><UserX size={16} /> No-show</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {completing && <CompleteFlow b={completing} onClose={() => setCompleting(null)} onDone={load} />}

      {noShow && (
        <Sheet title={`No-show ${noShow.booking_number}`} onClose={() => setNoShow(null)}>
          <p style={{ color: '#A0A0A0', fontSize: 14, margin: '0 0 16px', lineHeight: 1.5 }}>
            Mark {noShow.customer_name} as not at the location? The deposit is kept and the customer is emailed.
          </p>
          <button onClick={confirmNoShow} disabled={noShowBusy} style={{ ...btn('danger', noShowBusy, true), width: '100%' }}>
            {noShowBusy && <Loader2 size={18} className="animate-spin" />} Confirm no-show
          </button>
        </Sheet>
      )}
    </div>
  )
}
