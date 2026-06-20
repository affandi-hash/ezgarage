import { useState, useEffect, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import type { JobStatus } from '@/types/job'

interface MonthlyRevRow {
  month: string  // 'YYYY-MM'
  branch_id: string
  branch_name: string
  revenue: number
}

interface StatusCount {
  status: JobStatus
  count: number
}

interface TopService {
  service_type: string
  count: number
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Received',
  inspecting: 'Inspecting',
  waiting_approval: 'Waiting Approval',
  in_progress: 'In Progress',
  waiting_for_parts: 'Waiting Parts',
  done: 'Done',
  collected: 'Collected',
}

const STATUS_COLORS: Record<string, string> = {
  received: '#94a3b8',
  inspecting: '#60a5fa',
  waiting_approval: '#fbbf24',
  in_progress: '#fb923c',
  waiting_for_parts: '#a78bfa',
  done: '#4ade80',
  collected: '#34d399',
}

function formatRM(amount: number) {
  return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function last6Months(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: '2-digit' })
}

function exportCSV(rows: Record<string, string | number>[], filename: string) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csvContent = [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => {
        const val = String(r[h] ?? '')
        return val.includes(',') ? `"${val}"` : val
      }).join(',')
    ),
  ].join('\n')
  const uri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent)
  const a = document.createElement('a')
  a.href = uri
  a.download = filename
  a.click()
}

