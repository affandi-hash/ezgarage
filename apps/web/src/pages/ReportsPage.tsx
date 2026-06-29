import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BarChart2,
  Wrench,
  DollarSign,
  Users,
  Truck,
  Download,
  RefreshCw,
  TrendingUp,
  Clock,
  Star,
  AlertCircle,
  CheckCircle2,
  X,
  ShoppingCart,
  Percent,
  UserCheck,
  Receipt,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'

const BG = '#0E0E0E'
const SURFACE = '#161616'
const BORDER = '#2A2A2A'
const ORANGE = '#F15A22'
const TEXT_PRIMARY = '#F0F0F0'
const TEXT_SECONDARY = '#A0A0A0'

const STATUS_LABELS: Record<string, string> = {
  received: 'Received',
  inspecting: 'Inspecting',
  waiting_approval: 'Waiting Approval',
  in_progress: 'In Progress',
  waiting_for_parts: 'Waiting Parts',
  done: 'Done',
  collected: 'Collected',
  cancelled: 'Cancelled',
}

const STATUS_COLORS: Record<string, string> = {
  received: '#94a3b8',
  inspecting: '#60a5fa',
  waiting_approval: '#fbbf24',
  in_progress: '#fb923c',
  waiting_for_parts: '#a78bfa',
  done: '#4ade80',
  collected: '#34d399',
  cancelled: '#f87171',
}

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

function formatRM(amount: number) {
  return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: '2-digit' })
}

function last6MonthsKeys(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  sub?: string
}

function StatCard({ label, value, icon: Icon, sub }: StatCardProps) {
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '20px 20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>{label}</span>
        <div style={{ background: `${ORANGE}18`, borderRadius: 8, padding: 7, display: 'flex' }}>
          <Icon size={16} color={ORANGE} />
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: TEXT_PRIMARY, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

interface DivBarProps {
  label: string
  value: number
  max: number
  color?: string
  suffix?: string
}

function DivBar({ label, value, max, color = ORANGE, suffix = '' }: DivBarProps) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: TEXT_PRIMARY }}>{label}</span>
        <span style={{ fontSize: 13, color: TEXT_SECONDARY, fontWeight: 600 }}>
          {suffix ? `${value}${suffix}` : value}
        </span>
      </div>
      <div style={{ height: 8, background: BORDER, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

type TabKey = 'overview' | 'workshop' | 'revenue' | 'staff' | 'fleet'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart2 },
  { key: 'workshop', label: 'Workshop', icon: Wrench },
  { key: 'revenue', label: 'Revenue', icon: DollarSign },
  { key: 'staff', label: 'Staff', icon: Users },
  { key: 'fleet', label: 'Fleet', icon: Truck },
]

