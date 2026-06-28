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
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

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
      <div style={{ padding: '24px' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#1E1E1E', borderRadius: '12px', padding: '4px' }}>
            {TAB_FILTERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                  backgroundColor: tab === t.id ? '#2A2A2A' : 'transparent',
                  color: tab === t.id ? '#F0F0F0' : '#A0A0A0',
                  boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {canCreate && (
            <button
              onClick={() => setShowNewModal(true)}
              style={{
                padding: '8px 18px',
                backgroundColor: '#F15A22',
                color: '#FFFFFF',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              + New Job
            </button>
          )}
        </div>

        {/* Table */}
        <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
              <div style={{
                width: '24px', height: '24px',
                border: '2px solid #F15A22',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '64px 0', textAlign: 'center' }}>
              <p style={{ color: '#A0A0A0', fontSize: '14px' }}>No job orders found.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2A2A2A', backgroundColor: '#0E0E0E' }}>
                    {['Job No.', 'Customer', 'Vehicle', 'Service', 'Status', 'Mechanic', 'Date'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: '11px', fontWeight: 500, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      onMouseEnter={() => setHoveredRow(job.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      style={{
                        borderBottom: '1px solid #1E1E1E',
                        cursor: 'pointer',
                        backgroundColor: hoveredRow === job.id ? '#1E1E1E' : 'transparent',
                        transition: 'background 0.12s',
                      }}
                    >
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '12px', fontWeight: 500, color: '#F15A22' }}>{job.job_number}</td>
                      <td style={{ padding: '12px 16px', color: '#F0F0F0' }}>{job.customer?.full_name ?? '—'}</td>
                      <td style={{ padding: '12px 16px', color: '#A0A0A0', fontFamily: 'monospace', fontSize: '12px' }}>{job.vehicle?.plate_number ?? '—'}</td>
                      <td style={{ padding: '12px 16px', color: '#A0A0A0' }}>{job.service_type}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <StatusBadge status={job.status} />
                      </td>
                      <td style={{ padding: '12px 16px', color: '#A0A0A0' }}>{job.assigned_mechanic?.full_name ?? '—'}</td>
                      <td style={{ padding: '12px 16px', color: '#606060', fontSize: '12px' }}>{formatDate(job.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Count */}
        {!loading && (
          <p style={{ fontSize: '12px', color: '#606060', marginTop: '12px' }}>
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
