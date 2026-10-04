import { supabase } from '@/lib/supabase'

// Weekly Report numbers. Definitions agreed with the owner:
//  - Sales: invoices by issue date, excluding void/draft, paid or not.
//  - COGS: cost of part lines only (cost_price x qty). Labour is not a cost.
//  - OPEX / CAPEX: each expense belongs to the month of its expense_date and
//    is spread evenly over that month's days, so weeks that straddle two
//    months and part-weeks come out right.
//  - Net profit = gross profit - OPEX - CAPEX.
//  - Transactions: number of invoices. Weeks run Monday to Sunday.

export type ReportMode = 'week' | 'month' | 'custom'

export interface ReportCol {
  label: string
  partOf: string | null   // full Mon-Sun week this column was cut from, when it is shorter than a week
  start: string
  end: string
  days: number            // working days (Mon-Sat) that have happened in the range
  sales: number
  cogs: number
  gp: number
  gpPct: number
  opex: number
  capex: number
  net: number
  tx: number
  avgPerTx: number
  fleetSales: number
  walkinSales: number
  fleetTx: number
  walkinTx: number
  carSales: number
  carCogs: number
  bikeSales: number
  bikeCogs: number
}

// What the comparison tiles measure themselves against. The choice is printed
// on each tile, so a reader always sees the basis.
export interface ReportBasis {
  month: 'prev' | 'goal'            // revenue tile: previous month (like for like) or the monthly goal's pace
  gp: 'prev' | 'avg4' | 'target'    // GP %: previous period, average of the last 4, or the target GP %
  tx: 'prev' | 'avg4'               // customer count
  avg: 'prev' | 'avg4'              // average sales per customer
}
export const DEFAULT_BASIS: ReportBasis = { month: 'prev', gp: 'prev', tx: 'prev', avg: 'prev' }

export interface ReportTiles {
  monthLabelPrev: string
  monthLabelThis: string
  monthHeader: string
  monthSalesPrev: number
  monthSalesThis: number
  gpPctPrev: number
  gpPctThis: number
  costs: number           // OPEX + CAPEX for the period
  gp: number
  surplus: number
  salesTarget: number
  salesActual: number
  targetAchievement: number
  walkinShare: number
  fleetShare: number
  walkinShareChangePts: number
  gpBaseLabel: string
  txBaseLabel: string
  avgBaseLabel: string
  arTotal: number
  arCount: number
  arOverdue: number
  arFleet: number
  apTotal: number
  apCount: number
  apOverdue: number
  collInvoiced: number
  collPaid: number
  collRate: number
  collRatePrev: number
  collOutstanding: number
  collOutstandingCount: number
  txPrev: number
  txThis: number
  avgPrev: number
  avgThis: number
  perDayActual: number
  perDayTarget: number
  perDayAchievement: number
}

export interface ReportWord { word: string; caption: string }

// Summary numbers for one stretch of days. A chosen period that crosses a month
// end gets one section per month, so each part has its own panel and tiles.
export interface ReportSection {
  periodLabel: string
  prevLabel: string
  partOf: string | null
  period: ReportCol
  previous: ReportCol
  gpRange: { low: number; high: number; avg: number }
  tiles: ReportTiles
  words: ReportWord[]
}

export interface ReportData {
  version: 1
  tenantName: string
  branchLabel: string
  mode: ReportMode
  periodStart: string
  periodEnd: string
  periodLabel: string
  prevLabel: string
  generatedAt: string
  columns: ReportCol[]
  total: ReportCol
  period: ReportCol
  previous: ReportCol
  gpRange: { low: number; high: number; avg: number }
  historyWeeks: ReportCol[]
  historyMonths: { label: string; sales: number; net: number }[]
  tiles: ReportTiles
  targets: { monthlyGoal: number; workingDaysMonth: number; targetGpPct: number }
  words: ReportWord[]
  warnings: string[]
  basis?: ReportBasis
  partOf?: string | null       // set on a per-section view of the report
  sections?: ReportSection[]   // absent in reports saved before this existed
}

export interface ReportSettings {
  monthly_sales_goal: number
  working_days_month: number
  target_gp_pct: number
  weekly_target_override: number | null
}

export const DEFAULT_SETTINGS: ReportSettings = {
  monthly_sales_goal: 120000, working_days_month: 26, target_gp_pct: 43, weekly_target_override: null,
}

