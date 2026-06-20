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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">New Job Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Phone lookup */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Customer Phone</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. 0123456789"
                value={phoneQuery}
                onChange={(e) => setPhoneQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookupCustomer())}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                type="button"
                onClick={lookupCustomer}
                disabled={lookingUp}
                className="px-4 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {lookingUp ? '...' : 'Lookup'}
              </button>
            </div>
            {notFound && <p className="mt-1 text-xs text-red-500">No customer found with that phone number.</p>}
          </div>

          {/* Customer info */}
          {customer && (
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-gray-800">{customer.full_name}</p>
              <p className="text-xs text-gray-500">{customer.phone}</p>
            </div>
          )}

          {/* Vehicle */}
          {customer && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Vehicle</label>
              {vehicles.length === 0 ? (
                <p className="text-xs text-gray-400">No vehicles registered for this customer.</p>
              ) : (
                <select
                  required
                  value={form.vehicle_id}
                  onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Service Type</label>
            <select
              required
              value={form.service_type}
              onChange={(e) => setForm({ ...form, service_type: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">Select service</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description / Notes</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Describe the issue or requested service..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>

          {/* Mechanic */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Assign Mechanic (optional)</label>
            <select
              value={form.assigned_to}
              onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">Unassigned</option>
              {mechanics.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !customer || !form.vehicle_id}
              className="flex-1 bg-orange-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
