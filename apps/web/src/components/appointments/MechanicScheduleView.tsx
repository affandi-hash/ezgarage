import { useEffect } from 'react'
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

export function MechanicScheduleView({ weekStart }: Props) {
  const user = useAuthStore((s) => s.user)
  const { mechanicSchedules, getMechanicSchedule } = useAppointmentsStore()

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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="text-left px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 min-w-[140px]">
              Mechanic
            </th>
            {days.map((day) => (
              <th
                key={toISODate(day)}
                className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 text-center min-w-[100px]"
              >
                {fmtDay(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mechanics.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">
                No schedule data for this week.
              </td>
            </tr>
          ) : (
            mechanics.map(({ name, scheduleByDate }, idx) => (
              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-700 whitespace-nowrap">{name}</td>
                {days.map((day) => {
                  const dateKey = toISODate(day)
                  const entry = scheduleByDate.get(dateKey)
                  return (
                    <td key={dateKey} className="px-3 py-2 text-center">
                      {entry ? (
                        entry.is_available ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
                            {entry.shift_start && entry.shift_end && (
                              <span className="text-xs text-gray-400">
                                {entry.shift_start}–{entry.shift_end}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
                        )
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
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
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-red-400" /> Off / Leave
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-gray-300">—</span> Not scheduled
        </span>
      </div>
    </div>
  )
}