// ── date helpers (local calendar dates as YYYY-MM-DD) ───────────────────
const pad = (n: number) => String(n).padStart(2, '0')
export const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s: string, n: number) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return toYmd(d) }
export const mondayOf = (s: string) => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toYmd(d) }
const monthKey = (s: string) => s.slice(0, 7)
const daysInMonth = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate() }
const firstOfMonth = (s: string) => `${monthKey(s)}-01`
const lastOfMonth = (s: string) => `${monthKey(s)}-${pad(daysInMonth(monthKey(s)))}`
const addMonths = (s: string, n: number) => { const d = parseYmd(firstOfMonth(s)); d.setMonth(d.getMonth() + n); return toYmd(d) }
const diffDays = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000)

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtShort = (s: string) => { const d = parseYmd(s); return `${d.getDate()} ${SHORT_MONTH[d.getMonth()]}` }
export const fmtRange = (a: string, b: string) => {
  if (a === b) return fmtShort(a)
  const da = parseYmd(a), db = parseYmd(b)
  return da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear()
    ? `${da.getDate()} - ${db.getDate()} ${SHORT_MONTH[db.getMonth()]}`
    : `${fmtShort(a)} - ${fmtShort(b)}`
}
const monthName = (key: string) => `${SHORT_MONTH[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`

// ── raw inputs ──────────────────────────────────────────────────────────
interface LineItem { item_type?: string; qty?: number; cost_price?: number | null }
export interface RawInvoice {
  issue_date: string; total_amount: number | null; is_internal_fleet: boolean
  vehicle_plate: string | null; line_items: LineItem[] | null; amount_paid?: number | null
}
// An unpaid customer or supplier invoice, as at the day the report is generated.
export interface OpenBalance { balance: number; due_date: string | null; fleet: boolean }
export interface RawExpense { expense_date: string; type: 'opex' | 'capex'; amount: number | null }

interface Inv { date: string; total: number; paid: number; cogs: number; fleet: boolean; bike: boolean }

const plateKey = (p: string | null) => (p ?? '').replace(/\s+/g, '').toUpperCase()

function prepareInvoices(raw: RawInvoice[], bikePlates: Set<string>): { invs: Inv[]; partsWithoutCost: Map<string, number> } {
  const partsWithoutCost = new Map<string, number>()
  const invs = raw.filter(r => (r.total_amount ?? 0) > 0).map(r => {
    let cogs = 0
    for (const li of r.line_items ?? []) {
      if (li.item_type !== 'part') continue
      if (li.cost_price == null || Number(li.cost_price) === 0) {
        partsWithoutCost.set(r.issue_date, (partsWithoutCost.get(r.issue_date) ?? 0) + 1)
        continue
      }
      cogs += Number(li.cost_price) * (li.qty ?? 1)
    }
    return { date: r.issue_date, total: Number(r.total_amount), paid: Math.min(Number(r.amount_paid ?? 0), Number(r.total_amount)), cogs, fleet: !!r.is_internal_fleet, bike: bikePlates.has(plateKey(r.vehicle_plate)) }
  })
  return { invs, partsWithoutCost }
}

function monthlyCosts(expenses: RawExpense[]) {
  const m = new Map<string, { opex: number; capex: number; pending: number }>()
  for (const e of expenses) {
    const k = monthKey(e.expense_date)
    const row = m.get(k) ?? { opex: 0, capex: 0, pending: 0 }
    if (e.amount == null) row.pending += 1
    else if (e.type === 'opex') row.opex += Number(e.amount)
    else row.capex += Number(e.amount)
    m.set(k, row)
  }
  return m
}

// Calendar days in [start,end], each carrying 1/daysInMonth of its month's costs.
function spreadCost(costs: Map<string, { opex: number; capex: number }>, start: string, end: string) {
  let opex = 0, capex = 0
  const n = diffDays(start, end)
  for (let i = 0; i <= n; i++) {
    const day = addDays(start, i)
    const k = monthKey(day)
    const c = costs.get(k)
    if (!c) continue
    const dim = daysInMonth(k)
    opex += c.opex / dim
    capex += c.capex / dim
  }
  return { opex, capex }
}

function workingDays(start: string, end: string, today: string) {
  const last = end > today ? today : end
  let n = 0
  for (let i = 0; i <= diffDays(start, last); i++) if (parseYmd(addDays(start, i)).getDay() !== 0) n++
  return n
}

