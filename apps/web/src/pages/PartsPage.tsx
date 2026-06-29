import { useState, useEffect, useCallback } from 'react'
import {
  Package,
  Plus,
  Search,
  CheckCircle,
  Wrench,
  X,
  ShoppingCart,
  Truck,
  PackageCheck,
  Settings,
  Loader2,
  AlertCircle,
  Zap,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatName, formatPhone, formatTitleCase, formatSKU } from '@/lib/formatters'
import { toast } from '@/components/ui/Toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartRequest {
  id: string
  branch_id: string
  job_id?: string | null
  requested_by?: string | null
  part_name: string
  part_number?: string | null
  quantity: number
  ordered_qty?: number | null
  catalogue_part_id?: string | null
  unit_price?: number | null
  selling_price?: number | null
  supplier?: string | null
  urgency: 'low' | 'normal' | 'urgent' | 'critical'
  status: 'pending' | 'ordered' | 'received' | 'installed' | 'cancelled'
  notes?: string | null
  created_at: string
  jobs?: {
    job_number: string
    service_type: string
    vehicles?: {
      plate_number: string
      make: string
      model: string
    }
  } | null
}

type StatusFilter = 'all' | 'pending' | 'ordered' | 'received' | 'installed' | 'cancelled'

interface NewRequestForm {
  job_id: string
  job_number_search: string
  part_name: string
  part_number: string
  quantity: string
  unit_price: string
  supplier: string
  urgency: PartRequest['urgency']
  notes: string
}

const EMPTY_FORM: NewRequestForm = {
  job_id: '',
  job_number_search: '',
  part_name: '',
  part_number: '',
  quantity: '',
  unit_price: '',
  supplier: '',
  urgency: 'normal',
  notes: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const STATUS_COLORS: Record<PartRequest['status'], string> = {
  pending: '#F59E0B',
  ordered: '#3B82F6',
  received: '#22C55E',
  installed: '#10B981',
  cancelled: '#6B7280',
}

const STATUS_BG: Record<PartRequest['status'], string> = {
  pending: 'rgba(245,158,11,0.12)',
  ordered: 'rgba(59,130,246,0.12)',
  received: 'rgba(34,197,94,0.12)',
  installed: 'rgba(16,185,129,0.12)',
  cancelled: 'rgba(107,114,128,0.12)',
}

const URGENCY_COLORS: Record<PartRequest['urgency'], string> = {
  low: '#6B7280',
  normal: '#3B82F6',
  urgent: '#F59E0B',
  critical: '#EF4444',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string
  count: number
  icon: React.ReactNode
  color: string
}

function SummaryCard({ label, count, icon, color }: SummaryCardProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 20, borderRadius: 12, flex: 1, minWidth: 0, background: '#161616', border: '1px solid #2A2A2A' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 8, background: `${color}18`, flexShrink: 0 }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: 0 }}>{label}</p>
        <p style={{ color, fontSize: 28, fontWeight: 700, margin: '2px 0 0' }}>{count}</p>
      </div>
    </div>
  )
}

interface StatusBadgeProps {
  status: PartRequest['status']
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
        color: STATUS_COLORS[status],
        background: STATUS_BG[status],
      }}
    >
      {status}
    </span>
  )
}

// ─── New Request Modal ─────────────────────────────────────────────────────────

interface NewRequestModalProps {
  onClose: () => void
  onSubmit: (form: NewRequestForm) => Promise<void>
  loading: boolean
  tenantId: string
}

interface ResolvedJob { id: string; job_number: string; plate: string; service: string }

