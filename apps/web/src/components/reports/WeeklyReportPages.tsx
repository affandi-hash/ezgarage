import type { CSSProperties, ReactNode } from 'react'
import { pctChange } from '@/lib/weeklyReport'
import type { ReportCol, ReportData, ReportWord } from '@/lib/weeklyReport'

// Renders the auto-generated Weekly Report as three A4-landscape pages.
// Everything is styled inline (and charts are inline SVG) so the markup can be
// cloned verbatim into a print window.

const FONT = 'Arial, Helvetica, sans-serif'
const BLUE = '#4285F4'
const RED = '#EA4335'
const GREEN = '#1E9E4A'
const ORANGE = '#F15A22'

// ── formatting ──────────────────────────────────────────────────────────
const num = (n: number) => (Number.isFinite(n) ? n : 0)
const grouped = (n: number, dp: number) =>
  Math.abs(num(n)).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

function money(n: number, dp = 2) {
  const body = grouped(n, dp)
  const isZero = Number(body.replace(/,/g, '')) === 0
  return `${num(n) < 0 && !isZero ? '-' : ''}RM${body}`
}

function pct(n: number, dp = 2) {
  const r = Number(num(n).toFixed(dp))
  return `${(r === 0 ? 0 : r).toFixed(dp)}%`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const unitOf = (mode: ReportData['mode']) => (mode === 'week' ? 'Week' : mode === 'month' ? 'Month' : 'Period')
const gpOf = (sales: number, cogs: number) => (sales > 0 ? ((sales - cogs) / sales) * 100 : 0)

function generatedOn(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

type Dir = 'up' | 'down' | 'flat'
const dirOf = (d: number): Dir => (d > 0.005 ? 'up' : d < -0.005 ? 'down' : 'flat')

// Relative change of cur vs prev as a ready-made sentence + arrow direction.
function compare(cur: number, prev: number, dp = 1): { dir: Dir; text: string } {
  if (!(prev > 0)) return { dir: cur > 0 ? 'up' : 'flat', text: cur > 0 ? 'No earlier figure to compare' : 'No data yet' }
  const d = pctChange(cur, prev)
  const abs = `${Math.abs(d).toFixed(dp)}%`
  return { dir: dirOf(d), text: d > 0.005 ? `Increased by ${abs}` : d < -0.005 ? `Decreased by ${abs}` : 'No change' }
}

// One view per summary section (a period that crosses a month end has one per month).
function sectionViews(data: ReportData): ReportData[] {
  const secs = data.sections ?? [{ periodLabel: data.periodLabel, prevLabel: data.prevLabel, partOf: null, period: data.period, previous: data.previous, gpRange: data.gpRange, tiles: data.tiles, words: data.words }]
  return secs.map(sec => ({ ...data, ...sec }))
}

export function reportPageCount(data: ReportData): number {
  return 2 + sectionViews(data).length
}

// ── page chrome ─────────────────────────────────────────────────────────
function Page({ data, last, children }: { data: ReportData; last?: boolean; children: ReactNode }) {
  const gen = generatedOn(data.generatedAt)
  const page: CSSProperties = {
    width: 1123, height: 794, boxSizing: 'border-box', background: '#fff', padding: 28, position: 'relative',
    overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: FONT, color: '#111',
    pageBreakAfter: last ? 'auto' : 'always', breakAfter: last ? 'auto' : 'page', breakInside: 'avoid', pageBreakInside: 'avoid',
  }
  return (
    <div style={page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: 62, flex: '0 0 62px' }}>
        {data.logoUrl ? (
          <img src={data.logoUrl} alt={data.tenantName} style={{ height: 58, width: 'auto', maxWidth: 260, objectFit: 'contain', display: 'block' }} />
        ) : (
          <div style={{ display: 'inline-block', color: ORANGE, fontWeight: 900, fontSize: 26, letterSpacing: 2, lineHeight: 1.1, borderBottom: `2px solid ${ORANGE}`, paddingBottom: 2 }}>
            {data.tenantName.toUpperCase()}
          </div>
        )}
        <div style={{ textAlign: 'right', fontSize: 11, color: '#555', lineHeight: 1.4 }}>
          <div style={{ fontWeight: 700, color: '#222' }}>{data.branchLabel}</div>
          {gen && <div>Generated {gen}</div>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, marginTop: 10, display: 'flex', flexDirection: 'column' }}>{children}</div>
      <div style={{ position: 'absolute', right: 28, bottom: 10, fontSize: 12, color: '#222' }}>
        {`${data.tenantName.toUpperCase()} - ${data.periodLabel}`}
      </div>
    </div>
  )
}

