import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarCheck, Plus, Search, X, MoreVertical,
  ChevronDown, Check, Phone, Clock, Ban, Trash2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatName, formatPhone, formatPlate, formatTitleCase } from '@/lib/formatters'
import { toast } from '@/components/ui/Toast'
import { DatePickerInput, TimePickerInput } from '@/components/ui/DateTimePickers'
import type { Booking, BookingStatus, ServiceType, ArrivalMode } from '@/types'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BOOKING_STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  pending:    { label: 'Tentative',   bg: 'rgba(245,158,11,0.2)',  text: '#FCD34D' },
  confirmed:  { label: 'Confirmed',   bg: 'rgba(34,197,94,0.2)',   text: '#86EFAC' },
  arrived:    { label: 'Checked In',  bg: 'rgba(139,92,246,0.2)', text: '#A78BFA' },
  completed:  { label: 'Completed',   bg: 'rgba(16,185,129,0.2)',  text: '#6EE7B7' },
  cancelled:  { label: 'Cancelled',   bg: 'rgba(107,114,128,0.2)', text: '#9CA3AF' },
  no_show:    { label: 'No Show',     bg: 'rgba(239,68,68,0.2)',   text: '#FCA5A5' },
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Tentative' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'arrived',   label: 'Checked In' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'no_show',   label: 'No Show' },
]

const SOURCE_OPTIONS = [
  { value: 'whatsapp',   label: 'WhatsApp' },
  { value: 'call',       label: 'Phone Call' },
  { value: 'tiktok',     label: 'TikTok' },
  { value: 'facebook',   label: 'Facebook' },
  { value: 'instagram',  label: 'Instagram' },
  { value: 'walk_in',    label: 'Walk-in' },
  { value: 'website',    label: 'Website' },
  { value: 'referral',   label: 'Referral' },
  { value: 'other',      label: 'Other' },
]

const SOURCE_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  whatsapp:  { bg: 'rgba(34,197,94,0.2)',   text: '#86EFAC' },
  call:      { bg: 'rgba(59,130,246,0.2)',  text: '#60A5FA' },
  tiktok:    { bg: 'rgba(239,68,68,0.2)',   text: '#FCA5A5' },
  facebook:  { bg: 'rgba(59,130,246,0.2)',  text: '#60A5FA' },
  instagram:  { bg: 'rgba(249,115,22,0.2)', text: '#FDBA74' },
  walk_in:   { bg: 'rgba(107,114,128,0.2)', text: '#9CA3AF' },
  website:   { bg: 'rgba(139,92,246,0.2)', text: '#A78BFA' },
  referral:  { bg: 'rgba(245,158,11,0.2)', text: '#FCD34D' },
}

const MODE_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  walk_in:   { bg: 'rgba(107,114,128,0.2)', text: '#9CA3AF' },
  booked:    { bg: 'rgba(59,130,246,0.2)',  text: '#60A5FA' },
  fleet:     { bg: 'rgba(245,158,11,0.2)',  text: '#FCD34D' },
  insurance: { bg: 'rgba(139,92,246,0.2)', text: '#A78BFA' },
  drive_in:  { bg: 'rgba(34,197,94,0.2)',  text: '#86EFAC' },
  on_site:   { bg: 'rgba(249,115,22,0.2)', text: '#FDBA74' },
  pick_up:   { bg: 'rgba(16,185,129,0.2)', text: '#6EE7B7' },
}

const SERVICE_TYPES: { value: ServiceType; label: string }[] = [
  { value: 'service',    label: 'Routine Service' },
  { value: 'repair',     label: 'Repair' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'body_work',  label: 'Body Work' },
  { value: 'tyre',       label: 'Tyre' },
  { value: 'other',      label: 'Other' },
]

const ARRIVAL_MODES: { value: ArrivalMode; label: string }[] = [
  { value: 'walk_in',   label: 'Walk-in' },
  { value: 'booked',    label: 'Drive-in (Booked)' },
  { value: 'fleet',     label: 'Fleet' },
  { value: 'insurance', label: 'Insurance' },
]

