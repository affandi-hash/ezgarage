import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useAuthStore } from '@/store/authStore'
import { useAppointmentsStore } from '@/hooks/useAppointments'
import { BookAppointmentModal } from '@/components/appointments/BookAppointmentModal'
import { MechanicScheduleView } from '@/components/appointments/MechanicScheduleView'
import type { Appointment, AppointmentStatus } from '@/types/appointment'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<AppointmentStatus, { bg: string; color: string }> = {
  pending:   { bg: '#2A2200', color: '#FACC15' },
  confirmed: { bg: '#0A1F3A', color: '#60A5FA' },
  completed: { bg: '#0A2A1A', color: '#34D399' },
  cancelled: { bg: '#1E1E1E', color: '#A0A0A0' },
  no_show:   { bg: '#2A0A0A', color: '#F87171' },
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { bg, color } = STATUS_COLORS[status]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: '9999px',
      fontSize: '11px',
      fontWeight: 500,
      textTransform: 'capitalize',
      backgroundColor: bg,
      color,
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ─── Convert to Job inline modal ──────────────────────────────────────────────

interface ConvertModalProps {
  appointment: Appointment
  onClose: () => void
  onSuccess: () => void
}

function ConvertToJobModal({ appointment, onClose, onSuccess }: ConvertModalProps) {
  const user = useAuthStore((s) => s.user)
  const { convertToJob } = useAppointmentsStore()
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConvert = async () => {
    if (!user?.branch_id) return
    setSaving(true)
    const { error: err } = await convertToJob(appointment.id, {
      branch_id: user.branch_id,
      service_type: appointment.service_type,
      description,
      assigned_to: appointment.mechanic_id ?? undefined,
    })
    setSaving(false)
    if (err) { setError(err); return }
    onSuccess()
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
    }}>
      <div style={{
        backgroundColor: '#161616',
        borderRadius: '16px',
        border: '1px solid #2A2A2A',
        width: '100%',
        maxWidth: '440px',
        margin: '0 16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #2A2A2A' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#F0F0F0', margin: 0 }}>Convert to Job Order</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#A0A0A0', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ backgroundColor: '#0E0E0E', borderRadius: '8px', padding: '12px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <p style={{ margin: 0 }}>
              <span style={{ color: '#A0A0A0' }}>Customer: </span>
              <span style={{ fontWeight: 500, color: '#F0F0F0' }}>{appointment.customer_name}</span>
            </p>
            <p style={{ margin: 0 }}>
              <span style={{ color: '#A0A0A0' }}>Plate: </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 500, color: '#F0F0F0' }}>{appointment.plate_number}</span>
            </p>
            <p style={{ margin: 0 }}>
              <span style={{ color: '#A0A0A0' }}>Service: </span>
              <span style={{ color: '#F0F0F0' }}>{appointment.service_type}</span>
            </p>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#A0A0A0', marginBottom: '6px' }}>Additional Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any notes for the technician…"
              style={{
                width: '100%',
                border: '1px solid #2A2A2A',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '13px',
                backgroundColor: '#0E0E0E',
                color: '#F0F0F0',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {error && <p style={{ color: '#F87171', fontSize: '12px', margin: 0 }}>{error}</p>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 24px', borderTop: '1px solid #2A2A2A' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', fontSize: '13px', color: '#A0A0A0', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConvert}
            disabled={saving}
            style={{
              padding: '8px 20px',
              backgroundColor: saving ? '#7A2E11' : '#F15A22',
              color: '#FFFFFF',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Creating…' : 'Create Job Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabView = 'appointments' | 'schedule'

export function AppointmentsPage() {
  const user = useAuthStore((s) => s.user)
  const { appointments, loading, fetchAppointments, confirmAppointment } = useAppointmentsStore()

  const [selectedDate, setSelectedDate] = useState<string>(toISODate(new Date()))
  const [tab, setTab] = useState<TabView>('appointments')
  const [showBookModal, setShowBookModal] = useState(false)
  const [convertTarget, setConvertTarget] = useState<Appointment | null>(null)
  const [weekStart, setWeekStart] = useState<Date>(getMondayOf(new Date()))

  const canBook = user?.role && ['ceo', 'branch_manager', 'operation_manager', 'service_advisor'].includes(user.role)

  useEffect(() => {
    if (user?.branch_id) {
      fetchAppointments(user.branch_id, selectedDate)
    }
  }, [user?.branch_id, selectedDate])

  const handleConfirm = async (id: string) => {
    await confirmAppointment(id)
  }

  const shiftWeek = (n: number) => {
    setWeekStart((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() + n * 7)
      return d
    })
  }

  const fmtSelectedDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <>
      <Header title="Appointments" />
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          {/* Tab toggle */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#1E1E1E', borderRadius: '12px', padding: '4px' }}>
            {([['appointments', 'Appointments'], ['schedule', 'Mechanic Schedule']] as [TabView, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                  backgroundColor: tab === id ? '#2A2A2A' : 'transparent',
                  color: tab === id ? '#F0F0F0' : '#A0A0A0',
                  boxShadow: tab === id ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {canBook && tab === 'appointments' && (
            <button
              onClick={() => setShowBookModal(true)}
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
              + Book Appointment
            </button>
          )}
        </div>

        {/* ── Appointments tab ── */}
        {tab === 'appointments' && (
          <>
            {/* Date picker row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  border: '1px solid #2A2A2A',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  backgroundColor: '#161616',
                  color: '#F0F0F0',
                  outline: 'none',
                  colorScheme: 'dark',
                }}
              />
              <span style={{ fontSize: '13px', color: '#A0A0A0' }}>{fmtSelectedDate}</span>
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#606060' }}>
                {appointments.length} appointment{appointments.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Appointment list */}
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
              ) : appointments.length === 0 ? (
                <div style={{ padding: '64px 0', textAlign: 'center' }}>
                  <p style={{ color: '#A0A0A0', fontSize: '14px', margin: 0 }}>No appointments for this date.</p>
                  {canBook && (
                    <button
                      onClick={() => setShowBookModal(true)}
                      style={{ marginTop: '12px', color: '#F15A22', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Book one now
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {appointments.map((appt, i) => (
                    <div
                      key={appt.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '16px',
                        padding: '16px 20px',
                        borderBottom: i < appointments.length - 1 ? '1px solid #1E1E1E' : 'none',
                      }}
                    >
                      {/* Time */}
                      <div style={{ width: '60px', flexShrink: 0, textAlign: 'center' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#F0F0F0', margin: 0 }}>{fmtTime(appt.appointment_time)}</p>
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <p style={{ fontSize: '13px', fontWeight: 500, color: '#F0F0F0', margin: 0 }}>{appt.customer_name}</p>
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: '11px',
                            color: '#A0A0A0',
                            backgroundColor: '#1E1E1E',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}>
                            {appt.plate_number}
                          </span>
                          {appt.source === 'mia_whatsapp' && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              backgroundColor: '#0A2A1A',
                              color: '#34D399',
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontWeight: 500,
                            }}>
                              <svg style={{ width: '12px', height: '12px', fill: 'currentColor' }} viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.12.554 4.122 1.524 5.861L0 24l6.318-1.499A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.003-1.37l-.359-.213-3.721.882.899-3.619-.234-.372A9.818 9.818 0 1112 21.818z"/>
                              </svg>
                              Mia
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: '12px', color: '#A0A0A0', margin: '4px 0 0 0' }}>
                          {appt.vehicle_make} {appt.vehicle_model} {appt.vehicle_year ? `(${appt.vehicle_year})` : ''}
                          {' · '}{appt.service_type}
                        </p>
                        {appt.notes && (
                          <p style={{ fontSize: '12px', color: '#606060', margin: '4px 0 0 0', fontStyle: 'italic' }}>{appt.notes}</p>
                        )}
                        {appt.job_order && (
                          <p style={{ fontSize: '12px', color: '#34D399', margin: '4px 0 0 0', fontWeight: 500 }}>
                            Job: {appt.job_order.job_number}
                          </p>
                        )}
                      </div>

                      {/* Status & actions */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
                        <StatusBadge status={appt.status} />
                        {appt.status === 'pending' && canBook && (
                          <button
                            onClick={() => handleConfirm(appt.id)}
                            style={{ fontSize: '12px', color: '#60A5FA', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            Confirm
                          </button>
                        )}
                        {appt.status === 'confirmed' && !appt.job_order_id && canBook && (
                          <button
                            onClick={() => setConvertTarget(appt)}
                            style={{
                              fontSize: '12px',
                              backgroundColor: '#F15A22',
                              color: '#FFFFFF',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            Convert to Job
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Schedule tab ── */}
        {tab === 'schedule' && (
          <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden' }}>
            {/* Week navigation */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #2A2A2A' }}>
              <button
                onClick={() => shiftWeek(-1)}
                style={{ padding: '6px', borderRadius: '8px', backgroundColor: 'transparent', border: 'none', color: '#A0A0A0', cursor: 'pointer', fontSize: '16px' }}
              >
                &#8592;
              </button>
              <span style={{ fontSize: '13px', fontWeight: 500, color: '#F0F0F0' }}>
                Week of {weekStart.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <button
                onClick={() => shiftWeek(1)}
                style={{ padding: '6px', borderRadius: '8px', backgroundColor: 'transparent', border: 'none', color: '#A0A0A0', cursor: 'pointer', fontSize: '16px' }}
              >
                &#8594;
              </button>
            </div>
            <MechanicScheduleView weekStart={weekStart} />
          </div>
        )}
      </div>

      {showBookModal && (
        <BookAppointmentModal
          onClose={() => setShowBookModal(false)}
          onSuccess={() => {
            if (user?.branch_id) fetchAppointments(user.branch_id, selectedDate)
          }}
        />
      )}

      {convertTarget && (
        <ConvertToJobModal
          appointment={convertTarget}
          onClose={() => setConvertTarget(null)}
          onSuccess={() => {
            if (user?.branch_id) fetchAppointments(user.branch_id, selectedDate)
          }}
        />
      )}
    </>
  )
}
