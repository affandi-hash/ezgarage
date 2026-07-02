import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useOutletContext } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import {
  Search, AlertCircle, AlertTriangle, DollarSign,
  FileText, X, Loader2, CheckCircle, Plus
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ARInvoice {
  id: string
  invoice_number: string
  created_at: string
  due_date: string | null
  total_amount: number
  status: string
  job_id: string | null
  customer_id: string | null
  customers?: {
    id: string
    full_name: string
    phone: string
    customer_type: string
    credit_days?: number | null
    credit_limit?: number | null
  } | null
  receipts?: { amount: number }[]
}

interface Receipt {
  id: string
  invoice_id: string
  amount: number
  payment_method: string
  payment_date: string
  reference_number: string | null
  notes: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  return 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

function agingBucket(dueDate: string | null): string {
  if (!dueDate) return 'current'
  const diff = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
  if (diff <= 0) return 'current'
  if (diff <= 30) return '1-30'
  if (diff <= 60) return '31-60'
  return '60+'
}

function paidAmount(inv: ARInvoice): number {
  return (inv.receipts ?? []).reduce((s, r) => s + r.amount, 0)
}

function balance(inv: ARInvoice): number {
  return Math.max(0, inv.total_amount - paidAmount(inv))
}

function invStatus(inv: ARInvoice): 'paid' | 'partial' | 'overdue' | 'unpaid' {
  const bal = balance(inv)
  if (bal <= 0) return 'paid'
  const paid = paidAmount(inv)
  const today = new Date().toISOString().slice(0, 10)
  if (inv.due_date && inv.due_date < today) return 'overdue'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

const STATUS_COLOR: Record<string, string> = {
  paid: '#22C55E', partial: '#EAB308', overdue: '#EF4444', unpaid: '#A0A0A0',
}
const STATUS_BG: Record<string, string> = {
  paid: 'rgba(34,197,94,0.1)', partial: 'rgba(234,179,8,0.1)',
  overdue: 'rgba(239,68,68,0.1)', unpaid: 'rgba(160,160,160,0.1)',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{ background: STATUS_BG[status], color: STATUS_COLOR[status], borderRadius: 9999, padding: '3px 10px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' as const, whiteSpace: 'nowrap' as const }}>
      {status}
    </span>
  )
}

function SummaryCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} color={color} />
      </div>
      <div>
        <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>{label}</p>
        <p style={{ color: '#F0F0F0', fontSize: 20, fontWeight: 700, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  invoice,
  tenantId,
  onClose,
  onRefresh,
}: {
  invoice: ARInvoice
  tenantId: string
  onClose: () => void
  onRefresh: () => void
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [showPayForm, setShowPayForm] = useState(false)
  const [form, setForm] = useState({ payment_date: new Date().toISOString().slice(0, 10), amount: '', payment_method: 'cash', reference_number: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const loadReceipts = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('receipts').select('*').eq('invoice_id', invoice.id).order('payment_date', { ascending: false })
    setReceipts((data as Receipt[]) ?? [])
    setLoading(false)
  }, [invoice.id])

  useEffect(() => { loadReceipts() }, [loadReceipts])

  const totalPaid = receipts.reduce((s, r) => s + r.amount, 0)
  const bal = Math.max(0, invoice.total_amount - totalPaid)
  const status = invStatus({ ...invoice, receipts: receipts.map(r => ({ amount: r.amount })) })
  const customer = invoice.customers

  async function handlePay() {
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return }
    if (amt > bal + 0.001) { toast('Amount exceeds balance', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('receipts').insert({
      tenant_id: tenantId,
      invoice_id: invoice.id,
      amount: amt,
      payment_method: form.payment_method,
      payment_date: form.payment_date,
      reference_number: form.reference_number || null,
      notes: form.notes || null,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Payment recorded')
    setShowPayForm(false)
    setForm(f => ({ ...f, amount: '' }))
    loadReceipts()
    onRefresh()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: '100%', maxWidth: 480, height: '100%', background: '#161616', borderLeft: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #2A2A2A', flexShrink: 0 }}>
          <div>
            <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0 }}>{customer?.full_name}</p>
            <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: '4px 0 0' }}>{invoice.invoice_number}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
        </div>

        {/* Amounts */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #2A2A2A' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            {[
              { label: 'Total', value: fmtAmt(invoice.total_amount), color: '#F0F0F0' },
              { label: 'Paid', value: fmtAmt(totalPaid), color: '#22C55E' },
              { label: 'Balance', value: fmtAmt(bal), color: bal > 0 ? '#F15A22' : '#22C55E' },
            ].map(item => (
              <div key={item.label} style={{ background: '#1E1E1E', borderRadius: 8, padding: '12px 14px' }}>
                <p style={{ color: '#A0A0A0', fontSize: 11, margin: 0 }}>{item.label}</p>
                <p style={{ color: item.color, fontSize: 14, fontWeight: 700, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{item.value}</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge status={status} />
            {invoice.due_date && <span style={{ fontSize: 12, color: '#A0A0A0' }}>Due {fmtDate(invoice.due_date)}</span>}
          </div>
        </div>

        {/* Customer Credit Info */}
        {customer && (customer.credit_limit != null || customer.credit_days != null) && (
          <div style={{ padding: '14px 24px', borderBottom: '1px solid #2A2A2A', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {customer.credit_days != null && <span style={{ fontSize: 11, background: 'rgba(241,90,34,0.1)', color: '#F15A22', borderRadius: 4, padding: '2px 8px' }}>Credit {customer.credit_days}d</span>}
            {customer.credit_limit != null && <span style={{ fontSize: 11, background: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A', borderRadius: 4, padding: '2px 8px' }}>Limit {fmtAmt(customer.credit_limit)}</span>}
          </div>
        )}

        {/* Invoice Details */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #2A2A2A' }}>
          <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Invoice Details</p>
          {[
            { label: 'Invoice Date', value: fmtDate(invoice.created_at) },
            { label: 'Due Date', value: fmtDate(invoice.due_date) },
            { label: 'Customer Type', value: customer?.customer_type ?? '—' },
            { label: 'Phone', value: customer?.phone ?? '—' },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#A0A0A0' }}>{row.label}</span>
              <span style={{ fontSize: 13, color: '#F0F0F0', textTransform: 'capitalize' }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Payment History */}
        <div style={{ padding: '20px 24px', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Payment History</p>
            {bal > 0 && !showPayForm && (
              <button onClick={() => setShowPayForm(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <Plus size={13} /> Add Payment
              </button>
            )}
          </div>

          {showPayForm && (
            <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#A0A0A0', display: 'block', marginBottom: 4 }}>Date</label>
                  <input type="date" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 6, color: '#F0F0F0', fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#A0A0A0', display: 'block', marginBottom: 4 }}>Amount (RM)</label>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder={bal.toFixed(2)} style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 6, color: '#F0F0F0', fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#A0A0A0', display: 'block', marginBottom: 4 }}>Method</label>
                <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 6, color: '#F0F0F0', fontSize: 13, padding: '8px 10px', width: '100%' }}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="online">Online</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#A0A0A0', display: 'block', marginBottom: 4 }}>Reference No.</label>
                <input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="optional" style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 6, color: '#F0F0F0', fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handlePay} disabled={saving} style={{ flex: 1, background: '#F15A22', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {saving && <Loader2 size={13} className="animate-spin" />}Record Payment
                </button>
                <button onClick={() => setShowPayForm(false)} style={{ background: '#2A2A2A', color: '#A0A0A0', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Loader2 size={20} style={{ color: '#F15A22' }} className="animate-spin" /></div>
          ) : receipts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#4A4A4A' }}>
              <CheckCircle size={28} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, margin: 0 }}>No payments yet</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {receipts.map(r => (
                <div key={r.id} style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 14 }}>{fmtAmt(r.amount)}</span>
                    <span style={{ color: '#22C55E', fontSize: 12 }}>{fmtDate(r.payment_date)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: '#A0A0A0', textTransform: 'capitalize' }}>{r.payment_method.replace('_', ' ')}</span>
                    {r.reference_number && <span style={{ fontSize: 11, color: '#6A6A6A' }}>Ref: {r.reference_number}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ARPage() {
  const { user } = useAuthStore()
  const { selectedBranchId } = useOutletContext<{ selectedBranchId: string | null }>()
  const tenantId = user?.tenant_id ?? ''
  const branchId = selectedBranchId ?? user?.branch_id ?? ''

  const [invoices, setInvoices] = useState<ARInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [selected, setSelected] = useState<ARInvoice | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('invoices')
      .select('id, invoice_number, created_at, due_date, total_amount, status, job_id, customer_id, customers(id, full_name, phone, customer_type, credit_days, credit_limit), receipts(amount)')
      .eq('tenant_id', tenantId)
      .neq('status', 'void')
      .order('created_at', { ascending: false })

    if (branchId) query = query.eq('branch_id', branchId)

    const { data } = await query
    const rows = (data as unknown as ARInvoice[]) ?? []

    // Only show invoices for corporate/fleet customers (credit customers)
    const creditOnly = rows.filter(inv =>
      inv.customers?.customer_type === 'corporate' || inv.customers?.customer_type === 'fleet'
    )
    setInvoices(creditOnly)
    setLoading(false)
  }, [tenantId, branchId])

  useEffect(() => { load() }, [load])

  // Derived status for each invoice
  const withStatus = invoices.map(inv => ({ ...inv, _status: invStatus(inv), _balance: balance(inv), _paid: paidAmount(inv) }))

  // Summary
  const today = new Date().toISOString().slice(0, 10)
  const week = new Date(); week.setDate(week.getDate() + 7)
  const weekStr = week.toISOString().slice(0, 10)

  const overdue = withStatus.filter(i => i._status === 'overdue').reduce((s, i) => s + i._balance, 0)
  const dueThisWeek = withStatus.filter(i => i._status !== 'paid' && i.due_date && i.due_date >= today && i.due_date <= weekStr).reduce((s, i) => s + i._balance, 0)
  const totalOutstanding = withStatus.filter(i => i._status !== 'paid').reduce((s, i) => s + i._balance, 0)

  // Aging buckets
  const aging = {
    current: withStatus.filter(i => i._status !== 'paid' && agingBucket(i.due_date) === 'current').reduce((s, i) => s + i._balance, 0),
    '1-30': withStatus.filter(i => i._status !== 'paid' && agingBucket(i.due_date) === '1-30').reduce((s, i) => s + i._balance, 0),
    '31-60': withStatus.filter(i => i._status !== 'paid' && agingBucket(i.due_date) === '31-60').reduce((s, i) => s + i._balance, 0),
    '60+': withStatus.filter(i => i._status !== 'paid' && agingBucket(i.due_date) === '60+').reduce((s, i) => s + i._balance, 0),
  }

  const filtered = withStatus.filter(inv => {
    const name = inv.customers?.full_name ?? ''
    const matchSearch = !search || name.toLowerCase().includes(search.toLowerCase()) || inv.invoice_number.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus || inv._status === filterStatus
    const matchType = !filterType || inv.customers?.customer_type === filterType
    return matchSearch && matchStatus && matchType
  })

  const inputStyle: React.CSSProperties = { background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 14, padding: '10px 12px', outline: 'none' }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0 }}>Accounts Receivable</h1>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>Outstanding invoices from corporate & fleet customers</p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
        <SummaryCard label="Overdue" value={fmtAmt(overdue)} icon={AlertCircle} color="#EF4444" />
        <SummaryCard label="Due This Week" value={fmtAmt(dueThisWeek)} icon={AlertTriangle} color="#EAB308" />
        <SummaryCard label="Total Outstanding" value={fmtAmt(totalOutstanding)} icon={DollarSign} color="#F15A22" />
        <SummaryCard label="Total Invoices" value={String(withStatus.filter(i => i._status !== 'paid').length)} icon={FileText} color="#3B82F6" />
      </div>

      {/* Aging Report */}
      <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
        <p style={{ color: '#A0A0A0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 14px' }}>Aging Report</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {[
            { label: 'Current', value: aging.current, color: '#22C55E' },
            { label: '1–30 Days', value: aging['1-30'], color: '#EAB308' },
            { label: '31–60 Days', value: aging['31-60'], color: '#F97316' },
            { label: '60+ Days', value: aging['60+'], color: '#EF4444' },
          ].map(b => (
            <div key={b.label} style={{ textAlign: 'center' }}>
              <p style={{ color: '#A0A0A0', fontSize: 12, margin: '0 0 4px' }}>{b.label}</p>
              <p style={{ color: b.value > 0 ? b.color : '#4A4A4A', fontSize: 18, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(b.value)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '8px 12px', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ color: '#A0A0A0', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer or invoice #…" style={{ background: 'none', border: 'none', outline: 'none', color: '#F0F0F0', fontSize: 14, width: '100%' }} />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inputStyle, minWidth: 130 }}>
          <option value="">All Status</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inputStyle, minWidth: 140 }}>
          <option value="">All Types</option>
          <option value="corporate">Corporate</option>
          <option value="fleet">Fleet</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Loader2 size={32} style={{ color: '#F15A22' }} className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#A0A0A0' }}>
          <FileText size={44} style={{ margin: '0 auto 12px', color: '#2A2A2A' }} />
          <p style={{ fontSize: 15 }}>{invoices.length === 0 ? 'No credit customer invoices yet. Add corporate or fleet customers and raise invoices for them.' : 'No invoices match your filters.'}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 750, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Customer', 'Type', 'Invoice #', 'Invoice Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#4A4A4A', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} onClick={() => setSelected(inv)} style={{ borderBottom: '1px solid #1E1E1E', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1A1A1A')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '14px', color: '#F0F0F0', fontWeight: 600, fontSize: 14 }}>{inv.customers?.full_name ?? '—'}</td>
                  <td style={{ padding: '14px' }}>
                    <span style={{ fontSize: 11, background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 4, padding: '2px 8px', color: '#A0A0A0', textTransform: 'capitalize' }}>{inv.customers?.customer_type ?? '—'}</span>
                  </td>
                  <td style={{ padding: '14px', color: '#A0A0A0', fontSize: 13, fontFamily: 'monospace' }}>{inv.invoice_number}</td>
                  <td style={{ padding: '14px', color: '#A0A0A0', fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(inv.created_at)}</td>
                  <td style={{ padding: '14px', fontSize: 13, whiteSpace: 'nowrap', color: inv._status === 'overdue' ? '#EF4444' : '#A0A0A0' }}>{fmtDate(inv.due_date)}</td>
                  <td style={{ padding: '14px', color: '#F0F0F0', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmt(inv.total_amount)}</td>
                  <td style={{ padding: '14px', color: '#22C55E', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmt(inv._paid)}</td>
                  <td style={{ padding: '14px', color: inv._balance > 0 ? '#F15A22' : '#22C55E', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmt(inv._balance)}</td>
                  <td style={{ padding: '14px' }}><StatusBadge status={inv._status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailPanel
          invoice={selected}
          tenantId={tenantId}
          onClose={() => setSelected(null)}
          onRefresh={() => { load(); setSelected(null) }}
        />
      )}
    </div>
  )
}
