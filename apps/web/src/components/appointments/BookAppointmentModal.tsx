import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useAppointmentsStore } from '@/hooks/useAppointments'
import { DatePickerInput, TimePickerInput } from '@/components/ui/DateTimePickers'
import type { CreateAppointmentPayload } from '@/types/appointment'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

const SERVICE_TYPES = [
  'Oil Change',
  'Full Service',
  'Brake Service',
  'Tyre Change',
  'Alignment & Balancing',
  'Engine Repair',
  'Electrical',
  'Air-Conditioning',
  'Body & Paint',
  'Inspection',
  'Other',
]

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  text: '#F0F0F0',
  muted: '#A0A0A0',
  orange: '#F15A22',
  orangeHover: '#D94E1A',
} as const

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 14,
  background: C.bg,
  color: C.text,
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 500,
  color: C.muted,
  marginBottom: 4,
}

export function BookAppointmentModal({ onClose, onSuccess }: Props) {
  const user = useAuthStore((s) => s.user)
  const { createAppointment } = useAppointmentsStore()

  const [form, setForm] = useState<Omit<CreateAppointmentPayload, 'branch_id'>>({
    customer_phone: '',
    customer_name: '',
    plate_number: '',
    vehicle_make: '',
    vehicle_model: '',
    vehicle_year: null,
    service_type: '',
    appointment_date: '',
    appointment_time: '',
    notes: '',
    source: 'direct',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelHover, setCancelHover] = useState(false)
  const [submitHover, setSubmitHover] = useState(false)
  const [closeHover, setCloseHover] = useState(false)

  const set = (field: keyof typeof form, value: string | number | null) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.branch_id) return

    setSaving(true)
    setError(null)

    const { error: err } = await createAppointment({
      ...form,
      branch_id: user.branch_id,
      vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null,
    })

    setSaving(false)
    if (err) {
      setError(err)
      return
    }
    onSuccess()
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
    >
      <div
        style={{
          background: C.surface,
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          width: '100%',
          maxWidth: 520,
          margin: '0 16px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${C.border}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>
            Book Appointment
          </h2>
          <button
            onClick={onClose}
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1,
              color: closeHover ? C.text : C.muted,
              padding: 4,
              transition: 'color 0.15s',
            }}
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            overflowY: 'auto',
            padding: '20px 24px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Customer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Phone *</label>
              <input
                type="tel"
                required
                value={form.customer_phone}
                onChange={(e) => set('customer_phone', e.target.value)}
                placeholder="01X-XXXXXXX"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Name *</label>
              <input
                type="text"
                required
                value={form.customer_name}
                onChange={(e) => set('customer_name', e.target.value)}
                placeholder="Full name"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Vehicle */}
          <div>
            <label style={labelStyle}>Plate Number *</label>
            <input
              type="text"
              required
              value={form.plate_number}
              onChange={(e) => set('plate_number', e.target.value.toUpperCase())}
              placeholder="ABC 1234"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Make *</label>
              <input
                type="text"
                required
                value={form.vehicle_make}
                onChange={(e) => set('vehicle_make', e.target.value)}
                placeholder="e.g. Toyota"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Model *</label>
              <input
                type="text"
                required
                value={form.vehicle_model}
                onChange={(e) => set('vehicle_model', e.target.value)}
                placeholder="e.g. Vios"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Year</label>
              <input
                type="number"
                min={1980}
                max={new Date().getFullYear() + 1}
                value={form.vehicle_year ?? ''}
                onChange={(e) => set('vehicle_year', e.target.value ? Number(e.target.value) : null)}
                placeholder="2020"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Service */}
          <div>
            <label style={labelStyle}>Service Type *</label>
            <select
              required
              value={form.service_type}
              onChange={(e) => set('service_type', e.target.value)}
              style={{ ...inputStyle, appearance: 'none' }}
            >
              <option value="">Select service…</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Date & Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Date *</label>
              <DatePickerInput value={form.appointment_date} onChange={v => set('appointment_date', v)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Time *</label>
              <TimePickerInput value={form.appointment_time} onChange={v => set('appointment_time', v)} style={inputStyle} />
            </div>
          </div>

          {/* Source */}
          <div>
            <label style={labelStyle}>Booking Source</label>
            <div style={{ display: 'flex', gap: 16 }}>
              {(['direct', 'mia_whatsapp'] as const).map((src) => (
                <label
                  key={src}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: C.text,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="source"
                    value={src}
                    checked={form.source === src}
                    onChange={() => set('source', src)}
                    style={{ accentColor: C.orange }}
                  />
                  {src === 'direct' ? 'Direct / Walk-in' : 'Mia (WhatsApp)'}
                </label>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Any additional details…"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {error && (
            <p style={{ color: '#F87171', fontSize: 12, margin: 0 }}>{error}</p>
          )}
        </form>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '16px 24px',
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            onMouseEnter={() => setCancelHover(true)}
            onMouseLeave={() => setCancelHover(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '8px 16px',
              fontSize: 13,
              color: cancelHover ? C.text : C.muted,
              borderRadius: 8,
              transition: 'color 0.15s',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={saving}
            onMouseEnter={() => setSubmitHover(true)}
            onMouseLeave={() => setSubmitHover(false)}
            style={{
              padding: '8px 20px',
              background: saving ? C.muted : submitHover ? C.orangeHover : C.orange,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Booking…' : 'Book Appointment'}
          </button>
        </div>
      </div>
    </div>
  )
}
