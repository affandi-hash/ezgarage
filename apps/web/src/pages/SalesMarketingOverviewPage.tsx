import { useState, useEffect, useCallback } from 'react'
import {
  Users, Link2, Filter, UserCheck, ShoppingCart, Wallet, CircleDollarSign,
  Star, TrendingUp, TrendingDown, Sparkles, AlertTriangle, Megaphone,
  CalendarDays, Bike, Car, MessageCircle,
  Percent, Bot, Phone, Sliders,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { MarketingMetricsEditor } from '@/components/sales-marketing/MarketingMetricsEditor'

const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }

const GOOD = '#4ade80'
const BAD = '#f87171'
const WARN = '#fbbf24'
const INFO = '#60a5fa'
const ORANGE = '#F15A22'

// Sequential ramp, light -> dark, for the funnel stages (magnitude, not category).
const FUNNEL_RAMP = ['#FDE0D1', '#FBB790', '#F8894F', '#F15A22', '#C43D0F']

// ─── Date range (same pattern as ReportsPage.tsx) ──────────────────────────────

type DateRange = 'this_month' | 'last_month' | 'last_3_months' | 'custom'

function getDateBounds(range: DateRange, customStart?: string, customEnd?: string): { start: string; end: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  if (range === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { start: fmt(start), end: fmt(end) }
  }
  if (range === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    return { start: fmt(start), end: fmt(end) }
  }
  if (range === 'last_3_months') {
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { start: fmt(start), end: fmt(end) }
  }
  return { start: customStart ?? fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: customEnd ?? fmt(now) }
}

// Same-length window immediately preceding `bounds`, for "vs previous period" deltas.
function getPreviousBounds(bounds: { start: string; end: string }): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const start = new Date(bounds.start)
  const end = new Date(bounds.end)
  const durationMs = end.getTime() - start.getTime()
  const prevEnd = new Date(start.getTime() - 86400000)
  const prevStart = new Date(prevEnd.getTime() - durationMs)
  return { start: fmt(prevStart), end: fmt(prevEnd) }
}

// Every first-of-month string ('YYYY-MM-01') touched by `bounds` -- manual
// metrics are entered per calendar month, so a multi-month range sums them.
function monthsInRange(bounds: { start: string; end: string }): string[] {
  const months: string[] = []
  const cur = new Date(bounds.start)
  cur.setDate(1)
  const end = new Date(bounds.end)
  while (cur <= end) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return months
}

function pctDelta(curr: number, prev: number): { delta: string; good: boolean } {
  if (prev === 0 && curr === 0) return { delta: '0%', good: true }
  if (prev === 0) return { delta: '+100%', good: true }
  const pct = ((curr - prev) / prev) * 100
  return { delta: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`, good: pct >= 0 }
}

function fmtDateLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtRM(n: number) { return `RM${Math.round(n).toLocaleString()}` }

// ─── Data types ────────────────────────────────────────────────────────────────

interface StatTile { label: string; value: string; delta: string; good: boolean; icon: React.ElementType; sub?: string }

interface BookingChannelStat {
  key: 'mia' | 'human' | 'other'; icon: React.ElementType; name: string; blurb: string
  count: number; share: number; color: string
}

interface FunnelStage { label: string; value: number; pct: string }

interface OpportunitySegment { icon: React.ElementType; title: string; note: string; potential: number; count: number }

interface AlertItem { icon: React.ElementType; severity: string; text: string; sub: string; count: number }

interface ChannelPerf { channel: string; reach: number; leads: number; prospects: number; spend: number }

interface OverviewData {
  primaryStats: StatTile[]
  secondaryStats: StatTile[]
  bookingChannels: BookingChannelStat[]
  funnel: FunnelStage[]
  opportunities: OpportunitySegment[]
  aiSummaryText: string
  aiPriorities: string[]
  channelPerf: ChannelPerf[]
  alerts: AlertItem[]
  occupancy: { avgPct: number; deltaPts: number; series: number[] } | null
  revenueSeries: number[]
  revenueTargetSeries: number[]
  revenueTotal: number
  revenueTargetTotal: number
  dayLabels: string[]
}

// ─── Presentational pieces (unchanged visual design, now data-driven) ─────────

function StatTileCard({ tile }: { tile: StatTile }) {
  const Icon = tile.icon
  return (
    <div style={{ ...cardStyle, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={labelStyle}>{tile.label}</div>
        <Icon size={14} color="#6A6A6A" />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F0' }}>{tile.value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: tile.delta.startsWith('★') ? '#fbbf24' : (tile.good ? GOOD : BAD) }}>
        {!tile.delta.startsWith('★') && (tile.good ? <TrendingUp size={11} /> : <TrendingDown size={11} />)}
        <span style={{ fontWeight: 700 }}>{tile.delta}</span>
        <span style={{ color: '#6A6A6A', fontWeight: 400 }}>{tile.sub ?? 'vs prior period'}</span>
      </div>
    </div>
  )
}

function BookingChannelsRow({ channels }: { channels: BookingChannelStat[] }) {
  const total = channels.reduce((s, c) => s + c.count, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Bookings by Channel</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {channels.map(c => (
          <div key={c.key} style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: `${c.color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <c.icon size={15} color={c.color} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#F0F0F0' }}>{c.name}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: '#F0F0F0' }}>{c.count}</span>
              <span style={{ fontSize: 12, color: c.color, fontWeight: 700 }}>{c.share.toFixed(1)}%</span>
              <span style={{ fontSize: 11, color: '#6A6A6A' }}>of bookings</span>
            </div>
            <div style={{ width: '100%', height: 5, borderRadius: 999, backgroundColor: '#2A2A2A', overflow: 'hidden' }}>
              <div style={{ width: `${c.share}%`, height: '100%', backgroundColor: c.color }} />
            </div>
            <p style={{ fontSize: 11, color: '#8A8A8A', margin: 0, lineHeight: 1.4 }}>{c.blurb}</p>
          </div>
        ))}
      </div>
      {total === 0 && <p style={{ fontSize: 11, color: '#5A5A5A', fontStyle: 'italic', margin: 0 }}>No bookings in this period yet.</p>}
    </div>
  )
}

