import { useState } from 'react'
import {
  Users, Link2, Filter, UserCheck, ShoppingCart, Wallet, CircleDollarSign,
  Star, TrendingUp, TrendingDown, Sparkles, AlertTriangle, Megaphone,
  CalendarDays, Bike, Building2, Car, MessageCircle, Share2, Footprints,
  Search, PartyPopper, UserPlus, Percent,
} from 'lucide-react'

// Sample data only -- this page is a design pass to agree on the layout
// before any of it is wired to real tenant data. Every number below is
// illustrative, not a live query.

const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }

const GOOD = '#4ade80'
const BAD = '#f87171'
const WARN = '#fbbf24'
const INFO = '#60a5fa'
const ORANGE = '#F15A22'

// Sequential ramp, light -> dark, for the funnel stages (magnitude, not category).
const FUNNEL_RAMP = ['#FDE0D1', '#FBB790', '#F8894F', '#F15A22', '#C43D0F']

interface StatTile { label: string; value: string; delta: string; good: boolean; icon: React.ElementType; sub?: string }

const PRIMARY_STATS: StatTile[] = [
  { label: 'Reach', value: '126,540', delta: '+18%', good: true, icon: Users },
  { label: 'Leads', value: '1,248', delta: '+15%', good: true, icon: Link2 },
  { label: 'Prospects', value: '612', delta: '+10%', good: true, icon: Filter },
  { label: 'Customers', value: '298', delta: '+12%', good: true, icon: UserCheck },
  { label: 'Transactions', value: '467', delta: '+14%', good: true, icon: ShoppingCart },
  { label: 'Avg $ / Trans.', value: 'RM176', delta: '+6%', good: true, icon: Wallet },
  { label: 'Gross Profit', value: 'RM82,340', delta: '+16%', good: true, icon: CircleDollarSign },
]

const SECONDARY_STATS: StatTile[] = [
  { label: 'Bookings', value: '41', delta: '+15%', good: true, icon: CalendarDays },
  { label: 'Conversion Rate', value: '49%', delta: '+2%', good: true, icon: Percent, sub: 'Leads to Bookings' },
  { label: 'Google Reviews', value: '12', delta: '★ 4.8', good: true, icon: Star, sub: 'This month' },
  { label: 'ESP Members', value: '31', delta: '+8%', good: true, icon: Users, sub: 'Total members' },
]

const FUNNEL = [
  { label: 'Reach', value: 126540, pct: '100%' },
  { label: 'Leads', value: 1248, pct: '1.0%' },
  { label: 'Prospects', value: 612, pct: '0.5%' },
  { label: 'Customers', value: 298, pct: '0.2%' },
  { label: 'Transactions', value: 467, pct: '0.4%' },
]

const OPPORTUNITIES = [
  { icon: Bike, title: 'Harley Owners', note: 'High potential Harley owners in Puchong & Subang area', potential: 'RM18,000', stars: 5 },
  { icon: Building2, title: 'Corporate Fleet', note: '3 companies showing interest in fleet servicing', potential: 'RM24,000', stars: 5 },
  { icon: Car, title: 'E-Hailing Drivers', note: 'More e-hailing drivers need monthly maintenance', potential: 'RM8,000', stars: 4 },
]

interface ChannelRow {
  icon: React.ElementType; color: string; name: string
  reach: number; leads: number; prospects: number; customers: number; transactions: number
  avgTrans: number; grossProfit: number; convRate: number; roi: number
}

const CHANNELS: ChannelRow[] = [
  { icon: MessageCircle, color: '#4ade80', name: 'Mia (WhatsApp)', reach: 42890, leads: 568, prospects: 294, customers: 152, transactions: 233, avgTrans: 181, grossProfit: 42073, convRate: 26.8, roi: 7.6 },
  { icon: Share2, color: '#60a5fa', name: 'Facebook / Instagram', reach: 36240, leads: 362, prospects: 176, customers: 86, transactions: 128, avgTrans: 168, grossProfit: 21504, convRate: 23.8, roi: 5.1 },
  { icon: Footprints, color: '#F0F0F0', name: 'Walk-in', reach: 18650, leads: 210, prospects: 120, customers: 78, transactions: 125, avgTrans: 162, grossProfit: 20250, convRate: 37.1, roi: 4.2 },
  { icon: Search, color: '#fbbf24', name: 'Google (Search/Maps)', reach: 14780, leads: 98, prospects: 48, customers: 24, transactions: 39, avgTrans: 195, grossProfit: 7605, convRate: 24.5, roi: 6.3 },
  { icon: PartyPopper, color: '#c084fc', name: 'Community / Events', reach: 7980, leads: 74, prospects: 38, customers: 18, transactions: 22, avgTrans: 159, grossProfit: 3169, convRate: 24.3, roi: 3.9 },
  { icon: UserPlus, color: '#fb923c', name: 'Referrals', reach: 5000, leads: 36, prospects: 16, customers: 10, transactions: 20, avgTrans: 190, grossProfit: 2739, convRate: 27.8, roi: 8.4 },
]

