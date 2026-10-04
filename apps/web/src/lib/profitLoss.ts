import { supabase } from '@/lib/supabase'
import { addDays, fetchAll, parseYmd, toYmd } from '@/lib/weeklyReport'

// Management Profit & Loss for any date range, one column per month.
//  - Revenue: invoices by issue date (void/draft excluded), so a van job counts
//    when it is completed. Split into parts, labour, other charges, and
//    discounts/adjustments so the lines add up to the invoice totals.
//  - Cost of sales: cost price x qty of part lines only.
//  - Expenses: each belongs to the month of its expense_date and is spread
//    evenly over that month's days, so part-month columns carry their share.
//  - CAPEX is charged in full, as agreed, and net = gross profit - OPEX - CAPEX.

export interface PnlCol {
  label: string
  start: string
  end: string
  tx: number
  revenueParts: number
  revenueLabour: number
  revenueOther: number
  adjustments: number
  revenue: number
  carRevenue: number
  bikeRevenue: number
  cogs: number
  gp: number
  gpPct: number
  opex: Record<string, number>
  opexTotal: number
  capex: Record<string, number>
  capexTotal: number
  operatingProfit: number
  net: number
  netPct: number
}

export interface PnlData {
  tenantName: string
  logoUrl: string | null
  branchLabel: string
  start: string
  end: string
  columns: PnlCol[]
  total: PnlCol
  previous: PnlCol
  opexCategories: string[]
  capexCategories: string[]
  warnings: string[]
  generatedAt: string
}

interface LineItem { item_type?: string; qty?: number; unit_price?: number; amount?: number; cost_price?: number | null }
interface RawInvoice { issue_date: string; total_amount: number | null; vehicle_plate: string | null; line_items: LineItem[] | null }
interface RawExpense { expense_date: string; type: 'opex' | 'capex'; category: string | null; amount: number | null }

export interface PnlInput {
  tenantName: string
  logoUrl: string | null
  branchLabel: string
  start: string
  end: string
  invoices: RawInvoice[]
  expenses: RawExpense[]
  bikePlates: Set<string>
}

const pad = (n: number) => String(n).padStart(2, '0')
const monthKey = (s: string) => s.slice(0, 7)
const daysInMonth = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate() }
const lastOfMonth = (s: string) => `${monthKey(s)}-${pad(daysInMonth(monthKey(s)))}`
const diffDays = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000)
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plateKey = (p: string | null) => (p ?? '').replace(/\s+/g, '').toUpperCase()

export const fmtDay = (s: string) => { const d = parseYmd(s); return `${d.getDate()} ${SHORT[d.getMonth()]} ${d.getFullYear()}` }

