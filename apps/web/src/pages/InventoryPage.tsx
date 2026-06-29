import { useState, useEffect, useCallback } from 'react'
import {
  Package,
  Plus,
  Search,
  CheckCircle,
  X,
  Truck,
  PackageCheck,
  Loader2,
  BookOpen,
  Building2,
  Pencil,
  Trash2,
  Phone,
  Mail,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatName, formatPhone, formatEmail, formatTitleCase, formatSKU } from '@/lib/formatters'
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
}

type StatusFilter = 'all' | 'pending' | 'ordered' | 'received' | 'cancelled'

interface StockPurchaseForm {
  part_name: string
  part_number: string
  quantity: string
  unit_price: string
  markup: string
  supplier: string
  catalogue_part_id: string
  notes: string
}

const EMPTY_STOCK_FORM: StockPurchaseForm = {
  part_name: '',
  part_number: '',
  quantity: '',
  unit_price: '',
  markup: '1.5',
  supplier: '',
  catalogue_part_id: '',
  notes: '',
}

interface Supplier {
  id: string
  tenant_id?: string | null
  branch_id?: string | null
  name: string
  contact_person?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  is_active?: boolean
  created_at?: string
}

interface CataloguePart {
  id: string
  tenant_id?: string | null
  branch_id?: string | null
  supplier_id?: string | null
  name: string
  part_number?: string | null
  category?: string | null
  division: 'car' | 'bike' | 'both'
  unit: string
  stock_qty: number
  reorder_level: number
  cost_price?: number | null
  selling_price?: number | null
  notes?: string | null
  is_active: boolean
  created_at: string
  suppliers?: { name: string } | null
}

const PART_CATEGORIES = ['Engine', 'Brakes', 'Electrical', 'Body', 'Tyres', 'Fluids', 'Filters', 'Suspension', 'Accessories', 'Other']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
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

// ─── Module-level styles ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = { background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0', borderRadius: 8, padding: '8px 12px', fontSize: 14, width: '100%', outline: 'none' }
const labelStyle: React.CSSProperties = { color: '#A0A0A0', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SummaryCardProps { label: string; count: number; icon: React.ReactNode; color: string }

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

function StatusBadge({ status }: { status: PartRequest['status'] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: STATUS_COLORS[status], background: STATUS_BG[status] }}>
      {status}
    </span>
  )
}

// ─── New Stock Purchase Modal ─────────────────────────────────────────────────

interface NewStockPurchaseModalProps {
  onClose: () => void
  onSubmit: (form: StockPurchaseForm) => Promise<void>
  loading: boolean
  tenantId: string
}