function buildCol(label: string, start: string, end: string, invs: Inv[], costs: Map<string, { opex: number; capex: number }>, today: string, partOf: string | null = null): ReportCol {
  const rows = invs.filter(i => i.date >= start && i.date <= end)
  const sum = (f: (i: Inv) => number) => rows.reduce((s, i) => s + f(i), 0)
  const sales = sum(i => i.total), cogs = sum(i => i.cogs)
  const { opex, capex } = spreadCost(costs, start, end)
  const gp = sales - cogs
  const fleet = rows.filter(i => i.fleet), walk = rows.filter(i => !i.fleet)
  return {
    label, partOf, start, end, days: workingDays(start, end, today),
    sales, cogs, gp, gpPct: sales > 0 ? (gp / sales) * 100 : 0,
    opex, capex, net: gp - opex - capex,
    tx: rows.length, avgPerTx: rows.length ? sales / rows.length : 0,
    fleetSales: fleet.reduce((s, i) => s + i.total, 0), walkinSales: walk.reduce((s, i) => s + i.total, 0),
    fleetTx: fleet.length, walkinTx: walk.length,
    carSales: sum(i => (i.bike ? 0 : i.total)), carCogs: sum(i => (i.bike ? 0 : i.cogs)),
    bikeSales: sum(i => (i.bike ? i.total : 0)), bikeCogs: sum(i => (i.bike ? i.cogs : 0)),
  }
}

function totalCol(cols: ReportCol[], label: string): ReportCol {
  const t: ReportCol = { label, partOf: null, start: cols[0]?.start ?? '', end: cols[cols.length - 1]?.end ?? '', days: 0, sales: 0, cogs: 0, gp: 0, gpPct: 0, opex: 0, capex: 0, net: 0, tx: 0, avgPerTx: 0, fleetSales: 0, walkinSales: 0, fleetTx: 0, walkinTx: 0, carSales: 0, carCogs: 0, bikeSales: 0, bikeCogs: 0 }
  for (const c of cols) for (const k of Object.keys(t) as (keyof ReportCol)[]) if (typeof t[k] === 'number') (t[k] as number) += c[k] as number
  t.gpPct = t.sales > 0 ? (t.gp / t.sales) * 100 : 0
  t.avgPerTx = t.tx ? t.sales / t.tx : 0
  return t
}

export const pctChange = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : 0)

export interface ComputeInput {
  tenantName: string
  branchLabel: string
  mode: ReportMode
  start: string          // period start (week: its Monday)
  end: string            // period end
  invoices: RawInvoice[]
  expenses: RawExpense[]
  bikePlates: Set<string>
  settings: ReportSettings
  receivables?: OpenBalance[]
  payables?: OpenBalance[]
  basis?: ReportBasis
  today: string
}

