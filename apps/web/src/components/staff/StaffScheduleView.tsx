import { useEffect, useState } from 'react'
import { useStaffStore } from '@/hooks/useStaff'
import { useAuthStore } from '@/store/authStore'
import type { DayOfWeek, ScheduleUpsertPayload } from '@/types/staff'

interface Props {
  mechanicId: string
  mechanicName: string
}

const DAYS: { key: DayOfWeek; label: string }[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
]

interface DayState {
  is_working: boolean
  shift_start: string
  shift_end: string
}

const DEFAULT_DAY: DayState = {
  is_working: false,
  shift_start: '08:00',
  shift_end: '17:00',
}

export function StaffScheduleView({ mechanicId, mechanicName }: Props) {
  const user = useAuthStore((s) => s.user)
  const { schedules, scheduleLoading, fetchSchedules, updateSchedule } = useStaffStore()

  const [dayStates, setDayStates] = useState<Record<DayOfWeek, DayState>>(
    () => Object.fromEntries(DAYS.map((d) => [d.key, { ...DEFAULT_DAY }])) as Record<DayOfWeek, DayState>
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const canEdit = user?.role === 'hr_manager' || user?.role === 'ceo'

  useEffect(() => {
    fetchSchedules(mechanicId)
  }, [mechanicId, fetchSchedules])

  // Sync fetched schedules into local state
  useEffect(() => {
    if (schedules.length === 0) return

    setDayStates((prev) => {
      const next = { ...prev }
      for (const s of schedules) {
        if (s.mechanic_id === mechanicId) {
          next[s.day_of_week] = {
            is_working: s.is_working,
            shift_start: s.shift_start ?? '08:00',
            shift_end: s.shift_end ?? '17:00',
          }
        }
      }
      return next
    })
  }, [schedules, mechanicId])

  const toggleDay = (day: DayOfWeek) => {
    if (!canEdit) return
    setDayStates((prev) => ({
      ...prev,
      [day]: { ...prev[day], is_working: !prev[day].is_working },
    }))
  }

  const setTime = (day: DayOfWeek, field: 'shift_start' | 'shift_end', value: string) => {
    if (!canEdit) return
    setDayStates((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)

    const payload: ScheduleUpsertPayload[] = DAYS.map((d) => ({
      mechanic_id: mechanicId,
      day_of_week: d.key,
      is_working: dayStates[d.key].is_working,
      shift_start: dayStates[d.key].is_working ? dayStates[d.key].shift_start : null,
      shift_end: dayStates[d.key].is_working ? dayStates[d.key].shift_end : null,
    }))

    const { error } = await updateSchedule(mechanicId, payload)
    setSaving(false)

    if (error) {
      setSaveError(error)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
  }

  const inputCls =
    'border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 w-24'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Weekly Schedule — {mechanicName}
        </h3>
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-orange-500 text-white text-xs rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        )}
      </div>

      {scheduleLoading && (
        <p className="text-xs text-gray-400">Loading schedule…</p>
      )}

      {!scheduleLoading && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Day</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Working</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Shift Start</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Shift End</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d, idx) => {
                const state = dayStates[d.key]
                const isWeekend = d.key === 'saturday' || d.key === 'sunday'
                return (
                  <tr
                    key={d.key}
                    className={`border-b border-gray-50 last:border-0 ${
                      isWeekend ? 'bg-gray-50/50' : 'hover:bg-gray-50'
                    } ${idx % 2 === 0 ? '' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-700 text-sm">{d.label}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggleDay(d.key)}
                        disabled={!canEdit}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          state.is_working ? 'bg-orange-500' : 'bg-gray-200'
                        } ${!canEdit ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                        aria-pressed={state.is_working}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            state.is_working ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {state.is_working ? (
                        <input
                          type="time"
                          value={state.shift_start}
                          onChange={(e) => setTime(d.key, 'shift_start', e.target.value)}
                          disabled={!canEdit}
                          className={inputCls}
                        />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {state.is_working ? (
                        <input
                          type="time"
                          value={state.shift_end}
                          onChange={(e) => setTime(d.key, 'shift_end', e.target.value)}
                          disabled={!canEdit}
                          className={inputCls}
                        />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {saveError && <p className="text-red-500 text-xs">{saveError}</p>}
      {saved && <p className="text-green-600 text-xs">Schedule saved successfully.</p>}

      {!canEdit && (
        <p className="text-xs text-gray-400 italic">Only HR Manager or CEO can edit schedules.</p>
      )}
    </div>
  )
}
