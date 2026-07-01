import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Car,
  Bike,
  Search,
  Image,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
  User,
  Calendar,
  Gauge,
  Wrench,
  Plus,
  X,
  Edit2,
  Trash2,
  Save,
  Building2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatName, formatPhone, formatEmail, formatIC, formatPlate, formatTitleCase } from '@/lib/formatters'

// ─── Types ───────────────────────────────────────────────────────────────────

interface VehicleWithRelations {
  id: string
  plate_number: string
  make: string
  model: string
  year?: number
  color?: string
  vehicle_type: 'car' | 'bike'
  mileage?: number
  current_mileage?: number
  branch_id: string
  customer_id: string
  is_internal_fleet?: boolean
  created_at: string
  customers: { full_name: string; phone: string }
  jobs: Array<{
    id: string
    job_number: string
    status: string
    service_type: string
    checked_in_at: string
    customer_complaint?: string
    diagnosis_summary?: string
    final_amount?: number
  }>
}

interface CustomerOption {
  id: string
  full_name: string
}

interface VehicleFormData {
  plate_number: string
  vehicle_type: 'car' | 'bike'
  make: string
  model: string
  year: string
  color: string
  current_mileage: string
  customer_id: string
  is_internal_fleet: boolean
}

const EMPTY_FORM: VehicleFormData = {
  plate_number: '',
  vehicle_type: 'car',
  make: '',
  model: '',
  year: '',
  color: '',
  current_mileage: '',
  customer_id: '',
  is_internal_fleet: false,
}

type VehicleTypeFilter = 'all' | 'car' | 'bike'
type StatusFilter = 'all' | 'active' | 'long_due' | 'ready'
type DetailTab = 'overview' | 'current_job' | 'history' | 'photos'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['checked_in', 'diagnosing', 'in_progress', 'waiting_parts', 'pending_approval']
const READY_STATUSES = ['ready_for_pickup']
const LONG_DUE_DAYS = 7

function getActiveJob(jobs: VehicleWithRelations['jobs']) {
  return jobs.find((j) => ACTIVE_STATUSES.includes(j.status)) ?? null
}

function getDaysInGarage(checkedInAt: string): number {
  const diff = Date.now() - new Date(checkedInAt).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    checked_in: 'Checked In',
    diagnosing: 'Diagnosing',
    in_progress: 'In Progress',
    waiting_parts: 'Waiting Parts',
    pending_approval: 'Pending Approval',
    ready_for_pickup: 'Ready',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return map[status] ?? status
}

function statusColor(status: string): string {
  if (READY_STATUSES.includes(status)) return '#22C55E'
  if (ACTIVE_STATUSES.includes(status)) return '#F15A22'
  if (status === 'completed') return '#A0A0A0'
  if (status === 'cancelled') return '#EF4444'
  return '#A0A0A0'
}

// ─── Shared form field styles ─────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  backgroundColor: '#1A1A1A',
  border: '1px solid #2A2A2A',
  color: '#F0F0F0',
  borderRadius: 8,
  padding: '8px 12px',
  width: '100%',
  fontSize: 14,
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  color: '#A0A0A0',
  fontSize: 12,
  marginBottom: 6,
  display: 'block',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status)
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        color,
        backgroundColor: `${color}22`,
        border: `1px solid ${color}44`,
      }}
    >
      {statusLabel(status)}
    </span>
  )
}

function TypeBadge({ type }: { type: 'car' | 'bike' }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        color: '#F0F0F0',
        backgroundColor: '#2A2A2A',
        border: '1px solid #3A3A3A',
      }}
    >
      {type === 'car' ? <Car size={10} /> : <Bike size={10} />}
      {type === 'car' ? 'CAR' : 'BIKE'}
    </span>
  )
}

function DaysPill({ days }: { days: number }) {
  const isLong = days >= LONG_DUE_DAYS
  const color = isLong ? '#EF4444' : '#F15A22'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color,
        backgroundColor: `${color}22`,
        border: `1px solid ${color}44`,
      }}
    >
      <Clock size={10} />
      {days}d
    </span>
  )
}

// ─── Vehicle Form Fields (shared by Add + Edit) ───────────────────────────────