function NewRequestModal({ onClose, onSubmit, loading, tenantId }: NewRequestModalProps) {
  const [form, setForm] = useState<NewRequestForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof NewRequestForm, string>>>({})
  const [resolvedJob, setResolvedJob] = useState<ResolvedJob | null>(null)
  const [jobLookupState, setJobLookupState] = useState<'idle' | 'loading' | 'found' | 'notfound'>('idle')
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [showAddSupplier, setShowAddSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_person: '', phone: '', address: '' })
  const [savingSupplier, setSavingSupplier] = useState(false)

  const loadSuppliers = useCallback(async () => {
    if (!tenantId) return
    const { data } = await supabase.from('suppliers').select('id, name').eq('tenant_id', tenantId).eq('is_active', true).order('name')
    setSuppliers(data ?? [])
  }, [tenantId])

  useEffect(() => { loadSuppliers() }, [loadSuppliers])

  async function handleSaveSupplier() {
    if (!newSupplier.name.trim()) return
    setSavingSupplier(true)
    const { data, error } = await supabase.from('suppliers')
      .insert({ name: newSupplier.name.trim(), contact_person: newSupplier.contact_person.trim() || null, phone: newSupplier.phone.trim() || null, address: newSupplier.address.trim() || null, tenant_id: tenantId, is_active: true })
      .select('id, name').single()
    setSavingSupplier(false)
    if (error || !data) { toast('Failed to save supplier', 'error'); return }
    await loadSuppliers()
    set('supplier', data.name)
    setShowAddSupplier(false)
    setNewSupplier({ name: '', contact_person: '', phone: '', address: '' })
    toast(`"${data.name}" added and selected`)
  }

  function set(field: keyof NewRequestForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  useEffect(() => {
    const num = form.job_number_search.trim()
    if (!num) { setResolvedJob(null); setJobLookupState('idle'); setForm(f => ({ ...f, job_id: '' })); return }
    const timer = setTimeout(async () => {
      setJobLookupState('loading')
      const { data } = await supabase
        .from('jobs')
        .select('id, job_number, service_type, vehicles!vehicle_id(plate_number)')
        .ilike('job_number', `%${num}%`)
        .limit(3)
      if (data && data.length > 0) {
        const j = data[0] as { id: string; job_number: string; service_type: string; vehicles?: { plate_number: string }[] | { plate_number: string } | null }
        const veh = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles
        const resolved: ResolvedJob = {
          id: j.id,
          job_number: j.job_number,
          plate: veh?.plate_number ?? '—',
          service: j.service_type,
        }
        setResolvedJob(resolved)
        setForm(f => ({ ...f, job_id: resolved.id }))
        setJobLookupState('found')
      } else {
        setResolvedJob(null)
        setForm(f => ({ ...f, job_id: '' }))
        setJobLookupState(num.length >= 3 ? 'notfound' : 'idle')
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [form.job_number_search])

  function validate(): boolean {
    const newErrors: Partial<Record<keyof NewRequestForm, string>> = {}
    if (!form.part_name.trim()) newErrors.part_name = 'Part name is required'
    if (!form.quantity || Number(form.quantity) <= 0) newErrors.quantity = 'Valid quantity required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    await onSubmit(form)
  }

  const inputStyle = {
    background: '#0E0E0E',
    border: '1px solid #2A2A2A',
    color: '#F0F0F0',
  }
  const labelStyle = { color: '#A0A0A0' }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ width: '100%', maxWidth: 672, borderRadius: 16, display: 'flex', flexDirection: 'column', maxHeight: '90vh', background: '#1E1E1E', border: '1px solid #2A2A2A' }}
      >
        {/* Modal header */}
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, borderBottom: '1px solid #2A2A2A', padding: '20px 24px' }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#F0F0F0' }}>
            New Parts Request
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#A0A0A0', padding: '0 12px', minHeight: 44 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ overflowY: 'auto', flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Job number */}
            <div>
              <label style={{ display: 'block', fontSize: 14, ...labelStyle, marginBottom: 6 }}>
                Job Number (optional)
              </label>
              <input
                type="text"
                value={form.job_number_search}
                onChange={(e) => set('job_number_search', e.target.value)}
                placeholder="e.g. JB-2025-0042"
                style={{ width: '100%', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', ...inputStyle, borderColor: jobLookupState === 'notfound' ? '#EF4444' : jobLookupState === 'found' ? '#22C55E' : '#2A2A2A' }}
              />
              {jobLookupState === 'loading' && (
                <p style={{ fontSize: 11, margin: '4px 0 0', color: '#A0A0A0' }}>Searching…</p>
              )}
              {jobLookupState === 'found' && resolvedJob && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '6px 8px', borderRadius: 8, backgroundColor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                  <CheckCircle size={12} color="#22C55E" />
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#22C55E' }}>
                    {resolvedJob.job_number} · {resolvedJob.plate} · {resolvedJob.service}
                  </span>
                </div>
              )}
              {jobLookupState === 'notfound' && (
                <p style={{ fontSize: 11, marginTop: 4, color: '#EF4444' }}>No job found with that number</p>
              )}
            </div>

            {/* Part name + part number */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, ...labelStyle, marginBottom: 6 }}>
                  Part Name <span style={{ color: '#F15A22' }}>*</span>
                </label>
                <input
                  type="text"
                  value={form.part_name}
                  onChange={(e) => set('part_name', e.target.value)}
                  onBlur={(e) => set('part_name', formatTitleCase(e.target.value))}
                  placeholder="e.g. Brake Pad Front"
                  style={{
                    width: '100%', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none',
                    ...inputStyle,
                    borderColor: errors.part_name ? '#F15A22' : '#2A2A2A',
                  }}
                />
                {errors.part_name && (
                  <p style={{ fontSize: 11, marginTop: 4, color: '#F15A22' }}>
                    {errors.part_name}
                  </p>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, ...labelStyle, marginBottom: 6 }}>
                  Part Number
                </label>
                <input
                  type="text"
                  value={form.part_number}
                  onChange={(e) => set('part_number', e.target.value)}
                  onBlur={(e) => set('part_number', formatSKU(e.target.value))}
                  placeholder="e.g. BP-4501-F"
                  style={{ width: '100%', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', ...inputStyle }}
                />
              </div>
            </div>

            {/* Quantity + est. cost */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, ...labelStyle, marginBottom: 6 }}>
                  Quantity <span style={{ color: '#F15A22' }}>*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                  placeholder="1"
                  style={{
                    width: '100%', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none',
                    ...inputStyle,
                    borderColor: errors.quantity ? '#F15A22' : '#2A2A2A',
                  }}
                />
                {errors.quantity && (
                  <p style={{ fontSize: 11, marginTop: 4, color: '#F15A22' }}>
                    {errors.quantity}
                  </p>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, ...labelStyle, marginBottom: 6 }}>
                  Est. Cost (RM)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unit_price}
                  onChange={(e) => set('unit_price', e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', ...inputStyle }}
                />
              </div>
            </div>

            {/* Supplier + Urgency */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={labelStyle}>Supplier</label>
                  <button type="button" onClick={() => { setShowAddSupplier(v => !v); setNewSupplier({ name: '', contact_person: '', phone: '', address: '' }) }}
                    style={{ fontSize: 11, color: showAddSupplier ? '#A0A0A0' : '#F15A22', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                    {showAddSupplier ? '✕ Cancel' : '+ Add New'}
                  </button>
                </div>
                <select value={form.supplier} onChange={(e) => set('supplier', e.target.value)}
                  style={{ ...inputStyle, color: form.supplier ? '#F0F0F0' : '#6B7280' }}>
                  <option value="">— Select Supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...labelStyle, marginBottom: 6 }}>Urgency</label>
                <select value={form.urgency} onChange={(e) => set('urgency', e.target.value)} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            {/* Inline add-supplier */}
            {showAddSupplier && (
              <div style={{ background: '#0E0E0E', border: '1px solid #F15A22', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ color: '#F15A22', fontSize: 11, fontWeight: 700, margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>New Supplier</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ ...labelStyle, fontSize: 11, marginBottom: 0 }}>Supplier Name *</label>
                  <input value={newSupplier.name} onChange={e => setNewSupplier(s => ({ ...s, name: e.target.value }))} onBlur={e => setNewSupplier(s => ({ ...s, name: formatTitleCase(e.target.value) }))} placeholder="e.g. AutoParts Sdn Bhd" style={{ ...inputStyle, fontSize: 13 }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ ...labelStyle, fontSize: 11, marginBottom: 0 }}>Contact Person</label>
                    <input value={newSupplier.contact_person} onChange={e => setNewSupplier(s => ({ ...s, contact_person: e.target.value }))} onBlur={e => setNewSupplier(s => ({ ...s, contact_person: formatName(e.target.value) }))} placeholder="e.g. Ahmad" style={{ ...inputStyle, fontSize: 13 }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ ...labelStyle, fontSize: 11, marginBottom: 0 }}>Phone</label>
                    <input value={newSupplier.phone} onChange={e => setNewSupplier(s => ({ ...s, phone: e.target.value }))} onBlur={e => setNewSupplier(s => ({ ...s, phone: formatPhone(e.target.value) }))} placeholder="e.g. 012-3456789" style={{ ...inputStyle, fontSize: 13 }} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ ...labelStyle, fontSize: 11, marginBottom: 0 }}>Address</label>
                  <input value={newSupplier.address ?? ''} onChange={e => setNewSupplier(s => ({ ...s, address: e.target.value }))} placeholder="e.g. No 12, Jalan Industri 3, Klang" style={{ ...inputStyle, fontSize: 13 }} />
                </div>
                <button type="button" onClick={handleSaveSupplier} disabled={savingSupplier || !newSupplier.name.trim()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: newSupplier.name.trim() ? '#F15A22' : '#2A2A2A', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 13, fontWeight: 600, cursor: newSupplier.name.trim() ? 'pointer' : 'not-allowed' }}>
                  {savingSupplier ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                  Save & Select
                </button>
              </div>
            )}

            {/* Notes */}
            <div>
              <label style={{ display: 'block', fontSize: 14, ...labelStyle, marginBottom: 6 }}>
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Additional remarks..."
                rows={3}
                style={{ ...inputStyle, width: '100%', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', resize: 'none' }}
              />
            </div>
          </div>

          {/* Modal footer */}
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexShrink: 0, borderTop: '1px solid #2A2A2A', padding: '16px 24px' }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', padding: '0 20px', minHeight: 44 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                borderRadius: 8, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
                background: loading ? '#5A2A10' : '#F15A22',
                color: '#F0F0F0',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                padding: '0 20px',
                minHeight: 44,
              }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Module-level styles (used in order modal) ────────────────────────────────

const inputStyle: React.CSSProperties = { background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0', borderRadius: 8, padding: '8px 12px', fontSize: 14, width: '100%', outline: 'none' }
const labelStyle: React.CSSProperties = { color: '#A0A0A0', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function PartsPage() {
  const { user } = useAuthStore()
  const branchId: string = user?.branch_id ?? ''
  const tenantId: string = user?.tenant_id ?? ''

  const [parts, setParts] = useState<PartRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [showNewModal, setShowNewModal] = useState(false)
  const [newLoading, setNewLoading] = useState(false)

  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Order-confirmation modal state
  const [orderModal, setOrderModal] = useState<{ open: boolean; part: PartRequest | null }>({ open: false, part: null })
  const [orderForm, setOrderForm] = useState({ ordered_qty: '', catalogue_part_id: '' })
  const [catalogueParts, setCatalogueParts] = useState<{ id: string; name: string; part_number?: string | null; stock_qty: number; division?: string; selling_price?: number | null; suppliers?: { name: string }[] | { name: string } | null }[]>([])
  const [orderSaving, setOrderSaving] = useState(false)

  // Inline price editing
  const [editingPrice, setEditingPrice] = useState<{ id: string; value: string } | null>(null)

  async function savePriceInline(partId: string, value: string) {
    const price = parseFloat(value)
    if (!isNaN(price) && price >= 0) {
      await supabase.from('parts_requests').update({ selling_price: price }).eq('id', partId)
      await loadParts()
    }
    setEditingPrice(null)
  }

  // Grab & Go modal state
  const [showGrabGoModal, setShowGrabGoModal] = useState(false)
  const [grabGoForm, setGrabGoForm] = useState({ catalogue_part_id: '', part_search: '', qty: '1', job_id: '', job_search: '', job_vehicle_type: '', selling_price: '', supplier_name: '', notes: '' })
  const [grabGoSaving, setGrabGoSaving] = useState(false)
  const [grabGoJobResults, setGrabGoJobResults] = useState<{ id: string; job_number: string; plate: string; make: string; model: string; vehicle_type: string }[]>([])
  const [grabGoPartOpen, setGrabGoPartOpen] = useState(false)
  const [grabGoJobOpen, setGrabGoJobOpen] = useState(false)

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadParts = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: dbErr } = await supabase
        .from('parts_requests')
        .select(
          `*,
          jobs!job_id(job_number, service_type, vehicles!vehicle_id(plate_number, make, model))`
        )
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })

      if (dbErr) throw dbErr
      // Only show parts requests (have a job_id OR no ordered_qty at creation = not a stock purchase)
      const partsRequests = ((data as PartRequest[]) ?? []).filter(p => {
        const isStockPurchase = !p.job_id && p.ordered_qty != null
        return !isStockPurchase
      })
      setParts(partsRequests)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load parts')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => {
    loadParts()
  }, [loadParts])

  // ── Counts ────────────────────────────────────────────────────────────────────

  const counts = {
    pending: parts.filter((p) => p.status === 'pending').length,
    ordered: parts.filter((p) => p.status === 'ordered').length,
    received: parts.filter((p) => p.status === 'received').length,
    installed: parts.filter((p) => p.status === 'installed').length,
  }

  // ── Filtering ─────────────────────────────────────────────────────────────────

  const filtered = parts.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false

    if (search.trim()) {
      const q = search.toLowerCase()
      const inName = p.part_name.toLowerCase().includes(q)
      const inJob = p.jobs?.job_number?.toLowerCase().includes(q) ?? false
      const inSupplier = (p.supplier ?? '').toLowerCase().includes(q)
      if (!inName && !inJob && !inSupplier) return false
    }

    if (dateFrom) {
      if (new Date(p.created_at) < new Date(dateFrom)) return false
    }
    if (dateTo) {
      if (new Date(p.created_at) > new Date(dateTo + 'T23:59:59')) return false
    }

    return true
  })

  // ── Status updates ────────────────────────────────────────────────────────────

  async function updateStatus(id: string, status: PartRequest['status']) {
    setActionLoading(id)
    try {
      const { error: dbErr } = await supabase.from('parts_requests').update({ status }).eq('id', id)
      if (dbErr) throw dbErr
      toast(`Status updated to ${status}`)
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleMarkOrdered(part: PartRequest) {
    // Parts request — open modal to set ordered qty and optional catalogue link
    supabase.from('parts_catalogue').select('id,name,part_number,stock_qty').eq('tenant_id', tenantId).eq('is_active', true).order('name').then(({ data }) => setCatalogueParts(data ?? []))
    setOrderForm({ ordered_qty: String(part.quantity), catalogue_part_id: part.catalogue_part_id ?? '' })
    setOrderModal({ open: true, part })
  }

  async function handleConfirmOrdered() {
    if (!orderModal.part) return
    const orderedQty = Number(orderForm.ordered_qty)
    if (!orderedQty || orderedQty < 1) { toast('Enter a valid ordered quantity', 'error'); return }
    setOrderSaving(true)
    try {
      const payload: Record<string, unknown> = { status: 'ordered', ordered_qty: orderedQty }
      if (orderForm.catalogue_part_id) payload.catalogue_part_id = orderForm.catalogue_part_id
      const { error: dbErr } = await supabase.from('parts_requests').update(payload).eq('id', orderModal.part.id)
      if (dbErr) throw dbErr
      toast(`Marked as Ordered · ${orderedQty} units`)
      setOrderModal({ open: false, part: null })
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed', 'error')
    } finally {
      setOrderSaving(false)
    }
  }

  async function buildCatalogueUpdate(catalogueId: string, qtyToAdd: number, part: PartRequest) {
    const { data: catRow } = await supabase.from('parts_catalogue').select('stock_qty, supplier_id').eq('id', catalogueId).single()
    const update: Record<string, unknown> = { stock_qty: (catRow?.stock_qty ?? 0) + qtyToAdd }
    if (part.unit_price) update.cost_price = part.unit_price
    if (part.selling_price) update.selling_price = part.selling_price
    if (!catRow?.supplier_id && part.supplier) {
      const { data: sup } = await supabase.from('suppliers').select('id').eq('name', part.supplier).eq('tenant_id', tenantId).single()
      if (sup) update.supplier_id = sup.id
    }
    return update
  }

  async function handleMarkReceived(part: PartRequest) {
    setActionLoading(part.id)
    try {
      const { error } = await supabase.from('parts_requests').update({ status: 'received' }).eq('id', part.id)
      if (error) throw error
      const orderedQty = part.ordered_qty ?? part.quantity
      const surplus = orderedQty - part.quantity
      if (surplus > 0 && part.catalogue_part_id) {
        const catUpdate = await buildCatalogueUpdate(part.catalogue_part_id, surplus, part)
        await supabase.from('parts_catalogue').update(catUpdate).eq('id', part.catalogue_part_id)
        toast(`Received · ${part.quantity} unit${part.quantity !== 1 ? 's' : ''} for job · ${surplus} surplus added to stock`)
      } else {
        toast(`Received · ${part.quantity} unit${part.quantity !== 1 ? 's' : ''} for job`)
      }
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleMarkInstalled(part: PartRequest) {
    await updateStatus(part.id, 'installed')
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this parts request?')) return
    await updateStatus(id, 'cancelled')
  }

  async function searchGrabGoJobs(term: string) {
    let q = supabase
      .from('jobs')
      .select('id, job_number, vehicles!vehicle_id(plate_number, make, model, vehicle_type)')
      .not('status', 'in', '("cancelled","invoiced")')
      .order('created_at', { ascending: false })
      .limit(10)
    if (branchId) q = q.eq('branch_id', branchId)
    if (term.trim()) q = q.ilike('job_number', `%${term}%`)
    const { data } = await q
    setGrabGoJobResults((data ?? []).map((j: Record<string, unknown>) => {
      const veh = j.vehicles as { plate_number?: string; make?: string; model?: string; vehicle_type?: string } | null
      return {
        id: j.id as string,
        job_number: (j.job_number as string) ?? '(no job #)',
        plate: veh?.plate_number ?? '',
        make: veh?.make ?? '',
        model: veh?.model ?? '',
        vehicle_type: veh?.vehicle_type ?? '',
      }
    }))
  }

  async function handleGrabGo() {
    if (!grabGoForm.catalogue_part_id) { toast('Select a part from catalogue', 'error'); return }
    if (!grabGoForm.job_id) { toast('Link to a job before confirming Grab & Go', 'error'); return }
    const qty = Math.max(1, Number(grabGoForm.qty) || 1)
    setGrabGoSaving(true)
    try {
      const { data: catPart, error: fetchErr } = await supabase
        .from('parts_catalogue')
        .select('id, name, part_number, stock_qty, selling_price')
        .eq('id', grabGoForm.catalogue_part_id)
        .single()
      if (fetchErr || !catPart) throw new Error('Could not find catalogue part')

      const qtyBefore = catPart.stock_qty ?? 0
      const qtyAfter = qtyBefore - qty

      if (qtyAfter < 0 && !confirm(`Stock will go negative (${qtyAfter} units). Continue?`)) {
        setGrabGoSaving(false); return
      }

      const { error: deductErr } = await supabase
        .from('parts_catalogue')
        .update({ stock_qty: qtyAfter })
        .eq('id', grabGoForm.catalogue_part_id)
      if (deductErr) throw deductErr

      const reqPayload: Record<string, unknown> = {
        branch_id: branchId,
        tenant_id: tenantId || null,
        catalogue_part_id: grabGoForm.catalogue_part_id,
        part_name: catPart.name,
        part_number: catPart.part_number || null,
        quantity: qty,
        ordered_qty: qty,
        status: 'installed',
        urgency: 'normal',
        notes: grabGoForm.notes.trim() || 'Grab & Go',
        requested_by: user?.id ?? null,
        selling_price: grabGoForm.selling_price ? parseFloat(grabGoForm.selling_price) : (catPart.selling_price ?? null),
        supplier: grabGoForm.supplier_name.trim() || null,
      }
      if (grabGoForm.job_id) reqPayload.job_id = grabGoForm.job_id

      const { data: newReq, error: reqErr } = await supabase
        .from('parts_requests')
        .insert(reqPayload)
        .select('id')
        .single()
      if (reqErr) throw reqErr

      await supabase.from('stock_movements').insert({
        tenant_id: tenantId || null,
        branch_id: branchId || null,
        catalogue_part_id: grabGoForm.catalogue_part_id,
        movement_type: 'grab_go_out',
        qty_change: -qty,
        qty_before: qtyBefore,
        qty_after: qtyAfter,
        parts_request_id: newReq?.id ?? null,
        job_id: grabGoForm.job_id || null,
        done_by: user?.full_name ?? null,
        notes: grabGoForm.notes.trim() || null,
      })

      toast(`Grab & Go recorded · ${qty} × ${catPart.name} · stock now ${qtyAfter}`)
      setShowGrabGoModal(false)
      setGrabGoForm({ catalogue_part_id: '', part_search: '', qty: '1', job_id: '', job_search: '', job_vehicle_type: '', selling_price: '', supplier_name: '', notes: '' })
      setGrabGoJobResults([])
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to record Grab & Go', 'error')
    } finally {
      setGrabGoSaving(false)
    }
  }

  // ── New request submission ─────────────────────────────────────────────────────

  async function handleNewSubmit(form: NewRequestForm) {
    setNewLoading(true)
    try {
      const payload: Record<string, unknown> = {
        branch_id: branchId,
        part_name: form.part_name.trim(),
        quantity: Number(form.quantity),
        status: 'pending' as PartRequest['status'],
        urgency: form.urgency,
      }
      if (form.part_number.trim()) payload.part_number = form.part_number.trim()
      if (form.supplier.trim()) payload.supplier = form.supplier.trim()
      if (form.unit_price) {
        payload.selling_price = Number(form.unit_price)
      }
      if (form.notes.trim()) payload.notes = form.notes.trim()
      if (form.job_id) payload.job_id = form.job_id
      if (user?.id) payload.requested_by = user.id
      if (user?.tenant_id) payload.tenant_id = user.tenant_id

      const { error: dbErr } = await supabase.from('parts_requests').insert(payload)
      if (dbErr) throw dbErr
      toast('Parts request submitted')
      setShowNewModal(false)
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create request', 'error')
    } finally {
      setNewLoading(false)
    }
  }

  // ── Status filter tabs ─────────────────────────────────────────────────────────

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'ordered', label: 'Ordered' },
    { key: 'received', label: 'Received' },
    { key: 'installed', label: 'Installed' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', padding: 24, background: '#0E0E0E', color: '#F0F0F0' }}>
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 700, margin: 0 }}>Parts Requests</h1>
          <p style={{ color: '#A0A0A0', fontSize: 13, marginTop: 4 }}>Track job-specific parts orders</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowNewModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F15A22', color: '#fff', border: 'none', borderRadius: 10, padding: '0 20px', minHeight: 44, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={16} /> New Request
          </button>
          <button onClick={() => { supabase.from('parts_catalogue').select('id,name,part_number,stock_qty,division,selling_price,suppliers(name)').eq('tenant_id', tenantId).eq('is_active', true).order('name').then(({ data }) => setCatalogueParts(data ?? [])); setGrabGoForm({ catalogue_part_id: '', part_search: '', qty: '1', job_id: '', job_search: '', job_vehicle_type: '', selling_price: '', supplier_name: '', notes: '' }); setGrabGoJobResults([]); setShowGrabGoModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 10, padding: '0 20px', minHeight: 44, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            <Zap size={16} /> Grab &amp; Go
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <SummaryCard label="Pending" count={counts.pending} icon={<ShoppingCart size={20} />} color="#F59E0B" />
        <SummaryCard label="Ordered" count={counts.ordered} icon={<Truck size={20} />} color="#3B82F6" />
        <SummaryCard label="Received" count={counts.received} icon={<PackageCheck size={20} />} color="#22C55E" />
        <SummaryCard label="Installed" count={counts.installed} icon={<Settings size={20} />} color="#10B981" />
      </div>

      {/* ── Filter bar ── */}
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 16, marginBottom: 20 }}>
        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                style={{
                  borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  background: active ? '#F15A22' : '#1E1E1E',
                  color: active ? '#F0F0F0' : '#A0A0A0',
                  border: active ? 'none' : '1px solid #2A2A2A',
                  padding: '0 20px',
                  minHeight: 44,
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Search + date range */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ color: '#A0A0A0', position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search part name, job #, supplier…"
              style={{
                width: '100%', paddingLeft: 36, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: 8, fontSize: 14, outline: 'none',
                background: '#0E0E0E',
                border: '1px solid #2A2A2A',
                color: '#F0F0F0',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#A0A0A0', fontSize: 14 }}>From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#A0A0A0', fontSize: 14 }}>To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0' }}
            />
          </div>

          {(dateFrom || dateTo || search) && (
            <button
              onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
              style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', padding: '0 20px', minHeight: 44 }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #2A2A2A' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 96, paddingBottom: 96 }}>
            <Loader2 size={32} className="animate-spin" style={{ color: '#F15A22' }} />
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 96, paddingBottom: 96, gap: 12 }}>
            <AlertCircle size={40} style={{ color: '#F15A22' }} />
            <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>{error}</p>
            <button onClick={loadParts} style={{ background: '#F15A22', color: '#F0F0F0', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', padding: '0 20px', minHeight: 44 }}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 96, paddingBottom: 96, gap: 12 }}>
            <Package size={48} style={{ color: '#2A2A2A' }} />
            <p style={{ fontWeight: 600, color: '#A0A0A0', margin: 0 }}>No parts requests found</p>
            <p style={{ fontSize: 14, color: '#4A4A4A', margin: 0 }}>
              {search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first parts request to get started'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#161616', borderBottom: '1px solid #2A2A2A' }}>
                  {['Part', 'Job #', 'Vehicle', 'Req. Qty', 'Ord. Qty', 'Est. Cost', 'Supplier', 'Urgency', 'Status', 'Requested', 'Actions'].map((h) => (
                    <th
                      key={h}
                      style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#A0A0A0' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((part, idx) => (
                  <tr
                    key={part.id}
                    style={{ background: idx % 2 === 0 ? '#0E0E0E' : '#161616', borderBottom: '1px solid #2A2A2A' }}
                  >
                    {/* Part name + number */}
                    <td style={{ padding: '12px 16px' }}>
                      <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: '#F0F0F0' }}>{part.part_name}</p>
                      {part.part_number && <p style={{ fontSize: 11, margin: '2px 0 0', color: '#A0A0A0' }}>{part.part_number}</p>}
                    </td>

                    {/* Job # */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 14, fontFamily: 'monospace', color: '#F15A22' }}>
                        {part.jobs?.job_number ?? '—'}
                      </span>
                    </td>

                    {/* Vehicle */}
                    <td style={{ padding: '12px 16px' }}>
                      {part.jobs?.vehicles ? (
                        <>
                          <span style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 600, color: '#F15A22' }}>{part.jobs.vehicles.plate_number}</span>
                          <p style={{ fontSize: 11, margin: '2px 0 0', color: '#A0A0A0' }}>{part.jobs.vehicles.make} {part.jobs.vehicles.model}</p>
                        </>
                      ) : (
                        <span style={{ color: '#A0A0A0' }}>—</span>
                      )}
                    </td>

                    {/* Req. Qty */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>{part.quantity}</span>
                    </td>

                    {/* Ord. Qty */}
                    <td style={{ padding: '12px 16px' }}>
                      {part.ordered_qty != null ? (
                        <span style={{ fontSize: 14, fontWeight: 600, color: part.ordered_qty > part.quantity ? '#3B82F6' : '#F0F0F0' }}>
                          {part.ordered_qty}
                          {part.ordered_qty > part.quantity && (
                            <span style={{ color: '#22C55E', fontSize: 11, marginLeft: 4 }}>+{part.ordered_qty - part.quantity}</span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: '#4A4A4A' }}>—</span>
                      )}
                    </td>

                    {/* Est. Cost — click to edit unit_price */}
                    <td style={{ padding: '12px 16px' }}>
                      {editingPrice?.id === part.id ? (
                        <input
                          autoFocus
                          type="number" min="0" step="0.01"
                          value={editingPrice.value}
                          onChange={e => setEditingPrice({ id: part.id, value: e.target.value })}
                          onBlur={() => savePriceInline(part.id, editingPrice.value)}
                          onKeyDown={e => { if (e.key === 'Enter') savePriceInline(part.id, editingPrice.value); if (e.key === 'Escape') setEditingPrice(null) }}
                          style={{ width: 90, background: '#1E1E1E', border: '1px solid #F15A22', borderRadius: 6, color: '#F0F0F0', padding: '4px 8px', fontSize: 13, outline: 'none' }}
                        />
                      ) : (() => {
                        const price = part.unit_price ?? part.selling_price
                        return (
                          <span
                            title="Click to set price"
                            onClick={() => setEditingPrice({ id: part.id, value: String(price ?? '') })}
                            style={{ fontSize: 14, color: price != null ? '#F0F0F0' : '#F59E0B', cursor: 'pointer', borderBottom: `1px dashed ${price != null ? '#4A4A4A' : '#F59E0B'}` }}
                          >
                            {price != null ? `RM ${price.toFixed(2)}` : '⚠ Set price'}
                          </span>
                        )
                      })()}
                    </td>

                    {/* Supplier */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 14, color: '#F0F0F0' }}>{part.supplier ?? '—'}</span>
                    </td>

                    {/* Urgency */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize', padding: '2px 8px', borderRadius: 9999, color: URGENCY_COLORS[part.urgency], background: `${URGENCY_COLORS[part.urgency]}18` }}>
                        {part.urgency}
                      </span>
                    </td>

                    {/* Status badge */}
                    <td style={{ padding: '12px 16px' }}>
                      <StatusBadge status={part.status} />
                    </td>

                    {/* Requested date */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 14, color: '#A0A0A0' }}>{formatDate(part.created_at)}</span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {actionLoading === part.id ? (
                          <Loader2 size={16} className="animate-spin" style={{ color: '#F15A22' }} />
                        ) : (
                          <>
                            {part.status === 'pending' && (
                              <button onClick={() => handleMarkOrdered(part)} title="Mark as Ordered" style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#3B82F6', padding: '0 12px', minHeight: 44 }}>
                                <Truck size={16} />
                              </button>
                            )}
                            {part.status === 'ordered' && (
                              <button onClick={() => handleMarkReceived(part)} title="Mark as Received" style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#22C55E', padding: '0 12px', minHeight: 44 }}>
                                <CheckCircle size={16} />
                              </button>
                            )}
                            {part.status === 'received' && part.job_id && (
                              <button onClick={() => handleMarkInstalled(part)} title="Mark as Installed" style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#10B981', padding: '0 12px', minHeight: 44 }}>
                                <Wrench size={16} />
                              </button>
                            )}
                            {part.status !== 'installed' && part.status !== 'cancelled' && (
                              <button onClick={() => handleCancel(part.id)} title="Cancel Request" style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#6B7280', padding: '0 12px', minHeight: 44 }}>
                                <X size={16} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Row count ── */}
      {!loading && !error && filtered.length > 0 && (
        <p style={{ fontSize: 11, textAlign: 'right', color: '#4A4A4A', margin: '12px 0 0' }}>
          Showing {filtered.length} of {parts.length} records
        </p>
      )}

      {/* ── Modals ── */}
      {showNewModal && (
        <NewRequestModal
          onClose={() => setShowNewModal(false)}
          onSubmit={handleNewSubmit}
          loading={newLoading}
          tenantId={tenantId}
        />
      )}

      {/* ── Order Confirmation Modal ── */}
      {orderModal.open && orderModal.part && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && setOrderModal({ open: false, part: null })}>
          <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Truck size={18} style={{ color: '#3B82F6' }} />
                <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>Mark as Ordered</h2>
              </div>
              <button onClick={() => setOrderModal({ open: false, part: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 10, padding: '12px 16px' }}>
                <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 14, margin: 0 }}>{orderModal.part.part_name}</p>
                {orderModal.part.part_number && <p style={{ color: '#A0A0A0', fontSize: 12, marginTop: 2, marginBottom: 0 }}>{orderModal.part.part_number}</p>}
                <p style={{ color: '#A0A0A0', fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  Job requested: <span style={{ color: '#F0F0F0', fontWeight: 600 }}>{orderModal.part.quantity} unit{orderModal.part.quantity !== 1 ? 's' : ''}</span>
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Ordered Quantity *</label>
                <input type="number" min="1" value={orderForm.ordered_qty} onChange={e => setOrderForm(f => ({ ...f, ordered_qty: e.target.value }))} style={inputStyle} />
                {Number(orderForm.ordered_qty) > orderModal.part.quantity && (
                  <p style={{ color: '#22C55E', fontSize: 12, margin: 0 }}>
                    +{Number(orderForm.ordered_qty) - orderModal.part.quantity} surplus unit{(Number(orderForm.ordered_qty) - orderModal.part.quantity) !== 1 ? 's' : ''} will be added to catalogue stock on receive
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Link to Catalogue Part <span style={{ color: '#4A4A4A', fontWeight: 400 }}>(optional — routes surplus to stock)</span></label>
                <select value={orderForm.catalogue_part_id} onChange={e => setOrderForm(f => ({ ...f, catalogue_part_id: e.target.value }))} style={inputStyle}>
                  <option value="">— No catalogue link —</option>
                  {catalogueParts.map(cp => (
                    <option key={cp.id} value={cp.id}>{cp.name}{cp.part_number ? ` (${cp.part_number})` : ''} · stock: {cp.stock_qty}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #2A2A2A' }}>
              <button onClick={() => setOrderModal({ open: false, part: null })} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={handleConfirmOrdered} disabled={orderSaving} style={{ background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                {orderSaving && <Loader2 size={14} className="animate-spin" />}Confirm Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Grab & Go Modal ── */}
      {showGrabGoModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && setShowGrabGoModal(false)}>
          <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 500 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A' }}>
              <div>
                <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={16} style={{ color: '#F59E0B' }} /> Grab &amp; Go
                </h2>
                <p style={{ color: '#A0A0A0', fontSize: 12, margin: '4px 0 0' }}>Use a part from shelf stock — deducts quantity immediately</p>
              </div>
              <button onClick={() => setShowGrabGoModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
            </div>

            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Job link */}
              <div style={{ position: 'relative' }}>
                <label style={labelStyle}>Link to Job *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    value={grabGoForm.job_search}
                    onChange={e => { setGrabGoForm(f => ({ ...f, job_search: e.target.value, job_id: '', job_vehicle_type: '', catalogue_part_id: '', part_search: '' })); searchGrabGoJobs(e.target.value) }}
                    onFocus={() => { setGrabGoJobOpen(true); if (!grabGoForm.job_search.trim()) searchGrabGoJobs('') }}
                    onBlur={() => setTimeout(() => setGrabGoJobOpen(false), 150)}
                    placeholder="Search or select a job…"
                    style={{ ...inputStyle, paddingRight: 32 }}
                    autoFocus
                  />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#6B7280', fontSize: 10 }}>▼</span>
                </div>
                {grabGoJobOpen && !grabGoForm.job_id && grabGoJobResults.length > 0 && (
                  <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 10, border: '1px solid #2A2A2A', borderRadius: 8, marginTop: 2, maxHeight: 200, overflowY: 'auto' as const, background: '#161616', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                    {grabGoJobResults.map(j => (
                      <div key={j.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setGrabGoForm(f => ({ ...f, job_id: j.id, job_search: `${j.job_number} · ${j.plate} ${j.make} ${j.model}`, job_vehicle_type: j.vehicle_type, catalogue_part_id: '', part_search: '' })); setGrabGoJobOpen(false) }}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #1A1A1A', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#F0F0F0', fontWeight: 600 }}>{j.job_number}</span>
                        <span style={{ color: '#A0A0A0' }}>{j.plate} {j.make} {j.model}</span>
                        {j.vehicle_type && <span style={{ marginLeft: 'auto', fontSize: 11, color: j.vehicle_type === 'car' ? '#3B82F6' : '#F59E0B', fontWeight: 700, textTransform: 'uppercase' as const }}>{j.vehicle_type}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {grabGoJobOpen && !grabGoForm.job_id && grabGoJobResults.length === 0 && grabGoForm.job_search.trim() && (
                  <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 10, border: '1px solid #2A2A2A', borderRadius: 8, marginTop: 2, background: '#161616', padding: '12px 14px', color: '#A0A0A0', fontSize: 13 }}>No jobs match</div>
                )}
                {grabGoForm.job_id && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#22C55E', fontSize: 12, fontWeight: 600 }}>✓ {grabGoForm.job_search}</span>
                      {grabGoForm.job_vehicle_type && <span style={{ fontSize: 11, color: grabGoForm.job_vehicle_type === 'car' ? '#3B82F6' : '#F59E0B', fontWeight: 700, textTransform: 'uppercase' as const }}>{grabGoForm.job_vehicle_type}</span>}
                    </div>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setGrabGoForm(f => ({ ...f, job_id: '', job_search: '', job_vehicle_type: '', catalogue_part_id: '', part_search: '' })); setGrabGoJobOpen(true) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', fontSize: 11 }}>Remove</button>
                  </div>
                )}
              </div>

              {/* Part selection */}
              <div style={{ position: 'relative' }}>
                <label style={labelStyle}>Part from Catalogue *
                  {grabGoForm.job_vehicle_type && <span style={{ marginLeft: 6, fontSize: 11, color: grabGoForm.job_vehicle_type === 'car' ? '#3B82F6' : '#F59E0B', fontWeight: 600 }}>({grabGoForm.job_vehicle_type} parts only)</span>}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    value={grabGoForm.part_search}
                    onChange={e => setGrabGoForm(f => ({ ...f, part_search: e.target.value, catalogue_part_id: '' }))}
                    onFocus={() => setGrabGoPartOpen(true)}
                    onBlur={() => setTimeout(() => setGrabGoPartOpen(false), 150)}
                    placeholder={grabGoForm.job_id ? 'Search or select a part…' : 'Select a job first…'}
                    disabled={!grabGoForm.job_id}
                    style={{ ...inputStyle, paddingRight: 32, opacity: grabGoForm.job_id ? 1 : 0.4 }}
                  />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#6B7280', fontSize: 10 }}>▼</span>
                </div>
                {grabGoPartOpen && !grabGoForm.catalogue_part_id && (
                  <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 10, border: '1px solid #2A2A2A', borderRadius: 8, marginTop: 2, maxHeight: 220, overflowY: 'auto' as const, background: '#161616', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                    {catalogueParts
                      .filter(p => {
                        const vt = grabGoForm.job_vehicle_type
                        if (vt && p.division !== 'both' && p.division !== vt) return false
                        return !grabGoForm.part_search.trim() || p.name.toLowerCase().includes(grabGoForm.part_search.toLowerCase()) || (p.part_number ?? '').toLowerCase().includes(grabGoForm.part_search.toLowerCase())
                      })
                      .slice(0, 20)
                      .map(p => (
                        <div key={p.id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            const suppName = Array.isArray(p.suppliers) ? p.suppliers[0]?.name : (p.suppliers as { name: string } | null)?.name
                            setGrabGoForm(f => ({ ...f, catalogue_part_id: p.id, part_search: p.name + (p.part_number ? ` [${p.part_number}]` : ''), selling_price: p.selling_price != null ? String(p.selling_price) : '', supplier_name: suppName ?? '' }))
                            setGrabGoPartOpen(false)
                          }}
                          style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #1A1A1A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span style={{ color: '#F0F0F0', fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                            {p.part_number && <span style={{ color: '#A0A0A0', fontSize: 12, marginLeft: 8, fontFamily: 'monospace' }}>{p.part_number}</span>}
                          </div>
                          <span style={{ fontSize: 12, color: p.stock_qty > 0 ? '#22C55E' : '#EF4444', fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 8 }}>{p.stock_qty} in stock</span>
                        </div>
                      ))}
                    {catalogueParts.filter(p => {
                      const vt = grabGoForm.job_vehicle_type
                      if (vt && p.division !== 'both' && p.division !== vt) return false
                      return !grabGoForm.part_search.trim() || p.name.toLowerCase().includes(grabGoForm.part_search.toLowerCase()) || (p.part_number ?? '').toLowerCase().includes(grabGoForm.part_search.toLowerCase())
                    }).length === 0 && (
                      <div style={{ padding: '12px 14px', color: '#A0A0A0', fontSize: 13 }}>No parts match</div>
                    )}
                  </div>
                )}
                {grabGoForm.catalogue_part_id && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#F59E0B', fontSize: 12, fontWeight: 600 }}>✓ {grabGoForm.part_search}</span>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setGrabGoForm(f => ({ ...f, catalogue_part_id: '', part_search: '' })); setGrabGoPartOpen(true) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', fontSize: 11 }}>Change</button>
                  </div>
                )}
              </div>

              {/* Qty */}
              <div>
                <label style={labelStyle}>Quantity Used *</label>
                <input type="number" min="1" value={grabGoForm.qty} onChange={e => setGrabGoForm(f => ({ ...f, qty: e.target.value }))} style={inputStyle} />
              </div>

              {/* Selling price + supplier */}
              {grabGoForm.catalogue_part_id && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>
                      Unit Price (RM) *
                      {!grabGoForm.selling_price && <span style={{ color: '#F59E0B', marginLeft: 6, fontWeight: 700 }}>⚠ Not set in catalogue</span>}
                    </label>
                    <input
                      type="number" min="0" step="0.01"
                      value={grabGoForm.selling_price}
                      onChange={e => setGrabGoForm(f => ({ ...f, selling_price: e.target.value }))}
                      placeholder="0.00"
                      style={{ ...inputStyle, borderColor: !grabGoForm.selling_price ? 'rgba(245,158,11,0.6)' : '#2A2A2A' }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Supplier <span style={{ color: '#4A4A4A', fontWeight: 400 }}>(optional)</span></label>
                    <input value={grabGoForm.supplier_name} onChange={e => setGrabGoForm(f => ({ ...f, supplier_name: e.target.value }))} placeholder="Supplier name" style={inputStyle} />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label style={labelStyle}>Notes <span style={{ color: '#4A4A4A', fontWeight: 400 }}>(optional)</span></label>
                <input value={grabGoForm.notes} onChange={e => setGrabGoForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. used for quick fix on bay 3" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #2A2A2A' }}>
              <button onClick={() => setShowGrabGoModal(false)} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={handleGrabGo} disabled={grabGoSaving || !grabGoForm.catalogue_part_id || !grabGoForm.job_id} style={{ background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 8, padding: '0 24px', minHeight: 44, cursor: grabGoSaving || !grabGoForm.catalogue_part_id || !grabGoForm.job_id ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, opacity: !grabGoForm.catalogue_part_id || !grabGoForm.job_id ? 0.5 : 1 }}>
                {grabGoSaving ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Confirm Grab &amp; Go
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