export function ReportsPage() {
  const user = useAuthStore((s) => s.user)
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevRow[]>([])
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([])
  const [topServices, setTopServices] = useState<TopService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const months = last6Months()
  const monthStart = months[0] + '-01'
  const thisMonthStart = months[5] + '-01'
  const thisMonthEnd = new Date(
    new Date(thisMonthStart).getFullYear(),
    new Date(thisMonthStart).getMonth() + 1,
    0,
  ).toISOString().split('T')[0]

  const fetchReports = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Monthly revenue by branch — paid invoices grouped by month+branch
      const { data: invData, error: invErr } = await supabase
        .from('invoices')
        .select('total_amount, created_at, branch_id, branch:branches(name)')
        .eq('payment_status', 'paid')
        .gte('created_at', monthStart)

      if (invErr) throw new Error(invErr.message)

      // Build monthly revenue map
      const revMap: Record<string, Record<string, { revenue: number; branch_name: string }>> = {}
      months.forEach((m) => { revMap[m] = {} })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(invData ?? []).forEach((inv: any) => {
        const month = inv.created_at.substring(0, 7)
        if (!revMap[month]) return
        const bid = inv.branch_id
        if (!revMap[month][bid]) {
          const branchName = Array.isArray(inv.branch) ? (inv.branch[0]?.name ?? bid) : (inv.branch?.name ?? bid)
          revMap[month][bid] = { revenue: 0, branch_name: branchName }
        }
        revMap[month][bid].revenue += inv.total_amount ?? 0
      })

      const revRows: MonthlyRevRow[] = []
      Object.entries(revMap).forEach(([month, branches]) => {
        Object.entries(branches).forEach(([branch_id, data]) => {
          revRows.push({ month, branch_id, branch_name: data.branch_name, revenue: data.revenue })
        })
      })
      setMonthlyRevenue(revRows)

      // Job count by status (all time)
      const { data: jobData, error: jobErr } = await supabase
        .from('job_orders')
        .select('status')
      if (jobErr) throw new Error(jobErr.message)

      const statusMap: Record<string, number> = {}
      ;(jobData ?? []).forEach((j: { status: string }) => {
        statusMap[j.status] = (statusMap[j.status] ?? 0) + 1
      })
      setStatusCounts(
        Object.entries(statusMap)
          .map(([status, count]) => ({ status: status as JobStatus, count }))
          .sort((a, b) => b.count - a.count)
      )

      // Top 5 services this month
      const { data: thisMonthJobs, error: svcErr } = await supabase
        .from('job_orders')
        .select('service_type')
        .gte('created_at', thisMonthStart)
        .lte('created_at', thisMonthEnd + 'T23:59:59')
      if (svcErr) throw new Error(svcErr.message)

      const svcMap: Record<string, number> = {}
      ;(thisMonthJobs ?? []).forEach((j: { service_type: string }) => {
        svcMap[j.service_type] = (svcMap[j.service_type] ?? 0) + 1
      })
      setTopServices(
        Object.entries(svcMap)
          .map(([service_type, count]) => ({ service_type, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [monthStart, thisMonthStart, thisMonthEnd])

  useEffect(() => { fetchReports() }, [fetchReports])

  if (user?.role !== 'ceo') {
    return (
      <>
        <Header title="Reports" />
        <div className="p-6">
          <p className="text-gray-500 text-sm">Access restricted to CEO only.</p>
        </div>
      </>
    )
  }

  // --- Chart helpers ---
  // Monthly revenue bar chart: group by month, stack branches
  const branchIds = Array.from(new Set(monthlyRevenue.map((r) => r.branch_id)))
  const branchColors = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']
  const maxRevenue = Math.max(
    ...months.map((m) =>
      monthlyRevenue.filter((r) => r.month === m).reduce((s, r) => s + r.revenue, 0)
    ),
    1
  )

  // Pie chart for status counts
  const totalJobs = statusCounts.reduce((s, r) => s + r.count, 0) || 1
  let cumulativeAngle = 0
  const slices = statusCounts.map((s) => {
    const angle = (s.count / totalJobs) * 360
    const slice = { ...s, startAngle: cumulativeAngle, angle }
    cumulativeAngle += angle
    return slice
  })

  function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }

  function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
    const start = polarToCartesian(cx, cy, r, endAngle)
    const end = polarToCartesian(cx, cy, r, startAngle)
    const largeArc = endAngle - startAngle > 180 ? 1 : 0
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
  }

  // Export CSV handlers
  function handleExportRevenue() {
    const rows = months.flatMap((m) => {
      const monthRows = monthlyRevenue.filter((r) => r.month === m)
      if (monthRows.length === 0) return [{ Month: monthLabel(m), Branch: 'All', Revenue_RM: '0.00' }]
      return monthRows.map((r) => ({
        Month: monthLabel(m),
        Branch: r.branch_name,
        Revenue_RM: r.revenue.toFixed(2),
      }))
    })
    exportCSV(rows, 'monthly_revenue.csv')
  }

  function handleExportJobs() {
    const rows = statusCounts.map((s) => ({
      Status: STATUS_LABELS[s.status] ?? s.status,
      Count: s.count,
      Percentage: ((s.count / totalJobs) * 100).toFixed(1) + '%',
    }))
    exportCSV(rows, 'jobs_by_status.csv')
  }

  function handleExportServices() {
    const rows = topServices.map((s) => ({
      Service: s.service_type,
      Count: s.count,
    }))
    exportCSV(rows, 'top_services.csv')
  }

  return (
    <>
      <Header title="Reports" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Business Reports</h2>
            <p className="text-sm text-gray-500 mt-0.5">CEO view — all branches</p>
          </div>
          <button
            onClick={() => {
              handleExportRevenue()
              handleExportJobs()
              handleExportServices()
            }}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Export All CSV
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400">Loading reports…</div>
        ) : (
          <>
            {/* Monthly Revenue Bar Chart */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">Monthly Revenue by Branch</h3>
                <button
                  onClick={handleExportRevenue}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Export CSV
                </button>
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-4 mb-4">
                {branchIds.map((bid, i) => {
                  const name = monthlyRevenue.find((r) => r.branch_id === bid)?.branch_name ?? bid
                  return (
                    <div key={bid} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className="w-3 h-3 rounded-sm inline-block" style={{ background: branchColors[i % branchColors.length] }} />
                      {name}
                    </div>
                  )
                })}
              </div>
              {/* Bars */}
              <div className="flex items-end gap-3 h-48 overflow-x-auto pb-2">
                {months.map((m) => {
                  const rowsForMonth = monthlyRevenue.filter((r) => r.month === m)
                  const totalForMonth = rowsForMonth.reduce((s, r) => s + r.revenue, 0)
                  return (
                    <div key={m} className="flex flex-col items-center gap-1 min-w-[60px] flex-1">
                      <span className="text-xs text-gray-500">{formatRM(totalForMonth)}</span>
                      <div className="w-full flex flex-col-reverse gap-0.5" style={{ height: '140px' }}>
                        {branchIds.map((bid, i) => {
                          const row = rowsForMonth.find((r) => r.branch_id === bid)
                          const rev = row?.revenue ?? 0
                          const heightPct = (rev / maxRevenue) * 100
                          return (
                            <div
                              key={bid}
                              className="w-full rounded-sm transition-all"
                              style={{
                                height: `${heightPct}%`,
                                background: branchColors[i % branchColors.length],
                                minHeight: rev > 0 ? '2px' : '0',
                              }}
                              title={`${row?.branch_name ?? bid}: ${formatRM(rev)}`}
                            />
                          )
                        })}
                        {totalForMonth === 0 && (
                          <div className="w-full rounded-sm bg-gray-100" style={{ height: '4px' }} />
                        )}
                      </div>
                      <span className="text-xs text-gray-500">{monthLabel(m)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Job Count by Status (CSS Pie) */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-800">Jobs by Status</h3>
                  <button onClick={handleExportJobs} className="text-xs text-blue-600 hover:underline">
                    Export CSV
                  </button>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  {/* SVG Pie */}
                  <svg viewBox="0 0 120 120" className="w-32 h-32 shrink-0">
                    {slices.map((slice) => (
                      <path
                        key={slice.status}
                        d={describeArc(60, 60, 55, slice.startAngle, slice.startAngle + slice.angle)}
                        fill={STATUS_COLORS[slice.status] ?? '#cbd5e1'}
                        stroke="white"
                        strokeWidth="1"
                      />
                    ))}
                    {totalJobs === 0 && <circle cx="60" cy="60" r="55" fill="#e5e7eb" />}
                  </svg>
                  {/* Legend */}
                  <div className="flex flex-col gap-2 w-full">
                    {statusCounts.map((s) => (
                      <div key={s.status} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ background: STATUS_COLORS[s.status] ?? '#cbd5e1' }}
                          />
                          <span className="text-gray-700">{STATUS_LABELS[s.status] ?? s.status}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-gray-400 text-xs">
                            {((s.count / totalJobs) * 100).toFixed(0)}%
                          </span>
                          <span className="font-semibold text-gray-800 w-8 text-right">{s.count}</span>
                        </div>
                      </div>
                    ))}
                    {statusCounts.length === 0 && (
                      <p className="text-gray-400 text-sm">No jobs yet</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Top 5 Services This Month */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-800">Top Services This Month</h3>
                    <p className="text-xs text-gray-400">{monthLabel(months[5])}</p>
                  </div>
                  <button onClick={handleExportServices} className="text-xs text-blue-600 hover:underline">
                    Export CSV
                  </button>
                </div>
                {topServices.length === 0 ? (
                  <p className="text-gray-400 text-sm">No jobs this month yet</p>
                ) : (
                  <div className="space-y-3">
                    {topServices.map((svc, idx) => {
                      const maxCount = topServices[0].count
                      const pct = (svc.count / maxCount) * 100
                      return (
                        <div key={svc.service_type}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-gray-700 flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-400 w-4">{idx + 1}</span>
                              {svc.service_type}
                            </span>
                            <span className="font-semibold text-gray-800">{svc.count}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
