import type { JobStatus } from '@/types/job'

interface StatusBadgeProps {
  status: JobStatus
  style?: React.CSSProperties
}

const STATUS_CONFIG: Record<JobStatus, { label: string; bg: string; color: string }> = {
  received:         { label: 'Received',         bg: '#2A2A2A',   color: '#A0A0A0' },
  inspecting:       { label: 'Inspecting',        bg: '#1a2a3a',   color: '#60a5fa' },
  waiting_approval: { label: 'Waiting Approval',  bg: '#2a2200',   color: '#fbbf24' },
  in_progress:      { label: 'In Progress',       bg: '#2a1500',   color: '#F15A22' },
  waiting_for_parts:{ label: 'Waiting for Parts', bg: '#2a0f0f',   color: '#f87171' },
  done:             { label: 'Done',              bg: '#0f2a1a',   color: '#34d399' },
  collected:        { label: 'Collected',         bg: '#1a1a2a',   color: '#94a3b8' },
}

export function StatusBadge({ status, style }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, bg: '#2A2A2A', color: '#A0A0A0' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.color,
        ...style,
      }}
    >
      {config.label}
    </span>
  )
}

export const STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<JobStatus, string>

export const JOB_STATUSES = Object.keys(STATUS_CONFIG) as JobStatus[]
