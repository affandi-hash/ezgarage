import { useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import { addDays, parseYmd, toYmd } from '@/lib/weeklyReport'
import { fmtDay, loadPnl, type PnlCol, type PnlColumns, type PnlData } from '@/lib/profitLoss'

const C = { surface: '#1E1E1E', border: '#2A2A2A', orange: '#F15A22', text: '#F0F0F0', muted: '#A0A0A0', green: '#22C55E', red: '#EF4444' }

type Preset = 'this_month' | 'last_month' | 'last_3' | 'ytd' | 'last_year' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_3', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_year', label: 'Last year' },
  { id: 'custom', label: 'Custom range' },
]

function presetRange(p: Preset): { start: string; end: string } {
  const now = new Date()
  const today = toYmd(now)
  const y = now.getFullYear(), m = now.getMonth()
  const ymd = (yy: number, mm: number, dd: number) => toYmd(new Date(yy, mm, dd))
  switch (p) {
    case 'this_month': return { start: ymd(y, m, 1), end: today }
    case 'last_month': return { start: ymd(y, m - 1, 1), end: ymd(y, m, 0) }
    case 'last_3': return { start: ymd(y, m - 3, 1), end: ymd(y, m, 0) }
    case 'ytd': return { start: ymd(y, 0, 1), end: today }
    case 'last_year': return { start: ymd(y - 1, 0, 1), end: ymd(y - 1, 11, 31) }
    default: return { start: ymd(y, m, 1), end: today }
  }
}

interface Row {
  label: string
  kind: 'header' | 'line' | 'total' | 'grand' | 'memo' | 'pct'
  get?: (c: PnlCol) => number
  pct?: boolean
}

function buildRows(d: PnlData): Row[] {
  const rows: Row[] = [
    { label: 'Revenue', kind: 'header' },
    { label: 'Parts sales', kind: 'line', get: c => c.revenueParts },
    { label: 'Labour', kind: 'line', get: c => c.revenueLabour },
    { label: 'Other charges', kind: 'line', get: c => c.revenueOther },
    { label: 'Discounts and adjustments', kind: 'line', get: c => c.adjustments },
    { label: 'Total revenue', kind: 'total', get: c => c.revenue },
    { label: 'of which Car division', kind: 'memo', get: c => c.carRevenue },
    { label: 'of which Bike division', kind: 'memo', get: c => c.bikeRevenue },
    { label: 'Invoices issued', kind: 'memo', get: c => c.tx, pct: false },
    { label: 'Cost of sales', kind: 'header' },
    { label: 'Parts cost', kind: 'line', get: c => c.cogs },
    { label: 'Gross profit', kind: 'total', get: c => c.gp },
    { label: 'Gross margin %', kind: 'pct', get: c => c.gpPct },
    { label: 'Operating expenses', kind: 'header' },
    ...d.opexCategories.map(cat => ({ label: cat, kind: 'line' as const, get: (c: PnlCol) => c.opex[cat] ?? 0 })),
    { label: 'Total operating expenses', kind: 'total', get: c => c.opexTotal },
    { label: 'Operating profit', kind: 'total', get: c => c.operatingProfit },
  ]
  if (d.capexCategories.length > 0) {
    rows.push({ label: 'Capital expenditure', kind: 'header' })
    for (const cat of d.capexCategories) rows.push({ label: cat, kind: 'line', get: c => c.capex[cat] ?? 0 })
  }
  rows.push({ label: 'Total capital expenditure', kind: 'total', get: c => c.capexTotal })
  rows.push({ label: 'Net profit / (loss)', kind: 'grand', get: c => c.net })
  rows.push({ label: 'Net margin %', kind: 'pct', get: c => c.netPct })
  return rows
}

