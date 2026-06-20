import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useAuthStore } from '@/store/authStore'
import { useDashboard } from '@/hooks/useDashboard'

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
  received: 'bg-gray-100 text-gray-700',
  inspecting: 'bg-blue-100 text-blue-700',
  waiting_approval: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-orange-100 text-orange-700',
  waiting_for_parts: 'bg-purple-100 text-purple-700',
  done: 'bg-green-100 text-green-700',
  collected: 'bg-emerald-100 text-emerald-700',
}

interface Branch {
  id: string
  name: string
}

const BRANCHES: Branch[] = [
  { id: 'all', name: 'All Branches' },
  { id: 'branch-car', name: 'Car Division' },
  { id: 'branch-bike', name: 'Bike Division' },
]

function formatRM(amount: number) {
  return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const isCeo = user?.role === 'ceo'

  const [selectedBranch, setSelectedBranch] = useState<string | null>(
    isCeo ? null : (user?.branch_id ?? null)
  )

  const branchId = selectedBranch === 'all' ? null : selectedBranch
  const { stats, recentJobs, lowStockItems, loading, error } = useDashboard(branchId)

  const statCards = [
    {
      label: 'Active Jobs',
      value: loading ? '…' : String(stats.active_jobs),
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: "Today's Appointments",
      value: loading ? '…' : String(stats.today_appointments),
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Low Stock Items',
      value: loading ? '…' : String(stats.low_stock_items),
      color: stats.low_stock_items > 0 ? 'text-red-600' : 'text-gray-600',
      bg: stats.low_stock_items > 0 ? 'bg-red-50' : 'bg-gray-50',
    },
    {
      label: 'Unpaid Invoices',
      value: loading ? '…' : `${stats.unpaid_invoices}`,
      sublabel: loading ? '' : formatRM(stats.unpaid_invoices_total),
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
    },
    {
      label: 'Monthly Revenue',
      value: loading ? '…' : formatRM(stats.monthly_revenue),
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
  ]

  return (
    <>
      <Header title="Dashboard" />
      <div className="p-6 space-y-6">
        {/* Welcome + Branch Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              Welcome back, {user?.full_name?.split(' ')[0]}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5 capitalize">
              {user?.role.replace(/_/g, ' ')}
            </p>
          </div>

          {isCeo && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 font-medium">Branch:</label>
              <select
                value={selectedBranch ?? 'all'}
                onChange={(e) => setSelectedBranch(e.target.value === 'all' ? null : e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {statCards.map((stat) => (
            <div key={stat.label} className={`${stat.bg} rounded-xl border border-gray-100 p-4`}>
              <p className="text-xs text-gray-500 font-medium">{stat.label}</p>
              <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
              {stat.sublabel && (
                <p className="text-xs text-gray-500 mt-0.5">{stat.sublabel}</p>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Jobs Table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 text-sm">Recent Jobs</h3>
            </div>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
              ) : recentJobs.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">No jobs found</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left px-5 py-3 font-medium">Job #</th>
                      <th className="text-left px-3 py-3 font-medium">Customer</th>
                      <th className="text-left px-3 py-3 font-medium">Plate</th>
                      <th className="text-left px-3 py-3 font-medium">Service</th>
                      {isCeo && <th className="text-left px-3 py-3 font-medium">Branch</th>}
                      <th className="text-left px-3 py-3 font-medium">Status</th>
                      <th className="text-left px-3 py-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map((job) => (
                      <tr key={job.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-gray-700">{job.job_number}</td>
                        <td className="px-3 py-3 text-gray-700">{job.customer_name}</td>
                        <td className="px-3 py-3 font-mono text-xs text-gray-600">{job.plate_number}</td>
                        <td className="px-3 py-3 text-gray-600 max-w-[120px] truncate">{job.service_type}</td>
                        {isCeo && <td className="px-3 py-3 text-gray-500 text-xs">{job.branch_name}</td>}
                        <td className="px-3 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
                            {STATUS_LABELS[job.status] ?? job.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(job.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-sm">Low Stock Alerts</h3>
              {stats.low_stock_items > 0 && (
                <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">
                  {stats.low_stock_items}
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-50">
              {loading ? (
                <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
              ) : lowStockItems.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">
                  <p className="text-2xl mb-2">✓</p>
                  All stock levels are healthy
                </div>
              ) : (
                lowStockItems.slice(0, 8).map((item) => (
                  <div key={item.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.sku}</p>
                        {isCeo && <p className="text-xs text-gray-400">{item.branch_name}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-red-600">{item.quantity}</p>
                        <p className="text-xs text-gray-400">min {item.low_stock_threshold}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
