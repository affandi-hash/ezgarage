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
  const [saveHover, setSaveHover] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<DayOfWeek | null>(null)

  const canEdit = (user?.role as string) === 'hr_manager' || (user?.role as string) === 'ceo' || user?.role === 'super_admin' || user?.role === 'ops_manager'

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

  const timeInputStyle: React.CSSProperties = {
    border: '1px solid #2A2A2A',
    borderRadius: '6px',
    padding: '4px 8px',
    fontSize: '12px',
    backgroundColor: '#161616',
    color: '#F0F0F0',
    outline: 'none',
    width: '96px',
  }

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#A0A0A0',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    backgroundColor: '#0E0E0E',
    borderBottom: '1px solid #2A2A2A',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#F0F0F0', margin: 0 }}>
          Weekly Schedule — {mechanicName}
        </h3>
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving}
            onMouseEnter={() => setSaveHover(true)}
            onMouseLeave={() => setSaveHover(false)}
            style={{
              padding: '6px 12px',
              backgroundColor: saving ? '#F15A22' : saveHover ? '#d94e1a' : '#F15A22',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
              transition: 'background-color 0.15s',
            }}
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        )}
      </div>

      {scheduleLoading && (
        <p style={{ fontSize: '12px', color: '#A0A0A0', margin: 0 }}>Loading schedule…</p>
      )}

      {!scheduleLoading && (
        <div
          style={{
            border: '1px solid #2A2A2A',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '128px' }}>Day</th>
                <th style={{ ...thStyle, textAlign: 'center', width: '96px' }}>Working</th>
                <th style={thStyle}>Shift Start</th>
                <th style={thStyle}>Shift End</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d, idx) => {
                const state = dayStates[d.key]
                const isWeekend = d.key === 'saturday' || d.key === 'sunday'
                const isLastRow = idx === DAYS.length - 1
                const isHovered = hoveredRow === d.key

                let rowBg = '#161616'
                if (isWeekend) rowBg = '#0E0E0E'
                else if (isHovered) rowBg = '#1e1e1e'

                return (
                  <tr
                    key={d.key}
                    onMouseEnter={() => !isWeekend && setHoveredRow(d.key)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      borderBottom: isLastRow ? 'none' : '1px solid #2A2A2A',
                      backgroundColor: rowBg,
                      transition: 'background-color 0.1s',
                    }}
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontWeight: 500,
                        color: '#F0F0F0',
                        fontSize: '14px',
                      }}
                    >
                      {d.label}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => toggleDay(d.key)}
                        disabled={!canEdit}
                        aria-pressed={state.is_working}
                        style={{
                          position: 'relative',
                          display: 'inline-flex',
                          height: '20px',
                          width: '36px',
                          alignItems: 'center',
                          borderRadius: '9999px',
                          border: 'none',
                          backgroundColor: state.is_working ? '#F15A22' : '#2A2A2A',
                          cursor: !canEdit ? 'not-allowed' : 'pointer',
                          opacity: !canEdit ? 0.7 : 1,
                          transition: 'background-color 0.2s',
                          padding: 0,
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            height: '14px',
                            width: '14px',
                            borderRadius: '9999px',
                            backgroundColor: '#fff',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                            transform: state.is_working ? 'translateX(18px)' : 'translateX(2px)',
                            transition: 'transform 0.2s',
                          }}
                        />
                      </button>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {state.is_working ? (
                        <input
                          type="time"
                          value={state.shift_start}
                          onChange={(e) => setTime(d.key, 'shift_start', e.target.value)}
                          disabled={!canEdit}
                          style={timeInputStyle}
                        />
                      ) : (
                        <span style={{ fontSize: '12px', color: '#2A2A2A' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {state.is_working ? (
                        <input
                          type="time"
                          value={state.shift_end}
                          onChange={(e) => setTime(d.key, 'shift_end', e.target.value)}
                          disabled={!canEdit}
                          style={timeInputStyle}
                        />
                      ) : (
                        <span style={{ fontSize: '12px', color: '#2A2A2A' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {saveError && (
        <p style={{ color: '#ef4444', fontSize: '12px', margin: 0 }}>{saveError}</p>
      )}
      {saved && (
        <p style={{ color: '#22c55e', fontSize: '12px', margin: 0 }}>Schedule saved successfully.</p>
      )}

      {!canEdit && (
        <p style={{ fontSize: '12px', color: '#A0A0A0', fontStyle: 'italic', margin: 0 }}>
          Only HR Manager or CEO can edit schedules.
        </p>
      )}
    </div>
  )
}
