import { useEffect, useState } from 'react'
import { useJobsStore } from '@/hooks/useJobs'
import { useAuthStore } from '@/store/authStore'
import { StatusBadge, JOB_STATUSES } from './JobCard'
import type { JobStatus } from '@/types/job'

interface JobDetailViewProps {
  jobId: string
  onBack: () => void
}

const STATUS_ORDER: JobStatus[] = [
  'received',
  'inspecting',
  'waiting_approval',
  'in_progress',
  'waiting_for_parts',
  'done',
  'collected',
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function JobDetailView({ jobId, onBack }: JobDetailViewProps) {
  const { selectedJob, statusLogs, mechanics, loading, getJobById, updateJobStatus, clearSelected } = useJobsStore()
  const user = useAuthStore((s) => s.user)

  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [notes, setNotes] = useState('')
  const [showStatusChange, setShowStatusChange] = useState(false)
  const [targetStatus, setTargetStatus] = useState<JobStatus | ''>('')

  const canManage = user?.role && ['ceo', 'branch_manager', 'operation_manager'].includes(user.role)

  useEffect(() => {
    getJobById(jobId)
    return () => clearSelected()
  }, [jobId])

  const handleStatusUpdate = async () => {
    if (!targetStatus || !selectedJob) return
    setUpdatingStatus(true)
    await updateJobStatus(selectedJob.id, targetStatus, notes || undefined)
    setUpdatingStatus(false)
    setShowStatusChange(false)
    setNotes('')
    setTargetStatus('')
    getJobById(jobId)
  }

  const handleApprovalToggle = async () => {
    if (!selectedJob) return
    const { supabase } = await import('@/lib/supabase')
    await supabase
      .from('job_orders')
      .update({ customer_approval: !selectedJob.customer_approval })
      .eq('id', selectedJob.id)
    getJobById(jobId)
  }

  if (loading || !selectedJob) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const currentStatusIndex = STATUS_ORDER.indexOf(selectedJob.status)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-6">
        ← Back to Jobs
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-gray-800">{selectedJob.job_number}</h1>
            <StatusBadge status={selectedJob.status} />
          </div>
          <p className="text-sm text-gray-500">{selectedJob.service_type}</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowStatusChange(!showStatusChange)}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600"
          >
            Update Status
          </button>
        )}
      </div>

      {/* Status change panel */}
      {showStatusChange && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 space-y-3">
          <p className="text-sm font-medium text-orange-800">Change Job Status</p>
          <div className="flex flex-wrap gap-2">
            {JOB_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setTargetStatus(s)}
                disabled={s === selectedJob.status}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  targetStatus === s
                    ? 'bg-orange-500 text-white border-orange-500'
                    : s === selectedJob.status
                    ? 'opacity-40 cursor-not-allowed border-gray-200 text-gray-400'
                    : 'border-gray-200 text-gray-600 hover:border-orange-400 hover:text-orange-600'
                }`}
              >
                {s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            placeholder="Notes (optional)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-orange-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none bg-white"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setShowStatusChange(false); setTargetStatus(''); setNotes('') }}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleStatusUpdate}
              disabled={!targetStatus || updatingStatus}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {updatingStatus ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Job info */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Job Information</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-gray-400">Customer</dt>
                <dd className="font-medium text-gray-800">{selectedJob.customer?.full_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Phone</dt>
                <dd className="font-medium text-gray-800">{selectedJob.customer?.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Vehicle</dt>
                <dd className="font-medium text-gray-800">{selectedJob.vehicle?.plate_number ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Make / Model</dt>
                <dd className="font-medium text-gray-800">
                  {selectedJob.vehicle ? `${selectedJob.vehicle.make} ${selectedJob.vehicle.model}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Service Type</dt>
                <dd className="font-medium text-gray-800">{selectedJob.service_type}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Assigned Mechanic</dt>
                <dd className="font-medium text-gray-800">{selectedJob.assigned_mechanic?.full_name ?? 'Unassigned'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Created</dt>
                <dd className="font-medium text-gray-800">{formatDate(selectedJob.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Last Updated</dt>
                <dd className="font-medium text-gray-800">{formatDate(selectedJob.updated_at)}</dd>
              </div>
            </dl>
            {selectedJob.description && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <dt className="text-xs text-gray-400 mb-1">Description</dt>
                <dd className="text-sm text-gray-700">{selectedJob.description}</dd>
              </div>
            )}
          </div>

          {/* Customer Approval */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Customer Approval</h3>
                <p className="text-xs text-gray-400 mt-0.5">Required before work can proceed past inspection</p>
              </div>
              <button
                onClick={handleApprovalToggle}
                disabled={!canManage}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  selectedJob.customer_approval ? 'bg-green-500' : 'bg-gray-200'
                } ${!canManage ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    selectedJob.customer_approval ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <p className={`text-xs mt-2 font-medium ${selectedJob.customer_approval ? 'text-green-600' : 'text-yellow-600'}`}>
              {selectedJob.customer_approval ? 'Approved — work can proceed' : 'Pending approval'}
            </p>
          </div>

          {/* Mechanics list */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Assigned Mechanics</h3>
            {mechanics.length === 0 ? (
              <p className="text-xs text-gray-400">No additional mechanics assigned.</p>
            ) : (
              <ul className="space-y-2">
                {mechanics.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold">
                      {m.mechanic?.full_name?.[0] ?? '?'}
                    </span>
                    <span className="text-gray-700">{m.mechanic?.full_name ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Photo placeholder */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Job Photos</h3>
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
              <p className="text-xs text-gray-400">Photo upload — coming in Phase 4</p>
            </div>
          </div>
        </div>

        {/* Right column — status timeline */}
        <div className="space-y-5">
          {/* Progress steps */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Progress</h3>
            <ol className="relative border-l border-gray-200 ml-2 space-y-4">
              {STATUS_ORDER.map((s, i) => {
                const past = i < currentStatusIndex
                const current = i === currentStatusIndex
                return (
                  <li key={s} className="ml-4">
                    <span className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full border-2 ${
                      current ? 'bg-orange-500 border-orange-500' :
                      past ? 'bg-green-400 border-green-400' :
                      'bg-white border-gray-300'
                    }`} />
                    <p className={`text-xs font-medium ${current ? 'text-orange-600' : past ? 'text-gray-500' : 'text-gray-300'}`}>
                      {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </p>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* Status logs */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Activity Log</h3>
            {statusLogs.length === 0 ? (
              <p className="text-xs text-gray-400">No status changes yet.</p>
            ) : (
              <ol className="space-y-3">
                {statusLogs.map((log) => (
                  <li key={log.id} className="text-xs">
                    <p className="font-medium text-gray-700">
                      {log.previous_status
                        ? `${log.previous_status.replace(/_/g, ' ')} → ${log.new_status.replace(/_/g, ' ')}`
                        : `Set to ${log.new_status.replace(/_/g, ' ')}`}
                    </p>
                    {log.notes && <p className="text-gray-500 mt-0.5">{log.notes}</p>}
                    <p className="text-gray-400 mt-0.5">
                      {log.changed_by_profile?.full_name ?? 'System'} · {formatDate(log.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
