import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  X,
  Edit2,
  Save,
  Car,
  Bike,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  ChevronRight,
  AlertCircle,
  Loader2,
  Trash2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logAudit } from '@/lib/audit'
import { formatName, formatPhone, formatEmail, formatIC, formatPlate, formatTitleCase } from '@/lib/formatters'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Customer {
  id: string
  branch_id: string
  full_name: string
  phone: string
  email?: string
  ic_number?: string
  full_address?: string
  customer_type: string
  customer_status: string
  notes?: string
  created_at: string
}

interface Vehicle {
  id: string
  plate_number: string
  make: string
  model: string
  year?: number
  vehicle_type: 'car' | 'bike'
  customer_id: string
  branch_id: string
}

interface Job {
  id: string
  job_number: string
  service_type: string
  status: string
  checked_in_at: string
  final_amount?: number
}

type StatusFilter = 'all' | 'active' | 'inactive'
type TypeFilter = 'all' | 'individual' | 'corporate'
type DetailTab = 'overview' | 'vehicles' | 'jobs' | 'notes'

interface NewCustomerForm {
  full_name: string
  phone: string
  email: string
  ic_number: string
  full_address: string
  customer_type: string
  notes: string
}

interface EditForm {
  full_name: string
  phone: string
  email: string
  ic_number: string
  full_address: string
  customer_type: string
  customer_status: string
  notes: string
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

function formatMYR(amount: number): string {
  return new Intl.NumberFormat('ms-MY', { style: 'currency', currency: 'MYR' }).format(amount)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function statusDotColor(customer_status: string): string {
  return customer_status === 'active' ? '#22c55e' : '#ef4444'
}

function jobStatusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case 'completed': return { bg: '#14532d', text: '#86efac' }
    case 'in_progress': return { bg: '#1e3a5f', text: '#93c5fd' }
    case 'pending': return { bg: '#3b2a00', text: '#fcd34d' }
    case 'cancelled': return { bg: '#3b0a0a', text: '#fca5a5' }
    default: return { bg: '#1E1E1E', text: '#A0A0A0' }
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case 'individual': return 'Individual'
    case 'corporate': return 'Corporate'
    default: return type
  }
}

function typeBadgeColor(type: string): { bg: string; text: string } {
  switch (type) {
    case 'individual': return { bg: '#1e2a1e', text: '#86efac' }
    case 'corporate': return { bg: '#1e1e3b', text: '#a5b4fc' }
    default: return { bg: '#1E1E1E', text: '#A0A0A0' }
  }
}

// â”€â”€â”€ Shared UI atoms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
      <Loader2 size={28} style={{ color: '#F15A22', animation: 'spin 1s linear infinite' }} />
    </div>
  )
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 48, paddingBottom: 48, color: '#A0A0A0' }}>
      <Icon size={36} />
      <p style={{ fontSize: 14, margin: 0 }}>{message}</p>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#F15A22' : '#1E1E1E',
        color: active ? '#ffffff' : '#A0A0A0',
        border: `1px solid ${active ? '#F15A22' : '#2A2A2A'}`,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        padding: '6px 16px',
        minHeight: 32,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: '#F15A22',
        color: '#ffffff',
        fontSize: size * 0.4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {getInitial(name)}
    </div>
  )
}

// â”€â”€â”€ Customer Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CustomerRow({
  customer,
  selected,
  onClick,
}: {
  customer: Customer
  selected: boolean
  onClick: () => void
}) {
  const tc = typeBadgeColor(customer.customer_type)
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textAlign: 'left',
        background: selected ? '#1E1E1E' : 'transparent',
        borderLeft: selected ? '3px solid #F15A22' : '3px solid transparent',
        padding: '14px 16px 14px 13px',
        minHeight: 44,
        border: 'none',
        borderLeftWidth: 3,
        borderLeftStyle: 'solid',
        borderLeftColor: selected ? '#F15A22' : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <Avatar name={customer.full_name} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 14, color: '#F0F0F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {customer.full_name}
          </span>
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: statusDotColor(customer.customer_status ?? 'active'), display: 'inline-block' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Phone size={10} style={{ color: '#A0A0A0' }} />
          <span style={{ fontSize: 12, color: '#A0A0A0' }}>{customer.phone}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <span
            style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, background: tc.bg, color: tc.text }}
          >
            {typeLabel(customer.customer_type)}
          </span>
        </div>
      </div>
      <ChevronRight size={14} style={{ color: '#2A2A2A' }} />
    </button>
  )
}

