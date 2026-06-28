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

// Shared style tokens
const card: React.CSSProperties = {
  backgroundColor: '#161616',
  border: '1px solid #2A2A2A',
  borderRadius: '12px',
  padding: '24px',
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#A0A0A0',
  marginBottom: '2px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const valueStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#F0F0F0',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#F0F0F0',
  marginBottom: '16px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div
          style={{
            width: '24px',
            height: '24px',
            border: '2px solid #2A2A2A',
            borderTopColor: '#F15A22',
            borderRadius: '50%',
            animation: 'spin 0.75s linear infinite',
          }}
        />
      </div>
    )
  }

  const currentStatusIndex = STATUS_ORDER.indexOf(selectedJob.status)

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Back */}
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '0.875rem',
          color: '#A0A0A0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          marginBottom: '28px',
          padding: 0,
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#F0F0F0')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#A0A0A0')}
      >
        ← Back to Jobs
      </button>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          marginBottom: '28px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F0F0F0', margin: 0 }}>
              {selectedJob.job_number}
            </h1>
            <StatusBadge status={selectedJob.status} />
          </div>
          <p style={{ fontSize: '0.875rem', color: '#A0A0A0', margin: 0 }}>{selectedJob.service_type}</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowStatusChange(!showStatusChange)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#F15A22',
              color: '#fff',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            Update Status
          </button>
        )}
      </div>

      {/* Status change panel */}
      {showStatusChange && (
        <div
          style={{
            backgroundColor: '#1a1000',
            border: '1px solid #3a2500',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#F15A22', margin: 0 }}>Change Job Status</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {JOB_STATUSES.map((s) => {
              const isTarget = targetStatus === s
              const isCurrent = s === selectedJob.status
              return (
                <button
                  key={s}
                  onClick={() => setTargetStatus(s)}
                  disabled={isCurrent}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    border: `1px solid ${isTarget ? '#F15A22' : '#2A2A2A'}`,
                    backgroundColor: isTarget ? '#F15A22' : 'transparent',
                    color: isTarget ? '#fff' : isCurrent ? '#A0A0A0' : '#F0F0F0',
                    cursor: isCurrent ? 'not-allowed' : 'pointer',
                    opacity: isCurrent ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {s.replace(/_/g, ' ')}
                </button>
              )
            })}
          </div>
          <textarea
            rows={2}
            placeholder="Notes (optional)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              width: '100%',
              border: '1px solid #2A2A2A',
              borderRadius: '8px',
              padding: '10px 12px',
              fontSize: '0.875rem',
              backgroundColor: '#0E0E0E',
              color: '#F0F0F0',
              resize: 'none',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setShowStatusChange(false); setTargetStatus(''); setNotes('') }}
              style={{
                padding: '10px 18px',
                border: '1px solid #2A2A2A',
                borderRadius: '8px',
                fontSize: '0.875rem',
                color: '#A0A0A0',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1a1a1a')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Cancel
            </button>
            <button
              onClick={handleStatusUpdate}
              disabled={!targetStatus || updatingStatus}
              style={{
                padding: '10px 18px',
                backgroundColor: '#F15A22',
                color: '#fff',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: 500,
                border: 'none',
                cursor: !targetStatus || updatingStatus ? 'not-allowed' : 'pointer',
                opacity: !targetStatus || updatingStatus ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {updatingStatus ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {/* Two-column grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', gridColumn: 'span 2' }}>
          {/* Job info */}
          <div style={card}>
            <h3 style={sectionTitle}>Job Information</h3>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                columnGap: '24px',
                rowGap: '14px',
                margin: 0,
              }}
            >
              {[
                ['Customer', selectedJob.customer?.full_name ?? '—'],
                ['Phone', selectedJob.customer?.phone ?? '—'],
                ['Vehicle', selectedJob.vehicle?.plate_number ?? '—'],
                ['Make / Model', selectedJob.vehicle ? `${selectedJob.vehicle.make} ${selectedJob.vehicle.model}` : '—'],
                ['Service Type', selectedJob.service_type],
                ['Assigned Mechanic', selectedJob.assigned_mechanic?.full_name ?? 'Unassigned'],
                ['Created', formatDate(selectedJob.created_at)],
                ['Last Updated', formatDate(selectedJob.updated_at)],
              ].map(([label, val]) => (
                <div key={label}>
                  <dt style={labelStyle}>{label}</dt>
                  <dd style={{ ...valueStyle, margin: 0 }}>{val}</dd>
                </div>
              ))}
            </dl>
            {selectedJob.description && (
              <div
                style={{
                  marginTop: '16px',
                  paddingTop: '16px',
                  borderTop: '1px solid #2A2A2A',
                }}
              >
                <dt style={labelStyle}>Description</dt>
                <dd style={{ fontSize: '0.875rem', color: '#F0F0F0', margin: 0, marginTop: '4px' }}>
                  {selectedJob.description}
                </dd>
              </div>
            )}
          </div>

          {/* Customer Approval */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ ...sectionTitle, marginBottom: '4px' }}>Customer Approval</h3>
                <p style={{ fontSize: '0.75rem', color: '#A0A0A0', margin: 0 }}>
                  Required before work can proceed past inspection
                </p>
              </div>
              {/* Toggle */}
              <button
                onClick={handleApprovalToggle}
                disabled={!canManage}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  width: '44px',
                  height: '24px',
                  borderRadius: '9999px',
                  backgroundColor: selectedJob.customer_approval ? '#22c55e' : '#2A2A2A',
                  border: 'none',
                  cursor: canManage ? 'pointer' : 'not-allowed',
                  opacity: canManage ? 1 : 0.5,
                  transition: 'background-color 0.2s',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    transform: selectedJob.customer_approval ? 'translateX(22px)' : 'translateX(4px)',
                    transition: 'transform 0.2s',
                  }}
                />
              </button>
            </div>
            <p
              style={{
                fontSize: '0.75rem',
                marginTop: '10px',
                fontWeight: 500,
                color: selectedJob.customer_approval ? '#22c55e' : '#fbbf24',
              }}
            >
              {selectedJob.customer_approval ? 'Approved — work can proceed' : 'Pending approval'}
            </p>
          </div>

          {/* Mechanics list */}
          <div style={card}>
            <h3 style={sectionTitle}>Assigned Mechanics</h3>
            {mechanics.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: '#A0A0A0', margin: 0 }}>No additional mechanics assigned.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {mechanics.map((m) => (
                  <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.875rem' }}>
                    <span
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: '#2a1500',
                        color: '#F15A22',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {m.mechanic?.full_name?.[0] ?? '?'}
                    </span>
                    <span style={{ color: '#F0F0F0' }}>{m.mechanic?.full_name ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Photo placeholder */}
          <div style={card}>
            <h3 style={sectionTitle}>Job Photos</h3>
            <div
              style={{
                border: '2px dashed #2A2A2A',
                borderRadius: '12px',
                padding: '40px',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '0.75rem', color: '#A0A0A0', margin: 0 }}>Photo upload — coming in Phase 4</p>
            </div>
          </div>
        </div>

        {/* Right column — timeline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            gridColumn: 'span 1',
          }}
        >
          {/* Progress steps */}
          <div style={card}>
            <h3 style={sectionTitle}>Progress</h3>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative', paddingLeft: '20px' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '6px',
                  top: '6px',
                  bottom: '6px',
                  width: '1px',
                  backgroundColor: '#2A2A2A',
                }}
              />
              {STATUS_ORDER.map((s, i) => {
                const past = i < currentStatusIndex
                const current = i === currentStatusIndex
                return (
                  <li
                    key={s}
                    style={{
                      position: 'relative',
                      paddingLeft: '16px',
                      paddingBottom: i < STATUS_ORDER.length - 1 ? '16px' : 0,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: '-8px',
                        top: '2px',
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        border: `2px solid ${current ? '#F15A22' : past ? '#22c55e' : '#2A2A2A'}`,
                        backgroundColor: current ? '#F15A22' : past ? '#22c55e' : '#0E0E0E',
                        display: 'inline-block',
                      }}
                    />
                    <p
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        margin: 0,
                        color: current ? '#F15A22' : past ? '#A0A0A0' : '#3a3a3a',
                      }}
                    >
                      {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </p>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* Activity Log */}
          <div style={card}>
            <h3 style={sectionTitle}>Activity Log</h3>
            {statusLogs.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: '#A0A0A0', margin: 0 }}>No status changes yet.</p>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {statusLogs.map((log) => (
                  <li key={log.id} style={{ fontSize: '0.75rem' }}>
                    <p style={{ fontWeight: 500, color: '#F0F0F0', margin: 0 }}>
                      {log.previous_status
                        ? `${log.previous_status.replace(/_/g, ' ')} → ${log.new_status.replace(/_/g, ' ')}`
                        : `Set to ${log.new_status.replace(/_/g, ' ')}`}
                    </p>
                    {log.notes && (
                      <p style={{ color: '#A0A0A0', margin: '2px 0 0' }}>{log.notes}</p>
                    )}
                    <p style={{ color: '#3a3a3a', margin: '2px 0 0' }}>
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