const money = (n: number) => {
  if (Math.abs(n) < 0.005) return '-'
  const s = Math.abs(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `(RM${s})` : `RM${s}`
}
const count = (n: number) => String(Math.round(n))
const pctStr = (n: number) => `${n.toFixed(1)}%`

function cell(r: Row, c: PnlCol): string {
  if (!r.get) return ''
  const v = r.get(c)
  if (r.kind === 'pct') return pctStr(v)
  if (r.kind === 'memo' && r.pct === false) return count(v)
  return money(v)
}

// change versus the previous period: a percentage for amounts, points for margins
function change(r: Row, cur: PnlCol, prev: PnlCol): string {
  if (!r.get) return ''
  const a = r.get(cur), b = r.get(prev)
  if (r.kind === 'pct') { const d = a - b; return Math.abs(d) < 0.05 ? '-' : `${d > 0 ? '+' : ''}${d.toFixed(1)} pts` }
  if (Math.abs(b) < 0.005) return Math.abs(a) < 0.005 ? '-' : 'new'
  const d = ((a - b) / Math.abs(b)) * 100
  return Math.abs(d) < 0.05 ? '-' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`
}

// Whether a rise is good news: costs rising is not.
const costRow = (r: Row) => r.label === 'Parts cost' || r.label === 'Total operating expenses' || r.label === 'Total capital expenditure' || (r.kind === 'line' && r.label !== 'Parts sales' && r.label !== 'Labour' && r.label !== 'Other charges' && r.label !== 'Discounts and adjustments')

function hasPrevious(d: PnlData) { return d.previous.tx > 0 || d.previous.opexTotal > 0 }

function printPnl(d: PnlData, rows: Row[], title: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const withPrev = hasPrevious(d)
  const cols = withPrev ? [...d.columns, d.total, d.previous] : [...d.columns, d.total]
  const head = `<tr><th></th>${cols.map(c => `<th>${esc(c.label)}${c.partOf ? `<br/><span style="font-weight:400;color:#777;font-size:8px">part of ${esc(c.partOf)}</span>` : ''}</th>`).join('')}${withPrev ? '<th>Change</th>' : ''}</tr>`
  const body = rows.map(r => {
    if (r.kind === 'header') return `<tr class="h"><td colspan="${cols.length + 2}">${esc(r.label)}</td></tr>`
    const cls = r.kind === 'total' ? 't' : r.kind === 'grand' ? 'g' : r.kind === 'memo' ? 'm' : r.kind === 'pct' ? 'p' : ''
    const tds = cols.map(c => {
      const neg = r.get && r.kind !== 'memo' && r.kind !== 'pct' && r.get(c) < -0.005 && (r.kind === 'grand' || r.kind === 'total') ? ' neg' : ''
      return `<td class="n${neg}">${cell(r, c)}</td>`
    }).join('')
    return `<tr class="${cls}"><td>${esc(r.label)}</td>${tds}${withPrev ? `<td class="n">${change(r, d.total, d.previous)}</td>` : ''}</tr>`
  }).join('')
  const logo = d.logoUrl ? `<img src="${esc(d.logoUrl)}" style="height:54px;width:auto"/>` : `<b style="font-size:22px;color:#F15A22">${esc(d.tenantName.toUpperCase())}</b>`
  w.document.open()
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A4 landscape; margin: 12mm } * { -webkit-print-color-adjust: exact; print-color-adjust: exact }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: ${cols.length > 14 ? 7 : cols.length > 12 ? 8 : cols.length > 9 ? 9 : 11}px; margin: 0 }
  .top { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px }
  .top .r { text-align:right; color:#555; font-size:11px; line-height:1.5 }
  h1 { background:#000; color:#fff; font-size:16px; margin:0 0 8px; padding:6px 10px }
  table { width:100%; border-collapse:collapse } th { text-align:right; padding:4px ${cols.length > 9 ? 3 : 6}px; border-bottom:1px solid #999; font-size:${cols.length > 14 ? 7 : 10}px }
  td { padding:${cols.length > 9 ? 2 : 3}px ${cols.length > 9 ? 3 : 6}px } td:first-child { white-space:nowrap } td.n { text-align:right; white-space:nowrap } tr.h td { background:#eee; font-weight:700; padding:3px 6px }
  tr.t td { font-weight:700; border-top:1px solid #999 } tr.g td { font-weight:800; border-top:2px solid #000; border-bottom:2px solid #000; font-size:1.1em }
  tr.m td { color:#666; font-style:italic } tr.p td { color:#666 } td.neg { color:#D32F2F }
  .note { margin-top:10px; color:#555; font-size:10px; line-height:1.5 } .warn { margin-top:8px; background:#FFF4CE; border:1px solid #E0B000; color:#6B4E00; padding:5px 8px; font-size:10px }
  </style></head><body>
  <div class="top">${logo}<div class="r"><b>${esc(d.branchLabel)}</b><br/>Generated ${esc(fmtDay(toYmd(new Date(d.generatedAt))))}</div></div>
  <h1>Profit &amp; Loss - ${esc(fmtDay(d.start))} to ${esc(fmtDay(d.end))}</h1>
  <table><thead>${head}</thead><tbody>${body}</tbody></table>
  ${d.warnings.map(x => `<div class="warn">${esc(x)}</div>`).join('')}
  <div class="note">Revenue is by invoice date; van (ON-SITE) jobs count when completed. Cost of sales is the cost of parts only, labour is not a cost of sales. Each month's expenses are spread evenly over its days, so part-month columns carry their share. Capital expenditure is charged in full. Brackets are negative.</div>
  </body></html>`)
  w.document.close()
  const go = () => setTimeout(() => { w.focus(); w.print() }, 400)
  w.addEventListener('load', go)
  if (w.document.readyState === 'complete') go()
  return true
}