const DATE_FILTER_OPTIONS = [
  { value: 'all',   label: 'All Dates' },
  { value: 'today', label: 'Today' },
  { value: 'week',  label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

// ---------------------------------------------------------------------------
// Extended Booking type with joined fields
// ---------------------------------------------------------------------------
interface BookingRow extends Booking {
  customers?: { full_name: string; phone: string } | null
  vehicles?: { plate_number: string; make: string; model: string } | null
  customer_ic_last4?: string | null
  assigned_staff?: string | null
}

// ---------------------------------------------------------------------------
// New Booking form state
// ---------------------------------------------------------------------------
interface BookingFormData {
  customer_name: string
  customer_phone: string
  customer_ic_last4: string
  vehicle_plate: string
  vehicle_id: string
  vehicle_type: 'car' | 'bike'
  vehicle_brand: string
  vehicle_model: string
  booking_date: string
  booking_time: string
  service_type: ServiceType
  source: string
  arrival_mode: ArrivalMode
  deposit_amount: string
  deposit_paid: boolean
  problem_description: string
  notes: string
  assigned_staff: string
}

const EMPTY_FORM: BookingFormData = {
  customer_name: '',
  customer_phone: '',
  customer_ic_last4: '',
  vehicle_plate: '',
  vehicle_id: '',
  vehicle_type: 'car',
  vehicle_brand: '',
  vehicle_model: '',
  booking_date: new Date().toISOString().split('T')[0],
  booking_time: '09:00',
  service_type: 'service',
  source: 'whatsapp',
  arrival_mode: 'booked',
  deposit_amount: '',
  deposit_paid: false,
  problem_description: '',
  notes: '',
  assigned_staff: '',
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const cfg = BOOKING_STATUS_CONFIG[status] ?? BOOKING_STATUS_CONFIG.pending
  return (
    <span
      style={{
        backgroundColor: cfg.bg, color: cfg.text,
        padding: '3px 9px', borderRadius: 9999,
        fontSize: 11, fontWeight: 600,
        whiteSpace: 'nowrap' as const,
      }}
    >
      {cfg.label}
    </span>
  )
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span style={{ color: '#A0A0A0', fontSize: 11 }}>â€”</span>
  const colors = SOURCE_BADGE_COLORS[source] ?? { bg: 'rgba(107,114,128,0.2)', text: '#9CA3AF' }
  const label = SOURCE_OPTIONS.find((s) => s.value === source)?.label ?? source
  return (
    <span
      style={{
        backgroundColor: colors.bg, color: colors.text,
        padding: '3px 9px', borderRadius: 9999,
        fontSize: 11, fontWeight: 600,
        whiteSpace: 'nowrap' as const,
      }}
    >
      {label}
    </span>
  )
}

function ModeBadge({ mode }: { mode: string | null }) {
  if (!mode) return <span style={{ color: '#A0A0A0', fontSize: 11 }}>â€”</span>
  const colors = MODE_BADGE_COLORS[mode] ?? { bg: 'rgba(107,114,128,0.2)', text: '#9CA3AF' }
  const modeMap: Record<string, string> = {
    walk_in: 'Walk-in', booked: 'Drive-in', fleet: 'Fleet',
    insurance: 'Insurance', drive_in: 'Drive-in', on_site: 'On-site', pick_up: 'Pick-up',
  }
  return (
    <span
      style={{
        backgroundColor: colors.bg, color: colors.text,
        padding: '3px 9px', borderRadius: 9999,
        fontSize: 11, fontWeight: 600,
        whiteSpace: 'nowrap' as const,
      }}
    >
      {modeMap[mode] ?? mode}
    </span>
  )
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 5, letterSpacing: '0.05em' }}>
        {label.toUpperCase()}{required && <span style={{ color: '#F15A22', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  backgroundColor: '#0E0E0E', border: '1px solid #2A2A2A',
  borderRadius: 8, color: '#F0F0F0', fontSize: 13,
  outline: 'none', boxSizing: 'border-box',
}

// ---------------------------------------------------------------------------
// Actions menu
// ---------------------------------------------------------------------------
function ActionsMenu({ booking, onConfirm, onCheckIn, onConvertToJob, onCancel, onDelete }: {
  booking: BookingRow
  onConfirm: (id: string) => void
  onCheckIn: (id: string) => void
  onConvertToJob: (booking: BookingRow) => void
  onCancel: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  function handleOpen() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen(p => !p)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          background: 'none', border: '1px solid #2A2A2A',
          borderRadius: 6, color: '#A0A0A0', cursor: 'pointer',
          padding: '4px 6px', display: 'flex', alignItems: 'center',
        }}
      >
        <MoreVertical size={14} />
      </button>
      {open && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'fixed', right: menuPos.right, top: menuPos.top,
              backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A',
              borderRadius: 8, zIndex: 9999, minWidth: 180,
              overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            {[
              { label: 'Confirm Booking', action: () => { onConfirm(booking.id); setOpen(false) }, color: '#86EFAC', show: booking.status === 'pending', icon: <Check size={13} /> },
              { label: 'Check In', action: () => { onCheckIn(booking.id); setOpen(false) }, color: '#A78BFA', show: booking.status === 'confirmed', icon: null },
              { label: 'â†’ Convert to Job Card', action: () => { onConvertToJob(booking); setOpen(false) }, color: '#F15A22', show: booking.status === 'confirmed' || booking.status === 'arrived', icon: null },
              {
                label: 'Cancel Booking',
                action: () => {
                  setOpen(false)
                  if (window.confirm('Cancel this booking?')) {
                    onCancel(booking.id)
                  }
                },
                color: '#FCD34D',
                show: booking.status === 'pending' || booking.status === 'confirmed',
                icon: <Ban size={13} />,
              },
              {
                label: 'Delete Booking',
                action: () => {
                  setOpen(false)
                  if (window.confirm('Permanently delete this booking? This cannot be undone.')) {
                    onDelete(booking.id)
                  }
                },
                color: '#FCA5A5',
                show: booking.status === 'cancelled' || booking.status === 'no_show',
                icon: <Trash2 size={13} />,
              },
            ].filter((m) => m.show).map((m) => (
              <button
                key={m.label}
                onClick={m.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', textAlign: 'left',
                  padding: '9px 14px', background: 'none',
                  border: 'none', color: m.color, fontSize: 13,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2A2A2A' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        </>, document.body
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// New Booking slide-in panel
// ---------------------------------------------------------------------------
interface VehicleHit { id: string; plate_number: string; make: string; model: string }

function NewBookingPanel({
  onClose,
  onCreated,
  branchId,
}: {
  onClose: () => void
  onCreated: () => void
  branchId: string
}) {
  const { user: bookingUser } = useAuthStore()
  const [form, setForm] = useState<BookingFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [vehicleResults, setVehicleResults] = useState<VehicleHit[]>([])
  const [vehicleResolved, setVehicleResolved] = useState<VehicleHit | null>(null)

  const set = (field: keyof BookingFormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  // BUG-009: Search vehicles by plate when user types
  useEffect(() => {
    const plate = form.vehicle_plate.trim()
    if (vehicleResolved || plate.length < 2) { setVehicleResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, plate_number, make, model')
        .ilike('plate_number', `%${plate}%`)
        .limit(5)
      setVehicleResults((data ?? []) as VehicleHit[])
    }, 300)
    return () => clearTimeout(timer)
  }, [form.vehicle_plate, vehicleResolved])

  const selectVehicle = (v: VehicleHit) => {
    setVehicleResolved(v)
    setForm(prev => ({ ...prev, vehicle_plate: v.plate_number, vehicle_id: v.id, vehicle_brand: v.make, vehicle_model: v.model }))
    setVehicleResults([])
  }
  const clearVehicle = () => {
    setVehicleResolved(null)
    setForm(prev => ({ ...prev, vehicle_plate: '', vehicle_id: '', vehicle_brand: '', vehicle_model: '' }))
  }

  const handleSubmit = async () => {
    if (!form.customer_name || !form.customer_phone || !form.vehicle_plate || !form.booking_date || !form.booking_time || !form.service_type) {
      setFormError('Please fill in all required fields.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const { error: err } = await supabase.from('bookings').insert({
        branch_id: branchId,
        tenant_id: bookingUser?.tenant_id,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        vehicle_plate: form.vehicle_plate.toUpperCase(),
        vehicle_id: form.vehicle_id || null,
        vehicle_brand: form.vehicle_brand || null,
        vehicle_model: form.vehicle_model || null,
        booking_date: form.booking_date,
        booking_time: form.booking_time,
        service_type: form.service_type,
        source: form.source,
        arrival_mode: form.arrival_mode,
        deposit_amount: form.deposit_amount ? parseFloat(form.deposit_amount) : null,
        deposit_paid: form.deposit_paid,
        problem_description: form.problem_description || null,
        notes: form.notes || null,
        status: 'pending',
      })
      if (err) throw err
      onCreated()
      onClose()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to create booking')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 40, backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '100%', maxWidth: 600,
          backgroundColor: '#161616',
          borderLeft: '1px solid #2A2A2A',
          zIndex: 50,
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Panel header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #2A2A2A',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
            backgroundColor: '#161616',
            position: 'sticky', top: 0, zIndex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CalendarCheck size={18} color="#F15A22" />
            <span style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 16 }}>New Booking</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Form body */}
        <div style={{ padding: '24px', flex: 1 }}>
          {/* Section: Customer */}
          <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 16 }}>CUSTOMER</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <FormField label="Customer Name" required>
              <input style={inputStyle} value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} onBlur={(e) => set('customer_name', formatName(e.target.value))} placeholder="Full name" />
            </FormField>
            <FormField label="Phone" required>
              <input style={inputStyle} value={form.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} onBlur={(e) => set('customer_phone', formatPhone(e.target.value))} placeholder="01X-XXXXXXXX" />
            </FormField>
            <FormField label="IC Last 4">
              <input style={inputStyle} value={form.customer_ic_last4} onChange={(e) => set('customer_ic_last4', e.target.value)} placeholder="e.g. 1234" maxLength={4} />
            </FormField>
          </div>

          {/* Section: Vehicle */}
          <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 16 }}>VEHICLE</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <FormField label="Plate Number" required>
              {vehicleResolved ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0E0E0E', border: '1px solid #2A2A2A', borderRadius: 8, padding: '7px 12px' }}>
                  <div>
                    <span style={{ color: '#F15A22', fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{vehicleResolved.plate_number}</span>
                    <span style={{ color: '#A0A0A0', fontSize: 11, marginLeft: 8 }}>{vehicleResolved.make} {vehicleResolved.model}</span>
                    <span style={{ color: '#4ADE80', fontSize: 10, marginLeft: 6 }}>linked</span>
                  </div>
                  <button type="button" onClick={clearVehicle} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0 }}><X size={12} /></button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input style={inputStyle} value={form.vehicle_plate} onChange={(e) => set('vehicle_plate', e.target.value)} onBlur={(e) => set('vehicle_plate', formatPlate(e.target.value))} placeholder="e.g. WXY1234" />
                  {vehicleResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, overflow: 'hidden', marginTop: 2 }}>
                      {vehicleResults.map(v => (
                        <button key={v.id} type="button" onClick={() => selectVehicle(v)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #2A2A2A' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2A2A2A' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
                        >
                          <span style={{ color: '#F15A22', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{v.plate_number}</span>
                          <span style={{ color: '#A0A0A0', fontSize: 11, marginLeft: 8 }}>{v.make} {v.model}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </FormField>
            <FormField label="Vehicle Type">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['car', 'bike'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => set('vehicle_type', v)}
                    style={{
                      flex: 1, padding: '8px 0',
                      borderRadius: 8,
                      border: form.vehicle_type === v ? '1px solid #F15A22' : '1px solid #2A2A2A',
                      backgroundColor: form.vehicle_type === v ? 'rgba(241,90,34,0.1)' : '#0E0E0E',
                      color: form.vehicle_type === v ? '#F15A22' : '#A0A0A0',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      textTransform: 'capitalize' as const,
                    }}
                  >
                    {v === 'car' ? 'Car' : 'Bike'}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label="Brand">
              <input style={inputStyle} value={form.vehicle_brand} onChange={(e) => set('vehicle_brand', e.target.value)} onBlur={(e) => set('vehicle_brand', formatTitleCase(e.target.value))} placeholder="e.g. Toyota" />
            </FormField>
            <FormField label="Model">
              <input style={inputStyle} value={form.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} onBlur={(e) => set('vehicle_model', formatTitleCase(e.target.value))} placeholder="e.g. Vios" />
            </FormField>
          </div>

          {/* Section: Appointment */}
          <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 16 }}>APPOINTMENT</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <FormField label="Date" required>
              <DatePickerInput value={form.booking_date} onChange={v => set('booking_date', v)} style={inputStyle} />
            </FormField>
            <FormField label="Time" required>
              <TimePickerInput value={form.booking_time} onChange={v => set('booking_time', v)} style={inputStyle} />
            </FormField>
            <FormField label="Service Type" required>
              <select
                style={{ ...inputStyle, appearance: 'none' as const }}
                value={form.service_type}
                onChange={(e) => set('service_type', e.target.value)}
              >
                {SERVICE_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Arrival Mode" required>
              <select
                style={{ ...inputStyle, appearance: 'none' as const }}
                value={form.arrival_mode}
                onChange={(e) => set('arrival_mode', e.target.value)}
              >
                {ARRIVAL_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Source" required>
              <select
                style={{ ...inputStyle, appearance: 'none' as const }}
                value={form.source}
                onChange={(e) => set('source', e.target.value)}
              >
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Assigned Staff">
              <input style={inputStyle} value={form.assigned_staff} onChange={(e) => set('assigned_staff', e.target.value)} placeholder="Staff name" />
            </FormField>
          </div>

          {/* Section: Deposit */}
          <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 16 }}>DEPOSIT</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <FormField label="Deposit Amount (RM)">
              <input
                type="number"
                style={inputStyle}
                value={form.deposit_amount}
                onChange={(e) => set('deposit_amount', e.target.value)}
                placeholder="0.00"
                min="0"
              />
            </FormField>
            <FormField label="Deposit Paid">
              <div
                onClick={() => set('deposit_paid', !form.deposit_paid)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  backgroundColor: '#0E0E0E', border: '1px solid #2A2A2A',
                  borderRadius: 8, cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <div
                  style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: `2px solid ${form.deposit_paid ? '#F15A22' : '#2A2A2A'}`,
                    backgroundColor: form.deposit_paid ? '#F15A22' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {form.deposit_paid && <Check size={12} color="#fff" strokeWidth={3} />}
                </div>
                <span style={{ color: form.deposit_paid ? '#F0F0F0' : '#A0A0A0', fontSize: 13 }}>
                  {form.deposit_paid ? 'Yes, paid' : 'Not yet'}
                </span>
              </div>
            </FormField>
          </div>

          {/* Section: Details */}
          <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 16 }}>DETAILS</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            <FormField label="Problem Description">
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
                value={form.problem_description}
                onChange={(e) => set('problem_description', e.target.value)}
                placeholder="Customer's complaint or reason for visit..."
              />
            </FormField>
            <FormField label="Internal Notes">
              <textarea
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Internal notes for the team..."
              />
            </FormField>
          </div>

          {formError && (
            <p style={{ color: '#FCA5A5', fontSize: 13, marginBottom: 12 }}>{formError}</p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #2A2A2A',
            display: 'flex', gap: 10, justifyContent: 'flex-end',
            flexShrink: 0,
            backgroundColor: '#161616',
            position: 'sticky', bottom: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '0 24px', minHeight: 44, borderRadius: 8,
              border: '1px solid #2A2A2A', backgroundColor: 'transparent',
              color: '#A0A0A0', fontSize: 13, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '0 28px', minHeight: 44, borderRadius: 8,
              border: 'none', backgroundColor: '#F15A22',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Creatingâ€¦' : 'Create Booking'}
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Convert to Job Card modal â€” Option B: search & link customer + vehicle
// ---------------------------------------------------------------------------
interface ConvertModalProps {
  booking: BookingRow
  branchId: string
  tenantId: string | null
  onClose: () => void
  onCreated: () => void
}

type LinkMode = 'search' | 'selected' | 'new'

interface CustomerRow { id: string; full_name: string; phone: string; email?: string | null }
interface VehicleRow  { id: string; plate_number: string; make: string; model: string; year?: number | null }

function ConvertToJobModal({ booking, branchId, tenantId, onClose, onCreated }: ConvertModalProps) {
  // â”€â”€ Customer state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [custSearch,   setCustSearch]   = useState(booking.customer_phone ?? booking.customer_name ?? '')
  const [custResults,  setCustResults]  = useState<CustomerRow[]>([])
  const [custMode,     setCustMode]     = useState<LinkMode>('search')
  const [selCust,      setSelCust]      = useState<CustomerRow | null>(null)
  const [newCustName,  setNewCustName]  = useState(booking.customer_name ?? '')
  const [newCustPhone, setNewCustPhone] = useState(booking.customer_phone ?? '')

  // â”€â”€ Vehicle state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [vehSearch,    setVehSearch]    = useState(booking.vehicle_plate ?? '')
  const [vehResults,   setVehResults]   = useState<VehicleRow[]>([])
  const [vehMode,      setVehMode]      = useState<LinkMode>('search')
  const [selVeh,       setSelVeh]       = useState<VehicleRow | null>(null)
  const [newVehPlate,  setNewVehPlate]  = useState(booking.vehicle_plate ?? '')
  const [newVehMake,   setNewVehMake]   = useState(booking.vehicle_brand ?? '')
  const [newVehModel,  setNewVehModel]  = useState(booking.vehicle_model ?? '')

  const [saving, setSaving] = useState(false)

  // â”€â”€ Customer search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (custMode !== 'search' || custSearch.trim().length < 2) { setCustResults([]); return }
    const t = setTimeout(async () => {
      const q = custSearch.trim()
      const { data } = await supabase
        .from('customers')
        .select('id, full_name, phone, email')
        .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
        .eq('branch_id', branchId)
        .limit(6)
      setCustResults((data as CustomerRow[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [custSearch, custMode, branchId])

  // â”€â”€ Vehicle search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (vehMode !== 'search' || vehSearch.trim().length < 2) { setVehResults([]); return }
    const t = setTimeout(async () => {
      const q = vehSearch.trim().toUpperCase()
      const { data } = await supabase
        .from('vehicles')
        .select('id, plate_number, make, model, year')
        .ilike('plate_number', `%${q}%`)
        .limit(6)
      setVehResults((data as VehicleRow[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [vehSearch, vehMode])

  // â”€â”€ Submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function handleCreate() {
    setSaving(true)
    try {
      let customerId: string | null = null
      let vehicleId:  string | null = null

      // Resolve customer
      if (custMode === 'selected' && selCust) {
        customerId = selCust.id
      } else if (custMode === 'new') {
        const { data, error } = await supabase
          .from('customers')
          .insert({ branch_id: branchId, tenant_id: tenantId, full_name: newCustName.trim(), phone: newCustPhone.trim() })
          .select('id').single()
        if (error) throw error
        customerId = data.id
      }

      // Resolve vehicle
      if (vehMode === 'selected' && selVeh) {
        vehicleId = selVeh.id
      } else if (vehMode === 'new') {
        const { data, error } = await supabase
          .from('vehicles')
          .insert({ branch_id: branchId, tenant_id: tenantId, customer_id: customerId,
            plate_number: newVehPlate.trim().toUpperCase(), make: newVehMake.trim(), model: newVehModel.trim() })
          .select('id').single()
        if (error) throw error
        vehicleId = data.id
      }

      // Create job card
      const { error: jobErr } = await supabase.from('jobs').insert({
        branch_id: branchId,
        tenant_id: tenantId,
        customer_id: customerId,
        vehicle_id:  vehicleId,
        service_type:  booking.service_type ?? 'service',
        arrival_mode:  booking.arrival_mode  ?? 'booked',
        status:        'checked_in',
        vehicle_type:  'car',
        source:        booking.source ?? 'website',
        customer_complaint: (booking as any).problem_description ?? null,
        checked_in_at: new Date().toISOString(),
        payment_status: 'unpaid',
      })
      if (jobErr) throw jobErr

      await supabase.from('bookings').update({ status: 'arrived' }).eq('id', booking.id)
      toast('Job card created successfully')
      onCreated()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to create job card', 'error')
    } finally {
      setSaving(false)
    }
  }

  const canCreate = (custMode === 'selected' || custMode === 'new') &&
                    (vehMode  === 'selected' || vehMode  === 'new')

  // â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const S = {
    overlay:   { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modal:     { background: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 24px 60px rgba(0,0,0,0.6)' },
    header:    { padding: '20px 24px 0', borderBottom: '1px solid #1E1E1E', paddingBottom: 16 },
    body:      { padding: '20px 24px' },
    section:   { background: '#1C1C1C', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16 },
    label:     { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 4, display: 'block' },
    input:     { width: '100%', background: '#111', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13, padding: '8px 12px', outline: 'none', boxSizing: 'border-box' as const },
    chip:      { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1A3A1A', border: '1px solid #2D6A2D', borderRadius: 20, padding: '4px 10px 4px 8px', fontSize: 12, color: '#6EE7B7' },
    resultRow: { padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#F0F0F0', display: 'flex', justifyContent: 'space-between' as const, alignItems: 'center' },
    btnGhost:  { background: 'none', border: '1px solid #2A2A2A', borderRadius: 6, color: '#A0A0A0', fontSize: 12, padding: '5px 12px', cursor: 'pointer' },
    btnOrange: { background: '#F15A22', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700, padding: '10px 24px', cursor: 'pointer', opacity: canCreate && !saving ? 1 : 0.4 },
    hint:      { fontSize: 11, color: '#555', marginTop: 4 },
  }

  function CustSection() {
    if (custMode === 'selected' && selCust) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={S.chip}>
          <Check size={12} /> {selCust.full_name} Â· {selCust.phone}
        </div>
        <button style={S.btnGhost} onClick={() => { setCustMode('search'); setSelCust(null) }}>Change</button>
      </div>
    )
    if (custMode === 'new') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: '#F9A825' }}>Creating new customer</span>
          <button style={S.btnGhost} onClick={() => setCustMode('search')}>Back to search</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={S.label}>Full Name *</label>
            <input style={S.input} value={newCustName} onChange={e => setNewCustName(e.target.value)} onBlur={e => setNewCustName(formatName(e.target.value))} placeholder="Ahmad bin Ali" />
          </div>
          <div>
            <label style={S.label}>Phone *</label>
            <input style={S.input} value={newCustPhone} onChange={e => setNewCustPhone(e.target.value)} onBlur={e => setNewCustPhone(formatPhone(e.target.value))} placeholder="01X-XXXXXXX" />
          </div>
        </div>
      </div>
    )
    return (
      <div>
        <input
          style={S.input} value={custSearch} placeholder="Search by name or phoneâ€¦"
          onChange={e => { setCustSearch(e.target.value); setCustMode('search') }}
          autoFocus
        />
        {custResults.length > 0 && (
          <div style={{ background: '#111', border: '1px solid #2A2A2A', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
            {custResults.map(c => (
              <div key={c.id} style={S.resultRow}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#1E1E1E'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'none'}
                onClick={() => { setSelCust(c); setCustMode('selected'); setCustResults([]) }}
              >
                <span>{c.full_name}</span>
                <span style={{ color: '#666', fontSize: 12 }}>{c.phone}</span>
              </div>
            ))}
          </div>
        )}
        {custSearch.length >= 2 && custResults.length === 0 && (
          <p style={S.hint}>No match found.</p>
        )}
        <button style={{ ...S.btnGhost, marginTop: 8 }} onClick={() => setCustMode('new')}>
          + Create new customer
        </button>
      </div>
    )
  }

  function VehSection() {
    if (vehMode === 'selected' && selVeh) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={S.chip}>
          <Check size={12} /> {selVeh.plate_number} Â· {selVeh.make} {selVeh.model}
        </div>
        <button style={S.btnGhost} onClick={() => { setVehMode('search'); setSelVeh(null) }}>Change</button>
      </div>
    )
    if (vehMode === 'new') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: '#F9A825' }}>Creating new vehicle</span>
          <button style={S.btnGhost} onClick={() => setVehMode('search')}>Back to search</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div>
            <label style={S.label}>Plate *</label>
            <input style={{ ...S.input, textTransform: 'uppercase', letterSpacing: 2 }} value={newVehPlate} onChange={e => setNewVehPlate(e.target.value)} onBlur={e => setNewVehPlate(formatPlate(e.target.value))} placeholder="WXY 1234" />
          </div>
          <div>
            <label style={S.label}>Make</label>
            <input style={S.input} value={newVehMake} onChange={e => setNewVehMake(e.target.value)} onBlur={e => setNewVehMake(formatTitleCase(e.target.value))} placeholder="Toyota" />
          </div>
          <div>
            <label style={S.label}>Model</label>
            <input style={S.input} value={newVehModel} onChange={e => setNewVehModel(e.target.value)} onBlur={e => setNewVehModel(formatTitleCase(e.target.value))} placeholder="Vios" />
          </div>
        </div>
      </div>
    )
    return (
      <div>
        <input
          style={{ ...S.input, textTransform: 'uppercase', letterSpacing: 1 }}
          value={vehSearch} placeholder="Search by plate numberâ€¦"
          onChange={e => { setVehSearch(e.target.value.toUpperCase()); setVehMode('search') }}
        />
        {vehResults.length > 0 && (
          <div style={{ background: '#111', border: '1px solid #2A2A2A', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
            {vehResults.map(v => (
              <div key={v.id} style={S.resultRow}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#1E1E1E'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'none'}
                onClick={() => { setSelVeh(v); setVehMode('selected'); setVehResults([]) }}
              >
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.plate_number}</span>
                <span style={{ color: '#666', fontSize: 12 }}>{v.make} {v.model}</span>
              </div>
            ))}
          </div>
        )}
        {vehSearch.length >= 2 && vehResults.length === 0 && (
          <p style={S.hint}>No match found.</p>
        )}
        <button style={{ ...S.btnGhost, marginTop: 8 }} onClick={() => setVehMode('new')}>
          + Create new vehicle
        </button>
      </div>
    )
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F0' }}>Convert to Job Card</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
          </div>
          <span style={{ fontSize: 12, color: '#666' }}>
            Booking {(booking as any).booking_number ?? booking.id.slice(0, 8)} Â·{' '}
            {booking.customer_name ?? ''}{booking.vehicle_plate ? ` Â· ${booking.vehicle_plate}` : ''}
          </span>
        </div>

        {/* Body */}
        <div style={S.body}>
          {/* Customer */}
          <div style={S.section}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#F15A22', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
              Customer
            </div>
            {booking.customer_name || booking.customer_phone ? (
              <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                From booking: <span style={{ color: '#A0A0A0' }}>{booking.customer_name}{booking.customer_phone ? ` Â· ${booking.customer_phone}` : ''}</span>
              </div>
            ) : null}
            <CustSection />
          </div>

          {/* Vehicle */}
          <div style={S.section}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#F15A22', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
              Vehicle
            </div>
            {booking.vehicle_plate ? (
              <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                From booking: <span style={{ color: '#A0A0A0', fontFamily: 'monospace' }}>{booking.vehicle_plate}</span>
                {(booking.vehicle_brand || booking.vehicle_model) ? <span style={{ color: '#666' }}> Â· {booking.vehicle_brand} {booking.vehicle_model}</span> : null}
              </div>
            ) : null}
            <VehSection />
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
            <button style={S.btnGhost} onClick={onClose}>Cancel</button>
            <button style={S.btnOrange} disabled={!canCreate || saving} onClick={handleCreate}>
              {saving ? 'Creatingâ€¦' : 'Create Job Card'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function BookingsPage() {
  const { user } = useAuthStore()
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [showNewPanel, setShowNewPanel] = useState(false)
  const [convertingBooking, setConvertingBooking] = useState<BookingRow | null>(null)

  const branchId = user?.branch_id

  const fetchBookings = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('bookings')
        .select(`
          id, booking_number, status, booking_date, booking_time,
          service_type, source, arrival_mode, deposit_amount, deposit_paid,
          customer_name, customer_phone, vehicle_plate, vehicle_brand, vehicle_model,
          customers!customer_id(full_name, phone),
          vehicles!vehicle_id(plate_number, make, model)
        `)
        .eq('branch_id', branchId)
        .order('booking_date', { ascending: false })

      if (err) throw err
      setBookings((data as unknown as BookingRow[]) ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load bookings')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const updateBookingStatus = async (id: string, status: BookingStatus) => {
    const { error: err } = await supabase.from('bookings').update({ status }).eq('id', id)
    if (!err) {
      setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status } : b))
      toast('Booking status updated')
    } else {
      toast(err.message, 'error')
    }
  }

  const deleteBooking = async (id: string) => {
    const { error: err } = await supabase.from('bookings').delete().eq('id', id)
    if (!err) {
      setBookings((prev) => prev.filter((b) => b.id !== id))
      toast('Booking deleted')
    } else {
      toast(err.message, 'error')
    }
  }

  // Filter logic
  const today = new Date().toISOString().split('T')[0]
  const startOfWeek = (() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split('T')[0]
  })()
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

  const filtered = bookings.filter((b) => {
    if (activeTab !== 'all' && b.status !== activeTab) return false
    if (search) {
      const q = search.toLowerCase()
      const name = (b.customers?.full_name ?? b.customer_name ?? '').toLowerCase()
      const phone = (b.customers?.phone ?? b.customer_phone ?? '').toLowerCase()
      const plate = (b.vehicles?.plate_number ?? b.vehicle_plate ?? '').toLowerCase()
      const num = (b.booking_number ?? '').toLowerCase()
      if (!name.includes(q) && !phone.includes(q) && !plate.includes(q) && !num.includes(q)) return false
    }
    if (dateFilter === 'today' && b.booking_date !== today) return false
    if (dateFilter === 'week' && b.booking_date < startOfWeek) return false
    if (dateFilter === 'month' && b.booking_date < startOfMonth) return false
    if (sourceFilter !== 'all' && b.source !== sourceFilter) return false
    return true
  })

  const tabCounts = STATUS_TABS.reduce<Record<string, number>>((acc, tab) => {
    acc[tab.key] = tab.key === 'all'
      ? bookings.length
      : bookings.filter((b) => b.status === tab.key).length
    return acc
  }, {})

  return (
    <div style={{ backgroundColor: '#0E0E0E', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ---- Header ---- */}
      <div
        style={{
          backgroundColor: '#161616',
          borderBottom: '1px solid #2A2A2A',
          padding: '14px 20px',
          display: 'flex', alignItems: 'center', gap: 12,
          flexShrink: 0, flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 160 }}>
          <CalendarCheck size={20} color="#F15A22" />
          <span style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 18 }}>Bookings</span>
          <span style={{ color: '#A0A0A0', fontSize: 13, marginLeft: 4 }}>
            {loading ? '' : `${bookings.length} total`}
          </span>
        </div>
        <button
          onClick={() => setShowNewPanel(true)}
          style={{
            padding: '8px 18px', borderRadius: 8,
            border: 'none', backgroundColor: '#F15A22',
            color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={14} />
          New Booking
        </button>
      </div>

      {/* ---- Filter bar ---- */}
      <div
        style={{
          backgroundColor: '#161616',
          borderBottom: '1px solid #2A2A2A',
          padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: 8,
          flexWrap: 'wrap', flexShrink: 0,
        }}
      >
        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {STATUS_TABS.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '5px 12px', borderRadius: 20,
                  border: '1px solid',
                  borderColor: active ? '#F15A22' : '#2A2A2A',
                  backgroundColor: active ? 'rgba(241,90,34,0.15)' : 'transparent',
                  color: active ? '#F15A22' : '#A0A0A0',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {tab.label}
                {tabCounts[tab.key] > 0 && (
                  <span style={{ marginLeft: 5, opacity: 0.7 }}>({tabCounts[tab.key]})</span>
                )}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div style={{ position: 'relative', minWidth: 200 }}>
          <Search size={13} color="#A0A0A0" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, plate, booking #..."
            style={{
              ...inputStyle,
              paddingLeft: 30,
              padding: '7px 12px 7px 30px',
              fontSize: 12,
            }}
          />
        </div>

        {/* Date filter */}
        <div style={{ position: 'relative' }}>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={{ ...inputStyle, fontSize: 12, padding: '7px 28px 7px 12px', width: 'auto', appearance: 'none' as const, paddingRight: 28 }}
          >
            {DATE_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown size={12} color="#A0A0A0" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        </div>

        {/* Source filter */}
        <div style={{ position: 'relative' }}>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{ ...inputStyle, fontSize: 12, padding: '7px 28px 7px 12px', width: 'auto', appearance: 'none' as const, paddingRight: 28 }}
          >
            <option value="all">All Sources</option>
            {SOURCE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <ChevronDown size={12} color="#A0A0A0" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        </div>
      </div>

      {/* ---- Table area ---- */}
      <div style={{ flex: 1, overflowX: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 36, height: 36, border: '3px solid #2A2A2A', borderTopColor: '#F15A22', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
              <p style={{ color: '#A0A0A0', fontSize: 13 }}>Loading bookingsâ€¦</p>
            </div>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: '#FCA5A5', fontSize: 14 }}>{error}</p>
            <button onClick={fetchBookings} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', cursor: 'pointer' }}>Retry</button>
          </div>
        ) : (
          <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 10, overflow: 'hidden' }}>
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 1fr 120px 130px 100px 100px 110px 48px',
                padding: '10px 16px',
                borderBottom: '1px solid #2A2A2A',
                backgroundColor: '#1E1E1E',
              }}
            >
              {['Booking #', 'Customer', 'Vehicle', 'Date & Time', 'Service', 'Source', 'Mode', 'Status', ''].map((h) => (
                <span key={h} style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>{h.toUpperCase()}</span>
              ))}
            </div>

            {/* Rows */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                <CalendarCheck size={32} color="#2A2A2A" style={{ marginBottom: 12 }} />
                <p style={{ color: '#A0A0A0', fontSize: 14, margin: 0 }}>No bookings found</p>
                <p style={{ color: '#A0A0A0', fontSize: 12, marginTop: 4 }}>
                  {activeTab !== 'all' || search ? 'Try adjusting your filters' : 'Create your first booking'}
                </p>
              </div>
            ) : (
              filtered.map((booking, idx) => {
                const name = booking.customers?.full_name ?? booking.customer_name ?? 'â€”'
                const phone = booking.customers?.phone ?? booking.customer_phone ?? ''
                const plate = booking.vehicles?.plate_number ?? booking.vehicle_plate ?? 'â€”'
                const vehicleStr = [
                  booking.vehicles?.make ?? booking.vehicle_brand,
                  booking.vehicles?.model ?? booking.vehicle_model,
                ].filter(Boolean).join(' ')
                const dateStr = booking.booking_date
                  ? new Date(booking.booking_date + 'T00:00').toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
                  : 'â€”'
                const timeStr = booking.booking_time ?? ''
                const serviceLabel = SERVICE_TYPES.find((s) => s.value === booking.service_type)?.label ?? booking.service_type ?? 'â€”'

                return (
                  <div
                    key={booking.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '140px 1fr 1fr 120px 130px 100px 100px 110px 48px',
                      padding: '12px 16px',
                      borderBottom: idx < filtered.length - 1 ? '1px solid #2A2A2A' : 'none',
                      alignItems: 'center',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = '#1A1A1A' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent' }}
                  >
                    {/* Booking # */}
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(241,90,34,0.9)', fontWeight: 600 }}>
                      {booking.booking_number ?? 'â€”'}
                    </span>

                    {/* Customer */}
                    <div>
                      <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: 0 }}>{name}</p>
                      {phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <Phone size={10} color="#A0A0A0" />
                          <span style={{ color: '#A0A0A0', fontSize: 11 }}>{phone}</span>
                        </div>
                      )}
                    </div>

                    {/* Vehicle */}
                    <div>
                      <p style={{ color: '#F0F0F0', fontSize: 13, fontFamily: 'monospace', fontWeight: 600, margin: 0 }}>{plate}</p>
                      {vehicleStr && <p style={{ color: '#A0A0A0', fontSize: 11, margin: '2px 0 0' }}>{vehicleStr}</p>}
                    </div>

                    {/* Date & Time */}
                    <div>
                      <p style={{ color: '#F0F0F0', fontSize: 12, margin: 0 }}>{dateStr}</p>
                      {timeStr && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <Clock size={10} color="#A0A0A0" />
                          <span style={{ color: '#A0A0A0', fontSize: 11 }}>{timeStr}</span>
                        </div>
                      )}
                    </div>

                    {/* Service */}
                    <span style={{ color: '#A0A0A0', fontSize: 12 }}>{serviceLabel}</span>

                    {/* Source */}
                    <SourceBadge source={booking.source} />

                    {/* Mode */}
                    <ModeBadge mode={booking.arrival_mode} />

                    {/* Status */}
                    <StatusBadge status={booking.status} />

                    {/* Actions */}
                    <ActionsMenu
                      booking={booking}
                      onConfirm={(id) => updateBookingStatus(id, 'confirmed')}
                      onCheckIn={(id) => updateBookingStatus(id, 'arrived')}
                      onConvertToJob={(b) => setConvertingBooking(b)}
                      onCancel={(id) => updateBookingStatus(id, 'cancelled')}
                      onDelete={deleteBooking}
                    />
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ---- New Booking panel ---- */}
      {showNewPanel && branchId && (
        <NewBookingPanel
          branchId={branchId}
          onClose={() => setShowNewPanel(false)}
          onCreated={fetchBookings}
        />
      )}

      {/* ---- Convert to Job Card modal ---- */}
      {convertingBooking && branchId && (
        <ConvertToJobModal
          booking={convertingBooking}
          branchId={branchId}
          tenantId={user?.tenant_id ?? null}
          onClose={() => setConvertingBooking(null)}
          onCreated={() => {
            fetchBookings()
            setConvertingBooking(null)
          }}
        />
      )}
    </div>
  )
}

export default BookingsPage