export function ReportsPage() {
  const user = useAuthStore((s) => s.user)
  const isSuperAdmin = user?.role === 'super_admin'
  const branchFilter = isSuperAdmin ? null : user?.branch_id ?? null

  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [dateRange, setDateRange] = useState<DateRange>('this_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [toast, setToast] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const bounds = getDateBounds(dateRange, customStart, customEnd)

  const [loading, setLoading] = useState(false)
  const [overviewData, setOverviewData] = useState<{
    totalJobs: number
    revenue: number
    avgDays: number
    topMechanic: string
    topJobType: string
    statusCounts: { status: string; count: number }[]
    cogs: number
    grossProfit: number
    grossProfitPct: number
    uniqueCustomers: number
    avgSpendPerTx: number
    totalParts: number
    totalLabour: number
  } | null>(null)

  const [workshopJobs, setWorkshopJobs] = useState<{
    id: string
    job_number: string
    status: string
    mechanic: string
    days: number
    service_type: string
    created_at: string
  }[]>([])
  const [workshopStatusFilter, setWorkshopStatusFilter] = useState('all')

  const [revenueData, setRevenueData] = useState<{
    monthly: { month: string; total: number }[]
    partsTotal: number
    labourTotal: number
    outstanding: number
  } | null>(null)

  const [staffData, setStaffData] = useState<{
    id: string
    full_name: string
    role: string
    jobs_completed: number
    avg_days: number
    attendance_rate: number
  }[]>([])

  const [fleetData, setFleetData] = useState<{
    vehicleCount: number
    tripsThisMonth: number
    kmDriven: number
    issuesOpen: number
  } | null>(null)

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    try {
      let jobQ = supabase
        .from('jobs')
        .select('id, status, service_type, created_at, closed_at, assigned_mechanic_id, final_amount, payment_status, customer_id, branch_id')
        .gte('created_at', bounds.start)
        .lte('created_at', bounds.end + 'T23:59:59')
      if (branchFilter) jobQ = jobQ.eq('branch_id', branchFilter)
      const { data: jobs } = await jobQ

      const totalJobs = jobs?.length ?? 0

      const statusMap: Record<string, number> = {}
      const svcMap: Record<string, number> = {}
      const mechMap: Record<string, number> = {}
      const customerSet = new Set<string>()
      let daysSum = 0
      let daysCount = 0
      let revenue = 0
      let paidJobCount = 0

      jobs?.forEach((j: { status: string; service_type: string; assigned_mechanic_id: string; created_at: string; closed_at: string | null; final_amount: number | null; payment_status: string | null; customer_id: string | null }) => {
        statusMap[j.status] = (statusMap[j.status] ?? 0) + 1
        if (j.service_type) svcMap[j.service_type] = (svcMap[j.service_type] ?? 0) + 1
        if (j.assigned_mechanic_id) mechMap[j.assigned_mechanic_id] = (mechMap[j.assigned_mechanic_id] ?? 0) + 1
        if (j.customer_id) customerSet.add(j.customer_id)
        if (j.closed_at && j.created_at) {
          const d = (new Date(j.closed_at).getTime() - new Date(j.created_at).getTime()) / 86400000
          if (d >= 0) { daysSum += d; daysCount++ }
        }
        if (j.payment_status === 'paid' && j.final_amount) {
          revenue += j.final_amount
          paidJobCount++
        }
      })

      // Fetch actual parts + labour from invoices.line_items (JSONB) for jobs in this period
      const jobIds = (jobs ?? []).map((j: { id: string }) => j.id)
      let totalParts = 0
      let totalLabour = 0
      if (jobIds.length > 0) {
        const { data: invRows } = await supabase
          .from('invoices')
          .select('job_id, line_items, status')
          .in('job_id', jobIds)
          .in('status', ['paid', 'sent'])
        type LineItem = { item_type: string; amount?: number; qty?: number; unit_price?: number }
        invRows?.forEach((inv: { line_items: LineItem[] | null }) => {
          (inv.line_items ?? []).forEach((li) => {
            const amt = li.amount ?? (li.qty ?? 1) * (li.unit_price ?? 0)
            if (li.item_type === 'part') totalParts += amt
            else if (li.item_type === 'labour') totalLabour += amt
          })
        })
      }

      // If actual data exists, use it for COGS; otherwise fall back to 40% estimate
      const cogs = totalParts > 0 ? totalParts : revenue * 0.4
      const grossProfit = revenue - cogs
      const grossProfitPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0
      const avgSpendPerTx = paidJobCount > 0 ? revenue / paidJobCount : 0

      const topJobType = Object.entries(svcMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      const topMechId = Object.entries(mechMap).sort((a, b) => b[1] - a[1])[0]?.[0]
      let topMechanic = '—'
      if (topMechId) {
        const { data: mp } = await supabase.from('users').select('full_name').eq('id', topMechId).single()
        if (mp) topMechanic = mp.full_name
      }

      setOverviewData({
        totalJobs,
        revenue,
        avgDays: daysCount > 0 ? Math.round((daysSum / daysCount) * 10) / 10 : 0,
        topMechanic,
        topJobType,
        statusCounts: Object.entries(statusMap).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
        cogs,
        grossProfit,
        grossProfitPct,
        uniqueCustomers: customerSet.size,
        avgSpendPerTx,
        totalParts,
        totalLabour,
      })
    } finally {
      setLoading(false)
    }
  }, [bounds.start, bounds.end, branchFilter])

  const fetchWorkshop = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('jobs')
        .select('id, job_number, status, service_type, created_at, closed_at, assigned_mechanic_id, branch_id')
        .gte('created_at', bounds.start)
        .lte('created_at', bounds.end + 'T23:59:59')
        .order('created_at', { ascending: false })
        .limit(100)
      if (branchFilter) q = q.eq('branch_id', branchFilter)
      const { data: jobs } = await q

      const mechIds = [...new Set((jobs ?? []).map((j: { assigned_mechanic_id: string }) => j.assigned_mechanic_id).filter(Boolean))]
      const mechNames: Record<string, string> = {}
      if (mechIds.length > 0) {
        const { data: mechs } = await supabase.from('users').select('id, full_name').in('id', mechIds)
        mechs?.forEach((m: { id: string; full_name: string }) => { mechNames[m.id] = m.full_name })
      }

      setWorkshopJobs(
        (jobs ?? []).map((j: { id: string; job_number: string; status: string; service_type: string; created_at: string; closed_at: string | null; assigned_mechanic_id: string }) => ({
          id: j.id,
          job_number: j.job_number,
          status: j.status,
          mechanic: mechNames[j.assigned_mechanic_id] ?? '—',
          days: j.closed_at
            ? Math.round((new Date(j.closed_at).getTime() - new Date(j.created_at).getTime()) / 86400000)
            : Math.round((Date.now() - new Date(j.created_at).getTime()) / 86400000),
          service_type: j.service_type ?? '—',
          created_at: j.created_at,
        }))
      )
    } finally {
      setLoading(false)
    }
  }, [bounds.start, bounds.end, branchFilter])

  const fetchRevenue = useCallback(async () => {
    setLoading(true)
    try {
      const months = last6MonthsKeys()
      const sixMonthsAgo = months[0] + '-01'

      let revQ = supabase
        .from('jobs')
        .select('final_amount, estimated_cost, payment_status, closed_at, created_at, branch_id')
        .gte('created_at', sixMonthsAgo)
      if (branchFilter) revQ = revQ.eq('branch_id', branchFilter)
      const { data: revJobs } = await revQ

      const monthMap: Record<string, number> = {}
      months.forEach((m) => { monthMap[m] = 0 })
      let partsTotal = 0
      let labourTotal = 0
      let outstanding = 0

      revJobs?.forEach((j: { final_amount: number | null; estimated_cost: number | null; payment_status: string | null; created_at: string }) => {
        const m = j.created_at.substring(0, 7)
        const amt = j.final_amount ?? j.estimated_cost ?? 0
        if (j.payment_status === 'paid') {
          if (monthMap[m] !== undefined) monthMap[m] += amt
          partsTotal += amt * 0.4
          labourTotal += amt * 0.6
        }
        if (!j.payment_status || j.payment_status === 'unpaid' || j.payment_status === 'pending') outstanding++
      })

      setRevenueData({
        monthly: months.map((m) => ({ month: m, total: monthMap[m] })),
        partsTotal,
        labourTotal,
        outstanding,
      })
    } finally {
      setLoading(false)
    }
  }, [branchFilter])

  const fetchStaff = useCallback(async () => {
    setLoading(true)
    try {
      let staffQ = supabase
        .from('staff_profiles')
        .select('id, user_id, position, department')
      if (branchFilter) staffQ = staffQ.eq('branch_id', branchFilter)
      const { data: staff } = await staffQ

      const userIds = (staff ?? []).map((s: { user_id: string }) => s.user_id).filter(Boolean)
      const nameMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: staffUsers } = await supabase.from('users').select('id, full_name').in('id', userIds)
        staffUsers?.forEach((u: { id: string; full_name: string }) => { nameMap[u.id] = u.full_name })
      }

      const jobsQ = supabase
        .from('jobs')
        .select('assigned_mechanic_id, created_at, closed_at')
        .eq('status', 'closed')
        .gte('created_at', bounds.start)
        .lte('created_at', bounds.end + 'T23:59:59')
      const { data: completedJobs } = await jobsQ

      const jobCountMap: Record<string, number> = {}
      const jobDaysMap: Record<string, number[]> = {}
      completedJobs?.forEach((j: { assigned_mechanic_id: string; created_at: string; closed_at: string | null }) => {
        if (!j.assigned_mechanic_id) return
        jobCountMap[j.assigned_mechanic_id] = (jobCountMap[j.assigned_mechanic_id] ?? 0) + 1
        if (j.closed_at) {
          const d = (new Date(j.closed_at).getTime() - new Date(j.created_at).getTime()) / 86400000
          if (!jobDaysMap[j.assigned_mechanic_id]) jobDaysMap[j.assigned_mechanic_id] = []
          jobDaysMap[j.assigned_mechanic_id].push(d)
        }
      })

      setStaffData(
        (staff ?? []).map((s: { id: string; user_id: string; position: string }) => {
          const days = jobDaysMap[s.user_id] ?? []
          const avgDays = days.length > 0 ? Math.round((days.reduce((a: number, b: number) => a + b, 0) / days.length) * 10) / 10 : 0
          return {
            id: s.id,
            full_name: nameMap[s.user_id] ?? '—',
            role: s.position ?? '—',
            jobs_completed: jobCountMap[s.user_id] ?? 0,
            avg_days: avgDays,
            attendance_rate: 0,
          }
        })
      )
    } finally {
      setLoading(false)
    }
  }, [bounds.start, bounds.end, branchFilter])

  const fetchFleet = useCallback(async () => {
    setLoading(true)
    try {
      let vcQ = supabase.from('fleet_vehicles').select('id', { count: 'exact', head: true })
      if (branchFilter) vcQ = vcQ.eq('branch_id', branchFilter)
      const { count: vehicleCount } = await vcQ

      let tripQ = supabase
        .from('fleet_trips')
        .select('id, distance_km', { count: 'exact' })
        .gte('start_time', bounds.start)
        .lte('start_time', bounds.end + 'T23:59:59')
      if (branchFilter) tripQ = tripQ.eq('branch_id', branchFilter)
      const { data: trips, count: tripsCount } = await tripQ

      const kmDriven = trips?.reduce((s: number, t: { distance_km: number }) => s + (t.distance_km ?? 0), 0) ?? 0

      let issueQ = supabase
        .from('fleet_issues')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
      if (branchFilter) issueQ = issueQ.eq('branch_id', branchFilter)
      const { count: issuesOpen } = await issueQ

      setFleetData({
        vehicleCount: vehicleCount ?? 0,
        tripsThisMonth: tripsCount ?? 0,
        kmDriven,
        issuesOpen: issuesOpen ?? 0,
      })
    } finally {
      setLoading(false)
    }
  }, [bounds.start, bounds.end, branchFilter])

  useEffect(() => {
    if (activeTab === 'overview') fetchOverview()
    if (activeTab === 'workshop') fetchWorkshop()
    if (activeTab === 'revenue') fetchRevenue()
    if (activeTab === 'staff') fetchStaff()
    if (activeTab === 'fleet') fetchFleet()
  }, [activeTab, fetchOverview, fetchWorkshop, fetchRevenue, fetchStaff, fetchFleet])

  function showToast() {
    setToast(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(false), 3000)
  }

  const filteredWorkshopJobs = workshopStatusFilter === 'all'
    ? workshopJobs
    : workshopJobs.filter((j) => j.status === workshopStatusFilter)

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: 'inherit' }}>
      <div style={{ padding: '24px 28px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT_PRIMARY, margin: 0 }}>Reports</h1>
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, marginTop: 3 }}>
              {isSuperAdmin ? 'All branches' : 'Your branch'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => {
                if (activeTab === 'overview') fetchOverview()
                if (activeTab === 'workshop') fetchWorkshop()
                if (activeTab === 'revenue') fetchRevenue()
                if (activeTab === 'staff') fetchStaff()
                if (activeTab === 'fleet') fetchFleet()
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: TEXT_SECONDARY, fontSize: 13, cursor: 'pointer' }}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              onClick={showToast}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: `1px solid ${ORANGE}`, background: 'transparent', color: ORANGE, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
            >
              <Download size={14} />
              Export
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${BORDER}`, marginBottom: 0 }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '11px 18px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? `2px solid ${ORANGE}` : '2px solid transparent',
                  color: active ? ORANGE : TEXT_SECONDARY,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                  marginBottom: -1,
                }}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ padding: '20px 28px 40px' }}>
        {activeTab !== 'revenue' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            {(['this_month', 'last_month', 'last_3_months', 'custom'] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: `1px solid ${dateRange === r ? ORANGE : BORDER}`,
                  background: dateRange === r ? `${ORANGE}18` : SURFACE,
                  color: dateRange === r ? ORANGE : TEXT_SECONDARY,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: dateRange === r ? 600 : 400,
                }}
              >
                {r === 'this_month' ? 'This Month' : r === 'last_month' ? 'Last Month' : r === 'last_3_months' ? 'Last 3 Months' : 'Custom'}
              </button>
            ))}
            {dateRange === 'custom' && (
              <>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT_PRIMARY, fontSize: 12 }}
                />
                <span style={{ color: TEXT_SECONDARY, fontSize: 12 }}>to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT_PRIMARY, fontSize: 12 }}
                />
              </>
            )}
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', color: TEXT_SECONDARY, gap: 10 }}>
            <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
            Loading…
          </div>
        )}

        {!loading && activeTab === 'overview' && overviewData && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14, marginBottom: 24 }}>
              <StatCard label="Total Jobs" value={overviewData.totalJobs} icon={Wrench} sub="In selected period" />
              <StatCard label="Revenue" value={formatRM(overviewData.revenue)} icon={DollarSign} sub="Paid invoices" />
              <StatCard label="Total Parts" value={formatRM(overviewData.totalParts)} icon={ShoppingCart} sub={overviewData.totalParts > 0 ? 'From invoice lines' : 'No parts invoiced'} />
              <StatCard label="Total Labour" value={formatRM(overviewData.totalLabour)} icon={Wrench} sub={overviewData.totalLabour > 0 ? 'From labour charges' : 'No labour invoiced'} />
              <StatCard label="COGS" value={formatRM(overviewData.cogs)} icon={ShoppingCart} sub={overviewData.totalParts > 0 ? 'Actual parts cost' : 'Est. parts cost (40%)'} />
              <StatCard label="Gross Profit" value={formatRM(overviewData.grossProfit)} icon={TrendingUp} sub="Revenue minus COGS" />
              <StatCard label="Gross Profit %" value={`${overviewData.grossProfitPct.toFixed(1)}%`} icon={Percent} sub={overviewData.grossProfitPct >= 50 ? 'Healthy margin' : 'Below target'} />
              <StatCard label="No. of Customers" value={overviewData.uniqueCustomers} icon={UserCheck} sub="Unique in period" />
              <StatCard label="Avg Spend / Txn" value={formatRM(overviewData.avgSpendPerTx)} icon={Receipt} sub="Per paid invoice" />
              <StatCard label="Avg Turnaround" value={`${overviewData.avgDays}d`} icon={Clock} sub="Completed jobs" />
              <StatCard label="Top Mechanic" value={overviewData.topMechanic} icon={Star} sub="By job count" />
              <StatCard label="Top Job Type" value={overviewData.topJobType} icon={BarChart2} sub="Most frequent" />
            </div>

            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: '0 0 16px' }}>Jobs by Status</h3>
              {overviewData.statusCounts.length === 0 ? (
                <p style={{ color: TEXT_SECONDARY, fontSize: 13 }}>No jobs in selected period.</p>
              ) : (
                overviewData.statusCounts.map(({ status, count }) => (
                  <DivBar
                    key={status}
                    label={STATUS_LABELS[status] ?? status}
                    value={count}
                    max={overviewData.statusCounts[0].count}
                    color={STATUS_COLORS[status] ?? ORANGE}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {!loading && activeTab === 'workshop' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>Status:</span>
              {['all', ...Object.keys(STATUS_LABELS)].map((s) => (
                <button
                  key={s}
                  onClick={() => setWorkshopStatusFilter(s)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: `1px solid ${workshopStatusFilter === s ? (STATUS_COLORS[s] ?? ORANGE) : BORDER}`,
                    background: workshopStatusFilter === s ? `${STATUS_COLORS[s] ?? ORANGE}18` : SURFACE,
                    color: workshopStatusFilter === s ? (STATUS_COLORS[s] ?? ORANGE) : TEXT_SECONDARY,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: workshopStatusFilter === s ? 600 : 400,
                  }}
                >
                  {s === 'all' ? 'All' : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {['Job No.', 'Status', 'Service Type', 'Mechanic', 'Days', 'Date'].map((h) => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: TEXT_SECONDARY, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWorkshopJobs.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '32px 16px', textAlign: 'center', color: TEXT_SECONDARY }}>No jobs found.</td>
                      </tr>
                    ) : (
                      filteredWorkshopJobs.map((job) => (
                        <tr key={job.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <td style={{ padding: '11px 16px', color: TEXT_PRIMARY, fontFamily: 'monospace', fontSize: 12 }}>{job.job_number}</td>
                          <td style={{ padding: '11px 16px' }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 9px',
                              borderRadius: 12,
                              fontSize: 12,
                              fontWeight: 600,
                              background: `${STATUS_COLORS[job.status] ?? '#94a3b8'}18`,
                              color: STATUS_COLORS[job.status] ?? '#94a3b8',
                              border: `1px solid ${STATUS_COLORS[job.status] ?? '#94a3b8'}30`,
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[job.status] ?? '#94a3b8', flexShrink: 0 }} />
                              {STATUS_LABELS[job.status] ?? job.status}
                            </span>
                          </td>
                          <td style={{ padding: '11px 16px', color: TEXT_PRIMARY }}>{job.service_type}</td>
                          <td style={{ padding: '11px 16px', color: TEXT_SECONDARY }}>{job.mechanic}</td>
                          <td style={{ padding: '11px 16px', color: job.days > 7 ? '#f87171' : TEXT_PRIMARY, fontWeight: 600 }}>{job.days}d</td>
                          <td style={{ padding: '11px 16px', color: TEXT_SECONDARY }}>{new Date(job.created_at).toLocaleDateString('en-MY')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === 'revenue' && revenueData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: '0 0 16px' }}>Monthly Revenue (last 6 months)</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, overflowX: 'auto', paddingBottom: 8 }}>
                {(() => {
                  const maxVal = Math.max(...revenueData.monthly.map((m) => m.total), 1)
                  return revenueData.monthly.map((m) => {
                    const pct = (m.total / maxVal) * 100
                    return (
                      <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1, minWidth: 52 }}>
                        <span style={{ fontSize: 11, color: TEXT_SECONDARY, textAlign: 'center' }}>{m.total > 0 ? formatRM(m.total) : '—'}</span>
                        <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', height: 100 }}>
                          <div style={{
                            width: '100%',
                            height: `${Math.max(pct, m.total > 0 ? 3 : 0)}%`,
                            background: m.total > 0 ? ORANGE : BORDER,
                            borderRadius: '4px 4px 0 0',
                            transition: 'height 0.4s',
                          }} />
                        </div>
                        <span style={{ fontSize: 11, color: TEXT_SECONDARY }}>{monthLabel(m.month)}</span>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
              <StatCard label="Parts Cost" value={formatRM(revenueData.partsTotal)} icon={Wrench} sub="Paid invoices" />
              <StatCard label="Labour Revenue" value={formatRM(revenueData.labourTotal)} icon={DollarSign} sub="Paid invoices" />
              <StatCard label="Outstanding Invoices" value={revenueData.outstanding} icon={AlertCircle} sub="Unpaid / pending" />
            </div>

            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: '0 0 16px' }}>Parts vs Labour Split</h3>
              {(() => {
                const total = revenueData.partsTotal + revenueData.labourTotal
                const partsPct = total > 0 ? (revenueData.partsTotal / total) * 100 : 0
                const labourPct = total > 0 ? (revenueData.labourTotal / total) * 100 : 0
                return (
                  <div>
                    <div style={{ display: 'flex', height: 18, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
                      <div style={{ width: `${partsPct}%`, background: '#60a5fa', transition: 'width 0.4s' }} />
                      <div style={{ width: `${labourPct}%`, background: ORANGE, transition: 'width 0.4s' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT_SECONDARY }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: '#60a5fa', flexShrink: 0 }} />
                        Parts — {partsPct.toFixed(0)}%
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT_SECONDARY }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: ORANGE, flexShrink: 0 }} />
                        Labour — {labourPct.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {!loading && activeTab === 'staff' && (
          <div>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {['Name', 'Role', 'Jobs Completed', 'Avg Days/Job', 'Attendance Rate'].map((h) => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: TEXT_SECONDARY, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {staffData.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '32px 16px', textAlign: 'center', color: TEXT_SECONDARY }}>No staff data found.</td>
                      </tr>
                    ) : (
                      staffData
                        .sort((a, b) => b.jobs_completed - a.jobs_completed)
                        .map((s) => (
                          <tr key={s.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                            <td style={{ padding: '11px 16px', color: TEXT_PRIMARY, fontWeight: 600 }}>{s.full_name}</td>
                            <td style={{ padding: '11px 16px', color: TEXT_SECONDARY, textTransform: 'capitalize' }}>{s.role.replace(/_/g, ' ')}</td>
                            <td style={{ padding: '11px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ color: TEXT_PRIMARY, fontWeight: 600, minWidth: 28 }}>{s.jobs_completed}</span>
                                <div style={{ flex: 1, height: 6, background: BORDER, borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
                                  <div style={{ height: '100%', width: `${Math.min((s.jobs_completed / (Math.max(...staffData.map(x => x.jobs_completed)) || 1)) * 100, 100)}%`, background: ORANGE, borderRadius: 3 }} />
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '11px 16px', color: s.avg_days > 5 ? '#fbbf24' : TEXT_PRIMARY }}>{s.avg_days > 0 ? `${s.avg_days}d` : '—'}</td>
                            <td style={{ padding: '11px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: s.attendance_rate >= 90 ? '#4ade80' : s.attendance_rate >= 75 ? '#fbbf24' : '#f87171', fontWeight: 600 }}>
                                  {s.attendance_rate > 0 ? `${s.attendance_rate}%` : '—'}
                                </span>
                                {s.attendance_rate >= 90 && <CheckCircle2 size={13} color="#4ade80" />}
                                {s.attendance_rate > 0 && s.attendance_rate < 75 && <AlertCircle size={13} color="#f87171" />}
                              </div>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === 'fleet' && fleetData && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
              <StatCard label="Total Vehicles" value={fleetData.vehicleCount} icon={Truck} sub="Registered fleet" />
              <StatCard label="Trips This Month" value={fleetData.tripsThisMonth} icon={TrendingUp} sub="In selected period" />
              <StatCard label="KM Driven" value={`${fleetData.kmDriven.toLocaleString()} km`} icon={BarChart2} sub="In selected period" />
              <StatCard
                label="Open Issues"
                value={fleetData.issuesOpen}
                icon={AlertCircle}
                sub={fleetData.issuesOpen > 0 ? 'Needs attention' : 'All clear'}
              />
            </div>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: '0 0 16px' }}>Fleet Utilization</h3>
              <DivBar label="Trips" value={fleetData.tripsThisMonth} max={Math.max(fleetData.tripsThisMonth, 1)} color={ORANGE} />
              <DivBar label="KM Driven" value={fleetData.kmDriven} max={Math.max(fleetData.kmDriven, 1)} color="#60a5fa" suffix=" km" />
              <DivBar label="Open Issues" value={fleetData.issuesOpen} max={Math.max(fleetData.issuesOpen, fleetData.vehicleCount, 1)} color="#f87171" />
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 9999,
          color: TEXT_PRIMARY,
          fontSize: 13,
          minWidth: 240,
        }}>
          <Download size={16} color={ORANGE} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Export coming soon</span>
          <button
            onClick={() => setToast(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEXT_SECONDARY, display: 'flex', padding: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