// â”€â”€â”€ InfoField â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InfoField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: '#A0A0A0' }}>
        {icon}
        <span style={{ fontSize: 12 }}>{label}</span>
      </div>
      <p style={{ fontSize: 14, color: '#F0F0F0', margin: 0 }}>{value}</p>
    </div>
  )
}

// â”€â”€â”€ Overview Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function OverviewTab({
  customer,
  onUpdate,
  onDelete,
}: {
  customer: Customer
  onUpdate: (updated: Customer) => void
  onDelete: () => void
}) {
  const { user } = useAuthStore()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeleteCustomer() {
    if (!window.confirm('Delete this customer? This cannot be undone.')) return
    setDeleting(true)
    setError(null)
    const { error: err } = await supabase.from('customers').delete().eq('id', customer.id)
    setDeleting(false)
    if (err) {
      setError('Cannot delete - customer has existing records. Remove their vehicles and jobs first.')
      return
    }
    onDelete()
  }
  const [form, setForm] = useState<EditForm>({
    full_name: customer.full_name,
    phone: customer.phone,
    email: customer.email ?? '',
    ic_number: customer.ic_number ?? '',
    full_address: customer.full_address ?? '',
    customer_type: customer.customer_type,
    customer_status: customer.customer_status ?? 'active',
    notes: customer.notes ?? '',
  })

  useEffect(() => {
    setEditing(false)
    setForm({
      full_name: customer.full_name,
      phone: customer.phone,
      email: customer.email ?? '',
      ic_number: customer.ic_number ?? '',
      full_address: customer.full_address ?? '',
      customer_type: customer.customer_type,
      customer_status: customer.customer_status ?? 'active',
      notes: customer.notes ?? '',
    })
  }, [customer.id])

  async function handleSave() {
    if (!form.full_name.trim() || !form.phone.trim()) {
      setError('Full Name and Phone are required.')
      return
    }
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('customers')
      .update({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        email: form.email || null,
        ic_number: form.ic_number || null,
        full_address: form.full_address || null,
        customer_type: form.customer_type,
        customer_status: form.customer_status,
        notes: form.notes || null,
      })
      .eq('id', customer.id)
      .select()
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    logAudit({ action: 'update', module: 'customer', record_id: customer.id, record_type: 'customer', details: { name: form.full_name }, branch_id: user?.branch_id, user_id: user?.id, tenant_id: user?.tenant_id })
    onUpdate(data as Customer)
    setEditing(false)
  }

  const inputStyle: React.CSSProperties = {
    background: '#1E1E1E',
    border: '1px solid #2A2A2A',
    color: '#F0F0F0',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 14,
    width: '100%',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = { color: '#A0A0A0', fontSize: 12, marginBottom: 6 }

  const tc = typeBadgeColor(customer.customer_type)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <Avatar name={customer.full_name} size={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>
            {customer.full_name}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Phone size={13} style={{ color: '#A0A0A0' }} />
            <span style={{ fontSize: 14, color: '#A0A0A0' }}>{customer.phone}</span>
          </div>
          {customer.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Mail size={13} style={{ color: '#A0A0A0' }} />
              <span style={{ fontSize: 14, color: '#A0A0A0' }}>{customer.email}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span
              style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, fontWeight: 500, background: tc.bg, color: tc.text }}
            >
              {typeLabel(customer.customer_type)}
            </span>
            <span
              style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 999,
                fontWeight: 500,
                background: customer.customer_status === 'active' ? '#14532d' : '#450a0a',
                color: customer.customer_status === 'active' ? '#86efac' : '#fca5a5',
              }}
            >
              {customer.customer_status === 'active' ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, fontSize: 14, fontWeight: 500, background: '#1E1E1E', color: '#F0F0F0', border: '1px solid #2A2A2A', minHeight: 44, padding: '0 20px', flexShrink: 0, cursor: 'pointer' }}
          >
            <Edit2 size={13} />
            Edit Customer
          </button>
        )}
      </div>

      {error && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14, background: '#3b0a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}
        >
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Full Name *</p>
              <input
                style={inputStyle}
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, full_name: formatName(e.target.value) }))}
              />
            </div>
            <div>
              <p style={labelStyle}>Phone *</p>
              <input
                style={inputStyle}
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
              />
            </div>
            <div>
              <p style={labelStyle}>Email</p>
              <input
                style={inputStyle}
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, email: formatEmail(e.target.value) }))}
              />
            </div>
            <div>
              <p style={labelStyle}>IC Number</p>
              <input
                style={inputStyle}
                value={form.ic_number}
                onChange={e => setForm(f => ({ ...f, ic_number: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, ic_number: formatIC(e.target.value) }))}
              />
            </div>
            <div>
              <p style={labelStyle}>Customer Type</p>
              <select
                style={inputStyle}
                value={form.customer_type}
                onChange={e =>
                  setForm(f => ({ ...f, customer_type: e.target.value as string }))
                }
              >
                <option value="individual">Individual</option>
                <option value="corporate">Corporate</option>
              </select>
            </div>
            <div>
              <p style={labelStyle}>Status</p>
              <select
                style={inputStyle}
                value={form.customer_status}
                onChange={e => setForm(f => ({ ...f, customer_status: e.target.value }))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div>
            <p style={labelStyle}>Full Address</p>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
              value={form.full_address}
              onChange={e => setForm(f => ({ ...f, full_address: e.target.value }))}
            />
          </div>
          <div>
            <p style={labelStyle}>Notes</p>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, fontSize: 14, fontWeight: 500, background: '#F15A22', color: '#ffffff', opacity: saving ? 0.7 : 1, padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer' }}
            >
              {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
              Save Changes
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{ borderRadius: 8, fontSize: 14, background: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A', padding: '0 20px', minHeight: 44, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{ borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12, background: '#161616', border: '1px solid #2A2A2A', padding: '16px 20px' }}
          >
            <InfoField icon={<User size={13} />} label="IC Number" value={customer.ic_number ?? '-'} />
            <InfoField icon={<MapPin size={13} />} label="Address" value={customer.full_address ?? '-'} />
            <InfoField icon={<FileText size={13} />} label="Notes" value={customer.notes ?? '-'} />
          </div>

          {/* Danger Zone */}
          <div
            style={{ borderRadius: 12, marginTop: 24, background: '#1A0E0E', border: '1px solid #7f1d1d', padding: '16px 20px' }}
          >
            <p style={{ fontSize: 12, fontWeight: 600, color: '#F87171', marginBottom: 16 }}>Danger Zone</p>
            <button
              onClick={handleDeleteCustomer}
              disabled={deleting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                background: '#1A0E0E',
                color: '#F87171',
                border: '1px solid #F87171',
                opacity: deleting ? 0.7 : 1,
                minHeight: 44,
                padding: '0 20px',
                cursor: 'pointer',
              }}
            >
              {deleting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
              Delete Customer
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// â”€â”€â”€ Vehicles Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function VehiclesTab({ customerId, branchId }: { customerId: string; branchId: string }) {
  const { user } = useAuthStore()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | null>(null)

  async function handleDeleteVehicle(vehicleId: string) {
    if (!window.confirm('Delete this vehicle?')) return
    setDeletingVehicleId(vehicleId)
    setError(null)
    const { error: err } = await supabase.from('vehicles').delete().eq('id', vehicleId)
    setDeletingVehicleId(null)
    if (err) {
      setError('Cannot delete - vehicle has existing jobs.')
      return
    }
    setVehicles(vs => vs.filter(v => v.id !== vehicleId))
  }
  const [addForm, setAddForm] = useState({
    plate_number: '',
    make: '',
    model: '',
    year: '',
    vehicle_type: 'car' as Vehicle['vehicle_type'],
  })

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('vehicles')
        .select('*')
        .eq('customer_id', customerId)
      setLoading(false)
      if (err) { setError(err.message); return }
      setVehicles(data as Vehicle[])
    }
    load()
  }, [customerId])

  async function handleAddVehicle() {
    if (!addForm.plate_number || !addForm.make || !addForm.model) {
      setError('Plate number, make, and model are required.')
      return
    }
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('vehicles')
      .insert({
        plate_number: addForm.plate_number.toUpperCase(),
        make: addForm.make,
        model: addForm.model,
        year: addForm.year ? parseInt(addForm.year) : null,
        vehicle_type: addForm.vehicle_type,
        customer_id: customerId,
        branch_id: branchId,
      })
      .select()
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    logAudit({ action: 'create', module: 'vehicle', record_id: (data as Vehicle).id, record_type: 'vehicle', details: { plate: addForm.plate_number }, branch_id: user?.branch_id, user_id: user?.id, tenant_id: user?.tenant_id })
    setVehicles(v => [...v, data as Vehicle])
    setShowAdd(false)
    setAddForm({ plate_number: '', make: '', model: '', year: '', vehicle_type: 'car' })
  }

  const inputStyle: React.CSSProperties = {
    background: '#1E1E1E',
    border: '1px solid #2A2A2A',
    color: '#F0F0F0',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 14,
    width: '100%',
    outline: 'none',
  }

  if (loading) return <div style={{ padding: 24, height: 160 }}><Spinner /></div>

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, fontSize: 14, background: '#3b0a0a', color: '#fca5a5' }}
        >
          <AlertCircle size={14} />{error}
        </div>
      )}

      {vehicles.length === 0 && !showAdd && (
        <EmptyState icon={Car} message="No vehicles registered yet." />
      )}

      {vehicles.map(v => (
        <div
          key={v.id}
          style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16 }}
        >
          <div
            style={{ width: 44, height: 44, background: '#1E1E1E', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
          >
            {v.vehicle_type === 'car'
              ? <Car size={22} style={{ color: '#F15A22' }} />
              : <Bike size={22} style={{ color: '#F15A22' }} />}
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: '#F15A22' }}>
              {v.plate_number}
            </span>
            <p style={{ fontSize: 14, color: '#F0F0F0', marginTop: 2 }}>
              {v.make} {v.model}{v.year ? ` (${v.year})` : ''}
            </p>
          </div>
          <span
            style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace', fontWeight: 600, background: '#1E1E1E', color: '#A0A0A0' }}
          >
            {v.vehicle_type.toUpperCase()}
          </span>
          <button
            onClick={() => handleDeleteVehicle(v.id)}
            disabled={deletingVehicleId === v.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              marginLeft: 4,
              background: '#1A0E0E',
              color: '#F87171',
              border: '1px solid #F87171',
              opacity: deletingVehicleId === v.id ? 0.6 : 1,
              padding: '0 12px',
              minHeight: 44,
              cursor: 'pointer',
            }}
            title="Delete vehicle"
          >
            {deletingVehicleId === v.id
              ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : <Trash2 size={13} />}
          </button>
        </div>
      ))}

      {showAdd && (
        <div
          style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 20 }}
        >
          <p style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 600, marginBottom: 20 }}>New Vehicle</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <p style={{ color: '#A0A0A0', fontSize: 12, marginBottom: 6 }}>Plate Number *</p>
              <input
                style={inputStyle}
                value={addForm.plate_number}
                onChange={e => setAddForm(f => ({ ...f, plate_number: e.target.value }))}
                onBlur={e => setAddForm(f => ({ ...f, plate_number: formatPlate(e.target.value) }))}
              />
            </div>
            <div>
              <p style={{ color: '#A0A0A0', fontSize: 12, marginBottom: 6 }}>Type</p>
              <select
                style={inputStyle}
                value={addForm.vehicle_type}
                onChange={e =>
                  setAddForm(f => ({ ...f, vehicle_type: e.target.value as Vehicle['vehicle_type'] }))
                }
              >
                <option value="car">Car</option>
                <option value="bike">Bike</option>
              </select>
            </div>
            <div>
              <p style={{ color: '#A0A0A0', fontSize: 12, marginBottom: 6 }}>Make *</p>
              <input
                style={inputStyle}
                value={addForm.make}
                onChange={e => setAddForm(f => ({ ...f, make: e.target.value }))}
                onBlur={e => setAddForm(f => ({ ...f, make: formatTitleCase(e.target.value) }))}
              />
            </div>
            <div>
              <p style={{ color: '#A0A0A0', fontSize: 12, marginBottom: 6 }}>Model *</p>
              <input
                style={inputStyle}
                value={addForm.model}
                onChange={e => setAddForm(f => ({ ...f, model: e.target.value }))}
                onBlur={e => setAddForm(f => ({ ...f, model: formatTitleCase(e.target.value) }))}
              />
            </div>
            <div>
              <p style={{ color: '#A0A0A0', fontSize: 12, marginBottom: 6 }}>Year</p>
              <input
                style={inputStyle}
                type="number"
                placeholder="e.g. 2020"
                value={addForm.year}
                onChange={e => setAddForm(f => ({ ...f, year: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button
              onClick={handleAddVehicle}
              disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', minHeight: 44, borderRadius: 8, fontSize: 14, fontWeight: 500, background: '#F15A22', color: '#ffffff', opacity: saving ? 0.7 : 1, border: 'none', cursor: 'pointer' }}
            >
              {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
              Save
            </button>
            <button
              onClick={() => setShowAdd(false)}
              style={{ padding: '0 20px', minHeight: 44, borderRadius: 8, fontSize: 14, background: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, fontSize: 14, alignSelf: 'flex-start', background: 'transparent', color: '#F15A22', border: '1px solid #F15A22', padding: '0 20px', minHeight: 44, cursor: 'pointer' }}
        >
          <Plus size={14} />
          Add Vehicle
        </button>
      )}
    </div>
  )
}

// â”€â”€â”€ Jobs Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function JobsTab({ customerId }: { customerId: string }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('jobs')
        .select('id, job_number, service_type, status, checked_in_at, final_amount')
        .eq('customer_id', customerId)
        .order('checked_in_at', { ascending: false })
      setLoading(false)
      if (err) { setError(err.message); return }
      setJobs(data as Job[])
    }
    load()
  }, [customerId])

  if (loading) return <div style={{ padding: 24, height: 160 }}><Spinner /></div>

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, fontSize: 14, background: '#3b0a0a', color: '#fca5a5' }}
        >
          <AlertCircle size={14} />{error}
        </div>
      )}

      {jobs.length === 0 && (
        <EmptyState icon={FileText} message="No jobs found for this customer." />
      )}

      {jobs.map(job => {
        const sc = jobStatusColor(job.status)
        return (
          <div
            key={job.id}
            style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 12, background: '#161616', border: '1px solid #2A2A2A' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#F15A22' }}>
                  {job.job_number}
                </span>
                <span
                  style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.text }}
                >
                  {job.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p style={{ fontSize: 14, color: '#F0F0F0', marginTop: 2 }}>{job.service_type}</p>
              <p style={{ fontSize: 12, color: '#A0A0A0', marginTop: 2 }}>
                {formatDate(job.checked_in_at)}
              </p>
            </div>
            {job.final_amount != null && (
              <span style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>
                {formatMYR(job.final_amount)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// â”€â”€â”€ Notes Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NotesTab({
  customer,
  onUpdate,
}: {
  customer: Customer
  onUpdate: (c: Customer) => void
}) {
  const [notes, setNotes] = useState(customer.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNotes(customer.notes ?? '')
    setSaved(false)
  }, [customer.id])

  async function handleSave() {
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('customers')
      .update({ notes: notes || null })
      .eq('id', customer.id)
      .select()
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    onUpdate(data as Customer)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, fontSize: 14, background: '#3b0a0a', color: '#fca5a5' }}
        >
          <AlertCircle size={14} />{error}
        </div>
      )}
      <textarea
        style={{
          borderRadius: 12,
          padding: 16,
          fontSize: 14,
          resize: 'none',
          background: '#1E1E1E',
          border: '1px solid #2A2A2A',
          color: '#F0F0F0',
          minHeight: 200,
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
        }}
        placeholder="Add notes about this customer..."
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, fontSize: 14, fontWeight: 500, alignSelf: 'flex-start', background: '#F15A22', color: '#ffffff', opacity: saving ? 0.7 : 1, padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer' }}
      >
        {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
        {saved ? 'Saved!' : 'Save Notes'}
      </button>
    </div>
  )
}