function NewStockPurchaseModal({ onClose, onSubmit, loading, tenantId }: NewStockPurchaseModalProps) {
  const [form, setForm] = useState<StockPurchaseForm>(EMPTY_STOCK_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof StockPurchaseForm, string>>>({})
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [catalogueParts, setCatalogueParts] = useState<{ id: string; name: string; part_number?: string | null; stock_qty: number }[]>([])
  const [showAddSupplier, setShowAddSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({ name: '', contact_person: '', phone: '', address: '' })
  const [savingSupplier, setSavingSupplier] = useState(false)

  const loadSuppliers = useCallback(async () => {
    if (!tenantId) return
    const { data } = await supabase.from('suppliers').select('id,name').eq('tenant_id', tenantId).eq('is_active', true).order('name')
    setSuppliers(data ?? [])
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    loadSuppliers()
    supabase.from('parts_catalogue').select('id,name,part_number,stock_qty').eq('tenant_id', tenantId).eq('is_active', true).order('name').then(({ data }) => setCatalogueParts(data ?? []))
  }, [tenantId, loadSuppliers])

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

  function set(field: keyof StockPurchaseForm, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    if (errors[field]) setErrors(e => ({ ...e, [field]: undefined }))
  }

  function validate() {
    const e: Partial<Record<keyof StockPurchaseForm, string>> = {}
    if (!form.part_name.trim()) e.part_name = 'Part name is required'
    if (!form.quantity || Number(form.quantity) < 1) e.quantity = 'Valid quantity required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    await onSubmit(form)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Package size={18} style={{ color: '#22C55E' }} />
            <div>
              <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>New Stock Purchase</h2>
              <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>Buy parts to stock up inventory</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Part Name *</label>
                <input value={form.part_name} onChange={e => set('part_name', e.target.value)} onBlur={e => set('part_name', formatTitleCase(e.target.value))} placeholder="e.g. Brake Pad Front" style={{ ...inputStyle, borderColor: errors.part_name ? '#F15A22' : '#2A2A2A' }} />
                {errors.part_name && <p style={{ color: '#F15A22', fontSize: 11, margin: 0 }}>{errors.part_name}</p>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Part Number</label>
                <input value={form.part_number} onChange={e => set('part_number', e.target.value)} onBlur={e => set('part_number', formatSKU(e.target.value))} placeholder="e.g. BP-4501-F" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>Catalogue Part <span style={{ color: '#4A4A4A', fontWeight: 400 }}>(received stock updates this entry's qty)</span></label>
              <select value={form.catalogue_part_id} onChange={e => set('catalogue_part_id', e.target.value)} style={{ ...inputStyle, color: form.catalogue_part_id ? '#F0F0F0' : '#6B7280' }}>
                <option value="">— No catalogue link —</option>
                {catalogueParts.map(cp => <option key={cp.id} value={cp.id}>{cp.name}{cp.part_number ? ` (${cp.part_number})` : ''} · stock: {cp.stock_qty}</option>)}
              </select>
              {!form.catalogue_part_id && <p style={{ color: '#F59E0B', fontSize: 11, margin: 0 }}>No link selected — stock will not auto-update on receive. Add the part in Catalogue tab first.</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Quantity *</label>
                <input type="number" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="10" style={{ ...inputStyle, borderColor: errors.quantity ? '#F15A22' : '#2A2A2A' }} />
                {errors.quantity && <p style={{ color: '#F15A22', fontSize: 11, margin: 0 }}>{errors.quantity}</p>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Cost Price (RM)</label>
                <input type="number" min="0" step="0.01" value={form.unit_price} onChange={e => set('unit_price', e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Markup ×</label>
                <input type="number" min="1" step="0.05" value={form.markup} onChange={e => set('markup', e.target.value)} placeholder="1.5" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Selling Price (RM)</label>
                <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', borderRadius: 8, cursor: 'default' }}>
                  {form.unit_price && form.markup && Number(form.unit_price) > 0 && Number(form.markup) >= 1 ? (
                    <span style={{ color: '#22C55E', fontWeight: 700, fontSize: 15 }}>RM {(Number(form.unit_price) * Number(form.markup)).toFixed(2)}</span>
                  ) : <span style={{ color: '#4A4A4A', fontSize: 13 }}>—</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Profit Margin %</label>
                <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', borderRadius: 8, cursor: 'default' }}>
                  {form.unit_price && form.markup && Number(form.unit_price) > 0 && Number(form.markup) >= 1 ? (
                    <span style={{ color: '#22C55E', fontWeight: 700, fontSize: 15 }}>{((Number(form.markup) - 1) / Number(form.markup) * 100).toFixed(1)}%</span>
                  ) : <span style={{ color: '#4A4A4A', fontSize: 13 }}>—</span>}
                </div>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={labelStyle}>Supplier</label>
                <button type="button" onClick={() => { setShowAddSupplier(v => !v); setNewSupplier({ name: '', contact_person: '', phone: '', address: '' }) }}
                  style={{ fontSize: 11, color: showAddSupplier ? '#A0A0A0' : '#F15A22', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                  {showAddSupplier ? '✕ Cancel' : '+ Add New'}
                </button>
              </div>
              <select value={form.supplier} onChange={e => set('supplier', e.target.value)} style={{ ...inputStyle, color: form.supplier ? '#F0F0F0' : '#6B7280' }}>
                <option value="">— Select Supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
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
                  <input value={newSupplier.address} onChange={e => setNewSupplier(s => ({ ...s, address: e.target.value }))} placeholder="e.g. No 12, Jalan Industri 3, Klang" style={{ ...inputStyle, fontSize: 13 }} />
                </div>
                <button type="button" onClick={handleSaveSupplier} disabled={savingSupplier || !newSupplier.name.trim()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: newSupplier.name.trim() ? '#F15A22' : '#2A2A2A', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 13, fontWeight: 600, cursor: newSupplier.name.trim() ? 'pointer' : 'not-allowed' }}>
                  {savingSupplier ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                  Save & Select
                </button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="e.g. Bulk buy for Q3 stock-up" style={{ ...inputStyle, resize: 'none' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #2A2A2A', flexShrink: 0 }}>
            <button type="button" onClick={onClose} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ background: '#22C55E', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              {loading && <Loader2 size={14} className="animate-spin" />}Create Purchase
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Suppliers Tab ────────────────────────────────────────────────────────────

function SuppliersTab({ tenantId, branchId }: { tenantId: string; branchId: string }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('suppliers').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('name')
    setSuppliers(data ?? [])
    setLoading(false)
  }, [tenantId])

  useEffect(() => { load() }, [load])

  function openAdd() { setEditing(null); setForm({ name: '', contact_person: '', phone: '', email: '', address: '', notes: '' }); setShowModal(true) }
  function openEdit(s: Supplier) { setEditing(s); setForm({ name: s.name, contact_person: s.contact_person ?? '', phone: s.phone ?? '', email: s.email ?? '', address: s.address ?? '', notes: s.notes ?? '' }); setShowModal(true) }

  async function save() {
    if (!form.name.trim()) { toast('Supplier name is required', 'error'); return }
    setSaving(true)
    const payload = { ...form, tenant_id: tenantId, branch_id: branchId || null, is_active: true }
    const { error } = editing
      ? await supabase.from('suppliers').update(payload).eq('id', editing.id)
      : await supabase.from('suppliers').insert(payload)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(editing ? 'Supplier updated' : 'Supplier added')
    setShowModal(false)
    load()
  }

  async function deleteSupplier(s: Supplier) {
    if (!confirm(`Delete supplier "${s.name}"?`)) return
    await supabase.from('suppliers').update({ is_active: false }).eq('id', s.id)
    load()
  }

  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || (s.contact_person ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '8px 12px', flex: 1, maxWidth: 360 }}>
          <Search size={14} style={{ color: '#A0A0A0', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers…" style={{ background: 'none', border: 'none', outline: 'none', color: '#F0F0F0', fontSize: 14, width: '100%' }} />
        </div>
        <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginLeft: 12 }}>
          <Plus size={15} /> Add Supplier
        </button>
      </div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={28} style={{ color: '#F15A22' }} className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#A0A0A0' }}>
          <Building2 size={40} style={{ margin: '0 auto 12px', color: '#2A2A2A' }} />
          <p>{search ? 'No suppliers match your search' : 'No suppliers yet. Add your first one.'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {filtered.map(s => (
            <div key={s.id} style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 15, margin: 0 }}>{s.name}</p>
                  {s.contact_person && <p style={{ color: '#A0A0A0', fontSize: 12, margin: '4px 0 0' }}>{s.contact_person}</p>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => openEdit(s)} style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: '#A0A0A0' }}><Pencil size={13} /></button>
                  <button onClick={() => deleteSupplier(s)} style={{ background: '#1A0E0E', border: '1px solid #F87171', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: '#F87171' }}><Trash2 size={13} /></button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {s.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Phone size={12} style={{ color: '#A0A0A0' }} /><span style={{ color: '#A0A0A0', fontSize: 13 }}>{s.phone}</span></div>}
                {s.email && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Mail size={12} style={{ color: '#A0A0A0' }} /><span style={{ color: '#A0A0A0', fontSize: 13 }}>{s.email}</span></div>}
                {s.address && <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>{s.address}</p>}
                {s.notes && <p style={{ color: '#4A4A4A', fontSize: 12, margin: 0, fontStyle: 'italic' }}>{s.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A' }}>
              <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>{editing ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={labelStyle}>Supplier Name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onBlur={e => setForm(f => ({ ...f, name: formatTitleCase(e.target.value) }))} placeholder="e.g. AutoParts Sdn Bhd" style={inputStyle} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>Contact Person</label><input value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} onBlur={e => setForm(f => ({ ...f, contact_person: formatName(e.target.value) }))} placeholder="e.g. Ahmad" style={inputStyle} /></div>
                <div><label style={labelStyle}>Phone</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} onBlur={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} placeholder="e.g. 012-3456789" style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>Email</label><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} onBlur={e => setForm(f => ({ ...f, email: formatEmail(e.target.value) }))} placeholder="e.g. supplier@email.com" style={inputStyle} /></div>
              <div><label style={labelStyle}>Address</label><input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="e.g. No 12, Jalan..." style={inputStyle} /></div>
              <div><label style={labelStyle}>Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'none' }} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #2A2A2A' }}>
              <button onClick={() => setShowModal(false)} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                {saving && <Loader2 size={14} className="animate-spin" />}{editing ? 'Save Changes' : 'Add Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Catalogue Tab ────────────────────────────────────────────────────────────

function CatalogueTab({ tenantId, branchId }: { tenantId: string; branchId: string }) {
  const [parts, setParts] = useState<CataloguePart[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<CataloguePart | null>(null)
  const [form, setForm] = useState({ name: '', part_number: '', category: '', division: 'both', unit: 'unit', stock_qty: '0', reorder_level: '5', cost_price: '', markup: '', selling_price: '', supplier_id: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [divFilter, setDivFilter] = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from('parts_catalogue').select('*, suppliers(name)').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
      supabase.from('suppliers').select('id, name').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    ])
    setParts(p ?? [])
    setSuppliers(s ?? [])
    setLoading(false)
  }, [tenantId])

  useEffect(() => { load() }, [load])

  function openAdd() { setEditing(null); setForm({ name: '', part_number: '', category: '', division: 'both', unit: 'unit', stock_qty: '0', reorder_level: '5', cost_price: '', markup: '', selling_price: '', supplier_id: '', notes: '' }); setShowModal(true) }
  async function openEdit(p: CataloguePart) {
    setEditing(p)
    const cost = p.cost_price != null ? String(p.cost_price) : ''
    const sell = p.selling_price != null ? String(p.selling_price) : ''
    const markup = cost && sell && Number(cost) > 0 ? String(parseFloat((Number(sell) / Number(cost)).toFixed(4))) : ''
    let supplierId = p.supplier_id ?? ''
    if (!supplierId) {
      const { data: lastReq } = await supabase.from('parts_requests').select('supplier').eq('catalogue_part_id', p.id).not('supplier', 'is', null).order('created_at', { ascending: false }).limit(1).single()
      if (lastReq?.supplier) {
        const { data: sup } = await supabase.from('suppliers').select('id').eq('name', lastReq.supplier).eq('tenant_id', tenantId).single()
        if (sup) supplierId = sup.id
      }
    }
    setForm({ name: p.name, part_number: p.part_number ?? '', category: p.category ?? '', division: p.division ?? 'both', unit: p.unit, stock_qty: String(p.stock_qty), reorder_level: String(p.reorder_level), cost_price: cost, markup, selling_price: sell, supplier_id: supplierId, notes: p.notes ?? '' })
    setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) { toast('Part name is required', 'error'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(), part_number: form.part_number.trim() || null, category: form.category || null,
      division: form.division || 'both', unit: form.unit,
      stock_qty: parseInt(form.stock_qty) || 0, reorder_level: parseInt(form.reorder_level) || 5,
      cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
      selling_price: form.selling_price ? parseFloat(form.selling_price) : null,
      supplier_id: form.supplier_id || null, notes: form.notes.trim() || null,
      tenant_id: tenantId, branch_id: branchId || null, is_active: true,
    }
    const { error } = editing
      ? await supabase.from('parts_catalogue').update(payload).eq('id', editing.id)
      : await supabase.from('parts_catalogue').insert(payload)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(editing ? 'Part updated' : 'Part added to catalogue')
    setShowModal(false)
    load()
  }

  async function deletePart(p: CataloguePart) {
    if (!confirm(`Remove "${p.name}" from catalogue?`)) return
    await supabase.from('parts_catalogue').update({ is_active: false }).eq('id', p.id)
    load()
  }

  const categories = ['All', ...PART_CATEGORIES]
  const filtered = parts.filter(p => {
    const matchCat = catFilter === 'All' || p.category === catFilter
    const matchDiv = divFilter === 'All' || p.division === divFilter || (!p.division && divFilter === 'both')
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.part_number ?? '').toLowerCase().includes(search.toLowerCase())
    return matchCat && matchDiv && matchSearch
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '8px 12px', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ color: '#A0A0A0' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search parts…" style={{ background: 'none', border: 'none', outline: 'none', color: '#F0F0F0', fontSize: 14, width: '100%' }} />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ background: '#161616', border: '1px solid #2A2A2A', color: '#F0F0F0', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none' }}>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={divFilter} onChange={e => setDivFilter(e.target.value)} style={{ background: '#161616', border: '1px solid #2A2A2A', color: '#F0F0F0', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none' }}>
          <option value="All">All Divisions</option>
          <option value="car">Car</option>
          <option value="bike">Bike</option>
          <option value="both">Both</option>
        </select>
        <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={15} /> Add Part
        </button>
      </div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={28} style={{ color: '#F15A22' }} className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#A0A0A0' }}>
          <BookOpen size={40} style={{ margin: '0 auto 12px', color: '#2A2A2A' }} />
          <p>{search || catFilter !== 'All' ? 'No parts match your filters' : 'Catalogue is empty. Add your first part.'}</p>
        </div>
      ) : (
        <div style={{ border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#161616', borderBottom: '1px solid #2A2A2A' }}>
                {['Part Name', 'Part No.', 'Division', 'Category', 'Supplier', 'Stock', 'Reorder At', 'Cost Price', 'Selling Price', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const lowStock = p.stock_qty <= p.reorder_level
                return (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? '#0E0E0E' : '#161616', borderBottom: '1px solid #2A2A2A' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <p style={{ color: '#F0F0F0', fontWeight: 600, fontSize: 14, margin: 0 }}>{p.name}</p>
                      {p.notes && <p style={{ color: '#4A4A4A', fontSize: 11, margin: '2px 0 0', fontStyle: 'italic' }}>{p.notes}</p>}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 13, fontFamily: 'monospace' }}>{p.part_number ?? '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {p.division === 'car' && <span style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#60A5FA' }}>CAR</span>}
                      {p.division === 'bike' && <span style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#4ADE80' }}>BIKE</span>}
                      {(p.division === 'both' || !p.division) && <span style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#A0A0A0' }}>BOTH</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {p.category ? <span style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 6, padding: '2px 8px', fontSize: 12, color: '#A0A0A0' }}>{p.category}</span> : <span style={{ color: '#4A4A4A' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 13 }}>{p.suppliers?.name ?? '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: lowStock ? '#EF4444' : '#22C55E' }}>{p.stock_qty}</span>
                      <span style={{ color: '#4A4A4A', fontSize: 11, marginLeft: 4 }}>{p.unit}</span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 13 }}>{p.reorder_level} {p.unit}</td>
                    <td style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 13 }}>{p.cost_price != null ? `RM ${p.cost_price.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '12px 16px', color: '#F0F0F0', fontSize: 13 }}>{p.selling_price != null ? `RM ${p.selling_price.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openEdit(p)} style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: '#A0A0A0' }}><Pencil size={13} /></button>
                        <button onClick={() => deletePart(p)} style={{ background: '#1A0E0E', border: '1px solid #F87171', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: '#F87171' }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}>
              <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>{editing ? 'Edit Part' : 'Add Part to Catalogue'}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
            </div>
            <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>Part Name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Brake Pad Front" style={inputStyle} /></div>
                <div><label style={labelStyle}>Part Number</label><input value={form.part_number} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} placeholder="e.g. BP-4501-F" style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                    <option value="">— Select —</option>
                    {PART_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Supplier</label>
                  <select value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))} style={inputStyle}>
                    <option value="">— None —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Division</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['car', 'bike', 'both'] as const).map(d => (
                    <button key={d} type="button" onClick={() => setForm(f => ({ ...f, division: d }))} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: form.division === d ? '2px solid #F15A22' : '1px solid #2A2A2A', background: form.division === d ? 'rgba(241,90,34,0.12)' : '#0E0E0E', color: form.division === d ? '#F15A22' : '#A0A0A0', fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'uppercase' }}>
                      {d === 'car' ? '🚗 Car' : d === 'bike' ? '🏍️ Bike' : '🔧 Both'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>Unit</label><input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="unit / pcs / litre" style={inputStyle} /></div>
                <div><label style={labelStyle}>Stock Qty</label><input type="number" min="0" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: e.target.value }))} style={inputStyle} /></div>
                <div><label style={labelStyle}>Reorder Level</label><input type="number" min="0" value={form.reorder_level} onChange={e => setForm(f => ({ ...f, reorder_level: e.target.value }))} style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>Cost Price (RM)</label><input type="number" min="0" step="0.01" value={form.cost_price} onChange={e => {
                  const cost = e.target.value
                  const sell = form.markup && Number(form.markup) >= 1 && Number(cost) > 0 ? String(parseFloat((Number(cost) * Number(form.markup)).toFixed(2))) : form.selling_price
                  setForm(f => ({ ...f, cost_price: cost, selling_price: sell }))
                }} placeholder="0.00" style={inputStyle} /></div>
                <div><label style={labelStyle}>Markup ×</label><input type="number" min="1" step="0.05" value={form.markup} onChange={e => {
                  const markup = e.target.value
                  const sell = Number(markup) >= 1 && Number(form.cost_price) > 0 ? String(parseFloat((Number(form.cost_price) * Number(markup)).toFixed(2))) : form.selling_price
                  setForm(f => ({ ...f, markup, selling_price: sell }))
                }} placeholder="e.g. 1.5" style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={labelStyle}>Selling Price (RM)</label><input type="number" min="0" step="0.01" value={form.selling_price} onChange={e => setForm(f => ({ ...f, selling_price: e.target.value }))} placeholder="0.00" style={{ ...inputStyle, color: form.selling_price && Number(form.selling_price) > 0 ? '#22C55E' : '#F0F0F0', fontWeight: form.selling_price && Number(form.selling_price) > 0 ? 700 : 400 }} /></div>
                <div>
                  <label style={labelStyle}>Profit Margin %</label>
                  <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', borderRadius: 8, cursor: 'default', userSelect: 'none' }}>
                    {form.selling_price && Number(form.selling_price) > 0 && form.cost_price && Number(form.cost_price) > 0 ? (
                      <span style={{ color: '#22C55E', fontWeight: 700, fontSize: 15 }}>{((Number(form.selling_price) - Number(form.cost_price)) / Number(form.selling_price) * 100).toFixed(1)}%</span>
                    ) : <span style={{ color: '#4A4A4A', fontSize: 13 }}>—</span>}
                  </div>
                </div>
              </div>
              <div><label style={labelStyle}>Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'none' }} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #2A2A2A', flexShrink: 0 }}>
              <button onClick={() => setShowModal(false)} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                {saving && <Loader2 size={14} className="animate-spin" />}{editing ? 'Save Changes' : 'Add to Catalogue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stock Purchases Tab ──────────────────────────────────────────────────────

function StockPurchasesTab({ tenantId, branchId }: { tenantId: string; branchId: string }) {
  const [parts, setParts] = useState<PartRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [catalogueParts, setCatalogueParts] = useState<{ id: string; name: string; part_number?: string | null; stock_qty: number }[]>([])
  const [showStockModal, setShowStockModal] = useState(false)
  const [stockLoading, setStockLoading] = useState(false)
  const [linkReceiveModal, setLinkReceiveModal] = useState<{ open: boolean; part: PartRequest | null }>({ open: false, part: null })
  const [linkReceiveForm, setLinkReceiveForm] = useState({ catalogue_part_id: '', create_new: false, new_name: '', new_part_number: '' })
  const [linkReceiveSaving, setLinkReceiveSaving] = useState(false)

  const isStockPurchase = (p: PartRequest) => !p.job_id && p.ordered_qty != null

  const loadParts = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: dbErr } = await supabase.from('parts_requests').select('*').eq('branch_id', branchId).order('created_at', { ascending: false })
      if (dbErr) throw dbErr
      setParts(((data as PartRequest[]) ?? []).filter(isStockPurchase))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { loadParts() }, [loadParts])

  const counts = {
    pending: parts.filter(p => p.status === 'pending').length,
    ordered: parts.filter(p => p.status === 'ordered').length,
    received: parts.filter(p => p.status === 'received').length,
  }

  const filtered = parts.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!p.part_name.toLowerCase().includes(q) && !(p.supplier ?? '').toLowerCase().includes(q)) return false
    }
    if (dateFrom && new Date(p.created_at) < new Date(dateFrom)) return false
    if (dateTo && new Date(p.created_at) > new Date(dateTo + 'T23:59:59')) return false
    return true
  })

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

  async function buildCatalogueUpdate(catalogueId: string, qty: number, part: PartRequest) {
    const { data: catRow } = await supabase.from('parts_catalogue').select('stock_qty, supplier_id').eq('id', catalogueId).single()
    const update: Record<string, unknown> = { stock_qty: (catRow?.stock_qty ?? 0) + qty }
    if (part.unit_price) update.cost_price = part.unit_price
    if (part.selling_price) update.selling_price = part.selling_price
    if (!catRow?.supplier_id && part.supplier) {
      const { data: sup } = await supabase.from('suppliers').select('id').eq('name', part.supplier).eq('tenant_id', tenantId).single()
      if (sup) update.supplier_id = sup.id
    }
    return update
  }

  async function handleMarkReceived(part: PartRequest) {
    if (!part.catalogue_part_id) {
      supabase.from('parts_catalogue').select('id,name,part_number,stock_qty').eq('tenant_id', tenantId).eq('is_active', true).order('name').then(({ data }) => setCatalogueParts(data ?? []))
      setLinkReceiveForm({ catalogue_part_id: '', create_new: false, new_name: part.part_name, new_part_number: part.part_number ?? '' })
      setLinkReceiveModal({ open: true, part })
      return
    }
    setActionLoading(part.id)
    try {
      const orderedQty = part.ordered_qty ?? part.quantity
      const { error: dbErr } = await supabase.from('parts_requests').update({ status: 'received' }).eq('id', part.id)
      if (dbErr) throw dbErr
      const catUpdate = await buildCatalogueUpdate(part.catalogue_part_id, orderedQty, part)
      await supabase.from('parts_catalogue').update(catUpdate).eq('id', part.catalogue_part_id)
      toast(`Received · ${orderedQty} unit${orderedQty !== 1 ? 's' : ''} added to stock`)
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this stock purchase?')) return
    await updateStatus(id, 'cancelled')
  }

  async function handleConfirmLinkReceive() {
    if (!linkReceiveModal.part) return
    setLinkReceiveSaving(true)
    try {
      const part = linkReceiveModal.part
      const orderedQty = part.ordered_qty ?? part.quantity
      let catalogueId = linkReceiveForm.catalogue_part_id
      if (linkReceiveForm.create_new) {
        if (!linkReceiveForm.new_name.trim()) { toast('Part name is required', 'error'); setLinkReceiveSaving(false); return }
        const { data: newPart, error: createErr } = await supabase.from('parts_catalogue')
          .insert({ name: linkReceiveForm.new_name.trim(), part_number: linkReceiveForm.new_part_number.trim() || null, stock_qty: 0, tenant_id: tenantId, branch_id: branchId || null, is_active: true })
          .select('id').single()
        if (createErr || !newPart) { toast('Failed to create catalogue entry', 'error'); setLinkReceiveSaving(false); return }
        catalogueId = newPart.id
      }
      if (!catalogueId) { toast('Select or create a catalogue entry', 'error'); setLinkReceiveSaving(false); return }
      await supabase.from('parts_requests').update({ catalogue_part_id: catalogueId, status: 'received' }).eq('id', part.id)
      const catUpdate = await buildCatalogueUpdate(catalogueId, orderedQty, part)
      await supabase.from('parts_catalogue').update(catUpdate).eq('id', catalogueId)
      toast(`Received · ${orderedQty} unit${orderedQty !== 1 ? 's' : ''} added to stock`)
      setLinkReceiveModal({ open: false, part: null })
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setLinkReceiveSaving(false)
    }
  }

  async function handleStockPurchaseSubmit(form: StockPurchaseForm) {
    setStockLoading(true)
    try {
      const payload: Record<string, unknown> = {
        branch_id: branchId,
        part_name: form.part_name.trim(),
        quantity: Number(form.quantity),
        ordered_qty: Number(form.quantity),
        status: 'pending' as PartRequest['status'],
        urgency: 'normal',
      }
      if (form.part_number.trim()) payload.part_number = form.part_number.trim()
      if (form.supplier.trim()) payload.supplier = form.supplier.trim()
      if (form.unit_price) {
        const cost = Number(form.unit_price)
        payload.unit_price = cost
        const markup = Number(form.markup)
        if (markup >= 1) payload.selling_price = parseFloat((cost * markup).toFixed(2))
      }
      if (form.catalogue_part_id) payload.catalogue_part_id = form.catalogue_part_id
      if (form.notes.trim()) payload.notes = form.notes.trim()
      if (tenantId) payload.tenant_id = tenantId
      const { error: dbErr } = await supabase.from('parts_requests').insert(payload)
      if (dbErr) throw dbErr
      toast('Stock purchase created')
      setShowStockModal(false)
      await loadParts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create purchase', 'error')
    } finally {
      setStockLoading(false)
    }
  }

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'ordered', label: 'Ordered' },
    { key: 'received', label: 'Received' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <div>
      {/* Header with New Stock Purchase button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button onClick={() => setShowStockModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#22C55E', color: '#fff', border: 'none', borderRadius: 10, padding: '0 20px', minHeight: 44, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={16} /> New Stock Purchase
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <SummaryCard label="Pending" count={counts.pending} icon={<Package size={20} />} color="#F59E0B" />
        <SummaryCard label="Ordered" count={counts.ordered} icon={<Truck size={20} />} color="#3B82F6" />
        <SummaryCard label="Received" count={counts.received} icon={<PackageCheck size={20} />} color="#22C55E" />
      </div>

      {/* Filter bar */}
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {STATUS_TABS.map(tab => {
            const active = statusFilter === tab.key
            return (
              <button key={tab.key} onClick={() => setStatusFilter(tab.key)} style={{ borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', background: active ? '#F15A22' : '#1E1E1E', color: active ? '#F0F0F0' : '#A0A0A0', border: active ? 'none' : '1px solid #2A2A2A', padding: '0 20px', minHeight: 44 }}>
                {tab.label}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ color: '#A0A0A0', position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search part name, supplier…" style={{ width: '100%', paddingLeft: 36, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: 8, fontSize: 14, outline: 'none', background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#A0A0A0', fontSize: 14 }}>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#A0A0A0', fontSize: 14 }}>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none', background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0' }} />
          </div>
          {(dateFrom || dateTo || search) && (
            <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', padding: '0 20px', minHeight: 44 }}>Clear</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #2A2A2A' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 96, paddingBottom: 96 }}>
            <Loader2 size={32} className="animate-spin" style={{ color: '#F15A22' }} />
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 12 }}>
            <p style={{ color: '#A0A0A0' }}>{error}</p>
            <button onClick={loadParts} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 96, paddingBottom: 96, gap: 12 }}>
            <Package size={48} style={{ color: '#2A2A2A' }} />
            <p style={{ fontWeight: 600, color: '#A0A0A0', margin: 0 }}>No stock purchases found</p>
            <p style={{ fontSize: 14, color: '#4A4A4A', margin: 0 }}>{search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first stock purchase'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#161616', borderBottom: '1px solid #2A2A2A' }}>
                  {['Part', 'Qty', 'Ord. Qty', 'Selling Price', 'Supplier', 'Status', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#A0A0A0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((part, idx) => (
                  <tr key={part.id} style={{ background: idx % 2 === 0 ? '#0E0E0E' : '#161616', borderBottom: '1px solid #2A2A2A' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: '#F0F0F0' }}>{part.part_name}</p>
                      {part.part_number && <p style={{ fontSize: 11, margin: '2px 0 0', color: '#A0A0A0' }}>{part.part_number}</p>}
                    </td>
                    <td style={{ padding: '12px 16px' }}><span style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>{part.quantity}</span></td>
                    <td style={{ padding: '12px 16px' }}>
                      {part.ordered_qty != null ? <span style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>{part.ordered_qty}</span> : <span style={{ color: '#4A4A4A' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 14, color: part.selling_price != null ? '#F0F0F0' : '#4A4A4A' }}>
                        {part.selling_price != null ? `RM ${part.selling_price.toFixed(2)}` : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}><span style={{ fontSize: 14, color: '#F0F0F0' }}>{part.supplier ?? '—'}</span></td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status={part.status} /></td>
                    <td style={{ padding: '12px 16px' }}><span style={{ fontSize: 14, color: '#A0A0A0' }}>{formatDate(part.created_at)}</span></td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {actionLoading === part.id ? (
                          <Loader2 size={16} className="animate-spin" style={{ color: '#F15A22' }} />
                        ) : (
                          <>
                            {part.status === 'pending' && (
                              <button onClick={() => updateStatus(part.id, 'ordered')} title="Mark as Ordered" style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#3B82F6', padding: '0 12px', minHeight: 44 }}>
                                <Truck size={16} />
                              </button>
                            )}
                            {part.status === 'ordered' && (
                              <button onClick={() => handleMarkReceived(part)} title="Mark as Received" style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#22C55E', padding: '0 12px', minHeight: 44 }}>
                                <CheckCircle size={16} />
                              </button>
                            )}
                            {part.status !== 'received' && part.status !== 'cancelled' && (
                              <button onClick={() => handleCancel(part.id)} title="Cancel" style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: '#6B7280', padding: '0 12px', minHeight: 44 }}>
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

      {!loading && !error && filtered.length > 0 && (
        <p style={{ fontSize: 11, textAlign: 'right', color: '#4A4A4A', margin: '12px 0 0' }}>Showing {filtered.length} of {parts.length} records</p>
      )}

      {/* Modals */}
      {showStockModal && (
        <NewStockPurchaseModal onClose={() => setShowStockModal(false)} onSubmit={handleStockPurchaseSubmit} loading={stockLoading} tenantId={tenantId} />
      )}

      {linkReceiveModal.open && linkReceiveModal.part && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && setLinkReceiveModal({ open: false, part: null })}>
          <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PackageCheck size={18} style={{ color: '#22C55E' }} />
                <div>
                  <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>Link Catalogue Before Receiving</h2>
                  <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>Stock can't be updated without a catalogue entry</p>
                </div>
              </div>
              <button onClick={() => setLinkReceiveModal({ open: false, part: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 10, padding: '12px 16px' }}>
                <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 14, margin: 0 }}>{linkReceiveModal.part.part_name}</p>
                {linkReceiveModal.part.part_number && <p style={{ color: '#A0A0A0', fontSize: 12, marginTop: 2, marginBottom: 0 }}>{linkReceiveModal.part.part_number}</p>}
                <p style={{ color: '#A0A0A0', fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                  Qty to add to stock: <span style={{ color: '#22C55E', fontWeight: 700 }}>{linkReceiveModal.part.ordered_qty ?? linkReceiveModal.part.quantity}</span>
                </p>
              </div>
              <div style={{ display: 'flex', gap: 4, background: '#161616', border: '1px solid #2A2A2A', borderRadius: 10, padding: 4 }}>
                <button type="button" onClick={() => setLinkReceiveForm(f => ({ ...f, create_new: false }))}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: !linkReceiveForm.create_new ? '#F15A22' : 'transparent', color: !linkReceiveForm.create_new ? '#fff' : '#A0A0A0' }}>
                  Link Existing
                </button>
                <button type="button" onClick={() => setLinkReceiveForm(f => ({ ...f, create_new: true, catalogue_part_id: '' }))}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: linkReceiveForm.create_new ? '#F15A22' : 'transparent', color: linkReceiveForm.create_new ? '#fff' : '#A0A0A0' }}>
                  Create New Entry
                </button>
              </div>
              {!linkReceiveForm.create_new ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={labelStyle}>Select Catalogue Part</label>
                  <select value={linkReceiveForm.catalogue_part_id} onChange={e => setLinkReceiveForm(f => ({ ...f, catalogue_part_id: e.target.value }))} style={{ ...inputStyle, color: linkReceiveForm.catalogue_part_id ? '#F0F0F0' : '#6B7280' }}>
                    <option value="">— Select —</option>
                    {catalogueParts.map(cp => <option key={cp.id} value={cp.id}>{cp.name}{cp.part_number ? ` (${cp.part_number})` : ''} · stock: {cp.stock_qty}</option>)}
                  </select>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={labelStyle}>Part Name *</label>
                    <input value={linkReceiveForm.new_name} onChange={e => setLinkReceiveForm(f => ({ ...f, new_name: e.target.value }))} style={inputStyle} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={labelStyle}>Part Number</label>
                    <input value={linkReceiveForm.new_part_number} onChange={e => setLinkReceiveForm(f => ({ ...f, new_part_number: e.target.value }))} placeholder="Optional" style={inputStyle} />
                  </div>
                  <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>A new catalogue entry will be created with stock qty starting at 0, then this receipt will be added.</p>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #2A2A2A' }}>
              <button onClick={() => setLinkReceiveModal({ open: false, part: null })} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={handleConfirmLinkReceive} disabled={linkReceiveSaving} style={{ background: '#22C55E', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                {linkReceiveSaving && <Loader2 size={14} className="animate-spin" />}Confirm & Receive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type InvTab = 'stock' | 'catalogue' | 'suppliers'

export function InventoryPage() {
  const { user } = useAuthStore()
  const branchId: string = user?.branch_id ?? ''
  const tenantId: string = user?.tenant_id ?? ''
  const [activeTab, setActiveTab] = useState<InvTab>('stock')

  const tabs: { key: InvTab; label: string; icon: React.ReactNode }[] = [
    { key: 'stock', label: 'Stock Purchases', icon: <Package size={14} /> },
    { key: 'catalogue', label: 'Catalogue', icon: <BookOpen size={14} /> },
    { key: 'suppliers', label: 'Suppliers', icon: <Building2 size={14} /> },
  ]

  return (
    <div style={{ minHeight: '100vh', padding: 24, background: '#0E0E0E', color: '#F0F0F0' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 700, margin: 0 }}>Inventory</h1>
        <p style={{ color: '#A0A0A0', fontSize: 13, marginTop: 4 }}>Stock levels, catalogue and supplier management</p>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#161616', border: '1px solid #2A2A2A', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: activeTab === t.key ? '#F15A22' : 'transparent', color: activeTab === t.key ? '#fff' : '#A0A0A0', transition: 'all 0.15s' }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {activeTab === 'stock' && <StockPurchasesTab tenantId={tenantId} branchId={branchId} />}
      {activeTab === 'catalogue' && <CatalogueTab tenantId={tenantId} branchId={branchId} />}
      {activeTab === 'suppliers' && <SuppliersTab tenantId={tenantId} branchId={branchId} />}
    </div>
  )
}
