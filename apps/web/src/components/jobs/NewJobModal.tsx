import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useJobsStore } from '@/hooks/useJobs'
import type { CreateJobPayload } from '@/types/job'

interface Customer {
  id: string
  full_name: string
  phone: string
}

interface Vehicle {
  id: string
  plate_number: string
  make: string
  model: string
  year: number | null
}

interface Mechanic {
  id: string
  full_name: string
}

interface NewJobModalProps {
  onClose: () => void
  onSuccess: () => void
}

const SERVICE_TYPES = [
  'General Service',
  'Oil Change',
  'Brake Service',
  'Tyre Replacement',
  'Engine Repair',
  'Electrical',
  'Air Conditioning',
  'Body & Paint',
  'Inspection',
  'Other',
]

// Shared field styles
const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #2A2A2A',
  borderRadius: '8px',
  padding: '10px 12px',
  fontSize: '0.875rem',
  backgroundColor: '#0E0E0E',
  color: '#F0F0F0',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 500,
  color: '#A0A0A0',
  marginBottom: '6px',
}

export function NewJobModal({ onClose, onSuccess }: NewJobModalProps) {
  const user = useAuthStore((s) => s.user)
  const createJob = useJobsStore((s) => s.createJob)

  const [phoneQuery, setPhoneQuery] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [lookingUp, setLookingUp] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [form, setForm] = useState({
    vehicle_id: '',
    service_type: '',
    description: '',
    assigned_to: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.branch_id) return
    supabase
      .from('user_profiles')
      .select('id, full_name')
      .eq('branch_id', user.branch_id)
      .eq('role', 'staff')
      .then(({ data }) => setMechanics((data as Mechanic[]) ?? []))
  }, [user?.branch_id])

  const lookupCustomer = async () => {
    if (!phoneQuery.trim()) return
    setLookingUp(true)
    setNotFound(false)
    setCustomer(null)
    setVehicles([])

    const { data } = await supabase
      .from('customers')
      .select('id, full_name, phone')
      .eq('phone', phoneQuery.trim())
      .single()

    if (!data) {
      setNotFound(true)
      setLookingUp(false)
      return
    }

    setCustomer(data as Customer)

    const { data: vData } = await supabase
      .from('vehicles')
      .select('id, plate_number, make, model, year')
      .eq('customer_id', data.id)

    setVehicles((vData as Vehicle[]) ?? [])
    setLookingUp(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customer || !form.vehicle_id || !form.service_type || !user?.branch_id) return
    setSubmitting(true)
    setError(null)

    const payload: CreateJobPayload = {
      branch_id: user.branch_id,
      customer_id: customer.id,
      vehicle_id: form.vehicle_id,
      service_type: form.service_type,
      description: form.description || undefined,
      assigned_to: form.assigned_to || undefined,
    }

    const { error: err } = await createJob(payload)
    setSubmitting(false)
    if (err) { setError(err); return }
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
        backgroundColor: 'rgba(0,0,0,0.6)',
      }}
    >
      <div
        style={{
          backgroundColor: '#161616',
          borderRadius: '16px',
          border: '1px solid #2A2A2A',
          width: '100%',
          maxWidth: '520px',
          margin: '0 16px',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid #2A2A2A',
          }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F0F0F0', margin: 0 }}>
            New Job Order
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#A0A0A0',
              fontSize: '1.125rem',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '4px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#F0F0F0')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#A0A0A0')}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            overflowY: 'auto',
            maxHeight: '80vh',
          }}
        >
          {/* Phone lookup */}
          <div>
            <label style={labelStyle}>Customer Phone</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="e.g. 0123456789"
                value={phoneQuery}
                onChange={(e) => setPhoneQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookupCustomer())}
                style={{ ...inputStyle, flex: 1 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
              <button
                type="button"
                onClick={lookupCustomer}
                disabled={lookingUp}
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#F0F0F0',
                  color: '#0E0E0E',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  borderRadius: '8px',
                  border: 'none',
                  cursor: lookingUp ? 'not-allowed' : 'pointer',
                  opacity: lookingUp ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                  transition: 'opacity 0.15s',
                }}
              >
                {lookingUp ? '...' : 'Lookup'}
              </button>
            </div>
            {notFound && (
              <p style={{ marginTop: '6px', fontSize: '0.75rem', color: '#f87171' }}>
                No customer found with that phone number.
              </p>
            )}
          </div>

          {/* Customer info */}
          {customer && (
            <div
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
                padding: '14px 16px',
                border: '1px solid #2A2A2A',
              }}
            >
              <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#F0F0F0', margin: 0 }}>
                {customer.full_name}
              </p>
              <p style={{ fontSize: '0.75rem', color: '#A0A0A0', margin: '2px 0 0' }}>
                {customer.phone}
              </p>
            </div>
          )}

          {/* Vehicle */}
          {customer && (
            <div>
              <label style={labelStyle}>Vehicle</label>
              {vehicles.length === 0 ? (
                <p style={{ fontSize: '0.75rem', color: '#A0A0A0' }}>
                  No vehicles registered for this customer.
                </p>
              ) : (
                <select
                  required
                  value={form.vehicle_id}
                  onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                >
                  <option value="">Select vehicle</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate_number} — {v.make} {v.model} {v.year ?? ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Service type */}
          <div>
            <label style={labelStyle}>Service Type</label>
            <select
              required
              value={form.service_type}
              onChange={(e) => setForm({ ...form, service_type: e.target.value })}
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
            >
              <option value="">Select service</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description / Notes</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Describe the issue or requested service..."
              style={{ ...inputStyle, resize: 'none' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
            />
          </div>

          {/* Mechanic */}
          <div>
            <label style={labelStyle}>Assign Mechanic (optional)</label>
            <select
              value={form.assigned_to}
              onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
            >
              <option value="">Unassigned</option>
              {mechanics.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </div>

          {error && (
            <p style={{ fontSize: '0.75rem', color: '#f87171', margin: 0 }}>{error}</p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', paddingTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                border: '1px solid #2A2A2A',
                color: '#A0A0A0',
                borderRadius: '8px',
                padding: '11px 0',
                fontSize: '0.875rem',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1a1a1a')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !customer || !form.vehicle_id}
              style={{
                flex: 1,
                backgroundColor: '#F15A22',
                color: '#fff',
                borderRadius: '8px',
                padding: '11px 0',
                fontSize: '0.875rem',
                fontWeight: 500,
                border: 'none',
                cursor: submitting || !customer || !form.vehicle_id ? 'not-allowed' : 'pointer',
                opacity: submitting || !customer || !form.vehicle_id ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {submitting ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