const ALERTS = [
  { icon: Star, severity: BAD, text: 'Google Reviews are below target.', sub: 'Need 8 more this month.', count: 8 },
  { icon: Users, severity: BAD, text: 'ESP registrations behind target.', sub: 'Target 40, current 31.', count: 9 },
  { icon: Megaphone, severity: WARN, text: 'Harley Full Service campaign 42% behind target.', sub: '', count: 3 },
  { icon: Building2, severity: INFO, text: 'No corporate visits scheduled this week.', sub: '', count: 1 },
  { icon: MessageCircle, severity: WARN, text: 'Quotations pending follow-up.', sub: '', count: 23 },
]

// Illustrative daily series across 1-31 Aug 2026.
const OCCUPANCY_SERIES = [58, 61, 63, 60, 65, 68, 70, 66, 64, 67, 69, 71, 68, 65, 63, 66, 70, 72, 69, 67, 65, 68, 71, 73, 70, 68, 66, 69, 71, 68, 68]
const REVENUE_ACTUAL = Array.from({ length: 31 }, (_, i) => Math.round(82340 * (1 - Math.cos((Math.PI / 2) * ((i + 1) / 31))) * 1.02))
const REVENUE_TARGET = Array.from({ length: 31 }, (_, i) => Math.round((120000 / 31) * (i + 1)))

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

function fmtRM(n: number) { return `RM${n.toLocaleString()}` }

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
        <span style={{ color: '#6A6A6A', fontWeight: 400 }}>{tile.sub ?? 'vs 1 - 31 Jul 2026'}</span>
      </div>
    </div>
  )
}

function SalesFunnel() {
  const max = FUNNEL[0].value
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Sales Funnel (This Month)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {FUNNEL.map((stage, i) => {
          const widthPct = Math.max(18, Math.round(100 * Math.pow(stage.value / max, 0.32)))
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

function StarRating({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={11} fill={i < count ? '#fbbf24' : 'none'} color={i < count ? '#fbbf24' : '#3A3A3A'} />
      ))}
    </div>
  )
}

function OpportunityRadar() {
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Opportunity Radar</div>
        <span style={{ fontSize: 11, color: ORANGE, cursor: 'pointer' }}>View All</span>
      </div>
      {OPPORTUNITIES.map(o => (
        <div key={o.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#1E1E1E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <o.icon size={15} color={ORANGE} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#F0F0F0' }}>{o.title}</div>
            <div style={{ fontSize: 11, color: '#8A8A8A', lineHeight: 1.4, margin: '2px 0 4px' }}>{o.note}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: GOOD, fontWeight: 700 }}>{o.potential} potential</span>
              <StarRating count={o.stars} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function AIExecutiveSummary() {
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Sparkles size={14} color={ORANGE} />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>AI Executive Summary</div>
      </div>
      <p style={{ fontSize: 12, color: '#C0C0C0', lineHeight: 1.6, margin: 0 }}>
        Revenue is below target by RM37,660. Mia (WhatsApp) is performing best with 7.6x ROI this month.
      </p>
      <div>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Top 3 Priorities</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {['Increase Ask Mia posts today', 'Follow up 23 outstanding quotations', 'Launch Harley Full Service campaign'].map((p, i) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#E0E0E0' }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'rgba(241,90,34,0.15)', color: ORANGE, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              {p}
            </div>
          ))}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #2A2A2A', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#8A8A8A' }}>Revenue (This Month)</span>
          <span style={{ color: '#F0F0F0', fontWeight: 700 }}>RM82,340</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#8A8A8A' }}>Target</span>
          <span style={{ color: '#A0A0A0' }}>RM120,000</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: '#8A8A8A' }}>Gap</span>
          <span style={{ color: BAD, fontWeight: 700 }}>-RM37,660</span>
        </div>
        <div style={{ width: '100%', height: 6, borderRadius: 999, backgroundColor: '#2A2A2A', overflow: 'hidden' }}>
          <div style={{ width: '69%', height: '100%', backgroundColor: ORANGE }} />
        </div>
      </div>
    </div>
  )
}

// Hardcoded to match the reference mockup's own total row exactly -- the
// per-channel dummy rows don't perfectly foot to it (illustrative data),
// so this is a fixed figure rather than a derived sum.
const CHANNEL_TOTALS = { reach: 126540, leads: 1248, prospects: 612, customers: 298, transactions: 467, avgTrans: 176, grossProfit: 82340, convRate: 23.9, roi: 6.0 }