function VehicleFormFields({
  form,
  setForm,
  customers,
  onCustomerCreated,
  branchId,
  tenantId,
}: {
  form: VehicleFormData
  setForm: React.Dispatch<React.SetStateAction<VehicleFormData>>
  customers: CustomerOption[]
  onCustomerCreated?: (c: CustomerOption) => void
  branchId?: string
  tenantId?: string
}) {
  const update = (key: keyof VehicleFormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCust, setNewCust] = useState({ full_name: '', phone: '', email: '', ic_number: '', full_address: '' })
  const [savingCust, setSavingCust] = useState(false)
  const [custError, setCustError] = useState('')

  const handleCreateCustomer = async () => {
    if (!newCust.full_name.trim() || !newCust.phone.trim()) {
      setCustError('Name and phone are required.')
      return
    }
    setSavingCust(true)
    setCustError('')
    const { data, error } = await supabase
      .from('customers')
      .insert({
        full_name: newCust.full_name.trim(),
        phone: newCust.phone.trim(),
        email: newCust.email.trim() || null,
        ic_number: newCust.ic_number.trim() || null,
        full_address: newCust.full_address.trim() || null,
        customer_type: 'individual',
        customer_status: 'active',
        branch_id: branchId,
        tenant_id: tenantId,
      })
      .select('id, full_name')
      .single()
    setSavingCust(false)
    if (error) { setCustError(error.message); return }
    const created = data as CustomerOption
    onCustomerCreated?.(created)
    update('customer_id', created.id)
    setNewCust({ full_name: '', phone: '', email: '', ic_number: '', full_address: '' })
    setShowNewCustomer(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Plate Number */}
      <div>
        <label style={labelStyle}>
          Plate Number <span style={{ color: '#F15A22' }}>*</span>
        </label>
        <input
          type="text"
          value={form.plate_number}
          onChange={(e) => update('plate_number', e.target.value)}
          onBlur={(e) => update('plate_number', formatPlate(e.target.value))}
          placeholder="e.g. WXY 1234"
          style={inputStyle}
          required
        />
      </div>

      {/* Vehicle Type */}
      <div>
        <label style={labelStyle}>Vehicle Type</label>
        <select
          value={form.vehicle_type}
          onChange={(e) => update('vehicle_type', e.target.value)}
          style={inputStyle}
        >
          <option value="car">Car</option>
          <option value="bike">Bike</option>
        </select>
      </div>

      {/* Make + Model */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Make</label>
          <input type="text" value={form.make} onChange={(e) => update('make', e.target.value)} onBlur={(e) => update('make', formatTitleCase(e.target.value))} placeholder="e.g. Toyota" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Model</label>
          <input type="text" value={form.model} onChange={(e) => update('model', e.target.value)} onBlur={(e) => update('model', formatTitleCase(e.target.value))} placeholder="e.g. Vios" style={inputStyle} />
        </div>
      </div>

      {/* Year + Color */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Year</label>
          <input type="number" value={form.year} onChange={(e) => update('year', e.target.value)} placeholder="e.g. 2020" min={1900} max={2100} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Color</label>
          <input type="text" value={form.color} onChange={(e) => update('color', e.target.value)} placeholder="e.g. White" style={inputStyle} />
        </div>
      </div>

      {/* Current Mileage */}
      <div>
        <label style={labelStyle}>Current Mileage (km)</label>
        <input type="number" value={form.current_mileage} onChange={(e) => update('current_mileage', e.target.value)} placeholder="e.g. 45000" min={0} style={inputStyle} />
      </div>

      {/* Customer */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Customer</label>
          {onCustomerCreated && (
            <button
              type="button"
              onClick={() => { setShowNewCustomer(v => !v); setCustError('') }}
              style={{ fontSize: 12, color: '#F15A22', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: 0 }}
            >
              {showNewCustomer ? '✕ Cancel' : '+ New Customer'}
            </button>
          )}
        </div>

        {/* Inline quick-create customer */}
        {showNewCustomer && (
          <div style={{ background: '#1A1A1A', border: '1px solid #F15A22', borderRadius: 10, padding: 16, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ color: '#F15A22', fontSize: 12, fontWeight: 600, margin: 0 }}>New Customer</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Full Name *</label>
                <input type="text" value={newCust.full_name} onChange={e => setNewCust(p => ({ ...p, full_name: e.target.value }))} onBlur={e => setNewCust(p => ({ ...p, full_name: formatName(e.target.value) }))} placeholder="e.g. Ahmad Razif" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone *</label>
                <input type="text" value={newCust.phone} onChange={e => setNewCust(p => ({ ...p, phone: e.target.value }))} onBlur={e => setNewCust(p => ({ ...p, phone: formatPhone(e.target.value) }))} placeholder="e.g. 0123456789" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>IC Number</label>
                <input type="text" value={newCust.ic_number} onChange={e => setNewCust(p => ({ ...p, ic_number: e.target.value }))} onBlur={e => setNewCust(p => ({ ...p, ic_number: formatIC(e.target.value) }))} placeholder="e.g. 900101-14-1234" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" value={newCust.email} onChange={e => setNewCust(p => ({ ...p, email: e.target.value }))} onBlur={e => setNewCust(p => ({ ...p, email: formatEmail(e.target.value) }))} placeholder="e.g. ahmad@email.com" style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Address</label>
              <textarea value={newCust.full_address} onChange={e => setNewCust(p => ({ ...p, full_address: e.target.value }))} placeholder="e.g. No. 5, Jalan Ampang, 50450 KL" style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }} />
            </div>
            {custError && <p style={{ color: '#F87171', fontSize: 12, margin: 0 }}>{custError}</p>}
            <button
              type="button"
              onClick={handleCreateCustomer}
              disabled={savingCust}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 20px', minHeight: 44, borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#F15A22', color: '#fff', border: 'none', cursor: 'pointer', opacity: savingCust ? 0.7 : 1 }}
            >
              {savingCust ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              {savingCust ? 'Creating...' : 'Create & Select'}
            </button>
          </div>
        )}

        <select
          value={form.customer_id}
          onChange={(e) => update('customer_id', e.target.value)}
          style={inputStyle}
        >
          <option value="">— No customer —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
      </div>

      {/* Internal Fleet toggle */}
      <div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#1A1A1A', border: `1px solid ${form.is_internal_fleet ? '#F15A22' : '#2A2A2A'}`, borderRadius: 8, cursor: 'pointer' }}
          onClick={() => update('is_internal_fleet', !form.is_internal_fleet)}
        >
          <div style={{ width: 36, height: 20, borderRadius: 10, background: form.is_internal_fleet ? '#F15A22' : '#3A3A3A', position: 'relative', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 2, left: form.is_internal_fleet ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: '#F0F0F0', fontWeight: 500 }}>Internal Fleet</p>
            <p style={{ margin: 0, fontSize: 12, color: '#A0A0A0' }}>Company or subsidiary-owned vehicle</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add Vehicle Modal ────────────────────────────────────────────────────────

function AddVehicleModal({
  onClose,
  onSuccess,
  branchId,
  tenantId,
}: {
  onClose: () => void
  onSuccess: () => void
  branchId: string
  tenantId: string
}) {
  const [form, setForm] = useState<VehicleFormData>(EMPTY_FORM)
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!branchId) return
    supabase
      .from('customers')
      .select('id, full_name')
      .eq('branch_id', branchId)
      .order('full_name')
      .then(({ data }) => setCustomers((data as CustomerOption[]) ?? []))
  }, [branchId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.plate_number.trim()) {
      setFormError('Plate number is required.')
      return
    }
    setSaving(true)
    setFormError(null)

    const payload: Record<string, unknown> = {
      plate_number: form.plate_number.trim(),
      vehicle_type: form.vehicle_type,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      year: form.year ? parseInt(form.year, 10) : null,
      color: form.color.trim() || null,
      current_mileage: form.current_mileage ? parseInt(form.current_mileage, 10) : null,
      customer_id: form.customer_id || null,
      is_internal_fleet: form.is_internal_fleet ?? false,
      branch_id: branchId,
      tenant_id: tenantId,
    }

    const { error } = await supabase.from('vehicles').insert(payload)
    setSaving(false)

    if (error) {
      setFormError(error.message)
    } else {
      onSuccess()
      onClose()
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{ width: '100%', maxWidth: 448, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: '16px 16px 0 0', overflow: 'hidden', backgroundColor: '#161616', border: '1px solid #2A2A2A' }}
      >
        {/* Header */}
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} style={{ color: '#F15A22' }} />
            <h3 style={{ fontWeight: 600, fontSize: 16, color: '#F0F0F0', margin: 0 }}>
              Add Vehicle
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ padding: '0 12px', minHeight: 44, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <X size={16} style={{ color: '#A0A0A0' }} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <VehicleFormFields
            form={form}
            setForm={setForm}
            customers={customers}
            branchId={branchId}
            tenantId={tenantId}
            onCustomerCreated={(c) => setCustomers(prev => [...prev, c].sort((a, b) => a.full_name.localeCompare(b.full_name)))}
          />

          {formError && (
            <p style={{ marginTop: 12, fontSize: 12, color: '#EF4444' }}>
              {formError}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                backgroundColor: '#1E1E1E',
                color: '#A0A0A0',
                border: '1px solid #2A2A2A',
                padding: '0 20px',
                minHeight: 44,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, fontSize: 14, fontWeight: 600, backgroundColor: '#F15A22', color: '#0E0E0E', padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}
            >
              {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
              {saving ? 'Saving…' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Edit Vehicle Panel ───────────────────────────────────────────────────────

function EditVehiclePanel({
  vehicle,
  onClose,
  onSuccess,
  branchId,
}: {
  vehicle: VehicleWithRelations
  onClose: () => void
  onSuccess: () => void
  branchId: string
}) {
  const [form, setForm] = useState<VehicleFormData>({
    plate_number: vehicle.plate_number ?? '',
    vehicle_type: vehicle.vehicle_type ?? 'car',
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    year: vehicle.year != null ? String(vehicle.year) : '',
    color: vehicle.color ?? '',
    current_mileage:
      vehicle.current_mileage != null
        ? String(vehicle.current_mileage)
        : vehicle.mileage != null
        ? String(vehicle.mileage)
        : '',
    customer_id: vehicle.customer_id ?? '',
    is_internal_fleet: vehicle.is_internal_fleet ?? false,
  })
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  useEffect(() => {
    if (!branchId) return
    supabase
      .from('customers')
      .select('id, full_name')
      .eq('branch_id', branchId)
      .order('full_name')
      .then(({ data }) => setCustomers((data as CustomerOption[]) ?? []))
  }, [branchId])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.plate_number.trim()) {
      setPanelError('Plate number is required.')
      return
    }
    setSaving(true)
    setPanelError(null)

    const { error } = await supabase
      .from('vehicles')
      .update({
        plate_number: form.plate_number.trim(),
        vehicle_type: form.vehicle_type,
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        year: form.year ? parseInt(form.year, 10) : null,
        color: form.color.trim() || null,
        current_mileage: form.current_mileage ? parseInt(form.current_mileage, 10) : null,
        customer_id: form.customer_id || null,
        is_internal_fleet: form.is_internal_fleet ?? false,
      })
      .eq('id', vehicle.id)

    setSaving(false)

    if (error) {
      setPanelError(error.message)
    } else {
      onSuccess()
      onClose()
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setPanelError(null)

    const { error } = await supabase.from('vehicles').delete().eq('id', vehicle.id)

    setDeleting(false)

    if (error) {
      if (error.code === '23503') {
        setPanelError(
          'Cannot delete: this vehicle has linked jobs. Remove or reassign them first.',
        )
      } else {
        setPanelError(error.message)
      }
      setConfirmDelete(false)
    } else {
      onSuccess()
      onClose()
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{ height: '100%', width: '100%', maxWidth: 448, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#161616', borderLeft: '1px solid #2A2A2A' }}
      >
        {/* Header */}
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', flexShrink: 0, borderBottom: '1px solid #2A2A2A' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Edit2 size={15} style={{ color: '#F15A22' }} />
            <div>
              <h3 style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.2, color: '#F0F0F0', margin: 0 }}>
                Edit Vehicle
              </h3>
              <span
                style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: '#F15A22' }}
              >
                {formatPlate(vehicle.plate_number)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ padding: '0 12px', minHeight: 44, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <X size={16} style={{ color: '#A0A0A0' }} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <VehicleFormFields form={form} setForm={setForm} customers={customers} />

          {panelError && (
            <p style={{ marginTop: 12, fontSize: 12, color: '#EF4444' }}>
              {panelError}
            </p>
          )}

          {/* Save */}
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                backgroundColor: '#1E1E1E',
                color: '#A0A0A0',
                border: '1px solid #2A2A2A',
                padding: '0 20px',
                minHeight: 44,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, fontSize: 14, fontWeight: 600, backgroundColor: '#F15A22', color: '#0E0E0E', padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}
            >
              {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>

          {/* Danger zone */}
          <div
            style={{ marginTop: 32, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid #3A1A1A', backgroundColor: '#1A0E0E' }}
          >
            <p style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', margin: 0 }}>
              Danger Zone
            </p>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  backgroundColor: 'transparent',
                  color: '#EF4444',
                  border: '1px solid #3A1818',
                  padding: '0 20px',
                  minHeight: 44,
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={14} />
                Delete Vehicle
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 12, textAlign: 'center', color: '#F0F0F0', margin: 0 }}>
                  Are you sure? This cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    style={{
                      flex: 1,
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 500,
                      backgroundColor: '#1E1E1E',
                      color: '#A0A0A0',
                      border: '1px solid #2A2A2A',
                      padding: '0 20px',
                      minHeight: 44,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, fontSize: 12, fontWeight: 600, backgroundColor: '#EF4444', color: '#fff', padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer', opacity: deleting ? 0.5 : 1 }}
                  >
                    {deleting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={12} />}
                    {deleting ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Vehicle List Item ────────────────────────────────────────────────────────

function VehicleListItem({
  vehicle,
  selected,
  onClick,
}: {
  vehicle: VehicleWithRelations
  selected: boolean
  onClick: () => void
}) {
  const activeJob = getActiveJob(vehicle.jobs)
  const days = activeJob ? getDaysInGarage(activeJob.checked_in_at) : null

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        backgroundColor: selected ? '#1E1E1E' : 'transparent',
        borderBottom: '1px solid #2A2A2A',
        borderLeft: selected ? '3px solid #F15A22' : '3px solid transparent',
        padding: '14px 16px 14px 13px',
        minHeight: 44,
        border: 'none',
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: '#2A2A2A',
        borderLeftWidth: 3,
        borderLeftStyle: 'solid',
        borderLeftColor: selected ? '#F15A22' : 'transparent',
        cursor: 'pointer',
        background: selected ? '#1E1E1E' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 18, letterSpacing: '0.1em', color: '#F15A22' }}
        >
          {formatPlate(vehicle.plate_number)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {days !== null && <DaysPill days={days} />}
          {activeJob && <StatusBadge status={activeJob.status} />}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#F0F0F0', margin: 0 }}>
            {vehicle.make} {vehicle.model}
            {vehicle.year ? ` (${vehicle.year})` : ''}
          </p>
          <p style={{ fontSize: 12, color: '#A0A0A0', margin: 0, marginTop: 2 }}>
            {vehicle.customers?.full_name ?? '—'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {vehicle.is_internal_fleet && (
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#F15A22', backgroundColor: 'rgba(241,90,34,0.15)', border: '1px solid rgba(241,90,34,0.3)' }}>
              Internal
            </span>
          )}
          <TypeBadge type={vehicle.vehicle_type} />
        </div>
      </div>
    </button>
  )
}

// ─── Detail Tabs ──────────────────────────────────────────────────────────────

function OverviewTab({
  vehicle,
  onEdit,
}: {
  vehicle: VehicleWithRelations
  onEdit: () => void
}) {
  const activeJob = getActiveJob(vehicle.jobs)
  const lastJob = vehicle.jobs
    .filter((j) => j.status === 'completed')
    .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime())[0]

  const rows: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [
    {
      icon: <Car size={14} />,
      label: 'Vehicle',
      value: (
        <span style={{ color: '#F0F0F0' }}>
          {vehicle.make} {vehicle.model}
          {vehicle.year ? ` · ${vehicle.year}` : ''}
          {vehicle.color ? ` · ${vehicle.color}` : ''}
        </span>
      ),
    },
    {
      icon: <User size={14} />,
      label: 'Customer',
      value: (
        <span style={{ fontWeight: 500, color: '#F15A22' }}>
          {vehicle.customers?.full_name ?? '—'}
        </span>
      ),
    },
    {
      icon: <Gauge size={14} />,
      label: 'Mileage',
      value: (
        <span style={{ color: '#F0F0F0' }}>
          {(vehicle.current_mileage ?? vehicle.mileage) != null
            ? `${(vehicle.current_mileage ?? vehicle.mileage)!.toLocaleString()} km`
            : '—'}
        </span>
      ),
    },
    {
      icon: <Building2 size={14} />,
      label: 'Fleet',
      value: vehicle.is_internal_fleet ? (
        <span style={{ color: '#F15A22', fontWeight: 600 }}>Internal Fleet</span>
      ) : (
        <span style={{ color: '#A0A0A0' }}>External</span>
      ),
    },
    {
      icon: <Calendar size={14} />,
      label: 'Last Visit',
      value: (
        <span style={{ color: '#F0F0F0' }}>
          {lastJob
            ? formatDate(lastJob.checked_in_at)
            : activeJob
            ? formatDate(activeJob.checked_in_at)
            : '—'}
        </span>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 36, letterSpacing: '0.1em', color: '#F15A22' }}
          >
            {formatPlate(vehicle.plate_number)}
          </span>
          <TypeBadge type={vehicle.vehicle_type} />
        </div>
        <button
          onClick={onEdit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            backgroundColor: '#1E1E1E',
            color: '#F0F0F0',
            border: '1px solid #2A2A2A',
            padding: '0 20px',
            minHeight: 44,
            cursor: 'pointer',
          }}
        >
          <Edit2 size={12} />
          Edit
        </button>
      </div>

      <div
        style={{ borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, backgroundColor: '#161616', border: '1px solid #2A2A2A' }}
      >
        {rows.map(({ icon, label, value }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ color: '#A0A0A0', marginTop: 2 }}>{icon}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: '#A0A0A0' }}>
                {label}
              </span>
              <div style={{ fontSize: 14, wordBreak: 'break-word' }}>{value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CurrentJobTab({
  vehicle,
  onCheckIn,
}: {
  vehicle: VehicleWithRelations
  onCheckIn: () => void
}) {
  const activeJob = getActiveJob(vehicle.jobs)

  if (!activeJob) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 48, textAlign: 'center' }}>
        <div
          style={{ borderRadius: '50%', padding: 16, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A' }}
        >
          <Car size={32} style={{ color: '#A0A0A0' }} />
        </div>
        <p style={{ fontWeight: 500, color: '#A0A0A0', margin: 0 }}>
          No active job
        </p>
        <button
          onClick={onCheckIn}
          style={{ borderRadius: 8, fontSize: 14, fontWeight: 600, backgroundColor: '#F15A22', color: '#0E0E0E', padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer' }}
        >
          Check In Vehicle
        </button>
      </div>
    )
  }

  const days = getDaysInGarage(activeJob.checked_in_at)

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{ borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, backgroundColor: '#161616', border: '1px solid #2A2A2A' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#A0A0A0' }}>
            #{activeJob.job_number}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DaysPill days={days} />
            <StatusBadge status={activeJob.status} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#A0A0A0' }}>
            Service Type
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#F0F0F0' }}>
            {activeJob.service_type || '—'}
          </span>
        </div>

        {activeJob.customer_complaint && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#A0A0A0' }}>
              Complaint
            </span>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#F0F0F0', margin: 0 }}>
              {activeJob.customer_complaint}
            </p>
          </div>
        )}

        {activeJob.diagnosis_summary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#A0A0A0' }}>
              Diagnosis
            </span>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#F0F0F0', margin: 0 }}>
              {activeJob.diagnosis_summary}
            </p>
          </div>
        )}

        {activeJob.assigned_staff_name && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={14} style={{ color: '#A0A0A0' }} />
            <span style={{ fontSize: 14, color: '#A0A0A0' }}>
              Assigned to{' '}
              <span style={{ color: '#F0F0F0' }}>{activeJob.assigned_staff_name}</span>
            </span>
          </div>
        )}

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid #2A2A2A' }}
        >
          <Clock size={14} style={{ color: '#A0A0A0' }} />
          <span style={{ fontSize: 12, color: '#A0A0A0' }}>
            Checked in {formatDate(activeJob.checked_in_at)} ·{' '}
            <span
              style={{ color: days >= LONG_DUE_DAYS ? '#EF4444' : '#F15A22', fontWeight: 600 }}
            >
              {days} day{days !== 1 ? 's' : ''} in garage
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

interface InvDetail {
  invoice_number: string
  total_amount: number
  subtotal: number
  discount_amount: number
  tax_amount: number
  line_items: Array<{ item_type: string; description: string; qty: number; unit_price: number; total_price: number }>
}

function JobHistoryTab({ vehicle }: { vehicle: VehicleWithRelations }) {
  const completedJobs = vehicle.jobs
    .filter((j) => !ACTIVE_STATUSES.includes(j.status))
    .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime())

  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [cache, setCache] = useState<Record<string, InvDetail | null>>({})
  const [fetching, setFetching] = useState<string | null>(null)

  async function handleExpand(jobId: string) {
    if (expandedJobId === jobId) { setExpandedJobId(null); return }
    setExpandedJobId(jobId)
    if (jobId in cache) return
    setFetching(jobId)
    try {
      const { data } = await supabase
        .from('invoices')
        .select('invoice_number, total_amount, subtotal, discount_amount, tax_amount, line_items')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(1)
      setCache(prev => ({ ...prev, [jobId]: data?.[0] ?? null }))
    } catch {
      setCache(prev => ({ ...prev, [jobId]: null }))
    } finally {
      setFetching(null)
    }
  }

  if (completedJobs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48, textAlign: 'center' }}>
        <Wrench size={32} style={{ color: '#A0A0A0' }} />
        <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>No job history yet</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {completedJobs.map((job) => {
        const isOpen = expandedJobId === job.id
        const isLoading = fetching === job.id
        const inv = cache[job.id] ?? null
        const parts = Array.isArray(inv?.line_items) ? inv!.line_items.filter(l => l.item_type === 'part') : []
        const labour = Array.isArray(inv?.line_items) ? inv!.line_items.filter(l => l.item_type === 'labour') : []

        return (
          <div key={job.id} style={{ borderRadius: 10, border: `1px solid ${isOpen ? '#F15A22' : '#2A2A2A'}`, overflow: 'hidden' }}>
            <button
              onClick={() => handleExpand(job.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: isOpen ? '#1A0E0E' : '#161616', border: 'none', cursor: 'pointer', gap: 8 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#F15A22', flexShrink: 0 }}>{job.job_number}</span>
                <span style={{ fontSize: 12, color: '#A0A0A0', flexShrink: 0 }}>{formatDate(job.checked_in_at)}</span>
                <span style={{ fontSize: 13, color: '#F0F0F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.service_type || '—'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <StatusBadge status={job.status} />
                {job.final_amount != null && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#F0F0F0' }}>{formatCurrency(job.final_amount)}</span>
                )}
                <span style={{ fontSize: 14, color: '#A0A0A0' }}>{isOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {isOpen && (
              <div style={{ padding: '12px 14px 14px', backgroundColor: '#0E0E0E', borderTop: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {isLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#A0A0A0', fontSize: 13 }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Loading…
                  </div>
                )}

                {(job.customer_complaint || job.diagnosis_summary) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {job.customer_complaint && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer Complaint</div>
                        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#F0F0F0' }}>{job.customer_complaint}</p>
                      </div>
                    )}
                    {job.diagnosis_summary && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Work Done</div>
                        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#F0F0F0' }}>{job.diagnosis_summary}</p>
                      </div>
                    )}
                  </div>
                )}

                {!isLoading && inv && (
                  <>
                    <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoice {inv.invoice_number}</div>

                    {parts.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: '#A0A0A0', marginBottom: 4 }}>Parts</div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <tbody>
                            {parts.map((p, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #1A1A1A' }}>
                                <td style={{ padding: '5px 0', color: '#F0F0F0', paddingRight: 8 }}>{p.description}</td>
                                <td style={{ padding: '5px 0', color: '#6B7280', textAlign: 'right', paddingRight: 8 }}>×{p.qty}</td>
                                <td style={{ padding: '5px 0', color: '#6B7280', textAlign: 'right', paddingRight: 8 }}>{formatCurrency(p.unit_price)}</td>
                                <td style={{ padding: '5px 0', color: '#F0F0F0', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(p.total_price)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {labour.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: '#A0A0A0', marginBottom: 4 }}>Labour</div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <tbody>
                            {labour.map((l, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #1A1A1A' }}>
                                <td style={{ padding: '5px 0', color: '#F0F0F0', paddingRight: 8 }}>{l.description}</td>
                                <td style={{ padding: '5px 0', color: '#6B7280', textAlign: 'right', paddingRight: 8 }}>×{l.qty}</td>
                                <td style={{ padding: '5px 0', color: '#6B7280', textAlign: 'right', paddingRight: 8 }}>{formatCurrency(l.unit_price)}</td>
                                <td style={{ padding: '5px 0', color: '#F0F0F0', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(l.total_price)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid #2A2A2A', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(inv.discount_amount ?? 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#A0A0A0' }}>
                          <span>Discount</span><span>−{formatCurrency(inv.discount_amount)}</span>
                        </div>
                      )}
                      {(inv.tax_amount ?? 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#A0A0A0' }}>
                          <span>Tax (SST)</span><span>{formatCurrency(inv.tax_amount)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: '#F15A22' }}>
                        <span>Total</span><span>{formatCurrency(inv.total_amount)}</span>
                      </div>
                    </div>
                  </>
                )}

                {!isLoading && inv === null && !job.customer_complaint && !job.diagnosis_summary && (
                  <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>No details available for this job.</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PhotosTab() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              aspectRatio: '16/9',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: '#161616',
              border: '1px dashed #2A2A2A',
            }}
          >
            <Image size={20} style={{ color: '#3A3A3A' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 16, paddingBottom: 16 }}>
        <Image size={28} style={{ color: '#A0A0A0' }} />
        <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>
          No photos uploaded yet
        </p>
        <button
          style={{ marginTop: 4, borderRadius: 8, fontSize: 12, fontWeight: 600, backgroundColor: '#1E1E1E', color: '#F0F0F0', border: '1px solid #2A2A2A', padding: '0 20px', minHeight: 44, cursor: 'pointer' }}
        >
          Upload Photos
        </button>
      </div>
    </div>
  )
}

// ─── Vehicle Detail Panel ─────────────────────────────────────────────────────

function VehicleDetail({
  vehicle,
  onEdit,
}: {
  vehicle: VehicleWithRelations
  onEdit: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('overview')

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'current_job', label: 'Current Job' },
    { id: 'history', label: 'Job History' },
    { id: 'photos', label: 'Photos' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0E0E0E' }}>
      {/* Header */}
      <div
        style={{ borderBottom: '1px solid #2A2A2A', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 24, letterSpacing: '0.1em', color: '#F15A22' }}
          >
            {formatPlate(vehicle.plate_number)}
          </span>
          <TypeBadge type={vehicle.vehicle_type} />
        </div>
        <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>
          {vehicle.make} {vehicle.model}
          {vehicle.year ? ` · ${vehicle.year}` : ''} ·{' '}
          <span style={{ color: '#F15A22' }}>{vehicle.customers?.full_name ?? '—'}</span>
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{ display: 'flex', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}
      >
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: tab === id ? '#F15A22' : '#A0A0A0',
              borderBottom: tab === id ? '2px solid #F15A22' : '2px solid transparent',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: tab === id ? '#F15A22' : 'transparent',
              padding: '0 20px',
              minHeight: 44,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'overview' && <OverviewTab vehicle={vehicle} onEdit={onEdit} />}
        {tab === 'current_job' && (
          <CurrentJobTab vehicle={vehicle} onCheckIn={() => {}} />
        )}
        {tab === 'history' && <JobHistoryTab vehicle={vehicle} />}
        {tab === 'photos' && <PhotosTab />}
      </div>
    </div>
  )
}

// ─── Empty / Loading / Error states ──────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48, textAlign: 'center', height: '100%' }}>
      <Car size={36} style={{ color: '#A0A0A0' }} />
      <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>
        {message}
      </p>
    </div>
  )
}

function NoSelectionState() {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', backgroundColor: '#0E0E0E' }}
    >
      <div
        style={{ borderRadius: '50%', padding: 20, backgroundColor: '#161616', border: '1px solid #2A2A2A' }}
      >
        <Car size={36} style={{ color: '#A0A0A0' }} />
      </div>
      <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>
        Select a vehicle to view details
      </p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function VehiclesPage() {
  const { user } = useAuthStore()
  const [vehicles, setVehicles] = useState<VehicleWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<VehicleTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [internalOnly, setInternalOnly] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<VehicleWithRelations | null>(null)

  const branchId: string = user?.branch_id ?? ''
  const tenantId: string = user?.tenant_id ?? ''

  const fetchVehicles = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('vehicles')
      .select(
        `*,
        customers!customer_id(full_name, phone),
        jobs!vehicle_id(id, job_number, status, service_type, checked_in_at, customer_complaint, diagnosis_summary, final_amount)`,
      )
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setVehicles((data as VehicleWithRelations[]) ?? [])
    }

    setLoading(false)
  }, [branchId])

  useEffect(() => {
    fetchVehicles()
  }, [fetchVehicles])

  const filtered = useMemo(() => {
    return vehicles.filter((v) => {
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const matchPlate = v.plate_number.toLowerCase().includes(q)
        const matchCustomer = v.customers?.full_name?.toLowerCase().includes(q)
        const matchModel = `${v.make} ${v.model}`.toLowerCase().includes(q)
        if (!matchPlate && !matchCustomer && !matchModel) return false
      }

      if (typeFilter !== 'all' && v.vehicle_type !== typeFilter) return false
      if (internalOnly && !v.is_internal_fleet) return false

      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !ACTIVE_STATUSES.includes(getActiveJob(v.jobs)?.status ?? '')) return false
        if (statusFilter === 'long_due') {
          const active = getActiveJob(v.jobs)
          if (!active || getDaysInGarage(active.checked_in_at) < LONG_DUE_DAYS) return false
        }
        if (statusFilter === 'ready') {
          const active = getActiveJob(v.jobs)
          if (!active || !READY_STATUSES.includes(active.status)) return false
        }
      }

      return true
    })
  }, [vehicles, search, typeFilter, statusFilter])

  const selectedVehicle = vehicles.find((v) => v.id === selectedId) ?? null

  const typeChips: Array<{ id: VehicleTypeFilter; label: string; icon?: React.ReactNode }> = [
    { id: 'all', label: 'All' },
    { id: 'car', label: 'Cars', icon: <Car size={12} /> },
    { id: 'bike', label: 'Bikes', icon: <Bike size={12} /> },
  ]

  const statusChips: Array<{ id: StatusFilter; label: string; icon?: React.ReactNode }> = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active', icon: <Wrench size={12} /> },
    { id: 'long_due', label: 'Long Due', icon: <AlertCircle size={12} /> },
    { id: 'ready', label: 'Ready', icon: <CheckCircle size={12} /> },
  ]

  return (
    <div
      style={{ display: 'flex', overflow: 'hidden', backgroundColor: '#0E0E0E', color: '#F0F0F0', height: 'calc(100vh - 104px)' }}
    >
      {/* ── LEFT PANEL ── */}
      <div
        style={{ width: 380, display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100%', borderRight: '1px solid #2A2A2A', backgroundColor: '#161616' }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '24px 24px 16px 24px', borderBottom: '1px solid #2A2A2A' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 600, margin: 0 }}>Vehicles</h2>
              <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0, marginTop: 4 }}>
                {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 20px', minHeight: 44, borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#F15A22', color: '#ffffff', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={13} />
              Add Vehicle
            </button>
          </div>

          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', minHeight: 44, background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8 }}>
            <Search size={14} style={{ color: '#A0A0A0', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Plate, customer, model…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: '#F0F0F0' }}
            />
          </div>

          {/* Type chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {typeChips.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setTypeFilter(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: typeFilter === id ? '#F15A22' : '#1E1E1E',
                  color: typeFilter === id ? '#ffffff' : '#A0A0A0',
                  border: `1px solid ${typeFilter === id ? '#F15A22' : '#2A2A2A'}`,
                  borderRadius: 999, fontSize: 12, fontWeight: 500,
                  padding: '6px 16px', minHeight: 32, cursor: 'pointer',
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {/* Status chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {statusChips.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setStatusFilter(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: statusFilter === id ? '#F15A22' : '#1E1E1E',
                  color: statusFilter === id ? '#ffffff' : '#A0A0A0',
                  border: `1px solid ${statusFilter === id ? '#F15A22' : '#2A2A2A'}`,
                  borderRadius: 999, fontSize: 12, fontWeight: 500,
                  padding: '6px 16px', minHeight: 32, cursor: 'pointer',
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {/* Internal Fleet toggle */}
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => setInternalOnly(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: internalOnly ? 'rgba(241,90,34,0.15)' : '#1E1E1E',
                color: internalOnly ? '#F15A22' : '#A0A0A0',
                border: `1px solid ${internalOnly ? 'rgba(241,90,34,0.5)' : '#2A2A2A'}`,
                borderRadius: 999, fontSize: 12, fontWeight: 500,
                padding: '6px 16px', minHeight: 32, cursor: 'pointer',
              }}
            >
              <Building2 size={12} />
              Internal Fleet Only
            </button>
          </div>
        </div>

        {/* Count */}
        <div
          style={{ padding: '8px 16px', borderBottom: '1px solid #2A2A2A' }}
        >
          <span style={{ fontSize: 12, color: '#A0A0A0' }}>
            {filtered.length} vehicle{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8, paddingBottom: 8 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: '#F15A22' }} />
              <span style={{ fontSize: 14, color: '#A0A0A0' }}>
                Loading vehicles…
              </span>
            </div>
          )}

          {!loading && error && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 32, textAlign: 'center' }}>
              <AlertCircle size={20} style={{ color: '#EF4444' }} />
              <p style={{ fontSize: 12, color: '#EF4444', margin: 0 }}>
                {error}
              </p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <EmptyState message="No vehicles match your filters" />
          )}

          {!loading &&
            !error &&
            filtered.map((v) => (
              <VehicleListItem
                key={v.id}
                vehicle={v}
                selected={v.id === selectedId}
                onClick={() => setSelectedId(v.id)}
              />
            ))}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
        {selectedVehicle ? (
          <VehicleDetail
            vehicle={selectedVehicle}
            onEdit={() => setEditingVehicle(selectedVehicle)}
          />
        ) : (
          <NoSelectionState />
        )}
      </div>

      {/* ── ADD MODAL ── */}
      {showAddModal && (
        <AddVehicleModal
          branchId={branchId}
          tenantId={tenantId}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            fetchVehicles()
          }}
        />
      )}

      {/* ── EDIT PANEL ── */}
      {editingVehicle && (
        <EditVehiclePanel
          vehicle={editingVehicle}
          branchId={branchId}
          onClose={() => setEditingVehicle(null)}
          onSuccess={() => {
            fetchVehicles()
            setEditingVehicle(null)
            setSelectedId((prev) => {
              return prev
            })
          }}
        />
      )}
    </div>
  )
}
