import type { JobStatus } from '@/types/job'

interface StatusBadgeProps {
  status: JobStatus
  className?: string
}

const STATUS_CONFIG: Record<JobStatus, { label: string; classes: string }> = {
  received: { label: 'Received', classes: 'bg-gray-100 text-gray-700' },
  inspecting: { label: 'Inspecting', classes: 'bg-blue-100 text-blue-700' },
  waiting_approval: { label: 'Waiting Approval', classes: 'bg-yellow-100 text-yellow-700' },
  in_progress: { label: 'In Progress', classes: 'bg-orange-100 text-orange-700' },
  waiting_for_parts: { label: 'Waiting for Parts', classes: 'bg-red-100 text-red-700' },
  done: { label: 'Done', classes: 'bg-green-100 text-green-700' },
  collected: { label: 'Collected', classes: 'bg-slate-100 text-slate-700' },
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, classes: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.classes} ${className}`}>
      {config.label}
    </span>
  )
}

export const STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<JobStatus, string>

export const JOB_STATUSES = Object.keys(STATUS_CONFIG) as JobStatus[]
