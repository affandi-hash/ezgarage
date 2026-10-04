import { useState, useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// One column per branch (the Hub, each ON-SITE van), a Shared / HQ column for
// expenses recorded without a branch, and a total. Same basis as the Net
// Profit tile on the Expenses page: revenue - parts cost - OPEX - CAPEX.

interface BranchRow { id: string; name: string }
type LineItem = { item_type: string; amount?: number; qty?: number; unit_price?: number; cost_price?: number }
interface InvoiceRow { branch_id: string | null; total_amount: number | null; line_items: LineItem[] | null }
interface ExpenseRow { branch_id: string | null; type: 'opex' | 'capex'; amount: number | null }
interface Col { revenue: number; parts: number; opex: number; capex: number; pending: number }

const SHARED = '__shared__'
const emptyCol = (): Col => ({ revenue: 0, parts: 0, opex: 0, capex: 0, pending: 0 })

function fmt(n: number) {
  return 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function thisMonth() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
}

function nextMonthStart(m: string) {
  const [y, mo] = m.split('-').map(Number)
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`
}

export function PnLByBranchPage() {
  const user = useAuthStore(s => s.user)
  const tenantId = user?.tenant_id ?? ''
  const [month, setMonth] = useState(thisMonth())
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)

  const monthOptions = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < 12; i++) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return out
  }, [])

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const from = `${month}-01`
      const to = nextMonthStart(month)
      const [br, inv, exp] = await Promise.all([
        supabase.from('branches').select('id, name').eq('tenant_id', tenantId).order('name'),
        supabase.from('invoices').select('branch_id, total_amount, line_items')
          .eq('tenant_id', tenantId).gte('issue_date', from).lt('issue_date', to)
          .neq('status', 'void').neq('status', 'draft').limit(5000),
        supabase.from('expenses').select('branch_id, type, amount')
          .eq('tenant_id', tenantId).gte('expense_date', from).lt('expense_date', to).limit(5000),
      ])
      if (cancelled) return
      setBranches((br.data as BranchRow[]) ?? [])
      setInvoices((inv.data as InvoiceRow[]) ?? [])
      setExpenses((exp.data as ExpenseRow[]) ?? [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [tenantId, month])

  const { cols, total } = useMemo(() => {
    const cols: Record<string, Col> = {}
    cols[SHARED] = emptyCol()
    branches.forEach(b => { cols[b.id] = emptyCol() })
    const key = (id: string | null) => (id && cols[id] ? id : SHARED)

    invoices.forEach(inv => {
      const c = cols[key(inv.branch_id)]
      c.revenue += inv.total_amount ?? 0
      ;(inv.line_items ?? []).forEach(li => {
        if (li.item_type !== 'part') return
        const qty = li.qty ?? 1
        c.parts += li.cost_price != null ? li.cost_price * qty : (li.amount ?? qty * (li.unit_price ?? 0))
      })
    })
    expenses.forEach(e => {
      const c = cols[key(e.branch_id)]
      if (e.amount == null) { c.pending += 1; return }
      if (e.type === 'opex') c.opex += e.amount
      else c.capex += e.amount
    })

    const total = emptyCol()
    Object.values(cols).forEach(c => {
      total.revenue += c.revenue; total.parts += c.parts
      total.opex += c.opex; total.capex += c.capex; total.pending += c.pending
    })
    return { cols, total }
  }, [branches, invoices, expenses])

  const columns: { id: string; label: string }[] = [
    ...branches.map(b => ({ id: b.id, label: b.name })),
    { id: SHARED, label: 'Shared / HQ' },
  ]

  const rows: { label: string; value: (c: Col) => number; strong?: boolean; negativeColor?: boolean }[] = [
    { label: 'Revenue', value: c => c.revenue },
    { label: 'Parts cost', value: c => c.parts },
    { label: 'Gross profit', value: c => c.revenue - c.parts, strong: true },
    { label: 'OPEX', value: c => c.opex },
    { label: 'CAPEX', value: c => c.capex },
    { label: 'Net profit / loss', value: c => c.revenue - c.parts - c.opex - c.capex, strong: true, negativeColor: true },
  ]

  const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'right', fontSize: 11, color: '#A0A0A0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0 }}>P&amp;L by Branch</h1>
          <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>The Hub, each ON-SITE van, shared costs, and the consolidated total</p>
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13, padding: '8px 12px', outline: 'none' }}>
          {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={28} style={{ color: '#F15A22' }} className="animate-spin" /></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  <th style={{ ...th, textAlign: 'left' }}>{monthLabel(month)}</th>
                  {columns.map(c => <th key={c.id} style={th}>{c.label}</th>)}
                  <th style={{ ...th, color: '#F15A22' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label} style={{ borderBottom: '1px solid #161616', background: r.strong ? '#232323' : 'transparent' }}>
                    <td style={{ padding: '12px 16px', color: r.strong ? '#F0F0F0' : '#A0A0A0', fontSize: 13, fontWeight: r.strong ? 700 : 500 }}>{r.label}</td>
                    {columns.map(c => {
                      const v = r.value(cols[c.id])
                      return (
                        <td key={c.id} style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: r.strong ? 700 : 500, color: r.negativeColor ? (v >= 0 ? '#22C55E' : '#EF4444') : '#F0F0F0' }}>{fmt(v)}</td>
                      )
                    })}
                    {(() => {
                      const v = r.value(total)
                      return (
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 800, color: r.negativeColor ? (v >= 0 ? '#22C55E' : '#EF4444') : '#F15A22' }}>{fmt(v)}</td>
                      )
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && total.pending > 0 && (
        <p style={{ color: '#F59E0B', fontSize: 12, margin: '14px 0 0' }}>
          {total.pending} expense line{total.pending === 1 ? '' : 's'} this month still need a figure, so costs above are understated until they are filled in.
        </p>
      )}
      <p style={{ color: '#4A4A4A', fontSize: 12, margin: '10px 0 0', lineHeight: 1.6 }}>
        Net profit = revenue − parts cost − OPEX − CAPEX, the same basis as the Expenses page. Shared / HQ holds expenses recorded without a branch (for example a technician wage paid from the Hub, or van servicing done by the Car Division) and any invoice without a branch.
      </p>
    </div>
  )
}
