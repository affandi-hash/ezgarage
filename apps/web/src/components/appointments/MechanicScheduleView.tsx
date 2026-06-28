import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useAppointmentsStore } from '@/hooks/useAppointments'

interface Props {
  weekStart: Date // Monday of the week to display
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function fmtDay(date: Date): string {
  return date.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })
}

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  text: '#F0F0F0',
  muted: '#A0A0A0',
  orange: '#F15A22',
  rowHover: '#1E1E1E',
} as const

export function MechanicScheduleView({ weekStart }: Props) {
  const user = useAuthStore((s) => s.user)
  const { mechanicSchedules, getMechanicSchedule } = useAppointmentsStore()
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!user?.branch_id) return
    // Fetch schedule for each day of the week
    days.forEach((day) => getMechanicSchedule(user.branch_id!, toISODate(day)))
  }, [user?.branch_id, weekStart])

  // Group schedules by mechanic
  const mechanicMap = new Map<string, { name: string; scheduleByDate: Map<string, typeof mechanicSchedules[0]> }>()

  mechanicSchedules.forEach((s) => {
    if (!s.mechanic) return
    if (!mechanicMap.has(s.mechanic_id)) {
      mechanicMap.set(s.mechanic_id, { name: s.mechanic.full_name, scheduleByDate: new Map() })
    }
    mechanicMap.get(s.mechanic_id)!.scheduleByDate.set(s.schedule_date, s)
  })

  const mechanics = Array.from(mechanicMap.values())

  const thStyle: React.CSSProperties = {
    padding: '10px 16px',
    background: C.surface,
    borderBottom: `1px solid ${C.border}`,
    fontSize: 11,
    fontWeight: 500,
    color: C.muted,
    textAlign: 'left',
  }

  const thCenterStyle: React.CSSProperties = {
    ...thStyle,
    textAlign: 'center',
    minWidth: 100,
    padding: '10px 12px',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          fontSize: 13,
          borderCollapse: 'separate',
          borderSpacing: 0,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...thStyle, minWidth: 140 }}>
              Mechanic
            </th>
            {days.map((day) => (
              <th key={toISODate(day)} style={thCenterStyle}>
                {fmtDay(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mechanics.length === 0 ? (
            <tr>
              <td
                colSpan={8}
                style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                  color: C.muted,
                  fontSize: 13,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                No schedule data for this week.
              </td>
            </tr>
          ) : (
            mechanics.map(({ name, scheduleByDate }, idx) => (
              <tr
                key={idx}
                onMouseEnter={() => setHoveredRow(idx)}
                onMouseLeave={() => setHoveredRow(null)}
                style={{
                  background: hoveredRow === idx ? C.rowHover : 'transparent',
                  borderBottom: `1px solid ${C.border}`,
                  transition: 'background 0.15s',
                }}
              >
                <td
                  style={{
                    padding: '10px 16px',
                    fontWeight: 500,
                    color: C.text,
                    whiteSpace: 'nowrap',
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  {name}
                </td>
                {days.map((day) => {
                  const dateKey = toISODate(day)
                  const entry = scheduleByDate.get(dateKey)
                  return (
                    <td
                      key={dateKey}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'center',
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                      {entry ? (
                        entry.is_available ? (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 2,
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: '#4ADE80',
                              }}
                            />
                            {entry.shift_start && entry.shift_end && (
                              <span style={{ fontSize: 11, color: C.muted }}>
                                {entry.shift_start}–{entry.shift_end}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: '#F87171',
                            }}
                          />
                        )
                      ) : (
                        <span style={{ color: C.border, fontSize: 11 }}>—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 16px',
          fontSize: 11,
          color: C.muted,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#4ADE80',
            }}
          />
          Available
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#F87171',
            }}
          />
          Off / Leave
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: C.border }}>—</span>
          Not scheduled
        </span>
      </div>
    </div>
  )
}