function monthLabel(key: string, start: string, end: string, full: boolean) {
  const base = `${SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
  if (full) return base
  const a = parseYmd(start).getDate(), b = parseYmd(end).getDate()
  return `${base} (${a === b ? a : `${a}-${b}`})`
}

function lineAmount(li: LineItem) {
  return Number(li.amount ?? (li.qty ?? 1) * (li.unit_price ?? 0))
}

function buildCol(label: string, start: string, end: string, inp: PnlInput): PnlCol {
  const c: PnlCol = {
    label, start, end, tx: 0, revenueParts: 0, revenueLabour: 0, revenueOther: 0, adjustments: 0, revenue: 0,
    carRevenue: 0, bikeRevenue: 0, cogs: 0, gp: 0, gpPct: 0, opex: {}, opexTotal: 0, capex: {}, capexTotal: 0,
    operatingProfit: 0, net: 0, netPct: 0,
  }
  for (const inv of inp.invoices) {
    const total = Number(inv.total_amount ?? 0)
    if (!(total > 0) || inv.issue_date < start || inv.issue_date > end) continue
    let parts = 0, labour = 0, other = 0
    for (const li of inv.line_items ?? []) {
      const amt = lineAmount(li)
      if (li.item_type === 'part') {
        parts += amt
        if (li.cost_price != null) c.cogs += Number(li.cost_price) * (li.qty ?? 1)
      } else if (li.item_type === 'labour') labour += amt
      else other += amt
    }
    c.tx += 1
    c.revenueParts += parts; c.revenueLabour += labour; c.revenueOther += other
    c.adjustments += total - (parts + labour + other)   // invoice-level discounts, tax and rounding
    c.revenue += total
    if (inp.bikePlates.has(plateKey(inv.vehicle_plate))) c.bikeRevenue += total
    else c.carRevenue += total
  }
  // expenses: the share of each month's amount that falls inside [start, end]
  for (const e of inp.expenses) {
    if (e.amount == null) continue
    const k = monthKey(e.expense_date)
    const mStart = `${k}-01`, mEnd = lastOfMonth(mStart)
    const from = start > mStart ? start : mStart
    const to = end < mEnd ? end : mEnd
    if (from > to) continue
    const share = (diffDays(from, to) + 1) / daysInMonth(k)
    const cat = (e.category ?? '').trim() || 'Uncategorised'
    const bucket = e.type === 'capex' ? c.capex : c.opex
    bucket[cat] = (bucket[cat] ?? 0) + Number(e.amount) * share
  }
  c.opexTotal = Object.values(c.opex).reduce((a, b) => a + b, 0)
  c.capexTotal = Object.values(c.capex).reduce((a, b) => a + b, 0)
  c.gp = c.revenue - c.cogs
  c.gpPct = c.revenue > 0 ? (c.gp / c.revenue) * 100 : 0
  c.operatingProfit = c.gp - c.opexTotal
  c.net = c.operatingProfit - c.capexTotal
  c.netPct = c.revenue > 0 ? (c.net / c.revenue) * 100 : 0
  return c
}

export function computePnl(inp: PnlInput): PnlData {
  const columns: PnlCol[] = []
  for (let cur = inp.start; cur <= inp.end; ) {
    const monthEnd = lastOfMonth(cur)
    const segEnd = monthEnd < inp.end ? monthEnd : inp.end
    const full = cur === `${monthKey(cur)}-01` && segEnd === monthEnd
    columns.push(buildCol(monthLabel(monthKey(cur), cur, segEnd, full), cur, segEnd, inp))
    cur = addDays(segEnd, 1)
  }
  const total = buildCol('Total', inp.start, inp.end, inp)
  const len = diffDays(inp.start, inp.end) + 1
  const prevEnd = addDays(inp.start, -1)
  const prevStart = addDays(prevEnd, -(len - 1))
  const previous = buildCol('Previous period', prevStart, prevEnd, inp)

  const cats = (pick: (c: PnlCol) => Record<string, number>) => {
    const t = new Map<string, number>()
    for (const c of [...columns, previous]) for (const [k, v] of Object.entries(pick(c))) t.set(k, (t.get(k) ?? 0) + v)
    return [...t.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }

  const warnings: string[] = []
  const pending = inp.expenses.filter(e => e.amount == null && monthKey(e.expense_date) >= monthKey(inp.start) && monthKey(e.expense_date) <= monthKey(inp.end)).length
  if (pending > 0) warnings.push(`${pending} expense line${pending === 1 ? '' : 's'} in this range still have no figure, so expenses are understated.`)
  const noCost = inp.invoices.filter(i => i.issue_date >= inp.start && i.issue_date <= inp.end)
    .reduce((n, i) => n + (i.line_items ?? []).filter(li => li.item_type === 'part' && (li.cost_price == null || Number(li.cost_price) === 0)).length, 0)
  if (noCost > 0) warnings.push(`${noCost} part line${noCost === 1 ? '' : 's'} have no cost price and count as zero cost, so gross profit is overstated.`)
  if (inp.end > toYmd(new Date())) warnings.push('The range includes days that have not happened yet; expenses for those days are still counted.')

  return {
    tenantName: inp.tenantName, logoUrl: inp.logoUrl, branchLabel: inp.branchLabel, start: inp.start, end: inp.end,
    columns, total, previous, opexCategories: cats(c => c.opex), capexCategories: cats(c => c.capex), warnings, generatedAt: new Date().toISOString(),
  }
}

export async function loadPnl(p: {
  tenantId: string; tenantName: string; logoUrl: string | null; branchId: string | null; branchLabel: string; start: string; end: string
}): Promise<PnlData> {
  const len = diffDays(p.start, p.end) + 1
  const prevStart = addDays(p.start, -len)
  const from = prevStart
  const [invoices, expenses, bikes] = await Promise.all([
    fetchAll<RawInvoice>((a, b) => {
      let q = supabase.from('invoices').select('issue_date, total_amount, vehicle_plate, line_items')
        .eq('tenant_id', p.tenantId).gte('issue_date', from).lte('issue_date', p.end).neq('status', 'void').neq('status', 'draft').order('issue_date').range(a, b)
      if (p.branchId) q = q.eq('branch_id', p.branchId)
      return q as unknown as PromiseLike<{ data: RawInvoice[] | null; error: unknown }>
    }),
    fetchAll<RawExpense>((a, b) => {
      let q = supabase.from('expenses').select('expense_date, type, category, amount')
        .eq('tenant_id', p.tenantId).gte('expense_date', `${monthKey(from)}-01`).lte('expense_date', p.end).order('expense_date').range(a, b)
      if (p.branchId) q = q.eq('branch_id', p.branchId)
      return q as unknown as PromiseLike<{ data: RawExpense[] | null; error: unknown }>
    }),
    fetchAll<{ plate_number: string }>((a, b) =>
      supabase.from('vehicles').select('plate_number').eq('tenant_id', p.tenantId).eq('vehicle_type', 'bike').range(a, b)),
  ])
  return computePnl({
    tenantName: p.tenantName, logoUrl: p.logoUrl, branchLabel: p.branchLabel, start: p.start, end: p.end,
    invoices, expenses, bikePlates: new Set(bikes.map(v => plateKey(v.plate_number))),
  })
}
