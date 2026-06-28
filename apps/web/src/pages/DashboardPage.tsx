import { useOutletContext } from 'react-router-dom'
import {
  CalendarCheck,
  Car,
  Bike,
  CheckCircle,
  AlertTriangle,
  Clock,
  Package,
  DollarSign,
  TrendingUp,
  Timer,
  RefreshCw,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useDashboard } from '@/hooks/useDashboard'
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS, ROLE_LABELS } from '@/types'
import type { Job, Booking, JobStatus } from '@/types'

type OutletContext = { selectedBranchId: string | null }

function formatRM(amount: number) {
  return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Inject keyframes for spin animation once
const spinKeyframes = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`
if (typeof document !== 'undefined' && !document.getElementById('dashboard-spin-keyframes')) {
  const style = document.createElement('style')
  style.id = 'dashboard-spin-keyframes'
  style.textContent = spinKeyframes
  document.head.appendChild(style)
}

function StatusBadge({ status }: { status: JobStatus }) {
  const color = JOB_STATUS_COLORS[status] ?? '#6B7280'
  const label = JOB_STATUS_LABELS[status] ?? status
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        padding: '2px 8px',
        borderRadius: 9999,
        fontWeight: 500,
        backgroundColor: `${color}20`,
        color,
        border: `1px solid ${color}40`,
      } as React.CSSProperties}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, backgroundColor: color } as React.CSSProperties} />
      {label}
    </span>
  )
}

interface KpiCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  iconColor: string
  subtext?: string
  alert?: boolean
}

function KpiCard({ label, value, icon: Icon, iconColor, subtext, alert }: KpiCardProps) {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        backgroundColor: '#161616',
        border: `1px solid ${alert ? `${iconColor}40` : '#2A2A2A'}`,
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            backgroundColor: `${iconColor}18`,
          } as React.CSSProperties}
        >
          <Icon size={18} color={iconColor} />
        </div>
        {alert && (
          <span
            style={{
              fontSize: 12,
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 500,
              backgroundColor: `${iconColor}20`,
              color: iconColor,
            } as React.CSSProperties}
          >
            Alert
          </span>
        )}
      </div>
      <div>
        <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#F0F0F0' }}>{value}</p>
        <p style={{ fontSize: 12, marginTop: 2, marginBottom: 0, color: '#A0A0A0' }}>{label}</p>
        {subtext && (
          <p style={{ fontSize: 12, marginTop: 4, marginBottom: 0, fontWeight: 500, color: iconColor }}>{subtext}</p>
        )}
      </div>
    </div>
  )
}

function WorkshopSnapshot({ snapshot }: { snapshot: Array<{ status: JobStatus; count: number }> }) {
  const total = snapshot.reduce((s, i) => s + i.count, 0)

  return (
    <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 16, padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h3 style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 700, margin: 0 }}>Workshop Snapshot</h3>
        <span style={{ color: '#A0A0A0', fontSize: 12 }}>{total} active job{total !== 1 ? 's' : ''}</span>
      </div>

      <div style={{ display: 'flex', borderRadius: 99, overflow: 'hidden', height: 10, backgroundColor: '#2A2A2A', marginBottom: 24 }}>
        {snapshot.filter((s) => s.count > 0).map((s) => (
          <div key={s.status} title={`${JOB_STATUS_LABELS[s.status]}: ${s.count}`}
            style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%`, backgroundColor: JOB_STATUS_COLORS[s.status], minWidth: 4 }} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px 24px' }}>
        {snapshot.map((s) => (
          <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: JOB_STATUS_COLORS[s.status], flexShrink: 0 }} />
            <span style={{ color: '#A0A0A0', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              {JOB_STATUS_LABELS[s.status]}
            </span>
            <span style={{ color: '#F0F0F0', fontSize: 13, fontWeight: 600, marginLeft: 4 }}>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecentJobsTable({ jobs }: { jobs: Job[] }) {
  const thStyle: React.CSSProperties = { color: '#6B7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, padding: '12px 16px', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid #2A2A2A' }
  const tdStyle: React.CSSProperties = { padding: '14px 16px', borderBottom: '1px solid #1E1E1E', fontSize: 13, verticalAlign: 'middle' }

  return (
    <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #2A2A2A' }}>
        <h3 style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 700, margin: 0 }}>Recent Jobs</h3>
      </div>
      {jobs.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#A0A0A0', fontSize: 13 }}>No active jobs found.</div>
      ) : (
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Job #', 'Customer', 'Plate', 'Service', 'Status', 'Days', 'Staff'].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const customerName = typeof job.customer === 'object' && job.customer ? (job.customer as any).full_name : '—'
                const plate = typeof job.vehicle === 'object' && job.vehicle ? (job.vehicle as any).plate_number : '—'
                const staffName = typeof job.foreman === 'object' && job.foreman ? (job.foreman as any).full_name?.split(' ')[0] : '—'

                return (
                  <tr key={job.id} style={{ cursor: 'default' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1A1A1A')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                    <td style={{ ...tdStyle, color: '#F15A22', fontFamily: 'monospace', fontWeight: 700 }}>{job.job_number}</td>
                    <td style={{ ...tdStyle, color: '#F0F0F0', fontWeight: 500 }}>{customerName}</td>
                    <td style={{ ...tdStyle, color: '#A0A0A0', fontFamily: 'monospace' }}>{plate}</td>
                    <td style={{ ...tdStyle, color: '#A0A0A0', textTransform: 'capitalize' as const }}>{job.service_type?.replace(/_/g, ' ')}</td>
                    <td style={tdStyle}><StatusBadge status={job.status} /></td>
                    <td style={{ ...tdStyle, color: job.days_in_garage && job.days_in_garage > 7 ? '#EF4444' : '#A0A0A0' }}>{job.days_in_garage ?? 0}d</td>
                    <td style={{ ...tdStyle, color: '#A0A0A0' }}>{staffName}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TodayBookingsList({ bookings }: { bookings: Booking[] }) {
  return (
    <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#F0F0F0' }}>
          Today's Bookings
        </h3>
      </div>
      {bookings.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 14, color: '#A0A0A0' }}>
          No bookings today.
        </div>
      ) : (
        <div>
          {bookings.map((b, idx) => (
            <div
              key={b.id}
              style={{
                padding: '12px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                borderBottom: idx < bookings.length - 1 ? '1px solid #2A2A2A' : 'none',
                cursor: 'default',
              } as React.CSSProperties}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1E1E1E')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#F0F0F0' } as React.CSSProperties}>
                  {b.customer_name}
                </p>
                <p style={{ fontSize: 12, marginTop: 2, marginBottom: 0, color: '#A0A0A0' }}>
                  {b.customer_phone} · {b.vehicle_plate}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 9999, backgroundColor: '#1E1E1E', color: '#F15A22', border: '1px solid #2A2A2A' }}>
                  {b.service_type?.replace(/_/g, ' ')}
                </span>
                <p style={{ fontSize: 12, marginTop: 4, marginBottom: 0, color: '#A0A0A0' }}>
                  {b.arrival_mode?.replace(/_/g, ' ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const { selectedBranchId } = useOutletContext<OutletContext>()
  const { stats, recentJobs, todayBookings, workshopSnapshot, loading, error, refetch } =
    useDashboard(selectedBranchId)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.full_name?.split(' ')[0] ?? 'there'

  const kpiCards: KpiCardProps[] = [
    {
      label: "Today's Bookings",
      value: loading ? '—' : stats?.bookings_today ?? 0,
      icon: CalendarCheck,
      iconColor: '#3B82F6',
    },
    {
      label: 'Active Cars',
      value: loading ? '—' : stats?.active_cars ?? 0,
      icon: Car,
      iconColor: '#8B5CF6',
    },
    {
      label: 'Active Bikes',
      value: loading ? '—' : stats?.active_bikes ?? 0,
      icon: Bike,
      iconColor: '#06B6D4',
    },
    {
      label: 'Ready for Pickup',
      value: loading ? '—' : stats?.ready ?? 0,
      icon: CheckCircle,
      iconColor: '#22C55E',
    },
    {
      label: 'Long Due',
      value: loading ? '—' : stats?.long_due ?? 0,
      icon: AlertTriangle,
      iconColor: '#DC2626',
      alert: (stats?.long_due ?? 0) > 0,
    },
    {
      label: 'Waiting Approval',
      value: loading ? '—' : stats?.waiting_approval ?? 0,
      icon: Clock,
      iconColor: '#EF4444',
      alert: (stats?.waiting_approval ?? 0) > 0,
    },
    {
      label: 'Waiting Parts',
      value: loading ? '—' : stats?.waiting_parts ?? 0,
      icon: Package,
      iconColor: '#F97316',
    },
    {
      label: 'Est. Revenue (Month)',
      value: loading ? '—' : formatRM(stats?.est_revenue ?? 0),
      icon: DollarSign,
      iconColor: '#10B981',
    },
    {
      label: 'Completed This Month',
      value: loading ? '—' : stats?.completed_month ?? 0,
      icon: TrendingUp,
      iconColor: '#F15A22',
    },
    {
      label: 'Avg Days in Garage',
      value: loading ? '—' : `${stats?.avg_days ?? 0}d`,
      icon: Timer,
      iconColor: '#A0A0A0',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 1400 }}>
      {/* Welcome header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#F0F0F0' }}>
            {greeting}, {firstName} 👋
          </h2>
          <p style={{ fontSize: 14, marginTop: 2, marginBottom: 0, color: '#A0A0A0' }}>
            {user ? ROLE_LABELS[user.role] : ''} ·{' '}
            {now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button
          onClick={refetch}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 8,
            fontSize: 14,
            border: '1px solid #2A2A2A',
            color: '#A0A0A0',
            padding: '0 20px',
            minHeight: 44,
            backgroundColor: 'transparent',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          } as React.CSSProperties}
          onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E1E1E' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
        >
          <RefreshCw
            size={13}
            style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined}
          />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 14,
            backgroundColor: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#EF4444',
          }}
        >
          {error}
        </div>
      )}

      {/* KPI cards — responsive grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 20,
        }}
      >
        {kpiCards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>

      {/* Workshop snapshot */}
      <WorkshopSnapshot snapshot={workshopSnapshot} />

      {/* Bottom grid: recent jobs + today's bookings */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          gap: 24,
        }}
      >
        <div>
          <RecentJobsTable jobs={recentJobs} />
        </div>
        <div>
          <TodayBookingsList bookings={todayBookings} />
        </div>
      </div>
    </div>
  )
}
