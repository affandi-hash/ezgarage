import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useAppointmentsStore } from '@/hooks/useAppointments'
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

  const inputCls =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Book Appointment</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Phone *</label>
              <input
                type="tel"
                required
                value={form.customer_phone}
                onChange={(e) => set('customer_phone', e.target.value)}
                placeholder="01X-XXXXXXX"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Name *</label>
              <input
                type="text"
                required
                value={form.customer_name}
                onChange={(e) => set('customer_name', e.target.value)}
                placeholder="Full name"
                className={inputCls}
              />
            </div>
          </div>

          {/* Vehicle */}
          <div>
            <label className={labelCls}>Plate Number *</label>
            <input
              type="text"
              required
              value={form.plate_number}
              onChange={(e) => set('plate_number', e.target.value.toUpperCase())}
              placeholder="ABC 1234"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Make *</label>
              <input
                type="text"
                required
                value={form.vehicle_make}
                onChange={(e) => set('vehicle_make', e.target.value)}
                placeholder="e.g. Toyota"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Model *</label>
              <input
                type="text"
                required
                value={form.vehicle_model}
                onChange={(e) => set('vehicle_model', e.target.value)}
                placeholder="e.g. Vios"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Year</label>
              <input
                type="number"
                min={1980}
                max={new Date().getFullYear() + 1}
                value={form.vehicle_year ?? ''}
                onChange={(e) => set('vehicle_year', e.target.value ? Number(e.target.value) : null)}
                placeholder="2020"
                className={inputCls}
              />
            </div>
          </div>

          {/* Service */}
          <div>
            <label className={labelCls}>Service Type *</label>
            <select
              required
              value={form.service_type}
              onChange={(e) => set('service_type', e.target.value)}
              className={inputCls}
            >
              <option value="">Select service…</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date *</label>
              <input
                type="date"
                required
                value={form.appointment_date}
                onChange={(e) => set('appointment_date', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Time *</label>
              <input
                type="time"
                required
                value={form.appointment_time}
                onChange={(e) => set('appointment_time', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Source */}
          <div>
            <label className={labelCls}>Booking Source</label>
            <div className="flex gap-4">
              {(['direct', 'mia_whatsapp'] as const).map((src) => (
                <label key={src} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="source"
                    value={src}
                    checked={form.source === src}
                    onChange={() => set('source', src)}
                    className="accent-orange-500"
                  />
                  {src === 'direct' ? 'Direct / Walk-in' : 'Mia (WhatsApp)'}
                </label>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Any additional details…"
              className={inputCls}
            />
          </div>

          {error && (
            <p className="text-red-500 text-xs">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={saving}
            className="px-5 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Booking…' : 'Book Appointment'}
          </button>
        </div>
      </div>
    </div>
  )
}