function SalesFunnel({ funnel }: { funnel: FunnelStage[] }) {
  const max = funnel[0]?.value || 1
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Sales Funnel</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {funnel.map((stage, i) => {
          const widthPct = stage.value > 0 ? Math.max(18, Math.round(100 * Math.pow(stage.value / max, 0.32))) : 4
          return (
            <div key={stage.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 82, fontSize: 12, color: '#A0A0A0', flexShrink: 0 }}>{stage.label}</div>
              <div style={{ flex: 1, height: 22, backgroundColor: '#1E1E1E', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{
                  width: `${widthPct}%`, height: '100%', backgroundColor: FUNNEL_RAMP[i],
                  display: 'flex', alignItems: 'center', paddingLeft: 8, boxSizing: 'border-box',
                  transition: 'width 0.4s',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: i < 2 ? '#3a1a08' : '#fff' }}>{stage.value.toLocaleString()}</span>
                </div>
              </div>
              <div style={{ width: 44, textAlign: 'right' as const, fontSize: 11, color: '#6A6A6A', flexShrink: 0 }}>{stage.pct}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OpportunityRadar({ opportunities }: { opportunities: OpportunitySegment[] }) {
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Opportunity Radar</div>
      {opportunities.length === 0 && (
        <p style={{ fontSize: 12, color: '#5A5A5A', fontStyle: 'italic', margin: 0 }}>No segments found yet.</p>
      )}
      {opportunities.map(o => (
        <div key={o.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#1E1E1E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <o.icon size={15} color={ORANGE} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#F0F0F0' }}>{o.title}</div>
            <div style={{ fontSize: 11, color: '#8A8A8A', lineHeight: 1.4, margin: '2px 0 4px' }}>{o.note}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: GOOD, fontWeight: 700 }}>~{fmtRM(o.potential)} potential</span>
              <span style={{ fontSize: 11, color: '#6A6A6A' }}>{o.count} vehicle{o.count === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function AIExecutiveSummary({ text, priorities, revenue, target }: { text: string; priorities: string[]; revenue: number; target: number | null }) {
  const gap = target != null ? revenue - target : null
  const progressPct = target && target > 0 ? Math.min(100, Math.round((revenue / target) * 100)) : 0
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Sparkles size={14} color={ORANGE} />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Executive Summary</div>
      </div>
      <p style={{ fontSize: 12, color: '#C0C0C0', lineHeight: 1.6, margin: 0 }}>{text}</p>
      {priorities.length > 0 && (
        <div>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Top Priorities</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {priorities.map((p, i) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#E0E0E0' }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'rgba(241,90,34,0.15)', color: ORANGE, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                {p}
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ borderTop: '1px solid #2A2A2A', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#8A8A8A' }}>Revenue (this period)</span>
          <span style={{ color: '#F0F0F0', fontWeight: 700 }}>{fmtRM(revenue)}</span>
        </div>
        {target != null ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: '#8A8A8A' }}>Target</span>
              <span style={{ color: '#A0A0A0' }}>{fmtRM(target)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#8A8A8A' }}>Gap</span>
              <span style={{ color: (gap ?? 0) >= 0 ? GOOD : BAD, fontWeight: 700 }}>{(gap ?? 0) >= 0 ? '+' : '-'}{fmtRM(Math.abs(gap ?? 0))}</span>
            </div>
            <div style={{ width: '100%', height: 6, borderRadius: 999, backgroundColor: '#2A2A2A', overflow: 'hidden' }}>
              <div style={{ width: `${progressPct}%`, height: '100%', backgroundColor: ORANGE }} />
            </div>
          </>
        ) : (
          <p style={{ fontSize: 11, color: '#5A5A5A', fontStyle: 'italic', margin: '4px 0 0' }}>Set a Revenue Target in Marketing Metrics to see progress here.</p>
        )}
      </div>
    </div>
  )
}

function PerformanceTable({ channels }: { channels: ChannelPerf[] }) {
  const th: React.CSSProperties = { textAlign: 'left' as const, padding: '9px 12px', fontSize: 11, fontWeight: 700, color: '#6A6A6A', textTransform: 'uppercase' as const, letterSpacing: '0.02em', whiteSpace: 'nowrap' as const }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 12, color: '#E0E0E0', whiteSpace: 'nowrap' as const }

  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflowX: 'auto' as const }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Performance by Selling Channel</div>
      </div>
      {channels.length === 0 ? (
        <div style={{ padding: '24px 6px', textAlign: 'center' as const, color: '#6A6A6A', fontSize: 12 }}>
          No channel breakdown entered yet. Add it via "Marketing Metrics" above to see Reach/Leads/Prospects/Spend per channel here.
        </div>
      ) : (
        <>
          <table style={{ borderCollapse: 'collapse' as const, width: '100%' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                <th style={th}>Channel</th>
                <th style={th}>Reach</th>
                <th style={th}>Leads</th>
                <th style={th}>Prospects</th>
                <th style={th}>Spend</th>
                <th style={th}>Leads → Prospects</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(c => (
                <tr key={c.channel} style={{ borderBottom: '1px solid #202020' }}>
                  <td style={td}>{c.channel}</td>
                  <td style={td}>{c.reach.toLocaleString()}</td>
                  <td style={td}>{c.leads.toLocaleString()}</td>
                  <td style={td}>{c.prospects.toLocaleString()}</td>
                  <td style={td}>{c.spend > 0 ? fmtRM(c.spend) : '-'}</td>
                  <td style={td}>{c.leads > 0 ? `${((c.prospects / c.leads) * 100).toFixed(1)}%` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 10, color: '#5A5A5A', margin: 0 }}>Customer/revenue attribution by channel isn't tracked yet, so those columns aren't shown here.</p>
        </>
      )}
    </div>
  )
}

function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <AlertTriangle size={14} color={WARN} />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Alerts & Attention Needed</div>
        </div>
      </div>
      {alerts.length === 0 && <p style={{ fontSize: 12, color: '#5A5A5A', fontStyle: 'italic', margin: 0 }}>Nothing needs attention right now.</p>}
      {alerts.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#1E1E1E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <a.icon size={13} color={a.severity} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#E0E0E0' }}>{a.text}</div>
            {a.sub && <div style={{ fontSize: 11, color: '#6A6A6A' }}>{a.sub}</div>}
          </div>
          <span style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: `${a.severity}22`, color: a.severity, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{a.count}</span>
        </div>
      ))}
    </div>
  )
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 560, h = 90, pad = 4
  if (data.length < 2) return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5A5A5A', fontSize: 11 }}>Not enough data yet</div>
  const min = Math.min(...data), max = Math.max(...data)
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function RevenueVsTargetChart({ actual, target }: { actual: number[]; target: number[] }) {
  const w = 560, h = 160, pad = 8
  const max = Math.max(1, ...target, ...actual)
  const toPoints = (data: number[]) => data.map((v, i) => {
    const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2)
    const y = h - pad - (v / max) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#2A2A2A" strokeWidth={1} />
      {target.some(v => v > 0) && <polyline points={toPoints(target)} fill="none" stroke="#6A6A6A" strokeWidth={2} strokeDasharray="5,4" />}
      <polyline points={toPoints(actual)} fill="none" stroke={ORANGE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function DashboardTab({ data, loading }: { data: OverviewData | null; loading: boolean }) {
  if (loading || !data) {
    return <div style={{ padding: 48, textAlign: 'center' as const, color: '#6A6A6A', fontSize: 13 }}>Loading real data…</div>
  }
  const revenueTotal = data.revenueTotal
  const targetTotal = data.revenueTargetTotal > 0 ? data.revenueTargetTotal : null
  const gap = targetTotal != null ? revenueTotal - targetTotal : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10 }}>
        {data.primaryStats.map(t => <StatTileCard key={t.label} tile={t} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {data.secondaryStats.map(t => <StatTileCard key={t.label} tile={t} />)}
      </div>

      <BookingChannelsRow channels={data.bookingChannels} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        <AIExecutiveSummary text={data.aiSummaryText} priorities={data.aiPriorities} revenue={revenueTotal} target={targetTotal} />
        <SalesFunnel funnel={data.funnel} />
        <OpportunityRadar opportunities={data.opportunities} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
        <PerformanceTable channels={data.channelPerf} />
        <AlertsPanel alerts={data.alerts} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Workshop Occupancy</div>
            {data.occupancy ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: '#F0F0F0' }}>{data.occupancy.avgPct.toFixed(0)}%</span>
                <span style={{ fontSize: 11, color: data.occupancy.deltaPts >= 0 ? GOOD : BAD, display: 'flex', alignItems: 'center', gap: 2 }}>
                  {data.occupancy.deltaPts >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {Math.abs(data.occupancy.deltaPts).toFixed(0)}pts
                </span>
              </div>
            ) : <span style={{ fontSize: 11, color: '#5A5A5A' }}>No bays configured</span>}
          </div>
          {data.occupancy ? <Sparkline data={data.occupancy.series} color={GOOD} /> : (
            <p style={{ fontSize: 11, color: '#5A5A5A', margin: 0 }}>Add bays under Settings → Bays, and assign jobs to a bay on the Workshop Board, to see real occupancy here.</p>
          )}
        </div>
        <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Revenue vs Target</div>
            {gap != null && <span style={{ fontSize: 12, color: gap >= 0 ? GOOD : BAD, fontWeight: 700 }}>{gap >= 0 ? '+' : '-'}{fmtRM(Math.abs(gap))} gap</span>}
          </div>
          <RevenueVsTargetChart actual={data.revenueSeries} target={data.revenueTargetSeries} />
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#A0A0A0' }}>
              <span style={{ width: 14, height: 2, backgroundColor: ORANGE, display: 'inline-block' }} /> Revenue ({fmtRM(revenueTotal)})
            </div>
            {targetTotal != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#A0A0A0' }}>
                <span style={{ width: 14, height: 2, backgroundColor: '#6A6A6A', display: 'inline-block', borderTop: '2px dashed #6A6A6A' }} /> Target ({fmtRM(targetTotal)})
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Campaigns & Planning tab -- still a design pass, wired up separately ─────

const TOP_CAMPAIGNS = [
  { name: 'Harley Full Service', period: '1 - 31 Aug 2026', status: 'Active', spent: 800, revenue: 18700, roi: 23.4, progress: 75 },
  { name: 'Road Trip Ready', period: '1 - 31 Aug 2026', status: 'Active', spent: 600, revenue: 9250, roi: 15.4, progress: 60 },
  { name: 'Ask Mia Campaign', period: '1 - 31 Aug 2026', status: 'Active', spent: 400, revenue: 3800, roi: 9.5, progress: 50 },
  { name: 'ESP Community Drive', period: '1 - 31 Aug 2026', status: 'Planned', spent: 500, revenue: null, roi: null, progress: 0 },
  { name: 'Google Review Drive', period: '1 - 31 Aug 2026', status: 'Active', spent: 200, revenue: null, roi: null, progress: 30 },
]

const UPCOMING_CAMPAIGNS = [
  { day: '05', month: 'SEP', title: 'Harley Week Special', audience: 'Harley Owners', status: 'Upcoming' },
  { day: '12', month: 'SEP', title: 'Community Ride Support', audience: 'Motorcycle Communities', status: 'Upcoming' },
  { day: '17', month: 'SEP', title: 'ESP Roadshow', audience: 'All Communities & Clubs', status: 'Upcoming' },
  { day: '25', month: 'SEP', title: 'Road Trip Ready Promo', audience: 'Car Owners', status: 'Planned' },
]

function CampaignsPlanningTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...cardStyle, padding: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: WARN, backgroundColor: `${WARN}1A`, padding: '3px 9px', borderRadius: 999 }}>
          Preview -- sample data
        </span>
        <span style={{ fontSize: 11, color: '#6A6A6A' }}>Campaigns & Planning is still a design pass -- not wired to real data yet.</span>
      </div>

      <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Sparkles size={14} color={ORANGE} />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>AI Recommendation</div>
        </div>
        <p style={{ fontSize: 12, color: '#C0C0C0', margin: 0 }}>Revenue below target. Priority this week:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
          {['Ask Mia Campaign', 'Harley Full Service Package', 'E-Hailing Full Service Package'].map((p, i) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#E0E0E0', backgroundColor: '#1E1E1E', borderRadius: 999, padding: '5px 12px' }}>
              <span style={{ width: 15, height: 15, borderRadius: '50%', backgroundColor: 'rgba(241,90,34,0.15)', color: ORANGE, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              {p}
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Top Campaigns This Month</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {TOP_CAMPAIGNS.map(c => (
            <div key={c.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 90px 90px 90px 70px minmax(0,1fr)', gap: 10, alignItems: 'center', padding: '10px 6px', borderBottom: '1px solid #202020' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#F0F0F0' }}>{c.name}</div>
                <div style={{ fontSize: 10, color: '#6A6A6A' }}>{c.period}</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, textAlign: 'center' as const, padding: '3px 8px', borderRadius: 999,
                color: c.status === 'Active' ? GOOD : INFO, backgroundColor: c.status === 'Active' ? `${GOOD}22` : `${INFO}22`, justifySelf: 'start',
              }}>{c.status}</span>
              <span style={{ fontSize: 12, color: '#C0C0C0' }}>{fmtRM(c.spent)}</span>
              <span style={{ fontSize: 12, color: '#C0C0C0' }}>{c.revenue != null ? fmtRM(c.revenue) : '-'}</span>
              <span style={{ fontSize: 12, color: c.roi != null ? GOOD : '#6A6A6A', fontWeight: c.roi != null ? 700 : 400 }}>{c.roi != null ? `${c.roi}x` : '-'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: '#2A2A2A', overflow: 'hidden' }}>
                  <div style={{ width: `${c.progress}%`, height: '100%', backgroundColor: c.progress > 0 ? GOOD : '#3A3A3A' }} />
                </div>
                <span style={{ fontSize: 11, color: '#8A8A8A', width: 30, textAlign: 'right' as const }}>{c.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <CalendarDays size={14} color={ORANGE} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Upcoming Campaigns</div>
          </div>
        </div>
        {UPCOMING_CAMPAIGNS.map(u => (
          <div key={u.title} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, border: `1px solid ${ORANGE}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0', lineHeight: 1 }}>{u.day}</span>
              <span style={{ fontSize: 8, color: ORANGE, fontWeight: 700 }}>{u.month}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#F0F0F0' }}>{u.title}</div>
              <div style={{ fontSize: 11, color: INFO }}>{u.audience}</div>
            </div>
            <span style={{ fontSize: 11, color: u.status === 'Upcoming' ? GOOD : '#8A8A8A', fontWeight: 600 }}>{u.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Data loading ──────────────────────────────────────────────────────────────

async function loadPeriodCore(tenantId: string, branchFilter: string | null, bounds: { start: string; end: string }) {
  const endExclusive = new Date(bounds.end); endExclusive.setDate(endExclusive.getDate() + 1)
  const endExclusiveStr = `${endExclusive.getFullYear()}-${String(endExclusive.getMonth() + 1).padStart(2, '0')}-${String(endExclusive.getDate()).padStart(2, '0')}`

  let invQ = supabase.from('invoices').select('line_items, status, total_amount, subtotal, issue_date')
    .eq('tenant_id', tenantId).gte('issue_date', bounds.start).lte('issue_date', bounds.end).in('status', ['sent', 'overdue', 'paid'])
  if (branchFilter) invQ = invQ.eq('branch_id', branchFilter)

  let custQ = supabase.from('customers').select('id, created_at', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).gte('created_at', bounds.start).lt('created_at', endExclusiveStr)
  if (branchFilter) custQ = custQ.eq('branch_id', branchFilter)

  let bookQ = supabase.from('bookings').select('source, created_at').eq('tenant_id', tenantId)
    .gte('created_at', bounds.start).lt('created_at', endExclusiveStr)
  if (branchFilter) bookQ = bookQ.eq('branch_id', branchFilter)

  const [{ data: invRows }, { count: custCount }, { data: bookRows }] = await Promise.all([invQ, custQ, bookQ])

  let revenue = 0, totalParts = 0, totalLabour = 0, paidJobCount = 0
  const dayRevenue = new Map<string, number>()
  ;(invRows ?? []).forEach((inv: { line_items?: { item_type: string; qty?: number; cost_price?: number; amount?: number; unit_price?: number }[]; status: string; total_amount?: number; subtotal?: number; issue_date: string }) => {
    const invTotal = inv.total_amount ?? inv.subtotal ?? 0
    if (inv.status === 'paid') {
      revenue += invTotal
      paidJobCount++
      dayRevenue.set(inv.issue_date, (dayRevenue.get(inv.issue_date) ?? 0) + invTotal)
    }
    ;(inv.line_items ?? []).forEach(li => {
      const qty = li.qty ?? 1
      if (li.item_type === 'part') totalParts += li.cost_price != null ? li.cost_price * qty : (li.amount ?? qty * (li.unit_price ?? 0))
      else if (li.item_type === 'labour') totalLabour += li.amount ?? qty * (li.unit_price ?? 0)
    })
  })
  const grossProfit = revenue - (totalParts + totalLabour)
  const avgTrans = paidJobCount > 0 ? revenue / paidJobCount : 0

  const bookings = bookRows ?? []
  let mia = 0, human = 0, other = 0
  bookings.forEach(b => {
    if (b.source === 'whatsapp') mia++
    else if (b.source === 'staff' || b.source === 'phone') human++
    else other++
  })

  return {
    revenue, grossProfit, avgTrans, transactions: paidJobCount,
    customers: custCount ?? 0, bookings: bookings.length,
    bookingSplit: { mia, human, other },
    dayRevenue,
  }
}

async function loadManualMetrics(tenantId: string, branchFilter: string | null, months: string[]) {
  let q = supabase.from('sales_marketing_period_metrics').select('channel, metric_key, value').eq('tenant_id', tenantId).in('period_month', months)
  q = branchFilter ? q.eq('branch_id', branchFilter) : q.is('branch_id', null)
  const { data } = await q
  const rows = data ?? []
  const overall: Record<string, number> = {}
  const byChannel = new Map<string, Record<string, number>>()
  rows.forEach(r => {
    if (r.channel === null) {
      overall[r.metric_key] = (overall[r.metric_key] ?? 0) + Number(r.value)
    } else {
      const bucket = byChannel.get(r.channel) ?? {}
      bucket[r.metric_key] = (bucket[r.metric_key] ?? 0) + Number(r.value)
      byChannel.set(r.channel, bucket)
    }
  })
  return { overall, byChannel }
}

const CHANNEL_LABELS: Record<string, string> = {
  mia_whatsapp: 'Mia (WhatsApp)', facebook_instagram: 'Facebook / Instagram', walkin: 'Walk-in',
  google: 'Google (Search/Maps)', community_events: 'Community / Events', referrals: 'Referrals',
}

export function SalesMarketingOverviewPage() {
  const user = useAuthStore(s => s.user)
  const isSuperAdmin = user?.role === 'super_admin'
  const branchFilter = isSuperAdmin ? null : (user?.branch_id ?? null)
  const tenantId = user?.tenant_id ?? null

  const [tab, setTab] = useState<'dashboard' | 'campaigns'>('dashboard')
  const [dateRange, setDateRange] = useState<DateRange>('this_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [metricsEditorOpen, setMetricsEditorOpen] = useState(false)
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  const bounds = getDateBounds(dateRange, customStart, customEnd)
  const prevBounds = getPreviousBounds(bounds)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    const months = monthsInRange(bounds)
    const prevMonths = monthsInRange(prevBounds)
    const [curr, prev, manual, prevManual, bayRows, branchRow] = await Promise.all([
      loadPeriodCore(tenantId, branchFilter, bounds),
      loadPeriodCore(tenantId, branchFilter, prevBounds),
      loadManualMetrics(tenantId, branchFilter, months),
      loadManualMetrics(tenantId, branchFilter, prevMonths),
      branchFilter ? supabase.from('bays').select('id').eq('branch_id', branchFilter).eq('is_active', true) : Promise.resolve({ data: [] as { id: string }[] }),
      branchFilter ? supabase.from('branches').select('work_start_time, work_end_time, work_days').eq('id', branchFilter).single() : Promise.resolve({ data: null }),
    ])

    const espQ = supabase.from('esp_members').select('status, registered_at').eq('tenant_id', tenantId)
    const { data: espRows } = await espQ
    const espActive = (espRows ?? []).filter(r => r.status === 'active').length
    const espNewCurr = (espRows ?? []).filter(r => r.registered_at >= bounds.start && r.registered_at <= bounds.end + 'T23:59:59').length
    const espNewPrev = (espRows ?? []).filter(r => r.registered_at >= prevBounds.start && r.registered_at <= prevBounds.end + 'T23:59:59').length

    let quoteQ = supabase.from('quotations').select('id, status, sent_at').eq('tenant_id', tenantId).eq('status', 'sent')
    if (branchFilter) quoteQ = quoteQ.eq('branch_id', branchFilter)
    const { data: quoteRows } = await quoteQ
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const staleQuotes = (quoteRows ?? []).filter(q => q.sent_at && q.sent_at < sevenDaysAgo).length

    const reach = manual.overall.reach ?? 0
    const leads = manual.overall.leads ?? 0
    const prospects = manual.overall.prospects ?? 0
    const googleCount = manual.overall.google_reviews_count ?? 0
    const googleRating = manual.overall.google_reviews_rating ?? null
    const espTarget = manual.overall.esp_target ?? null
    const revenueTarget = manual.overall.revenue_target ?? 0

    const primaryStats: StatTile[] = [
      { label: 'Reach', value: reach.toLocaleString(), ...pctDelta(reach, prevManual.overall.reach ?? 0), icon: Users },
      { label: 'Leads', value: leads.toLocaleString(), ...pctDelta(leads, prevManual.overall.leads ?? 0), icon: Link2 },
      { label: 'Prospects', value: prospects.toLocaleString(), ...pctDelta(prospects, prevManual.overall.prospects ?? 0), icon: Filter },
      { label: 'Customers', value: curr.customers.toLocaleString(), ...pctDelta(curr.customers, prev.customers), icon: UserCheck },
      { label: 'Transactions', value: curr.transactions.toLocaleString(), ...pctDelta(curr.transactions, prev.transactions), icon: ShoppingCart },
      { label: 'Avg $ / Trans.', value: fmtRM(curr.avgTrans), ...pctDelta(curr.avgTrans, prev.avgTrans), icon: Wallet },
      { label: 'Gross Profit', value: fmtRM(curr.grossProfit), ...pctDelta(curr.grossProfit, prev.grossProfit), icon: CircleDollarSign },
    ]

    const secondaryStats: StatTile[] = [
      { label: 'Bookings', value: curr.bookings.toLocaleString(), ...pctDelta(curr.bookings, prev.bookings), icon: CalendarDays },
      { label: 'Conversion Rate', value: leads > 0 ? `${((curr.bookings / leads) * 100).toFixed(0)}%` : '—', delta: '', good: true, icon: Percent, sub: 'Bookings to Leads' },
      { label: 'Google Reviews', value: googleCount.toLocaleString(), delta: googleRating != null ? `★ ${googleRating}` : '—', good: true, icon: Star, sub: 'This period' },
      { label: 'ESP Members', value: espActive.toLocaleString(), ...pctDelta(espNewCurr, espNewPrev), icon: Users, sub: 'Total active' },
    ]

    const bookingChannels: BookingChannelStat[] = (() => {
      const { mia, human, other } = curr.bookingSplit
      const total = mia + human + other || 1
      return [
        { key: 'mia' as const, icon: Bot, name: 'Mia (WhatsApp)', blurb: 'Booked directly via WhatsApp', count: mia, share: (mia / total) * 100, color: ORANGE },
        { key: 'human' as const, icon: Phone, name: 'Human (Staff / Phone)', blurb: 'Booked by staff or a phone call', count: human, share: (human / total) * 100, color: INFO },
        { key: 'other' as const, icon: Filter, name: 'Other / Online', blurb: 'Online or another booking source', count: other, share: (other / total) * 100, color: WARN },
      ]
    })()

    const funnel: FunnelStage[] = [
      { label: 'Reach', value: reach, pct: '100%' },
      { label: 'Leads', value: leads, pct: reach > 0 ? `${((leads / reach) * 100).toFixed(1)}%` : '—' },
      { label: 'Prospects', value: prospects, pct: reach > 0 ? `${((prospects / reach) * 100).toFixed(1)}%` : '—' },
      { label: 'Customers', value: curr.customers, pct: reach > 0 ? `${((curr.customers / reach) * 100).toFixed(1)}%` : '—' },
      { label: 'Transactions', value: curr.transactions, pct: reach > 0 ? `${((curr.transactions / reach) * 100).toFixed(1)}%` : '—' },
    ]

    // Opportunity Radar -- real segments derived from vehicles.last_visit_at + make,
    // not AI-generated. Estimated potential = lapsed-vehicle count x avg transaction value.
    let vehQ = supabase.from('vehicles').select('id, make, last_visit_at, branch_id')
    if (branchFilter) vehQ = vehQ.eq('branch_id', branchFilter)
    const { data: vehRows } = await vehQ
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString()
    const lapsed = (vehRows ?? []).filter(v => v.last_visit_at && v.last_visit_at < ninetyDaysAgo)
    const lapsedHarley = lapsed.filter(v => (v.make ?? '').toLowerCase().includes('harley'))
    const opportunities: OpportunitySegment[] = []
    if (lapsedHarley.length > 0) {
      opportunities.push({ icon: Bike, title: 'Harley-Davidson Owners Overdue', note: 'Harley owners who haven\'t visited in 90+ days', potential: lapsedHarley.length * curr.avgTrans, count: lapsedHarley.length })
    }
    if (lapsed.length > 0) {
      opportunities.push({ icon: Car, title: 'Overdue for Service', note: 'Any vehicle not seen in 90+ days', potential: lapsed.length * curr.avgTrans, count: lapsed.length })
    }

    // Alerts -- real signals only (no fabricated "no corporate visits" style items).
    const alerts: AlertItem[] = []
    if (espTarget != null && espActive < espTarget) {
      alerts.push({ icon: Users, severity: BAD, text: 'ESP registrations behind target.', sub: `Target ${espTarget}, current ${espActive}.`, count: espTarget - espActive })
    }
    if (staleQuotes > 0) {
      alerts.push({ icon: MessageCircle, severity: WARN, text: 'Quotations pending follow-up.', sub: 'Sent 7+ days ago with no response.', count: staleQuotes })
    }
    if (revenueTarget > 0 && curr.revenue < revenueTarget) {
      alerts.push({ icon: Megaphone, severity: WARN, text: 'Revenue is below target this period.', sub: `${fmtRM(revenueTarget - curr.revenue)} short.`, count: 1 })
    }

    const aiSummaryText = revenueTarget > 0
      ? `Revenue is ${curr.revenue >= revenueTarget ? 'above' : 'below'} target by ${fmtRM(Math.abs(curr.revenue - revenueTarget))} this period.`
      : `Revenue this period is ${fmtRM(curr.revenue)}. Set a Revenue Target in Marketing Metrics to track progress.`
    const aiPriorities = alerts.slice(0, 3).map(a => a.text)

    // Workshop Occupancy -- real, from bays + jobs.bay_id + branch working hours.
    let occupancy: OverviewData['occupancy'] = null
    if (branchRow.data && (bayRows.data ?? []).length > 0) {
      const totalBays = (bayRows.data ?? []).length
      const workDays: string[] = branchRow.data.work_days ?? []
      const dowKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
      let jobsQ = supabase.from('jobs').select('bay_id, checked_in_at, ready_at, closed_at').eq('tenant_id', tenantId).eq('branch_id', branchFilter).not('bay_id', 'is', null)
      const { data: jobRows } = await jobsQ
      const computeSeries = (b: { start: string; end: string }) => {
        const series: number[] = []
        const cur = new Date(b.start)
        const end = new Date(b.end)
        while (cur <= end) {
          const dow = dowKeys[cur.getDay()]
          if (workDays.includes(dow)) {
            const dayStart = new Date(cur); dayStart.setHours(0, 0, 0, 0)
            const dayEnd = new Date(cur); dayEnd.setHours(23, 59, 59, 999)
            const occupiedBays = new Set<string>()
            ;(jobRows ?? []).forEach(j => {
              const checkedIn = new Date(j.checked_in_at)
              const leftAt = j.closed_at ? new Date(j.closed_at) : j.ready_at ? new Date(j.ready_at) : new Date()
              if (checkedIn <= dayEnd && leftAt >= dayStart && j.bay_id) occupiedBays.add(j.bay_id)
            })
            series.push(totalBays > 0 ? (occupiedBays.size / totalBays) * 100 : 0)
          }
          cur.setDate(cur.getDate() + 1)
        }
        return series
      }
      const series = computeSeries(bounds)
      const prevSeries = computeSeries(prevBounds)
      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
      occupancy = { avgPct: avg(series), deltaPts: avg(series) - avg(prevSeries), series: series.length > 0 ? series : [0] }
    }

    // Revenue vs Target series -- real daily revenue, target spread evenly across the period.
    const dayLabels: string[] = []
    const revenueSeries: number[] = []
    const revenueTargetSeries: number[] = []
    {
      const cur = new Date(bounds.start)
      const end = new Date(bounds.end)
      const totalDays = Math.max(1, Math.round((end.getTime() - cur.getTime()) / 86400000) + 1)
      const perDayTarget = revenueTarget / totalDays
      let cumulative = 0
      let i = 0
      while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
        dayLabels.push(key)
        cumulative += curr.dayRevenue.get(key) ?? 0
        revenueSeries.push(cumulative)
        revenueTargetSeries.push(perDayTarget * (i + 1))
        cur.setDate(cur.getDate() + 1)
        i++
      }
    }

    const channelPerf: ChannelPerf[] = Array.from(manual.byChannel.entries()).map(([channel, vals]) => ({
      channel: CHANNEL_LABELS[channel] ?? channel,
      reach: vals.reach ?? 0, leads: vals.leads ?? 0, prospects: vals.prospects ?? 0, spend: vals.spend ?? 0,
    }))

    setData({
      primaryStats, secondaryStats, bookingChannels, funnel, opportunities,
      aiSummaryText, aiPriorities, channelPerf, alerts, occupancy,
      revenueSeries, revenueTargetSeries, revenueTotal: curr.revenue, revenueTargetTotal: revenueTarget,
      dayLabels,
    })
    setLoading(false)
  }, [tenantId, branchFilter, bounds.start, bounds.end, prevBounds.start, prevBounds.end])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Overview</h1>
          <p style={{ fontSize: 12, color: '#6A6A6A', margin: '3px 0 0' }}>Real-time overview of your sales &amp; marketing performance.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          <button
            onClick={() => setMetricsEditorOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.3)', borderRadius: 8, color: ORANGE, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <Sliders size={13} /> Marketing Metrics
          </button>
          {(['this_month', 'last_month', 'last_3_months', 'custom'] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${dateRange === r ? ORANGE : '#2A2A2A'}`,
                backgroundColor: dateRange === r ? 'rgba(241,90,34,0.1)' : '#161616',
                color: dateRange === r ? ORANGE : '#A0A0A0', fontWeight: dateRange === r ? 600 : 400,
              }}
            >
              {r === 'this_month' ? 'This Month' : r === 'last_month' ? 'Last Month' : r === 'last_3_months' ? 'Last 3 Months' : 'Custom'}
            </button>
          ))}
          {dateRange === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: '#161616', color: '#F0F0F0', fontSize: 12 }} />
              <span style={{ color: '#6A6A6A', fontSize: 12 }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: '#161616', color: '#F0F0F0', fontSize: 12 }} />
            </>
          )}
          <div style={{ fontSize: 11, color: '#6A6A6A', backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '7px 10px' }}>
            {fmtDateLabel(bounds.start)} – {fmtDateLabel(bounds.end)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2A2A2A' }}>
        {[
          { key: 'dashboard' as const, label: 'Dashboard' },
          { key: 'campaigns' as const, label: 'Campaigns & Planning' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.key ? ORANGE : 'transparent'}`,
              color: tab === t.key ? ORANGE : '#8A8A8A', marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' ? <DashboardTab data={data} loading={loading} /> : <CampaignsPlanningTab />}

      {tenantId && (
        <MarketingMetricsEditor
          open={metricsEditorOpen}
          onClose={() => setMetricsEditorOpen(false)}
          tenantId={tenantId}
          branchId={branchFilter}
          periodMonth={monthsInRange(bounds)[0] ?? bounds.start.slice(0, 7) + '-01'}
          onSaved={load}
        />
      )}
    </div>
  )
}