export function computeReport(inp: ComputeInput): ReportData {
  const { invs, partsWithoutCost } = prepareInvoices(inp.invoices, inp.bikePlates)
  const monthly = monthlyCosts(inp.expenses)
  const costs = monthly
  const today = inp.today
  const warnings: string[] = []

  // table columns: Monday-Sunday weeks, cut at the 1st / end of each month so a
  // week that straddles two months shows as two columns
  const weeks: { start: string; end: string }[] = []
  if (inp.mode === 'week') {
    for (let i = 3; i >= 0; i--) { const s = addDays(inp.start, -7 * i); weeks.push({ start: s, end: addDays(s, 6) }) }
  } else {
    for (let s = mondayOf(inp.start); s <= inp.end; s = addDays(s, 7)) weeks.push({ start: s, end: addDays(s, 6) })
  }
  const cappedWeeks = weeks.length > 10 ? weeks.slice(-10) : weeks
  const columns: ReportCol[] = []
  for (const w of cappedWeeks) {
    const lo = inp.mode === 'week' || w.start >= inp.start ? w.start : inp.start
    const hi = inp.mode === 'week' || w.end <= inp.end ? w.end : inp.end
    for (let cur = lo; cur <= hi; ) {
      const segEnd = lastOfMonth(cur) < hi ? lastOfMonth(cur) : hi
      const partial = cur !== w.start || segEnd !== w.end
      columns.push(buildCol(fmtRange(cur, segEnd), cur, segEnd, invs, costs, today, partial ? fmtRange(w.start, w.end) : null))
      cur = addDays(segEnd, 1)
    }
  }
  const total = totalCol(columns, inp.mode === 'week' ? 'TOTAL (4 weeks)' : 'TOTAL')

  // history charts: up to 9 weeks ending with the week of the period end, and months with data
  const lastWeekStart = mondayOf(inp.end)
  const historyWeeks: ReportCol[] = []
  for (let i = 8; i >= 0; i--) { const s = addDays(lastWeekStart, -7 * i); historyWeeks.push(buildCol(fmtRange(s, addDays(s, 6)), s, addDays(s, 6), invs, costs, today)) }
  const firstData = invs.length ? invs.reduce((m, i) => (i.date < m ? i.date : m), invs[0].date) : inp.end
  let mStart = firstOfMonth(firstData)
  const endMonthStart = firstOfMonth(inp.end)
  if (diffDays(mStart, endMonthStart) > 31 * 11) mStart = addMonths(endMonthStart, -11)
  const historyMonths: ReportData['historyMonths'] = []
  for (let s = mStart; s <= endMonthStart; s = addMonths(s, 1)) {
    const k = monthKey(s)
    const rows = invs.filter(i => monthKey(i.date) === k)
    const sales = rows.reduce((a, i) => a + i.total, 0)
    const cogs = rows.reduce((a, i) => a + i.cogs, 0)
    // a month still in progress is charged only for the days up to the period end
    const partial = k === monthKey(inp.end) && inp.end < lastOfMonth(inp.end)
    const c = partial ? spreadCost(costs, s, inp.end) : (monthly.get(k) ?? { opex: 0, capex: 0 })
    historyMonths.push({ label: partial ? `${monthName(k)} (to ${parseYmd(inp.end).getDate()})` : monthName(k), sales, net: sales - cogs - c.opex - c.capex })
  }

  const st = inp.settings
  const basis = inp.basis ?? DEFAULT_BASIS
  const unit = inp.mode === 'week' ? 'week' : inp.mode === 'month' ? 'month' : 'period'

  // Summary numbers (panel, tiles, words) for one stretch of days, compared with
  // another stretch of the same shape.
  function makeSection(secStart: string, secEnd: string, prevStart: string, prevEnd: string, prevLabel: string, partOf: string | null): ReportSection {
    const period = buildCol(fmtRange(secStart, secEnd), secStart, secEnd, invs, costs, today)
    const previous = buildCol(fmtRange(prevStart, prevEnd), prevStart, prevEnd, invs, costs, today)

    // per-invoice margin spread (10th to 90th percentile) for the "GP range" line
    const margins = invs.filter(i => i.date >= secStart && i.date <= secEnd && i.cogs > 0).map(i => ((i.total - i.cogs) / i.total) * 100).sort((x, y) => x - y)
    const q = (pp: number) => (margins.length ? margins[Math.min(margins.length - 1, Math.floor(pp * margins.length))] : 0)
    const gpRange = { low: q(0.1), high: q(0.9), avg: period.gpPct }

    // the four periods just before this one, for the "4-period average" baseline
    const prior: ReportCol[] = []
    for (let k = 1; k <= 4; k++) {
      let ps: string, pe: string
      if (inp.mode === 'week') { ps = addDays(secStart, -7 * k); pe = addDays(secEnd, -7 * k) }
      else if (inp.mode === 'month') { ps = addMonths(secStart, -k); pe = lastOfMonth(ps) }
      else { const len = diffDays(secStart, secEnd) + 1; ps = addDays(secStart, -len * k); pe = addDays(ps, len - 1) }
      prior.push(buildCol(fmtRange(ps, pe), ps, pe, invs, costs, today))
    }
    const priorTotal = totalCol(prior, 'avg4')
    const unitName = inp.mode === 'week' ? 'week' : inp.mode === 'month' ? 'month' : 'period'
    const avg4Label = `4-${unitName} avg`
    const prevCapLabel = prevLabel.charAt(0).toUpperCase() + prevLabel.slice(1)

    const gpBase = basis.gp === 'avg4' ? priorTotal.gpPct : basis.gp === 'target' ? st.target_gp_pct : previous.gpPct
    const gpBaseLabel = basis.gp === 'avg4' ? avg4Label : basis.gp === 'target' ? 'Target GP' : prevCapLabel
    const txBase = basis.tx === 'avg4' ? priorTotal.tx / 4 : previous.tx
    const txBaseLabel = basis.tx === 'avg4' ? avg4Label : prevCapLabel
    const avgBase = basis.avg === 'avg4' ? priorTotal.avgPerTx : previous.avgPerTx
    const avgBaseLabel = basis.avg === 'avg4' ? avg4Label : prevCapLabel

    // collections: how much of what was invoiced has been paid
    const inRange = (a: string, b: string) => invs.filter(i => i.date >= a && i.date <= b)
    const collOf = (rows: Inv[]) => { const t = rows.reduce((x, i) => x + i.total, 0), p = rows.reduce((x, i) => x + i.paid, 0); return { t, p, rate: t > 0 ? (p / t) * 100 : 0 } }
    const collNow = collOf(inRange(secStart, secEnd)), collPrev = collOf(inRange(prevStart, prevEnd))
    const ar = inp.receivables ?? [], ap = inp.payables ?? []
    const sumOf = (rows: OpenBalance[]) => rows.reduce((x, r) => x + r.balance, 0)
    const late = (rows: OpenBalance[]) => rows.filter(r => r.due_date && r.due_date < today)
    const unpaid = inRange(secStart, secEnd).filter(i => i.total - i.paid > 0.009)

    const thisMonthStart = firstOfMonth(secEnd), prevMonthStart = addMonths(secEnd, -1)
    // when the month is still in progress, compare the same days of both months
    const partialMonth = secEnd < lastOfMonth(secEnd)
    const dayNo = parseYmd(secEnd).getDate()
    const prevMonthEnd = partialMonth ? `${monthKey(prevMonthStart)}-${pad(Math.min(dayNo, daysInMonth(monthKey(prevMonthStart))))}` : lastOfMonth(prevMonthStart)
    const monthSalesThis = invs.filter(i => i.date >= thisMonthStart && i.date <= secEnd).reduce((a, i) => a + i.total, 0)
    const prevMonthSales = invs.filter(i => i.date >= prevMonthStart && i.date <= prevMonthEnd).reduce((a, i) => a + i.total, 0)
    // goal pace: the monthly goal prorated by working days elapsed so far in the month
    const goalPace = (st.monthly_sales_goal * workingDays(thisMonthStart, secEnd, today)) / st.working_days_month
    const monthSalesPrev = basis.month === 'goal' ? goalPace : prevMonthSales
    const monthTag = partialMonth ? ` (1-${dayNo})` : ''
    const periodDays = diffDays(secStart, secEnd) + 1
    const costsTotal = period.opex + period.capex
    const salesTarget = st.weekly_target_override != null
      ? (st.weekly_target_override * periodDays) / 7
      : costsTotal / (st.target_gp_pct / 100)
    const dailyTarget = st.monthly_sales_goal / st.working_days_month
    const perDayActual = period.days ? period.sales / period.days : 0
    const share = (c: ReportCol, f: boolean) => (c.sales ? ((f ? c.fleetSales : c.walkinSales) / c.sales) * 100 : 0)
    const tiles: ReportTiles = {
      monthLabelPrev: basis.month === 'goal' ? 'Goal pace' : monthName(monthKey(prevMonthStart)) + monthTag, monthLabelThis: monthName(monthKey(thisMonthStart)) + monthTag,
      monthHeader: (basis.month === 'goal'
        ? `${SHORT_MONTH[Number(monthKey(thisMonthStart).slice(5, 7)) - 1]} SALES VS GOAL PACE`
        : `${SHORT_MONTH[Number(monthKey(prevMonthStart).slice(5, 7)) - 1]} VS ${SHORT_MONTH[Number(monthKey(thisMonthStart).slice(5, 7)) - 1]} REVENUE${partialMonth ? ` (DAY 1-${dayNo})` : ''}`).toUpperCase(),
      monthSalesPrev, monthSalesThis,
      gpPctPrev: gpBase, gpPctThis: period.gpPct, gpBaseLabel, txBaseLabel, avgBaseLabel,
      arTotal: sumOf(ar), arCount: ar.length, arOverdue: sumOf(late(ar)), arFleet: sumOf(ar.filter(r => r.fleet)),
      apTotal: sumOf(ap), apCount: ap.length, apOverdue: sumOf(late(ap)),
      collInvoiced: collNow.t, collPaid: collNow.p, collRate: collNow.rate, collRatePrev: collPrev.rate, collOutstanding: collNow.t - collNow.p, collOutstandingCount: unpaid.length,
      costs: costsTotal, gp: period.gp, surplus: period.gp - costsTotal,
      salesTarget, salesActual: period.sales, targetAchievement: salesTarget ? (period.sales / salesTarget) * 100 : 0,
      walkinShare: share(period, false), fleetShare: share(period, true), walkinShareChangePts: share(period, false) - share(previous, false),
      txPrev: txBase, txThis: period.tx, avgPrev: avgBase, avgThis: period.avgPerTx,
      perDayActual, perDayTarget: dailyTarget, perDayAchievement: dailyTarget ? (perDayActual / dailyTarget) * 100 : 0,
    }
    const words: ReportWord[] = [
      period.net >= 0 ? { word: 'Profitable', caption: 'NET PROFIT AFTER OPEX & CAPEX' } : { word: 'Under pressure', caption: `NET LOSS THIS ${partOf ? 'PART OF THE WEEK' : unit.toUpperCase()}` },
      tiles.targetAchievement >= 100 ? { word: 'On target', caption: 'SALES TARGET MET' } : { word: 'Below target', caption: 'SALES TARGET NOT YET MET' },
      period.sales >= previous.sales ? { word: 'Growing', caption: `SALES UP ON ${prevLabel.toUpperCase()}` } : { word: 'Softer', caption: `SALES DOWN ON ${prevLabel.toUpperCase()}` },
      period.gpPct >= st.target_gp_pct ? { word: 'Healthy margins', caption: `GP ABOVE ${st.target_gp_pct}% TARGET` } : { word: 'Margin watch', caption: `GP BELOW ${st.target_gp_pct}% TARGET` },
      period.tx >= previous.tx ? { word: 'Busy', caption: 'TRAFFIC UP OR LEVEL' } : { word: 'Quieter', caption: 'FEWER JOBS THAN BEFORE' },
    ]
    return { periodLabel: fmtRange(secStart, secEnd), prevLabel, partOf, period, previous, gpRange, tiles, words }
  }

  // how each stretch is compared: week -> the same days a week earlier, month -> previous month,
  // custom -> the equally long stretch just before it
  function compareWith(secStart: string, secEnd: string): { ps: string; pe: string; label: string } {
    if (inp.mode === 'week') return { ps: addDays(secStart, -7), pe: addDays(secEnd, -7), label: 'previous week' }
    if (inp.mode === 'month') { const ps = addMonths(secStart, -1); return { ps, pe: lastOfMonth(ps), label: 'previous month' } }
    const len = diffDays(secStart, secEnd) + 1
    const pe = addDays(secStart, -1)
    return { ps: addDays(pe, -(len - 1)), pe, label: 'previous period' }
  }

  // the chosen period as a whole, and one section per calendar month it touches
  const whole = compareWith(inp.start, inp.end)
  const overall = makeSection(inp.start, inp.end, whole.ps, whole.pe, whole.label, null)
  const sections: ReportSection[] = []
  for (let cur = inp.start; cur <= inp.end; ) {
    const segEnd = lastOfMonth(cur) < inp.end ? lastOfMonth(cur) : inp.end
    const cmp = compareWith(cur, segEnd)
    sections.push(makeSection(cur, segEnd, cmp.ps, cmp.pe, cmp.label, cur !== inp.start || segEnd !== inp.end ? fmtRange(inp.start, inp.end) : null))
    cur = addDays(segEnd, 1)
  }
  const { period, previous, gpRange, tiles, words, prevLabel } = overall
  const prevStart = whole.ps

  // data-quality warnings
  const pending = [...monthly.entries()].filter(([k]) => k >= monthKey(prevStart) && k <= monthKey(inp.end)).reduce((a, [, v]) => a + v.pending, 0)
  if (pending > 0) warnings.push(`${pending} expense line${pending === 1 ? '' : 's'} in these months still have no figure, so OPEX is understated.`)
  const noCost = [...partsWithoutCost.entries()].filter(([d]) => d >= prevStart && d <= inp.end).reduce((a, [, n]) => a + n, 0)
  if (noCost > 0) warnings.push(`${noCost} part line${noCost === 1 ? '' : 's'} have no cost price and count as zero cost, so gross profit is overstated.`)
  if (inp.end > today) warnings.push('The period includes days that have not happened yet.')

  return {
    version: 1, tenantName: inp.tenantName, branchLabel: inp.branchLabel, mode: inp.mode,
    periodStart: period.start, periodEnd: period.end, periodLabel: fmtRange(period.start, period.end), prevLabel,
    generatedAt: new Date().toISOString(), columns, total, period, previous, gpRange,
    historyWeeks, historyMonths, tiles, targets: { monthlyGoal: st.monthly_sales_goal, workingDaysMonth: st.working_days_month, targetGpPct: st.target_gp_pct },
    words, warnings, sections, basis,
  }
}

