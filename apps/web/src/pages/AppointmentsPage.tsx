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

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  no_show: 'bg-red-100 text-red-600',
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[status]}`}>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Convert to Job Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            <p><span className="text-gray-500">Customer:</span> <span className="font-medium">{appointment.customer_name}</span></p>
            <p><span className="text-gray-500">Plate:</span> <span className="font-mono font-medium">{appointment.plate_number}</span></p>
            <p><span className="text-gray-500">Service:</span> {appointment.service_type}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Additional Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any notes for the technician…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            onClick={handleConvert}
            disabled={saving}
            className="px-5 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
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
      <div className="p-6 space-y-5">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Tab toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {([['appointments', 'Appointments'], ['schedule', 'Mechanic Schedule']] as [TabView, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === id ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {canBook && tab === 'appointments' && (
            <button
              onClick={() => setShowBookModal(true)}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
            >
              + Book Appointment
            </button>
          )}
        </div>

        {/* ── Appointments tab ── */}
        {tab === 'appointments' && (
          <>
            {/* Date picker */}
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <span className="text-sm text-gray-500">{fmtSelectedDate}</span>
              <span className="ml-auto text-xs text-gray-400">
                {appointments.length} appointment{appointments.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Appointment list */}
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : appointments.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-gray-400 text-sm">No appointments for this date.</p>
                  {canBook && (
                    <button
                      onClick={() => setShowBookModal(true)}
                      className="mt-3 text-orange-500 text-sm hover:underline"
                    >
                      Book one now
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {appointments.map((appt) => (
                    <div key={appt.id} className="flex items-start gap-4 px-5 py-4">
                      {/* Time */}
                      <div className="w-16 shrink-0 text-center">
                        <p className="text-sm font-semibold text-gray-700">{fmtTime(appt.appointment_time)}</p>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800">{appt.customer_name}</p>
                          <span className="font-mono text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                            {appt.plate_number}
                          </span>
                          {appt.source === 'mia_whatsapp' && (
                            <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                              <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.12.554 4.122 1.524 5.861L0 24l6.318-1.499A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.003-1.37l-.359-.213-3.721.882.899-3.619-.234-.372A9.818 9.818 0 1112 21.818z"/>
                              </svg>
                              Mia
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {appt.vehicle_make} {appt.vehicle_model} {appt.vehicle_year ? `(${appt.vehicle_year})` : ''}
                          {' · '}{appt.service_type}
                        </p>
                        {appt.notes && (
                          <p className="text-xs text-gray-400 mt-1 italic">{appt.notes}</p>
                        )}
                        {appt.job_order && (
                          <p className="text-xs text-green-600 mt-1 font-medium">
                            Job: {appt.job_order.job_number}
                          </p>
                        )}
                      </div>

                      {/* Status & actions */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <StatusBadge status={appt.status} />
                        {appt.status === 'pending' && canBook && (
                          <button
                            onClick={() => handleConfirm(appt.id)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Confirm
                          </button>
                        )}
                        {appt.status === 'confirmed' && !appt.job_order_id && canBook && (
                          <button
                            onClick={() => setConvertTarget(appt)}
                            className="text-xs bg-orange-500 text-white px-2.5 py-1 rounded-lg hover:bg-orange-600 transition-colors"
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
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {/* Week navigation */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <button
                onClick={() => shiftWeek(-1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              >
                &#8592;
              </button>
              <span className="text-sm font-medium text-gray-700">
                Week of {weekStart.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <button
                onClick={() => shiftWeek(1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
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