const TitleBar = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: '#000', color: '#fff', fontWeight: 700, fontSize: 20, padding: '4px 10px', ...style }}>{children}</div>
)

// ── icons ───────────────────────────────────────────────────────────────
const ICONS: Record<string, string[]> = {
  trend: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  dollar: ['M12 3v18', 'M16 7.5c-.6-1.2-2-1.8-4-1.8-2.4 0-4 1-4 2.7 0 4 8 1.8 8 5.9 0 1.8-1.7 2.9-4 2.9-2.1 0-3.7-.8-4.3-2.2'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  check: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M8 12.500l3 3 5-6'],
  seed: ['M12 21v-9', 'M12 13c0-4-3-6-7-6 0 4 3 6 7 6z', 'M12 15c0-3 2-5 6-5 0 3-2 5-6 5z'],
  receipt: ['M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.500L6 21z', 'M9 8h6', 'M9 12h6'],
}

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {(ICONS[name] ?? []).map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

const IconBadge = ({ name, size = 36 }: { name: string; size?: number }) => (
  <div style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%', border: '1px solid #777', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={name} size={Math.round(size * 0.6)} />
  </div>
)

function Arrow({ dir, size = 56 }: { dir: Dir; size?: number }) {
  const color = dir === 'up' ? GREEN : dir === 'down' ? RED : '#888'
  const paths = dir === 'up' ? ['M5 40L22 22l10 10L54 10', 'M38 10h16v16']
    : dir === 'down' ? ['M5 10l17 18 10-10 22 22', 'M38 50h16V34']
    : ['M6 30h46', 'M40 18l12 12-12 12']
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

// ── charts ──────────────────────────────────────────────────────────────
function niceNum(x: number, round: boolean) {
  const e = Math.floor(Math.log10(x))
  const f = x / 10 ** e
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10)
  return nf * 10 ** e
}

// Axis range that always includes zero; minSpan keeps all-zero data drawable.
function niceScale(min: number, max: number, minSpan: number, ticks = 5) {
  let lo = Math.min(0, num(min)), hi = Math.max(0, num(max))
  if (hi - lo < minSpan) hi = lo + minSpan
  const step = niceNum((hi - lo) / (ticks - 1), true)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const count = Math.round((hi - lo) / step)
  return { lo, hi, ticks: Array.from({ length: count + 1 }, (_, i) => lo + i * step) }
}

function wrapLabel(label: string): [string, string] {
  if ((label.match(/[A-Za-z]+/g) ?? []).length >= 2 && label.includes(' - ')) {
    const i = label.indexOf(' - ') + 2
    return [label.slice(0, i), label.slice(i).trim()]
  }
  const i = label.lastIndexOf(' ')
  return i < 0 ? [label, ''] : [label.slice(0, i), label.slice(i + 1)]
}

interface BarSeries { name: string; color: string; values: number[] }

function BarChart({ width, height, labels, series, fmtValue = v => money(v), fmtAxis = v => money(v, 0), minSpan = 1, valueLabels = 'none', xMode = 'plain', maxBar = 30, axisW = 70 }: {
  width: number; height: number; labels: string[]; series: BarSeries[]
  fmtValue?: (v: number) => string; fmtAxis?: (v: number) => string; minSpan?: number
  valueLabels?: 'none' | 'out' | 'in'; xMode?: 'plain' | 'wrap' | 'rotate'; maxBar?: number; axisW?: number
}) {
  const n = labels.length
  const all = series.flatMap(s => s.values.map(num))
  const { lo, hi, ticks } = niceScale(Math.min(0, ...all), Math.max(0, ...all), minSpan)
  const showLegend = series.length > 1
  const padT = (showLegend ? 26 : 8) + (valueLabels === 'out' ? 12 : 0)
  const padB = xMode === 'rotate' ? 56 : xMode === 'wrap' ? 36 : 24
  const padL = axisW, padR = 8
  const pw = width - padL - padR, ph = height - padT - padB
  const y = (v: number) => padT + ph - ((v - lo) / (hi - lo)) * ph
  const y0 = y(0)
  const gw = n ? pw / n : pw
  const barW = Math.max(1, Math.min(maxBar, (gw * 0.8) / Math.max(1, series.length)))
  const legendW = series.reduce((s, x) => s + x.name.length * 6 + 26, 0)
  const txt = { fontFamily: FONT, fontSize: 10 }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {showLegend && (() => {
        let x = (width - legendW) / 2
        return series.map(s => {
          const el = (
            <g key={s.name}>
              <rect x={x} y={5} width={10} height={10} fill={s.color} rx={1} />
              <text x={x + 15} y={14} {...txt} fill="#444">{s.name}</text>
            </g>
          )
          x += s.name.length * 6 + 26
          return el
        })
      })()}
      {ticks.map(t => (
        <g key={t}>
          <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="#ddd" strokeWidth={1} />
          <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" {...txt} fill="#444">{fmtAxis(t)}</text>
        </g>
      ))}
      <line x1={padL} x2={width - padR} y1={y0} y2={y0} stroke={lo < 0 ? '#222' : '#888'} strokeWidth={1} />
      {n === 0 && <text x={padL + pw / 2} y={padT + ph / 2} textAnchor="middle" {...txt} fontSize={12} fill="#888">No data</text>}
      {labels.map((label, g) => {
        const cx = padL + gw * (g + 0.5)
        const x0 = cx - (barW * series.length) / 2
        const ly = height - padB + 14
        return (
          <g key={g}>
            {series.map((s, si) => {
              const v = num(s.values[g] ?? 0)
              const top = Math.min(y(v), y0), h = Math.abs(y(v) - y0)
              const x = x0 + si * barW
              const inside = valueLabels === 'in' && h >= 16
              return (
                <g key={s.name}>
                  <rect x={x} y={top} width={barW - (series.length > 1 ? 1 : 2)} height={h} fill={s.color} />
                  {valueLabels === 'out' && (
                    <text x={x + barW / 2} y={v >= 0 ? y(v) - 4 : y(v) + 11} textAnchor="middle" {...txt} fill={s.color} stroke="#fff" strokeWidth={3} paintOrder="stroke">{fmtValue(v)}</text>
                  )}
                  {valueLabels === 'in' && (
                    <text x={x + barW / 2 - 1} y={inside ? top + 13 : top - 4} textAnchor="middle" {...txt} fontWeight={600} fill={inside ? '#fff' : '#333'}>{fmtValue(v)}</text>
                  )}
                </g>
              )
            })}
            {xMode === 'plain' && <text x={cx} y={ly} textAnchor="middle" {...txt} fill="#222">{label}</text>}
            {xMode === 'wrap' && (() => {
              const [a, b] = wrapLabel(label)
              return <text x={cx} y={ly} textAnchor="middle" {...txt} fontSize={9} fill="#222"><tspan x={cx}>{a}</tspan><tspan x={cx} dy={11}>{b}</tspan></text>
            })()}
            {xMode === 'rotate' && (
              <text x={cx + 4} y={ly - 4} textAnchor="end" {...txt} fontSize={9} fill="#222" transform={`rotate(-45 ${cx + 4} ${ly - 4})`}>{label}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function ChartCard({ w, h, title, children }: { w: number; h: number; title: string; children: (svgW: number, svgH: number) => ReactNode }) {
  return (
    <div style={{ width: w, height: h, boxSizing: 'border-box', border: '1px solid #bbb', padding: 8, overflow: 'hidden', flex: '0 0 auto' }}>
      <div style={{ fontSize: 16, color: '#666', height: 24, lineHeight: '24px', paddingLeft: 6 }}>{title}</div>
      {children(w - 18, h - 18 - 24)}
    </div>
  )
}

const profitCell: CSSProperties = { padding: '3px 12px 3px 0', fontSize: 13 }

function ProfitBlock({ v, heading }: { v: ReportData; heading: string | null }) {
  const { period, previous, gpRange } = v
  const d = period.gpPct - previous.gpPct
  const verdict = d > 0.005 ? 'Increase' : d < -0.005 ? 'Decrease' : 'No change'
  const divisions = [
    { name: 'Car Division', sales: period.carSales, cogs: period.carCogs },
    { name: 'Bike Division', sales: period.bikeSales, cogs: period.bikeCogs },
  ]
  const cell = profitCell
  return (
    <div style={{ marginTop: heading ? 14 : 28 }}>
      {heading && <div style={{ fontWeight: 700, fontSize: 13, borderBottom: '1px solid #999', paddingBottom: 3, marginBottom: 8 }}>{heading}</div>}
      <div style={{ display: 'flex', gap: 48, fontSize: 13, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 420 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Profitability</div>
          <div style={{ display: 'flex', gap: 24 }}><b style={{ width: 90 }}>GP range:</b><span>{`~${num(gpRange.low).toFixed(0)}%–${num(gpRange.high).toFixed(0)}%`}</span></div>
          <div style={{ display: 'flex', gap: 24, marginTop: 4 }}><b style={{ width: 90 }}>Average:</b><span>{`~${num(gpRange.avg).toFixed(0)}%`}</span></div>
          <div style={{ marginTop: 10 }}>
            <b>{verdict}</b> in margin percentage vs {v.prevLabel} ({pct(previous.gpPct)} to {pct(period.gpPct)})
          </div>
        </div>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: 'left' }} />
              {['Revenue', 'COGS', 'GP %'].map(h => <th key={h} style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {divisions.map(dv => (
              <tr key={dv.name}>
                <td style={{ ...cell, fontWeight: 700 }}>{dv.name}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{money(dv.sales)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{money(dv.cogs)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{pct(gpOf(dv.sales, dv.cogs))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

// ── page 1 ──────────────────────────────────────────────────────────────
function PageOne({ data }: { data: ReportData }) {
  const { columns, total } = data
  const views = sectionViews(data)
  const cols = [...columns, total]
  const fs = cols.length > 8 ? 11 : 13
  const rows: { label: string; get: (c: ReportCol) => string; bold?: boolean; net?: boolean }[] = [
    { label: 'Weekly Sales (RM)', get: c => money(c.sales) },
    { label: 'COGS (parts)', get: c => money(c.cogs) },
    { label: 'Gross Profit', get: c => money(c.gp) },
    { label: 'GP %', get: c => pct(c.gpPct) },
    { label: 'OPEX', get: c => money(c.opex) },
    { label: 'CAPEX', get: c => money(c.capex) },
    { label: 'Net Profit', get: c => money(c.net), bold: true, net: true },
    { label: '', get: () => '' },
    { label: 'Transactions', get: c => String(c.tx) },
    { label: 'Average Sales per Customer', get: c => money(c.avgPerTx) },
  ]
  const th: CSSProperties = { textAlign: 'right', fontWeight: 700, padding: '4px 8px', whiteSpace: 'nowrap' }
  const td: CSSProperties = { textAlign: 'right', padding: '3px 8px', whiteSpace: 'nowrap' }


  return (
    <>
      <TitleBar>{`${data.mode === 'week' ? 'Weekly' : data.mode === 'month' ? 'Monthly' : ''} Financial Summary`.trim()} - {data.periodLabel}</TitleBar>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: fs, marginTop: 6 }}>
        <colgroup>
          <col style={{ width: 210 }} />
          {cols.map((_, i) => <col key={i} />)}
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }} />
            {cols.map((c, i) => (
              <th key={i} style={{ ...th, ...(i === cols.length - 1 ? { borderLeft: '1px solid #999' } : null) }}>{i === cols.length - 1 ? (c.label || 'TOTAL') : c.label}{c.partOf && <div style={{ fontSize: 9, fontWeight: 400, color: '#777' }}>{`part of ${c.partOf}`}</div>}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => r.label === '' ? (
            <tr key={ri}><td colSpan={cols.length + 1} style={{ height: 16 }} /></tr>
          ) : (
            <tr key={ri}>
              <td style={{ ...td, textAlign: 'left', fontWeight: r.bold ? 700 : 400 }}>{r.label}</td>
              {cols.map((c, i) => (
                <td key={i} style={{ ...td, fontWeight: r.bold ? 700 : 400, color: r.net && c.net < 0 ? RED : '#111', ...(i === cols.length - 1 ? { borderLeft: '1px solid #999' } : null) }}>{r.get(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {views.map((v, i) => <ProfitBlock key={i} v={v} heading={views.length > 1 ? v.periodLabel : null} />)}

      {data.warnings.length > 0 && (
        <div style={{ position: 'absolute', left: 28, right: 280, bottom: 28, background: '#FFF4CE', border: '1px solid #E0B000', color: '#6B4E00', fontSize: 11, padding: '6px 10px', lineHeight: 1.45 }}>
          <b>Data notes</b>
          {data.warnings.map((w, i) => <div key={i}>{`• ${w}`}</div>)}
        </div>
      )}
    </>
  )
}

// ── page 2 ──────────────────────────────────────────────────────────────
function PageTwo({ data }: { data: ReportData }) {
  const { historyMonths: months, historyWeeks: weeks } = data
  const views = sectionViews(data)
  const multi = views.length > 1
  const kpisOf = (period: ReportCol) => [
    { icon: 'trend', label: 'SALES', value: money(period.sales), sub: undefined as string | undefined, color: undefined as string | undefined },
    { icon: 'dollar', label: 'GROSS PROFIT', value: money(period.gp), sub: undefined, color: undefined },
    { icon: 'receipt', label: 'OPEX', value: money(period.opex), sub: `CAPEX ${money(period.capex)}`, color: undefined },
    { icon: 'seed', label: 'NET PROFIT', value: money(period.net), sub: undefined, color: period.net >= 0 ? '#7CE38B' : '#FF6B5E' },
  ]
  const wl = weeks.map(w => w.label)
  return (
    <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 825 }}>
        <ChartCard w={825} h={270} title="Sales and Net Profit/Loss">
          {(w, h) => (
            <BarChart width={w} height={h} labels={months.map(m => m.label)} minSpan={100}
              series={[{ name: 'Sales', color: BLUE, values: months.map(m => m.sales) }, { name: 'Net Profit/Loss', color: RED, values: months.map(m => m.net) }]}
              valueLabels="out" fmtValue={v => money(v, months.length > 8 ? 0 : 2)} axisW={74} />
          )}
        </ChartCard>
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          <ChartCard w={520} h={340} title="Weekly Sales and Gross Profit">
            {(w, h) => (
              <BarChart width={w} height={h} labels={wl} xMode="wrap" minSpan={100} axisW={70}
                series={[{ name: 'Sales', color: BLUE, values: weeks.map(x => x.sales) }, { name: 'Gross Profit', color: RED, values: weeks.map(x => x.gp) }]} />
            )}
          </ChartCard>
          <ChartCard w={293} h={340} title="Weekly Transactions">
            {(w, h) => (
              <BarChart width={w} height={h} labels={wl} xMode="rotate" minSpan={4} axisW={30} maxBar={40} valueLabels="in"
                fmtAxis={v => String(v)} fmtValue={v => String(Math.round(v))}
                series={[{ name: 'Transactions', color: BLUE, values: weeks.map(x => x.tx) }]} />
            )}
          </ChartCard>
        </div>
      </div>
      <div style={{ flex: 1, background: '#000', color: '#fff', display: 'flex', flexDirection: 'column', padding: '18px 16px', boxSizing: 'border-box' }}>
        {views.map((v, vi) => (
          <div key={vi} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: vi ? 10 : 0 }}>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: multi ? 15 : 19, paddingBottom: multi ? 6 : 14, borderBottom: '1px solid #555' }}>{v.periodLabel.toUpperCase()}</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
              {kpisOf(v.period).map(k => (
                <div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: multi ? '4px 0' : '12px 0', borderBottom: '1px solid #333' }}>
                  <IconBadge name={k.icon} size={multi ? 30 : 46} />
                  <div style={{ borderLeft: '1px solid #666', paddingLeft: 12, minWidth: 0 }}>
                    <div style={{ fontSize: multi ? 9 : 11, fontWeight: 700, letterSpacing: 0.5, color: '#ddd' }}>{k.label}</div>
                    <div style={{ fontSize: multi ? 14 : 17, fontWeight: 700, color: k.color ?? '#fff', whiteSpace: 'nowrap' }}>{k.value}</div>
                    {k.sub && <div style={{ fontSize: multi ? 9 : 11, color: '#bbb', marginTop: 2 }}>{k.sub}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── page 3 ──────────────────────────────────────────────────────────────
function TileShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ background: '#000', color: '#fff', fontWeight: 700, fontSize: 13, textAlign: 'center', padding: '4px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-evenly' }}>{children}</div>
    </div>
  )
}

function Pair({ items }: { items: { label: string; value: string; color?: string }[] }) {
  const big = items.some(i => i.value.length >= 10) ? 19 : 24
  return (
    <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%' }}>
      {items.map(i => (
        <div key={i.label} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: i.color ?? '#222', fontWeight: i.color ? 700 : 400 }}>{i.label}</div>
          <div style={{ fontSize: big, fontWeight: 700 }}>{i.value}</div>
        </div>
      ))}
    </div>
  )
}

// Red under 50%, amber up to 99%, green at 100% or more.
function Progress({ value }: { value: number }) {
  const v = num(value)
  const color = v >= 100 ? GREEN : v >= 50 ? '#F5A623' : RED
  return (
    <div style={{ width: '82%', height: 18, background: '#e6e6e6', borderRadius: 9, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(2, Math.min(100, v))}%`, height: '100%', background: color }} />
    </div>
  )
}

const Sentence = ({ children }: { children: ReactNode }) => <div style={{ fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{children}</div>

function Pie({ fleet, walkin, size = 120 }: { fleet: number; walkin: number; size?: number }) {
  const f = Math.max(0, num(fleet)), w = Math.max(0, num(walkin)), sum = f + w
  const r = size / 2
  if (sum <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={r} cy={r} r={r - 1} fill="#e5e5e5" />
        <text x={r} y={r + 4} textAnchor="middle" fontFamily={FONT} fontSize={11} fill="#777">No sales</text>
      </svg>
    )
  }
  const fShare = f / sum
  const pt = (frac: number, rad = r) => [r + rad * Math.sin(frac * 2 * Math.PI), r - rad * Math.cos(frac * 2 * Math.PI)]
  const slices = [
    { share: fShare, from: 0, color: BLUE },
    { share: 1 - fShare, from: fShare, color: RED },
  ].filter(s => s.share > 0.00001)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map(s => {
        if (s.share >= 0.99999) return <circle key={s.color} cx={r} cy={r} r={r - 1} fill={s.color} />
        const [x1, y1] = pt(s.from, r - 1), [x2, y2] = pt(s.from + s.share, r - 1)
        return <path key={s.color} d={`M${r} ${r}L${x1} ${y1}A${r - 1} ${r - 1} 0 ${s.share > 0.5 ? 1 : 0} 1 ${x2} ${y2}Z`} fill={s.color} stroke="#fff" strokeWidth={1} />
      })}
      {slices.map(s => {
        if (s.share < 0.08) return null
        const [lx, ly] = pt(s.from + s.share / 2, r * 0.58)
        return <text key={s.color} x={lx} y={ly + 4} textAnchor="middle" fontFamily={FONT} fontSize={12} fontWeight={700} fill="#fff">{pct(s.share * 100, 1)}</text>
      })}
    </svg>
  )
}

function PageThree({ data, words }: { data: ReportData; words: ReportWord[] }) {
  const t = data.tiles
  const unit = data.partOf ? 'Part-week' : unitOf(data.mode)
  const thisCap = `This ${unit.toLowerCase()}`
  const prevCap = cap(data.prevLabel)   // reports saved before comparison choices existed lack the base labels
  const profitable = data.period.net >= 0
  const dash = (n: number) => (n > 0 ? pct(n, 1) : '-')
  const oneDp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

  const rev = compare(t.monthSalesThis, t.monthSalesPrev)
  const gp = compare(t.gpPctThis, t.gpPctPrev)
  const quality = compare(t.avgThis, t.avgPrev)
  const txDiff = Math.round((t.txThis - t.txPrev) * 10) / 10
  const coverage = t.costs > 0 ? (t.gp / t.costs) * 100 : t.gp > 0 ? 100 : 0
  const ptsAbs = Math.abs(t.walkinShareChangePts).toFixed(2)
  const hasTarget = t.salesTarget > 0, hasDaily = t.perDayTarget > 0
  const arNet = (t.arTotal ?? 0) - (t.apTotal ?? 0)
  const hasAr = (t.arTotal ?? 0) > 0 || (t.apTotal ?? 0) > 0

  const wordIcons = ['shield', 'check', 'dollar', 'trend', 'seed']
  return (
    <>
      <TitleBar style={{ alignSelf: 'flex-start', minWidth: 640, fontSize: 18, textTransform: 'uppercase' }}>
        {`${data.periodLabel}${data.partOf ? ` (part of ${data.partOf}) Summary` : ` ${unit} Summary`} - ${profitable ? 'PROFITABLE' : 'LOSS'}`}
      </TitleBar>
      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0, marginTop: 10 }}>
        <div style={{ width: 190, flex: '0 0 190px', background: '#000', color: '#fff', padding: '14px 12px', boxSizing: 'border-box' }}>
          <div style={{ fontWeight: 700, fontSize: 13, textAlign: 'center', paddingBottom: 10, borderBottom: '1px solid #444' }}>{`Words To Describe This ${unit}`}</div>
          {words.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: '1px solid #333' }}>
              <IconBadge name={wordIcons[i % wordIcons.length]} size={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{w.word}</div>
                <div style={{ fontSize: 7.5, color: '#bbb', letterSpacing: 0.3, textTransform: 'uppercase', lineHeight: 1.3 }}>{w.caption}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 10 }}>
          <TileShell title={t.monthHeader}>
            <Arrow dir={rev.dir} /><Sentence>{rev.text}</Sentence>
            <Pair items={[{ label: t.monthLabelPrev, value: money(t.monthSalesPrev, 0) }, { label: t.monthLabelThis, value: money(t.monthSalesThis, 0) }]} />
          </TileShell>
          <TileShell title="GP PERFORMANCE">
            <Arrow dir={gp.dir} /><Sentence>{gp.text}</Sentence>
            <Pair items={[{ label: t.gpBaseLabel ?? prevCap, value: pct(t.gpPctPrev) }, { label: thisCap, value: pct(t.gpPctThis) }]} />
          </TileShell>
          <TileShell title="BREAK-EVEN ANALYSIS">
            <Progress value={coverage} />
            <Sentence>{`${t.surplus >= 0 ? 'Surplus' : 'Shortfall'}: ${money(Math.abs(t.surplus), 0)} (${pct(coverage, 0)} of costs covered)`}</Sentence>
            <Pair items={[{ label: 'Costs (OPEX+CAPEX)', value: money(t.costs, 0) }, { label: 'GP', value: money(t.gp, 0) }]} />
          </TileShell>
          <TileShell title={`${unit.toUpperCase()} SALES TARGET`}>
            {hasTarget ? <Progress value={t.targetAchievement} /> : <Arrow dir="flat" />}
            <Sentence>{`Achievement: ${hasTarget ? pct(t.targetAchievement, 1) : '-'}`}</Sentence>
            <Pair items={[{ label: 'Target', value: money(t.salesTarget, 0) }, { label: 'Actual', value: money(t.salesActual, 0) }]} />
          </TileShell>
          <TileShell title="CUSTOMER COUNT">
            <Arrow dir={dirOf(txDiff)} />
            <Sentence>{txDiff === 0 ? 'No change' : `${txDiff > 0 ? 'Increased' : 'Decreased'} by ${oneDp(Math.abs(txDiff))}`}</Sentence>
            <Pair items={[{ label: t.txBaseLabel ?? prevCap, value: oneDp(Math.round(t.txPrev * 10) / 10) }, { label: thisCap, value: String(t.txThis) }]} />
          </TileShell>
          <TileShell title="CUSTOMER QUALITY">
            <Arrow dir={quality.dir} /><Sentence>{quality.text}</Sentence>
            <Pair items={[{ label: t.avgBaseLabel ?? prevCap, value: money(t.avgPrev, 0) }, { label: thisCap, value: money(t.avgThis, 0) }]} />
          </TileShell>
          <TileShell title={`${unit.toUpperCase()} REVENUE PER DAY`}>
            {hasDaily ? <Progress value={t.perDayAchievement} /> : <Arrow dir="flat" />}
            <Sentence>{`Achievement: ${hasDaily ? pct(t.perDayAchievement, 1) : '-'}`}</Sentence>
            <Pair items={[{ label: 'Daily', value: money(t.perDayActual, 0) }, { label: 'Target', value: money(t.perDayTarget, 0) }]} />
          </TileShell>
          <TileShell title="RECEIVABLES VS PAYABLES">
            <Arrow dir={arNet > 0.5 ? 'up' : arNet < -0.5 ? 'down' : 'flat'} />
            <Sentence>{hasAr ? (arNet >= 0 ? `Owed to you: ${money(arNet, 0)} more` : `You owe: ${money(-arNet, 0)} more`) : 'No open invoices'}</Sentence>
            <Pair items={[{ label: `Receivable (${t.arCount ?? 0})`, value: money(t.arTotal ?? 0, 0) }, { label: `Payable (${t.apCount ?? 0})`, value: money(t.apTotal ?? 0, 0) }]} />
            <div style={{ fontSize: 10, color: '#666', textAlign: 'center', lineHeight: 1.4 }}>
              {`Overdue: AR ${money(t.arOverdue ?? 0, 0)} · AP ${money(t.apOverdue ?? 0, 0)} · as at ${generatedOn(data.generatedAt)}`}<br />
              {`Fleet owes ${money(t.arFleet ?? 0, 0)} · ${(t.collInvoiced ?? 0) > 0 ? `${pct(t.collRate ?? 0, 0)} of period invoices paid` : 'nothing invoiced'}`}
            </div>
          </TileShell>
          <TileShell title="Internal Fleet vs Walk Ins">
            <Pie fleet={t.fleetShare} walkin={t.walkinShare} size={96} />
            <Pair items={[{ label: 'Internal Fleet', value: dash(t.fleetShare), color: BLUE }, { label: 'Walk Ins', value: dash(t.walkinShare), color: RED }]} />
            <div style={{ fontSize: 10, color: '#666' }}>{dirOf(t.walkinShareChangePts) === 'flat' ? 'Mix unchanged' : `Walk-ins share ${t.walkinShareChangePts > 0 ? 'up' : 'down'} ${ptsAbs} pts`}</div>
          </TileShell>
        </div>
      </div>
    </>
  )
}

// ── exports ─────────────────────────────────────────────────────────────
export function WeeklyReportPages({ data, words }: { data: ReportData; words: ReportWord[][] }) {
  const views = sectionViews(data)
  return (
    <>
      <Page data={data}><PageOne data={data} /></Page>
      <Page data={data}><PageTwo data={data} /></Page>
      {views.map((v, i) => (
        <Page key={i} data={v} last={i === views.length - 1}><PageThree data={v} words={words[i] ?? v.words} /></Page>
      ))}
    </>
  )
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Opens a print-ready tab for the rendered pages. Returns false if the popup was blocked.
export function openReportPrintWindow(el: HTMLElement, title: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 0 }
  body { margin: 0 }
  body > div { width: 1122px !important; height: 793px !important; overflow: hidden }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact }
</style>
</head>
<body>${el.innerHTML}</body>
</html>`
  let printed = false
  const print = () => { if (printed) return; printed = true; setTimeout(() => { w.focus(); w.print() }, 250) }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.addEventListener('load', print)
  if (w.document.readyState === 'complete') print()
  return true
}