const field: React.CSSProperties = { background: '#111', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, padding: '9px 12px', outline: 'none' }
const lab: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }

export function ProfitLossPage() {
  const user = useAuthStore(s => s.user)
  const tenant = useAuthStore(s => s.tenant)
  const tenantId = user?.tenant_id ?? ''

  const [preset, setPreset] = useState<Preset>('last_month')
  const [from, setFrom] = useState(presetRange('last_month').start)
  const [to, setTo] = useState(presetRange('last_month').end)
  const [branchId, setBranchId] = useState('')
  const [colChoice, setColChoice] = useState<'auto' | PnlColumns>('auto')
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<PnlData | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!tenantId) return
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).order('name').then(({ data: b }) => setBranches((b as { id: string; name: string }[]) ?? []))
  }, [tenantId])

  function pick(p: Preset) {
    setPreset(p)
    if (p !== 'custom') { const r = presetRange(p); setFrom(r.start); setTo(r.end) }
  }

  const spanDays = from && to ? (parseYmd(to).getTime() - parseYmd(from).getTime()) / 86400000 : 0
  // auto: a range of up to about 10 weeks shows week by week, anything longer month by month
  const colMode: PnlColumns = colChoice === 'auto' ? (spanDays <= 70 ? 'weeks' : 'months') : colChoice
  const valid = !!from && !!to && from <= to && spanDays <= (colMode === 'weeks' ? 190 : 740)

  useEffect(() => {
    if (!tenantId || !valid) return
    const mine = ++seq.current
    setLoading(true)
    loadPnl({
      tenantId, tenantName: tenant?.name ?? 'Motoverse Garage', logoUrl: tenant?.logo_url ?? null,
      branchId: branchId || null, branchLabel: branchId ? (branches.find(b => b.id === branchId)?.name ?? '') : 'All branches', start: from, end: to, columnMode: colMode,
    }).then(d => { if (mine === seq.current) setData(d) })
      .catch(e => toast(e instanceof Error ? e.message : 'Could not load the P&L', 'error'))
      .finally(() => { if (mine === seq.current) setLoading(false) })
  }, [tenantId, from, to, branchId, colMode, valid, tenant?.name, tenant?.logo_url, branches])

  const rows = useMemo(() => (data ? buildRows(data) : []), [data])
  const withPrev = data ? hasPrevious(data) : false
  const cols = data ? (withPrev ? [...data.columns, data.total, data.previous] : [...data.columns, data.total]) : []

  const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'right', fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}` }

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto', color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Profit &amp; Loss</h1>
          <p style={{ color: C.muted, fontSize: 13, margin: '4px 0 0' }}>Management P&amp;L for any date range, one column per month, compared with the period before.</p>
        </div>
        <button
          disabled={!data}
          onClick={() => data && !printPnl(data, rows, `Profit and Loss ${data.start} to ${data.end}`) && toast('Allow pop-ups to download the PDF', 'error')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, border: `1px solid ${C.orange}`, background: C.orange, color: '#fff', cursor: data ? 'pointer' : 'not-allowed', opacity: data ? 1 : 0.5 }}>
          <FileDown size={16} /> Download PDF
        </button>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <span style={lab}>Period</span>
          <select style={field} value={preset} onChange={e => pick(e.target.value as Preset)}>
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div><span style={lab}>From</span><input type="date" style={field} value={from} onChange={e => { setFrom(e.target.value); setPreset('custom') }} /></div>
        <div><span style={lab}>To</span><input type="date" style={field} value={to} onChange={e => { setTo(e.target.value); setPreset('custom') }} /></div>
        <div>
          <span style={lab}>Branch</span>
          <select style={field} value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <span style={lab}>Columns</span>
          <select style={field} value={colChoice} onChange={e => setColChoice(e.target.value as 'auto' | PnlColumns)}>
            <option value="auto">Automatic (weeks up to 10 weeks)</option>
            <option value="weeks">One per week (Mon-Sun)</option>
            <option value="months">One per month</option>
          </select>
        </div>
        {loading && <Loader2 size={20} className="animate-spin" style={{ color: C.orange, marginBottom: 8 }} />}
      </div>
      {!valid && <div style={{ color: '#F59E0B', fontSize: 13, marginBottom: 12 }}>{`Choose a valid range: the end after the start, up to about ${colMode === 'weeks' ? '26 weeks' : '2 years'}.`}</div>}
      {from > addDays(toYmd(new Date()), 0) && <div style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>This range starts in the future.</div>}

      {data && data.warnings.map(w => (
        <div key={w} style={{ border: '1px solid #F59E0B55', background: '#F59E0B14', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 }}>{w}</div>
      ))}

      {data && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflowX: 'auto', opacity: loading ? 0.6 : 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: C.surface }}>{fmtDay(data.start)} - {fmtDay(data.end)}</th>
                {cols.map((c, i) => <th key={i} style={{ ...th, color: c.label === 'Total' ? C.orange : C.muted, borderLeft: c.label === 'Total' ? `1px solid ${C.border}` : undefined }}>{c.label}{c.partOf && <div style={{ fontSize: 9, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#777' }}>{`part of ${c.partOf}`}</div>}</th>)}
                {withPrev && <th style={th}>Change</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                if (r.kind === 'header') {
                  return <tr key={i}><td colSpan={cols.length + 2} style={{ padding: '10px 12px 4px', fontSize: 11, fontWeight: 800, color: C.orange, textTransform: 'uppercase', letterSpacing: '0.06em', background: '#181818' }}>{r.label}</td></tr>
                }
                const strong = r.kind === 'total' || r.kind === 'grand'
                const muted = r.kind === 'memo' || r.kind === 'pct'
                const chg = change(r, data.total, data.previous)
                const up = chg.startsWith('+'), down = chg.startsWith('-') && chg !== '-'
                const good = costRow(r) ? down : up
                const bad = costRow(r) ? up : down
                return (
                  <tr key={i} style={{ background: r.kind === 'grand' ? '#262626' : strong ? '#222' : 'transparent', borderTop: strong ? `1px solid ${C.border}` : undefined }}>
                    <td style={{ padding: '8px 12px', paddingLeft: r.kind === 'line' || r.kind === 'memo' ? 24 : 12, fontSize: 13, fontWeight: strong ? 700 : 400, color: muted ? C.muted : C.text, fontStyle: r.kind === 'memo' ? 'italic' : undefined, position: 'sticky', left: 0, background: r.kind === 'grand' ? '#262626' : strong ? '#222' : C.surface, whiteSpace: 'nowrap' }}>{r.label}</td>
                    {cols.map((c, ci) => {
                      const v = r.get ? r.get(c) : 0
                      const neg = (r.kind === 'grand' || r.kind === 'total') && v < -0.005
                      return (
                        <td key={ci} style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: r.kind === 'grand' ? 14 : 13, fontWeight: strong ? 700 : 400, whiteSpace: 'nowrap',
                          color: neg ? C.red : r.kind === 'grand' && v > 0.005 ? C.green : muted ? C.muted : C.text, borderLeft: c.label === 'Total' ? `1px solid ${C.border}` : undefined }}>
                          {cell(r, c)}
                        </td>
                      )
                    })}
                    {withPrev && <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap', color: chg === '-' ? C.muted : good ? C.green : bad ? C.red : C.muted }}>{chg}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <p style={{ color: '#6A6A6A', fontSize: 12, lineHeight: 1.6, margin: '14px 0 0' }}>
          Revenue is by invoice date, and van (ON-SITE) jobs count when the job is completed. Cost of sales is parts cost only; labour is not a cost of sales. Each month's expenses are spread evenly over its days, so a part-month column carries its share. Capital expenditure is charged in full. Brackets are negative. {withPrev ? <>"Change" compares the Total column with the equally long period just before the range ({fmtDay(data.previous.start)} - {fmtDay(data.previous.end)}).</> : <>There is no data in the period before this range, so no comparison is shown.</>}
        </p>
      )}
    </div>
  )
}