// â”€â”€â”€ Customer Detail (tabbed right panel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CustomerDetail({
  customer,
  branchId,
  onUpdate,
  onDelete,
}: {
  customer: Customer
  branchId: string
  onUpdate: (c: Customer) => void
  onDelete: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('overview')

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'jobs', label: 'Jobs' },
    { key: 'notes', label: 'Notes' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '20px 24px 0 24px', borderBottom: '1px solid #2A2A2A' }}
      >
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: tab === t.key ? '#F15A22' : '#A0A0A0',
              borderBottom: tab === t.key ? '2px solid #F15A22' : '2px solid transparent',
              background: 'transparent',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: tab === t.key ? '#F15A22' : 'transparent',
              padding: '0 20px',
              minHeight: 44,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {tab === 'overview' && <OverviewTab customer={customer} onUpdate={onUpdate} onDelete={onDelete} />}
        {tab === 'vehicles' && <VehiclesTab customerId={customer.id} branchId={branchId} />}
        {tab === 'jobs' && <JobsTab customerId={customer.id} />}
        {tab === 'notes' && <NotesTab customer={customer} onUpdate={onUpdate} />}
      </div>
    </div>
  )
}

// â”€â”€â”€ New Customer Slide-in Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NewCustomerPanel({
  branchId,
  onClose,
  onCreated,
}: {
  branchId: string
  onClose: () => void
  onCreated: (c: Customer) => void
}) {
  const { user } = useAuthStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<NewCustomerForm>({
    full_name: '',
    phone: '',
    email: '',
    ic_number: '',
    full_address: '',
    customer_type: 'individual',
    notes: '',
  })

  async function handleSubmit() {
    if (!form.full_name.trim() || !form.phone.trim()) {
      setError('Full Name and Phone are required.')
      return
    }
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('customers')
      .insert({
        branch_id: branchId,
        tenant_id: user?.tenant_id,
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        email: form.email || null,
        ic_number: form.ic_number || null,
        full_address: form.full_address || null,
        customer_type: form.customer_type,
        notes: form.notes || null,
      })
      .select()
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    logAudit({ action: 'create', module: 'customer', record_id: (data as Customer).id, record_type: 'customer', details: { name: form.full_name }, branch_id: user?.branch_id, user_id: user?.id, tenant_id: user?.tenant_id })
    onCreated(data as Customer)
  }

  const inputStyle: React.CSSProperties = {
    background: '#1E1E1E',
    border: '1px solid #2A2A2A',
    color: '#F0F0F0',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 14,
    width: '100%',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = { color: '#A0A0A0', fontSize: 12, marginBottom: 6 }

  return (
    <>
      {/* Overlay */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100%',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          width: 500,
          background: '#161616',
          borderLeft: '1px solid #2A2A2A',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, borderBottom: '1px solid #2A2A2A', padding: '20px 24px' }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#F0F0F0', margin: 0 }}>
            New Customer
          </h2>
          <button
            onClick={onClose}
            style={{ borderRadius: 8, color: '#A0A0A0', background: '#1E1E1E', padding: '0 12px', minHeight: 44, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {error && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14, background: '#3b0a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}
            >
              <AlertCircle size={14} />{error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Full Name *</p>
              <input
                style={inputStyle}
                placeholder="e.g. Ahmad bin Ali"
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, full_name: formatName(e.target.value) }))}
              />
            </div>
            <div>
              <p style={labelStyle}>Phone *</p>
              <input
                style={inputStyle}
                placeholder="e.g. 0123456789"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
              />
            </div>
            <div>
              <p style={labelStyle}>Email</p>
              <input
                style={inputStyle}
                type="email"
                placeholder="optional"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, email: formatEmail(e.target.value) }))}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>IC Number</p>
              <input
                style={inputStyle}
                placeholder="e.g. 900101-14-5678"
                value={form.ic_number}
                onChange={e => setForm(f => ({ ...f, ic_number: e.target.value }))}
                onBlur={e => setForm(f => ({ ...f, ic_number: formatIC(e.target.value) }))}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Customer Type</p>
              <select
                style={inputStyle}
                value={form.customer_type}
                onChange={e =>
                  setForm(f => ({ ...f, customer_type: e.target.value as string }))
                }
              >
                <option value="individual">Individual</option>
                <option value="corporate">Corporate</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Full Address</p>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                placeholder="optional"
                value={form.full_address}
                onChange={e => setForm(f => ({ ...f, full_address: e.target.value }))}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Notes</p>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                placeholder="optional"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{ borderTop: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '16px 24px', flexShrink: 0 }}
        >
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, fontSize: 14, fontWeight: 600, background: '#F15A22', color: '#ffffff', opacity: saving ? 0.7 : 1, padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer' }}
          >
            {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
            Create Customer
          </button>
          <button
            onClick={onClose}
            style={{ borderRadius: 8, fontSize: 14, background: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A', padding: '0 20px', minHeight: 44, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

// â”€â”€â”€ Main Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function CustomersPage() {
  const { user } = useAuthStore()
  const branchId: string = user?.branch_id ?? ''

  const PAGE_SIZE = 50
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewPanel, setShowNewPanel] = useState(false)

  const loadCustomers = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    setError(null)
    setPage(0)
    const { data, error: err } = await supabase
      .from('customers')
      .select('*')
      .eq('branch_id', branchId)
      .order('full_name')
      .range(0, PAGE_SIZE - 1)
    setLoading(false)
    if (err) { setError(err.message); return }
    const rows = (data as Customer[]) ?? []
    setCustomers(rows)
    setHasMore(rows.length === PAGE_SIZE)
  }, [branchId])

  async function loadMore() {
    if (!branchId || loadingMore) return
    setLoadingMore(true)
    const nextPage = page + 1
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('branch_id', branchId)
      .order('full_name')
      .range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1)
    setLoadingMore(false)
    const rows = (data as Customer[]) ?? []
    setCustomers(cs => [...cs, ...rows])
    setPage(nextPage)
    setHasMore(rows.length === PAGE_SIZE)
  }

  useEffect(() => {
    loadCustomers()
  }, [loadCustomers])

  const filtered = customers.filter(c => {
    const matchSearch =
      search === '' ||
      c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.full_address ?? '').toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && c.customer_status === 'active') ||
      (statusFilter === 'inactive' && c.customer_status !== 'active')
    const matchType = typeFilter === 'all' || c.customer_type === typeFilter
    return matchSearch && matchStatus && matchType
  })

  const selectedCustomer = customers.find(c => c.id === selectedId) ?? null

  function handleCustomerUpdate(updated: Customer) {
    setCustomers(cs => cs.map(c => (c.id === updated.id ? updated : c)))
  }

  function handleCustomerDeleted() {
    if (selectedId) {
      setCustomers(cs => cs.filter(c => c.id !== selectedId))
      setSelectedId(null)
    }
  }

  function handleCreated(c: Customer) {
    setCustomers(cs =>
      [...cs, c].sort((a, b) => a.full_name.localeCompare(b.full_name))
    )
    setSelectedId(c.id)
    setShowNewPanel(false)
  }

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
  ]

  const typeChips: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'individual', label: 'Individual' },
    { key: 'corporate', label: 'Corporate' },
  ]

  return (
    <div
      style={{ display: 'flex', overflow: 'hidden', background: '#0E0E0E', color: '#F0F0F0', height: 'calc(100vh - 104px)' }}
    >
      {/* â”€â”€ Left panel (380px fixed) â”€â”€ */}
      <div
        style={{
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          height: '100%',
          overflow: 'hidden',
          background: '#161616',
          borderRight: '1px solid #2A2A2A',
        }}
      >
        {/* Panel header */}
        <div style={{ flexShrink: 0, padding: '24px 24px 16px 24px', borderBottom: '1px solid #2A2A2A' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 600, color: '#F0F0F0', margin: 0 }}>Customers</h1>
              {!loading && (
                <p style={{ fontSize: 12, color: '#A0A0A0', marginTop: 2 }}>
                  {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
                </p>
              )}
            </div>
            <button
              onClick={() => setShowNewPanel(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#F15A22', color: '#ffffff', padding: '0 20px', minHeight: 44, border: 'none', cursor: 'pointer' }}
            >
              <Plus size={13} />
              New Customer
            </button>
          </div>

          {/* Search */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: 8, background: '#1E1E1E', border: '1px solid #2A2A2A', minHeight: 44 }}
          >
            <Search size={14} style={{ color: '#A0A0A0', flexShrink: 0 }} />
            <input
              style={{ flex: 1, background: 'transparent', fontSize: 14, outline: 'none', color: '#F0F0F0', border: 'none' }}
              placeholder="Search name, phone, address..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 12px', minHeight: 44, display: 'flex', alignItems: 'center' }}>
                <X size={13} style={{ color: '#A0A0A0' }} />
              </button>
            )}
          </div>

          {/* Status filter chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {statusChips.map(c => (
              <FilterChip
                key={c.key}
                label={c.label}
                active={statusFilter === c.key}
                onClick={() => setStatusFilter(c.key)}
              />
            ))}
          </div>

          {/* Type filter chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {typeChips.map(c => (
              <FilterChip
                key={c.key}
                label={c.label}
                active={typeFilter === c.key}
                onClick={() => setTypeFilter(c.key)}
              />
            ))}
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 12, paddingBottom: 12 }}>
          {loading && (
            <div style={{ height: 160 }}>
              <Spinner />
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: 16 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, fontSize: 14, background: '#3b0a0a', color: '#fca5a5' }}
              >
                <AlertCircle size={14} />{error}
              </div>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <EmptyState icon={User} message="No customers found." />
          )}
          {!loading && !error && filtered.map(c => (
            <CustomerRow
              key={c.id}
              customer={c}
              selected={selectedId === c.id}
              onClick={() => setSelectedId(c.id)}
            />
          ))}
          {!loading && !error && hasMore && search === '' && statusFilter === 'all' && typeFilter === 'all' && (
            <div style={{ padding: '12px 16px', textAlign: 'center' }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: 'none', border: '1px solid #2A2A2A', borderRadius: 6,
                  color: '#A0A0A0', padding: '6px 20px', cursor: 'pointer', fontSize: 12,
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* â”€â”€ Right panel (flex-1) â”€â”€ */}
      <div style={{ flex: 1, height: '100%', overflow: 'hidden', background: '#0E0E0E' }}>
        {selectedCustomer ? (
          <CustomerDetail
            key={selectedCustomer.id}
            customer={selectedCustomer}
            branchId={branchId}
            onUpdate={handleCustomerUpdate}
            onDelete={handleCustomerDeleted}
          />
        ) : (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#A0A0A0' }}
          >
            <User size={48} />
            <p style={{ fontSize: 14, margin: 0 }}>Select a customer to view details</p>
          </div>
        )}
      </div>

      {/* â”€â”€ New Customer slide-in â”€â”€ */}
      {showNewPanel && (
        <NewCustomerPanel
          branchId={branchId}
          onClose={() => setShowNewPanel(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