function PerformanceTable() {
  const totals = CHANNEL_TOTALS
  const th: React.CSSProperties = { textAlign: 'left' as const, padding: '9px 12px', fontSize: 11, fontWeight: 700, color: '#6A6A6A', textTransform: 'uppercase' as const, letterSpacing: '0.02em', whiteSpace: 'nowrap' as const }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 12, color: '#E0E0E0', whiteSpace: 'nowrap' as const }

  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflowX: 'auto' as const }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Performance by Selling Method</div>
        <span style={{ fontSize: 11, color: ORANGE, cursor: 'pointer' }}>View All</span>
      </div>
      <table style={{ borderCollapse: 'collapse' as const, width: '100%' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
            <th style={th}>Selling Method</th>
            <th style={th}>Reach</th>
            <th style={th}>Leads</th>
            <th style={th}>Prospects</th>
            <th style={th}>Customers</th>
            <th style={th}>Transactions</th>
            <th style={th}>Avg $ / Trans.</th>
            <th style={th}>Gross Profit</th>
            <th style={th}>Conv. Rate</th>
            <th style={th}>ROI</th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.map(c => (
            <tr key={c.name} style={{ borderBottom: '1px solid #202020' }}>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <c.icon size={13} color={c.color} />
                  {c.name}
                </div>
              </td>
              <td style={td}>{c.reach.toLocaleString()}</td>
              <td style={td}>{c.leads.toLocaleString()}</td>
              <td style={td}>{c.prospects.toLocaleString()}</td>
              <td style={td}>{c.customers.toLocaleString()}</td>
              <td style={td}>{c.transactions.toLocaleString()}</td>
              <td style={td}>{fmtRM(c.avgTrans)}</td>
              <td style={td}>{fmtRM(c.grossProfit)}</td>
              <td style={{ ...td, color: c.convRate >= 30 ? GOOD : '#E0E0E0' }}>{c.convRate}%</td>
              <td style={{ ...td, color: GOOD, fontWeight: 700 }}>{c.roi}x</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>Total</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{totals.reach.toLocaleString()}</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{totals.leads.toLocaleString()}</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{totals.prospects.toLocaleString()}</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{totals.customers.toLocaleString()}</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{totals.transactions.toLocaleString()}</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{fmtRM(totals.avgTrans)}</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{fmtRM(totals.grossProfit)}</td>
            <td style={{ ...td, fontWeight: 700, color: '#F0F0F0' }}>{totals.convRate}%</td>
            <td style={{ ...td, fontWeight: 700, color: GOOD }}>{totals.roi}x</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function AlertsPanel() {
  return (
    <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <AlertTriangle size={14} color={WARN} />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Alerts & Attention Needed</div>
        </div>
        <span style={{ fontSize: 11, color: ORANGE, cursor: 'pointer' }}>View All</span>
      </div>
      {ALERTS.map((a, i) => (
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

function RevenueVsTargetChart() {
  const w = 560, h = 160, pad = 8
  const max = Math.max(...REVENUE_TARGET, ...REVENUE_ACTUAL)
  const toPoints = (data: number[]) => data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - (v / max) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#2A2A2A" strokeWidth={1} />
        <polyline points={toPoints(REVENUE_TARGET)} fill="none" stroke="#6A6A6A" strokeWidth={2} strokeDasharray="5,4" />
        <polyline points={toPoints(REVENUE_ACTUAL)} fill="none" stroke={ORANGE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#A0A0A0' }}>
          <span style={{ width: 14, height: 2, backgroundColor: ORANGE, display: 'inline-block' }} /> Revenue (RM82,340)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#A0A0A0' }}>
          <span style={{ width: 14, height: 2, backgroundColor: '#6A6A6A', display: 'inline-block', borderTop: '2px dashed #6A6A6A' }} /> Target (RM120,000)
        </div>
      </div>
    </div>
  )
}

function DashboardTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10 }}>
        {PRIMARY_STATS.map(t => <StatTileCard key={t.label} tile={t} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {SECONDARY_STATS.map(t => <StatTileCard key={t.label} tile={t} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        <AIExecutiveSummary />
        <SalesFunnel />
        <OpportunityRadar />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
        <PerformanceTable />
        <AlertsPanel />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Workshop Occupancy</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: '#F0F0F0' }}>68%</span>
              <span style={{ fontSize: 11, color: BAD, display: 'flex', alignItems: 'center', gap: 2 }}><TrendingDown size={11} /> 5%</span>
            </div>
          </div>
          <Sparkline data={OCCUPANCY_SERIES} color={GOOD} />
        </div>
        <div style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Revenue vs Target (This Month)</div>
            <span style={{ fontSize: 12, color: BAD, fontWeight: 700 }}>-RM37,660 gap</span>
          </div>
          <RevenueVsTargetChart />
        </div>
      </div>
    </div>
  )
}

function CampaignsPlanningTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <span style={{ fontSize: 11, color: ORANGE, cursor: 'pointer' }}>View All</span>
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
          <span style={{ fontSize: 11, color: ORANGE, cursor: 'pointer' }}>View Calendar</span>
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

export function SalesMarketingOverviewPage() {
  const [tab, setTab] = useState<'dashboard' | 'campaigns'>('dashboard')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Overview</h1>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: WARN, backgroundColor: `${WARN}1A`, padding: '3px 9px', borderRadius: 999 }}>
              Preview -- sample data
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#6A6A6A', margin: '3px 0 0' }}>Real-time overview of your sales & marketing performance -- design pass, not live data yet.</p>
        </div>
        <div style={{ fontSize: 12, color: '#A0A0A0', backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '7px 12px' }}>
          1 Aug - 31 Aug 2026
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

      {tab === 'dashboard' ? <DashboardTab /> : <CampaignsPlanningTab />}
    </div>
  )
}
