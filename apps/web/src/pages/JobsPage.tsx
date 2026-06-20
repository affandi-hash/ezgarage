import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useAuthStore } from '@/store/authStore'
import { useJobsStore } from '@/hooks/useJobs'
import { StatusBadge } from '@/components/jobs/JobCard'
import { NewJobModal } from '@/components/jobs/NewJobModal'
import { JobDetailView } from '@/components/jobs/JobDetailView'
import type { JobStatus } from '@/types/job'

type TabFilter = 'all' | 'active' | 'waiting_approval' | 'done'

const TAB_FILTERS: { id: TabFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'waiting_approval', label: 'Waiting Approval' },
  { id: 'done', label: 'Done' },
]

const ACTIVE_STATUSES: JobStatus[] = ['received', 'inspecting', 'in_progress', 'waiting_for_parts']

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function JobsPage() {
  const user = useAuthStore((s) => s.user)
  const { jobs, loading, fetchJobs } = useJobsStore()

  const [tab, setTab] = useState<TabFilter>('all')
  const [showNewModal, setShowNewModal] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const canCreate = user?.role && ['ceo', 'branch_manager', 'operation_manager'].includes(user.role)

  useEffect(() => {
    if (user?.branch_id) fetchJobs(user.branch_id)
  }, [user?.branch_id])

  const filtered = jobs.filter((j) => {
    if (tab === 'all') return true
    if (tab === 'active') return ACTIVE_STATUSES.includes(j.status)
    if (tab === 'waiting_approval') return j.status === 'waiting_approval'
    if (tab === 'done') return j.status === 'done' || j.status === 'collected'
    return true
  })

  if (selectedJobId) {
    return (
      <>
        <Header title="Job Orders" />
        <JobDetailView jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />
      </>
    )
  }

  return (
    <>
      <Header title="Job Orders" />
      <div className="p-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {TAB_FILTERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {canCreate && (
            <button
              onClick={() => setShowNewModal(true)}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
            >
              + New Job
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">No job orders found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Job No.</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Customer</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Vehicle</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Service</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Mechanic</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium text-orange-600">{job.job_number}</td>
                      <td className="px-4 py-3 text-gray-800">{job.customer?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{job.vehicle?.plate_number ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{job.service_type}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-500">{job.assigned_mechanic?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(job.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Count */}
        {!loading && (
          <p className="text-xs text-gray-400 mt-3">
            {filtered.length} job{filtered.length !== 1 ? 's' : ''} shown
          </p>
        )}
      </div>

      {showNewModal && (
        <NewJobModal
          onClose={() => setShowNewModal(false)}
          onSuccess={() => { if (user?.branch_id) fetchJobs(user.branch_id) }}
        />
      )}
    </>
  )
}
