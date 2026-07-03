import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useOutletContext } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import {
  Plus, X, Loader2, Search, Upload, FileText,
  Zap, Wrench, TrendingDown, TrendingUp, Building,
  Megaphone, Users, Package, MoreHorizontal, Pencil, Trash2,
  DollarSign, HardHat
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Expense {
  id: string
  type: 'opex' | 'capex'
  category: string
  description: string
  amount: number
  expense_date: string
  payment_method: string
  reference: string | null
  vendor: string | null
  file_url: string | null
  is_recurring: boolean
  recurring_period: string | null
  lifespan_years: number | null
  notes: string | null
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OPEX_CATEGORIES = ['Utilities', 'Wages', 'Rental', 'Marketing', 'Maintenance', 'Consumables', 'Insurance', 'Others']
const CAPEX_CATEGORIES = ['Renovation', 'Tools & Equipment', 'Machinery', 'Vehicle', 'Furniture', 'IT & Technology', 'Others']
const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Online', 'Card']

const CATEGORY_ICON: Record<string, React.ElementType> = {
  'Utilities': Zap,
  'Wages': Users,
  'Rental': Building,
  'Marketing': Megaphone,
  'Maintenance': Wrench,
  'Consumables': Package,
  'Renovation': Building,
  'Tools & Equipment': Wrench,
  'Machinery': Wrench,
  'Vehicle': TrendingUp,
}

const CATEGORY_COLOR: Record<string, string> = {
  'Utilities': '#3B82F6',
  'Wages': '#8B5CF6',
  'Rental': '#F97316',
  'Marketing': '#EC4899',
  'Maintenance': '#EAB308',
  'Consumables': '#14B8A6',
  'Insurance': '#6366F1',
  'Renovation': '#F97316',
  'Tools & Equipment': '#EAB308',
  'Machinery': '#10B981',
  'Vehicle': '#3B82F6',
  'IT & Technology': '#6366F1',
  'Others': '#6B7280',
  'Furniture': '#A78BFA',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  return 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

function thisMonth() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function lastMonth() {
  const n = new Date()
  n.setMonth(n.getMonth() - 1)
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

const inp: React.CSSProperties = {
  background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8,
  color: '#F0F0F0', fontSize: 14, padding: '10px 12px', width: '100%',
  boxSizing: 'border-box' as const, outline: 'none',
}
const lbl: React.CSSProperties = { fontSize: 12, color: '#A0A0A0', marginBottom: 6, display: 'block', fontWeight: 500 }

// ─── Tile ─────────────────────────────────────────────────────────────────────

function Tile({ label, value, sub, color, icon: Icon }: { label: string; value: string; sub?: string; color: string; icon: React.ElementType }) {
  return (
    <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#A0A0A0', fontWeight: 500 }}>{label}</span>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} color={color} />
        </div>
      </div>
      <p style={{ color: '#F0F0F0', fontSize: 20, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p style={{ color: '#4A4A4A', fontSize: 12, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

// ─── Category Bar ─────────────────────────────────────────────────────────────

function CategoryBar({ expenses, type }: { expenses: Expense[]; type: 'opex' | 'capex' }) {
  const rows = expenses.filter(e => e.type === type)
  const total = rows.reduce((s, e) => s + e.amount, 0)
  const bycat: Record<string, number> = {}
  rows.forEach(e => { bycat[e.category] = (bycat[e.category] ?? 0) + e.amount })
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (sorted.length === 0) return <p style={{ color: '#4A4A4A', fontSize: 13, margin: 0 }}>No data this month</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map(([cat, amt]) => {
        const pct = total > 0 ? (amt / total) * 100 : 0
        const color = CATEGORY_COLOR[cat] ?? '#6B7280'
        return (
          <div key={cat}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: '#A0A0A0' }}>{cat}</span>
              <span style={{ fontSize: 13, color: '#F0F0F0', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(amt)}</span>
            </div>
            <div style={{ background: '#2A2A2A', borderRadius: 4, height: 6 }}>
              <div style={{ background: color, width: `${pct}%`, height: 6, borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

interface ExpenseForm {
  type: 'opex' | 'capex'
  category: string
  description: string
  amount: string
  expense_date: string
  payment_method: string
  reference: string
  vendor: string
  is_recurring: boolean
  recurring_period: string
  lifespan_years: string
  notes: string
}

const EMPTY: ExpenseForm = {
  type: 'opex', category: 'Utilities', description: '', amount: '',
  expense_date: new Date().toISOString().slice(0, 10),
  payment_method: 'Cash', reference: '', vendor: '',
  is_recurring: false, recurring_period: 'monthly',
  lifespan_years: '', notes: '',
}

function ExpenseModal({
  editing,
  onClose,
  onSaved,
  tenantId,
  branchId,
  userId,
}: {
  editing: Expense | null
  onClose: () => void
  onSaved: () => void
  tenantId: string
  branchId: string
  userId: string
}) {
  const [form, setForm] = useState<ExpenseForm>(
    editing ? {
      type: editing.type, category: editing.category,
      description: editing.description, amount: String(editing.amount),
      expense_date: editing.expense_date, payment_method: editing.payment_method,
      reference: editing.reference ?? '', vendor: editing.vendor ?? '',
      is_recurring: editing.is_recurring, recurring_period: editing.recurring_period ?? 'monthly',
      lifespan_years: editing.lifespan_years != null ? String(editing.lifespan_years) : '',
      notes: editing.notes ?? '',
    } : EMPTY
  )
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const categories = form.type === 'opex' ? OPEX_CATEGORIES : CAPEX_CATEGORIES

  // reset category when type changes
  useEffect(() => {
    const cats = form.type === 'opex' ? OPEX_CATEGORIES : CAPEX_CATEGORIES
    if (!cats.includes(form.category)) setForm(f => ({ ...f, category: cats[0] }))
  }, [form.type])

  async function save() {
    if (!form.description.trim()) { toast('Description is required', 'error'); return }
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return }

    setSaving(true)
    let fileUrl = editing?.file_url ?? null

    if (file) {
      setUploading(true)
      const ext = file.name.split('.').pop()
      const path = `${tenantId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('expense-docs').upload(path, file, { upsert: true })
      if (!upErr) {
        const { data } = supabase.storage.from('expense-docs').getPublicUrl(path)
        fileUrl = data.publicUrl
      }
      setUploading(false)
    }

    const payload = {
      tenant_id: tenantId, branch_id: branchId || null,
      type: form.type, category: form.category,
      description: form.description.trim(), amount: amt,
      expense_date: form.expense_date, payment_method: form.payment_method,
      reference: form.reference || null, vendor: form.vendor || null,
      is_recurring: form.is_recurring,
      recurring_period: form.is_recurring ? form.recurring_period : null,
      lifespan_years: form.type === 'capex' && form.lifespan_years ? parseInt(form.lifespan_years) : null,
      notes: form.notes || null, file_url: fileUrl,
      created_by: userId || null,
    }

    const { error } = editing
      ? await supabase.from('expenses').update(payload).eq('id', editing.id)
      : await supabase.from('expenses').insert(payload)

    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(editing ? 'Expense updated' : 'Expense recorded')
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}>
          <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>{editing ? 'Edit Expense' : 'Record Expense'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Type toggle */}
          <div>
            <label style={lbl}>Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['opex', 'capex'] as const).map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid', fontSize: 13, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em', borderColor: form.type === t ? '#F15A22' : '#2A2A2A', background: form.type === t ? 'rgba(241,90,34,0.12)' : '#161616', color: form.type === t ? '#F15A22' : '#6A6A6A' }}>
                  {t === 'opex' ? 'OPEX' : 'CAPEX'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inp}>
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Date</label>
              <input type="date" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} style={inp} />
            </div>
          </div>

          <div>
            <label style={lbl}>Description *</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. TNB bill July 2026" style={inp} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Amount (RM) *</label>
              <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" style={inp} />
            </div>
            <div>
              <label style={lbl}>Payment Method</label>
              <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} style={inp}>
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Vendor / Payee</label>
              <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="e.g. TNB, Indah Water" style={inp} />
            </div>
            <div>
              <label style={lbl}>Reference No.</label>
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="optional" style={inp} />
            </div>
          </div>

          {form.type === 'capex' && (
            <div>
              <label style={lbl}>Expected Lifespan (years)</label>
              <input type="number" min="1" step="1" value={form.lifespan_years} onChange={e => setForm(f => ({ ...f, lifespan_years: e.target.value }))} placeholder="e.g. 5" style={inp} />
            </div>
          )}

          {form.type === 'opex' && (
            <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, margin: 0 }}>Recurring expense</p>
                <p style={{ color: '#A0A0A0', fontSize: 12, margin: '2px 0 0' }}>Rent, utilities, subscriptions</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {form.is_recurring && (
                  <select value={form.recurring_period} onChange={e => setForm(f => ({ ...f, recurring_period: e.target.value }))} style={{ ...inp, width: 'auto', padding: '6px 10px', fontSize: 12 }}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                )}
                <button onClick={() => setForm(f => ({ ...f, is_recurring: !f.is_recurring }))}
                  style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: form.is_recurring ? '#F15A22' : '#2A2A2A', position: 'relative', transition: 'background 0.2s' }}>
                  <span style={{ position: 'absolute', top: 3, left: form.is_recurring ? 20 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </button>
              </div>
            </div>
          )}

          <div>
            <label style={lbl}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inp, resize: 'none' }} />
          </div>

          {/* File upload */}
          <div>
            <label style={lbl}>Receipt / Document (optional)</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#161616', border: '1px dashed #3A3A3A', borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>
              {uploading ? <Loader2 size={15} className="animate-spin" color="#A0A0A0" /> : <Upload size={15} color={file || editing?.file_url ? '#22C55E' : '#A0A0A0'} />}
              <span style={{ fontSize: 13, color: file ? '#22C55E' : editing?.file_url ? '#22C55E' : '#A0A0A0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {file ? file.name : editing?.file_url ? 'File attached — click to replace' : 'Click to upload'}
              </span>
              {file && <span onClick={e => { e.preventDefault(); setFile(null) }} style={{ color: '#EF4444', fontSize: 11, cursor: 'pointer' }}>Remove</span>}
              <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #2A2A2A', flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 44, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            {saving && <Loader2 size={14} className="animate-spin" />}{editing ? 'Save Changes' : 'Record Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ExpensesPage() {
  const { user } = useAuthStore()
  const { selectedBranchId } = useOutletContext<{ selectedBranchId: string | null }>()
  const tenantId = user?.tenant_id ?? ''
  const branchId = selectedBranchId ?? user?.branch_id ?? ''
  const userId = user?.id ?? ''

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'opex' | 'capex'>('opex')
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [month, setMonth] = useState(thisMonth())
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [monthLabour, setMonthLabour] = useState(0)
  const [monthCOGS, setMonthCOGS] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const currentMonth = thisMonth()

    // expenses
    let query = supabase.from('expenses').select('*').eq('tenant_id', tenantId).order('expense_date', { ascending: false })
    if (branchId) query = query.eq('branch_id', branchId)
    const { data } = await query
    setExpenses((data as Expense[]) ?? [])

    // revenue: sum of invoices issued this month (not void/draft)
    const monthStart = `${currentMonth}-01`
    const [y, m] = currentMonth.split('-').map(Number)
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    let revQuery = supabase.from('invoices')
      .select('total_amount')
      .eq('tenant_id', tenantId)
      .gte('issue_date', monthStart)
      .lt('issue_date', nextMonth)
      .neq('status', 'void')
      .neq('status', 'draft')
    if (branchId) revQuery = revQuery.eq('branch_id', branchId)
    const { data: invData } = await revQuery
    const revenue = (invData ?? []).reduce((s: number, r: { total_amount: number }) => s + (r.total_amount ?? 0), 0)
    setMonthRevenue(revenue)

    // labour + COGS from invoice line items this month
    const { data: itemsData } = await supabase.from('invoice_items')
      .select('type, total, cost_price, quantity, invoices!inner(issue_date, status, tenant_id)')
      .eq('invoices.tenant_id', tenantId)
      .gte('invoices.issue_date', monthStart)
      .lt('invoices.issue_date', nextMonth)
      .neq('invoices.status', 'void')
      .neq('invoices.status', 'draft')
    const items = (itemsData ?? []) as { type: string; total: number; cost_price: number | null; quantity: number }[]
    const labour = items.filter(r => r.type === 'labour').reduce((s, r) => s + (r.total ?? 0), 0)
    const cogs = items.filter(r => r.type === 'part').reduce((s, r) => s + ((r.cost_price ?? 0) * (r.quantity ?? 1)), 0)
    setMonthLabour(labour)
    setMonthCOGS(cogs)

    setLoading(false)
  }, [tenantId, branchId])

  useEffect(() => { load() }, [load])

  // This month / last month buckets
  const thisMonthExp = expenses.filter(e => e.expense_date.startsWith(month))
  const lastMonthExp = expenses.filter(e => e.expense_date.startsWith(lastMonth()))

  const opexThis = thisMonthExp.filter(e => e.type === 'opex').reduce((s, e) => s + e.amount, 0)
  const capexThis = thisMonthExp.filter(e => e.type === 'capex').reduce((s, e) => s + e.amount, 0)
  const opexLast = lastMonthExp.filter(e => e.type === 'opex').reduce((s, e) => s + e.amount, 0)
  const capexLast = lastMonthExp.filter(e => e.type === 'capex').reduce((s, e) => s + e.amount, 0)
  const totalThis = opexThis + capexThis
  const totalLast = opexLast + capexLast

  function trendLabel(cur: number, prev: number) {
    if (prev === 0) return prev === 0 && cur === 0 ? 'No data last month' : 'New this month'
    const diff = ((cur - prev) / prev) * 100
    return `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}% vs last month`
  }

  // YTD
  const year = month.slice(0, 4)
  const ytdOpex = expenses.filter(e => e.type === 'opex' && e.expense_date.startsWith(year)).reduce((s, e) => s + e.amount, 0)
  const ytdCapex = expenses.filter(e => e.type === 'capex' && e.expense_date.startsWith(year)).reduce((s, e) => s + e.amount, 0)

  // Table data
  const categories = tab === 'opex' ? OPEX_CATEGORIES : CAPEX_CATEGORIES
  const tableData = expenses.filter(e => {
    if (e.type !== tab) return false
    if (!e.expense_date.startsWith(month)) return false
    if (filterCat && e.category !== filterCat) return false
    if (search && !e.description.toLowerCase().includes(search.toLowerCase()) && !(e.vendor ?? '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function deleteExpense(exp: Expense) {
    if (!confirm(`Delete "${exp.description}"?`)) return
    await supabase.from('expenses').delete().eq('id', exp.id)
    toast('Expense deleted')
    load()
  }

  // Month picker options (last 12 months)
  const monthOptions: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  function monthLabel(m: string) {
    const [y, mo] = m.split('-')
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0 }}>Expenses</h1>
          <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>OPEX & CAPEX tracking</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={month} onChange={e => setMonth(e.target.value)} style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13, padding: '8px 12px', outline: 'none' }}>
            {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button onClick={() => { setEditing(null); setShowModal(true) }} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F15A22', color: '#fff', border: 'none', borderRadius: 10, padding: '0 20px', minHeight: 44, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={15} /> Record Expense
          </button>
        </div>
      </div>

      {/* Summary Tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Tile label="OPEX This Month" value={fmtAmt(opexThis)} sub={trendLabel(opexThis, opexLast)} color="#F15A22" icon={TrendingDown} />
        <Tile label="CAPEX This Month" value={fmtAmt(capexThis)} sub={trendLabel(capexThis, capexLast)} color="#3B82F6" icon={TrendingUp} />
        <Tile label="Total Expenses" value={fmtAmt(totalThis)} sub={trendLabel(totalThis, totalLast)} color="#8B5CF6" icon={MoreHorizontal} />
        <Tile label="YTD OPEX" value={fmtAmt(ytdOpex)} sub={`${year} year-to-date`} color="#EAB308" icon={TrendingDown} />
        <Tile label="YTD CAPEX" value={fmtAmt(ytdCapex)} sub={`${year} year-to-date`} color="#10B981" icon={TrendingUp} />
        <Tile label="Total Labour" value={fmtAmt(monthLabour)} sub="Billed labour this month" color="#06B6D4" icon={HardHat} />
        <Tile
          label="Gross Profit"
          value={fmtAmt(monthRevenue - monthCOGS + monthLabour - opexThis - capexThis)}
          sub={`Rev ${fmtAmt(monthRevenue)} − COGS ${fmtAmt(monthCOGS)} + Labour ${fmtAmt(monthLabour)} − OPEX ${fmtAmt(opexThis)} − CAPEX ${fmtAmt(capexThis)}`}
          color={(monthRevenue - monthCOGS + monthLabour - opexThis - capexThis) >= 0 ? '#22C55E' : '#EF4444'}
          icon={DollarSign}
        />
      </div>

      {/* Category Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {(['opex', 'capex'] as const).map(t => (
          <div key={t} style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 14, margin: 0 }}>{t === 'opex' ? 'OPEX' : 'CAPEX'} Breakdown</p>
              <span style={{ fontSize: 13, color: '#F15A22', fontWeight: 700 }}>{fmtAmt(t === 'opex' ? opexThis : capexThis)}</span>
            </div>
            <CategoryBar expenses={thisMonthExp} type={t} />
          </div>
        ))}
      </div>

      {/* Records Table */}
      <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #2A2A2A' }}>
          {(['opex', 'capex'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setFilterCat('') }}
              style={{ flex: 1, padding: '14px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', background: 'none', color: tab === t ? '#F15A22' : '#4A4A4A', borderBottom: `2px solid ${tab === t ? '#F15A22' : 'transparent'}`, transition: 'color 0.15s' }}>
              {t}
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div style={{ display: 'flex', gap: 10, padding: '14px 16px', borderBottom: '1px solid #2A2A2A', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '7px 12px', flex: 1, minWidth: 180 }}>
            <Search size={13} color="#A0A0A0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description or vendor…" style={{ background: 'none', border: 'none', outline: 'none', color: '#F0F0F0', fontSize: 13, width: '100%' }} />
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13, padding: '7px 12px', outline: 'none' }}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={28} style={{ color: '#F15A22' }} className="animate-spin" /></div>
        ) : tableData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#4A4A4A' }}>
            <FileText size={36} style={{ margin: '0 auto 10px' }} />
            <p style={{ fontSize: 14, margin: 0 }}>No {tab.toUpperCase()} records for {monthLabel(month)}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Date', 'Category', 'Description', 'Vendor', 'Method', 'Amount', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#4A4A4A', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.map(exp => {
                  const CatIcon = CATEGORY_ICON[exp.category] ?? Package
                  const color = CATEGORY_COLOR[exp.category] ?? '#6B7280'
                  return (
                    <tr key={exp.id} style={{ borderBottom: '1px solid #161616' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#232323')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(exp.expense_date)}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 26, height: 26, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <CatIcon size={13} color={color} />
                          </div>
                          <span style={{ fontSize: 13, color: '#A0A0A0' }}>{exp.category}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <p style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 500, margin: 0 }}>{exp.description}</p>
                        {exp.is_recurring && <span style={{ fontSize: 10, background: 'rgba(241,90,34,0.1)', color: '#F15A22', borderRadius: 4, padding: '1px 6px', marginTop: 2, display: 'inline-block' }}>↻ {exp.recurring_period}</span>}
                        {exp.notes && <p style={{ color: '#4A4A4A', fontSize: 11, margin: '2px 0 0' }}>{exp.notes}</p>}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 13 }}>{exp.vendor ?? '—'}</td>
                      <td style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 12 }}>{exp.payment_method}</td>
                      <td style={{ padding: '12px 16px', color: '#F0F0F0', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmt(exp.amount)}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {exp.file_url && <a href={exp.file_url} target="_blank" rel="noreferrer" style={{ color: '#A0A0A0' }} title="View receipt"><FileText size={14} /></a>}
                          <button onClick={() => { setEditing(exp); setShowModal(true) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: 4 }} title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => deleteExpense(exp)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 4 }} title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #2A2A2A' }}>
                  <td colSpan={5} style={{ padding: '12px 16px', color: '#A0A0A0', fontSize: 13, fontWeight: 600 }}>Total ({tableData.length} records)</td>
                  <td style={{ padding: '12px 16px', color: '#F15A22', fontWeight: 800, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmt(tableData.reduce((s, e) => s + e.amount, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <ExpenseModal
          editing={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={load}
          tenantId={tenantId}
          branchId={branchId}
          userId={userId}
        />
      )}
    </div>
  )
}
