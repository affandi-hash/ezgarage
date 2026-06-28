import { useState, useEffect } from 'react'
import { CalendarDays, CheckCircle, Loader2, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { DatePickerInput, TimePickerInput } from '@/components/ui/DateTimePickers'

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
  green: '#22C55E',
}

const SERVICE_TYPES = [
  'Engine Service', 'Tyre Change', 'Brake Service', 'Battery Replacement',
  'Air-Con Service', 'Electrical Repair', 'Body & Paint', 'Alignment & Balancing',
  'Suspension Service', 'Transmission Service', 'Full Inspection', 'Other',
]


interface Branch {
  id: string
  name: string
  city: string | null
}

interface FormData {
  branch_id: string
  customer_name: string
  customer_phone: string
  customer_email: string
  vehicle_plate: string
  service_type: string
  preferred_date: string
  preferred_time: string
  notes: string
}

const EMPTY_FORM: FormData = {
  branch_id: '',
  customer_name: '',
  customer_phone: '',
  customer_email: '',
  vehicle_plate: '',
  service_type: '',
  preferred_date: '',
  preferred_time: '09:00',
  notes: '',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#111',
  border: `1px solid #2A2A2A`,
  borderRadius: 6,
  color: '#F0F0F0',
  padding: '10px 14px',
  fontSize: 14,
  boxSizing: 'border-box',
  outline: 'none',
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function OnlineBookingPage() {
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [branches, setBranches] = useState<Branch[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [refNumber, setRefNumber] = useState('')
  const [tenantName, setTenantName] = useState('Our Workshop')

  useEffect(() => {
    supabase.rpc('get_portal_config').then(({ data }) => {
      if (data?.name) setTenantName(data.name)
    })
    supabase.from('branches').select('id, name, city').then(({ data }) => {
      const list = data || []
      setBranches(list)
      if (list.length === 1) setForm(f => ({ ...f, branch_id: list[0].id }))
    })
  }, [])

  const set = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.branch_id) { setError('Please select a service centre.'); return }
    if (!form.vehicle_plate.trim()) { setError('Please enter your vehicle plate number.'); return }
    if (!form.service_type) { setError('Please select a service type.'); return }
    if (!form.preferred_date) { setError('Please select a preferred date.'); return }

    setError('')
    setSubmitting(true)

    // Combine date + time into datetime string
    const scheduled_at = `${form.preferred_date}T${form.preferred_time}:00`

    const { data, error: err } = await supabase.from('bookings').insert({
      branch_id: form.branch_id,
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      customer_email: form.customer_email || null,
      vehicle_plate: form.vehicle_plate.toUpperCase().replace(/\s/g, ''),
      service_type: form.service_type,
      scheduled_at,
      arrival_mode: 'drop_off',
      status: 'pending',
      notes: form.notes || null,
      source: 'online',
    }).select('id, booking_number').single()

    setSubmitting(false)

    if (err) {
      setError('Booking failed. Please try again or call us directly.')
      console.error(err)
      return
    }

    setRefNumber(data?.booking_number || data?.id?.slice(0, 8).toUpperCase() || 'N/A')
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ width: 72, height: 72, background: C.green + '22', border: `2px solid ${C.green}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <CheckCircle size={36} color={C.green} />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.textPrimary, margin: '0 0 10px' }}>Booking Confirmed!</h1>
          <p style={{ color: C.textSecondary, fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
            Your appointment request has been received. Our team will confirm your booking via WhatsApp or phone call within 24 hours.
          </p>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '20px 28px', marginBottom: 28 }}>
            <div style={{ fontSize: 12, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Reference Number</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: C.orange, letterSpacing: 2 }}>{refNumber}</div>
          </div>
          <button
            onClick={() => { setSubmitted(false); setForm(EMPTY_FORM) }}
            style={{ background: C.orange, border: 'none', borderRadius: 8, color: '#fff', padding: '12px 32px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
          >
            Book Another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '18px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, background: C.orange, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wrench size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.textPrimary, letterSpacing: -0.3 }}>{tenantName}</div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>Book a Service Appointment</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.textPrimary, margin: '0 0 6px' }}>Schedule Your Service</h1>
          <p style={{ color: C.textSecondary, fontSize: 14, margin: 0 }}>Fill in the form below and we'll get back to you to confirm your appointment.</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Service centre */}
          {branches.length > 1 && (
            <div>
              <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Service Centre *</label>
              <select value={form.branch_id} onChange={e => set('branch_id', e.target.value)} style={inputStyle} required>
                <option value="">Select a branch…</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.city ? ` — ${b.city}` : ''}</option>)}
              </select>
            </div>
          )}

          {/* Customer info */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, marginBottom: 16 }}>Your Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Full Name *</label>
                <input style={inputStyle} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} required placeholder="Ahmad bin Abdullah" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Phone Number *</label>
                <input style={inputStyle} value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} required placeholder="01X-XXXXXXX" type="tel" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Email (optional)</label>
                <input style={inputStyle} value={form.customer_email} onChange={e => set('customer_email', e.target.value)} placeholder="you@email.com" type="email" />
              </div>
            </div>
          </div>

          {/* Vehicle */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, marginBottom: 16 }}>Vehicle Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Plate Number *</label>
                <input
                  style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: 2 }}
                  value={form.vehicle_plate}
                  onChange={e => set('vehicle_plate', e.target.value.toUpperCase())}
                  required placeholder="WXY1234"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Service Type *</label>
                <select style={inputStyle} value={form.service_type} onChange={e => set('service_type', e.target.value)} required>
                  <option value="">Select service…</option>
                  {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Schedule */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarDays size={15} /> Preferred Schedule
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Date *</label>
                <DatePickerInput value={form.preferred_date} onChange={v => set('preferred_date', v)} min={todayStr()} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Time</label>
                <TimePickerInput value={form.preferred_time} onChange={v => set('preferred_time', v)} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Additional Notes</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Describe the issue or any additional details…"
            />
          </div>

          {error && (
            <div style={{ background: '#1C1010', border: '1px solid #EF444444', borderRadius: 6, padding: '10px 14px', color: '#EF4444', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
              width: '100%', background: C.orange, border: 'none', borderRadius: 8,
              color: '#fff', padding: '14px 0', cursor: 'pointer', fontSize: 15, fontWeight: 700,
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
            {submitting ? 'Submitting…' : 'Submit Booking Request'}
          </button>

          <p style={{ textAlign: 'center', color: C.textSecondary, fontSize: 12, margin: 0 }}>
            By submitting, you agree to our terms of service. We will contact you to confirm your appointment.
          </p>
        </form>
      </div>

    </div>
  )
}