// ── loading ─────────────────────────────────────────────────────────────
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function loadSettings(tenantId: string): Promise<ReportSettings> {
  const { data } = await supabase.from('report_settings').select('monthly_sales_goal, working_days_month, target_gp_pct, weekly_target_override').eq('tenant_id', tenantId).maybeSingle()
  return data ? {
    monthly_sales_goal: Number(data.monthly_sales_goal), working_days_month: Number(data.working_days_month),
    target_gp_pct: Number(data.target_gp_pct), weekly_target_override: data.weekly_target_override == null ? null : Number(data.weekly_target_override),
  } : DEFAULT_SETTINGS
}

export async function loadReportInput(p: {
  tenantId: string; tenantName: string; branchId: string | null; branchLabel: string
  mode: ReportMode; start: string; end: string
}): Promise<ComputeInput> {
  const today = toYmd(new Date())
  // enough history for the charts: 12 months before the period end, and always the previous comparison period
  const from = addMonths(p.end, -12)
  const [invoices, expenses, vehicles, settings, openInv, openSup] = await Promise.all([
    fetchAll<RawInvoice>((a, b) => {
      let q = supabase.from('invoices').select('issue_date, total_amount, amount_paid, is_internal_fleet, vehicle_plate, line_items')
        .eq('tenant_id', p.tenantId).gte('issue_date', from).lte('issue_date', p.end).neq('status', 'void').neq('status', 'draft').order('issue_date').range(a, b)
      if (p.branchId) q = q.eq('branch_id', p.branchId)
      return q as unknown as PromiseLike<{ data: RawInvoice[] | null; error: unknown }>
    }),
    fetchAll<RawExpense>((a, b) => {
      let q = supabase.from('expenses').select('expense_date, type, amount').eq('tenant_id', p.tenantId).gte('expense_date', from).lte('expense_date', p.end).order('expense_date').range(a, b)
      if (p.branchId) q = q.eq('branch_id', p.branchId)
      return q as unknown as PromiseLike<{ data: RawExpense[] | null; error: unknown }>
    }),
    fetchAll<{ plate_number: string; vehicle_type: string | null }>((a, b) =>
      supabase.from('vehicles').select('plate_number, vehicle_type').eq('tenant_id', p.tenantId).eq('vehicle_type', 'bike').range(a, b)),
    loadSettings(p.tenantId),
    // everything still unpaid today, whatever its date
    fetchAll<{ balance_due: number | null; due_date: string | null; is_internal_fleet: boolean }>((a, b) => {
      let q = supabase.from('invoices').select('balance_due, due_date, is_internal_fleet').eq('tenant_id', p.tenantId)
        .neq('status', 'void').neq('status', 'draft').gt('balance_due', 0).order('issue_date').range(a, b)
      if (p.branchId) q = q.eq('branch_id', p.branchId)
      return q as unknown as PromiseLike<{ data: { balance_due: number | null; due_date: string | null; is_internal_fleet: boolean }[] | null; error: unknown }>
    }),
    fetchAll<{ total_amount: number; amount_paid: number | null; due_date: string | null }>((a, b) => {
      let q = supabase.from('supplier_invoices').select('total_amount, amount_paid, due_date').eq('tenant_id', p.tenantId)
        .is('voided_at', null).neq('status', 'paid').order('invoice_date').range(a, b)
      if (p.branchId) q = q.eq('branch_id', p.branchId)
      return q as unknown as PromiseLike<{ data: { total_amount: number; amount_paid: number | null; due_date: string | null }[] | null; error: unknown }>
    }),
  ])
  return {
    tenantName: p.tenantName, branchLabel: p.branchLabel, mode: p.mode, start: p.start, end: p.end,
    invoices, expenses, bikePlates: new Set(vehicles.map(v => plateKey(v.plate_number))), settings, today,
    receivables: openInv.map(i => ({ balance: Number(i.balance_due), due_date: i.due_date, fleet: !!i.is_internal_fleet })),
    payables: openSup.map(i => ({ balance: Number(i.total_amount) - Number(i.amount_paid ?? 0), due_date: i.due_date, fleet: false })).filter(i => i.balance > 0.009),
  }
}
