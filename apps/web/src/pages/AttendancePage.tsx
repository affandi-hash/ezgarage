import { useEffect, useState, useCallback, useRef } from 'react'
import {
  CheckCircle,
  Clock,
  XCircle,
  Umbrella,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Download,
  Check,
  X,
  Edit2,
  CalendarDays,
  Camera,
  LogIn,
  LogOut,
} from 'lucide-react'
import { DatePickerInput } from '@/components/ui/DateTimePickers'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import { logAudit } from '@/lib/audit'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface AttendanceRecord {
  id: string
  staff_id: string
  date: string
  clock_in_time: string | null
  clock_out_time: string | null
  status: string
  late_minutes: number | null
  ot_hours: number | null
  location_verified: boolean | null
  staff_profiles?: {
    full_name: string
    position: string | null
    department: string | null
  }
}

interface LeaveRequest {
  id: string
  staff_id: string
  leave_type: string
  date_from: string
  date_to: string
  total_days: number
  reason: string | null
  status: string
  created_at: string
  staff_profiles?: { full_name: string; position: string | null }
}

interface OTRequest {
  id: string
  staff_id: string
  date: string
  ot_hours: number
  reason: string | null
  status: string
  created_at: string
  staff_profiles?: { full_name: string; position: string | null }
}

interface MonthlySummary {
  staff_id: string
  full_name: string
  position: string | null
  working_days: number
  present: number
  late: number
  absent: number
  ot_hours: number
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fmtTime(t: string | null) {
  if (!t) return '—'
  // Handle both “HH:MM” time strings and full ISO timestamps
  if (t.includes('T') || t.includes('-')) {
    return new Date(t).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })
  }
  return t.slice(0, 5)
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '3px solid #2A2A2A', borderTopColor: '#F15A22',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      backgroundColor: 'rgba(241,90,34,0.15)', color: '#F15A22',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 11, flexShrink: 0,
    }}>{initials}</div>
  )
}

const ATTENDANCE_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  present:  { label: 'Present',  color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  late:     { label: 'Late',     color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  absent:   { label: 'Absent',   color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  on_leave: { label: 'On Leave', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
  mc:       { label: 'MC',       color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' },
  off:      { label: 'Off Day',  color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
}

const REQUEST_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: 'Pending',  color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  approved: { label: 'Approved', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  rejected: { label: 'Rejected', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
}

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; color: string; bg: string }> }) {
  const s = map[status] ?? { label: status, color: '#A0A0A0', bg: 'rgba(160,160,160,0.12)' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 9999,
      fontSize: 11, fontWeight: 600, color: s.color, backgroundColor: s.bg,
    }}>{s.label}</span>
  )
}

// â”€â”€â”€ Edit Attendance Modal (BUG-018: OT auto-calc) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseTimeToMinutes(t: string): number {
  const parts = t.split(':').map(Number)
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

function EditAttendanceModal({ record, onClose, onSaved }: {
  record: AttendanceRecord
  onClose: () => void
  onSaved: () => void
}) {
  const [clockIn, setClockIn] = useState(record.clock_in_time?.slice(0, 5) ?? '')
  const [clockOut, setClockOut] = useState(record.clock_out_time?.slice(0, 5) ?? '')
  const [status, setStatus] = useState(record.status)
  const [saving, setSaving] = useState(false)

  // Auto-compute OT whenever times change
  const otHours = (() => {
    if (!clockIn || !clockOut) return 0
    const worked = parseTimeToMinutes(clockOut) - parseTimeToMinutes(clockIn)
    const standard = 8 * 60
    return Math.max(0, Math.round((worked - standard) / 60 * 10) / 10)
  })()

  const lateMinutes = (() => {
    if (!clockIn) return 0
    const workStart = parseTimeToMinutes('09:00')
    const actual = parseTimeToMinutes(clockIn)
    return Math.max(0, actual - workStart)
  })()

  const handleSave = async () => {
    setSaving(true)
    const { error: err } = await supabase
      .from('attendance_records')
      .update({
        clock_in_time: clockIn || null,
        clock_out_time: clockOut || null,
        status,
        ot_hours: otHours > 0 ? otHours : null,
        late_minutes: lateMinutes > 0 ? lateMinutes : null,
      })
      .eq('id', record.id)
    setSaving(false)
    if (err) { toast(err.message, 'error'); return }
    toast(`Attendance updated${otHours > 0 ? ` Â· ${otHours}h OT calculated` : ''}`)
    onSaved()
    onClose()
  }

  const inputS: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    backgroundColor: '#0E0E0E', border: '1px solid #2A2A2A',
    borderRadius: 8, color: '#F0F0F0', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, width: '100%', maxWidth: 420, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <p style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 15, margin: 0 }}>Edit Attendance</p>
            <p style={{ color: '#A0A0A0', fontSize: 12, margin: '2px 0 0' }}>{record.staff_profiles?.full_name ?? 'â€”'} Â· {record.date}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A0A0A0', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>CLOCK IN</label>
            <input type="time" value={clockIn} onChange={e => setClockIn(e.target.value)} style={inputS} />
          </div>
          <div>
            <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>CLOCK OUT</label>
            <input type="time" value={clockOut} onChange={e => setClockOut(e.target.value)} style={inputS} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ color: '#A0A0A0', fontSize: 11, display: 'block', marginBottom: 5 }}>STATUS</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputS, appearance: 'none' }}>
            {['present', 'late', 'absent', 'on_leave', 'mc', 'off'].map(s => (
              <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
            ))}
          </select>
        </div>

        {/* Auto-computed summary */}
        {(otHours > 0 || lateMinutes > 0) && (
          <div style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', gap: 20 }}>
            {lateMinutes > 0 && (
              <div>
                <p style={{ color: '#A0A0A0', fontSize: 10, margin: '0 0 2px' }}>LATE</p>
                <p style={{ color: '#F59E0B', fontWeight: 700, fontSize: 14, margin: 0 }}>{lateMinutes} min</p>
              </div>
            )}
            {otHours > 0 && (
              <div>
                <p style={{ color: '#A0A0A0', fontSize: 10, margin: '0 0 2px' }}>OT (auto)</p>
                <p style={{ color: '#F15A22', fontWeight: 700, fontSize: 14, margin: 0 }}>{otHours}h</p>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Savingâ€¦' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// â”€â”€â”€ KPI Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function KpiCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.ElementType; color: string
}) {
  return (
    <div style={{
      backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: '16px 18px',
      display: 'flex', alignItems: 'center', gap: 14, flex: 1,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        backgroundColor: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <p style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F0', lineHeight: 1 }}>{value}</p>
        <p style={{ fontSize: 11, color: '#A0A0A0', marginTop: 4 }}>{label}</p>
      </div>
    </div>
  )
}

// â”€â”€â”€ Daily Board Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DailyBoardTab({ branchId }: { branchId: string | null }) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)

  const fetchRecords = useCallback(async (d: string) => {
    setLoading(true)
    let q = supabase
      .from('attendance_records')
      .select('*, staff_profiles!staff_id(full_name, position, department)')
      .eq('date', d)
      .order('clock_in_time')
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q
    setRecords(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { fetchRecords(date) }, [date, fetchRecords])

  const prevDay = () => {
    const d = new Date(date); d.setDate(d.getDate() - 1)
    setDate(d.toISOString().split('T')[0])
  }
  const nextDay = () => {
    const d = new Date(date); d.setDate(d.getDate() + 1)
    const today = new Date().toISOString().split('T')[0]
    if (d.toISOString().split('T')[0] <= today) setDate(d.toISOString().split('T')[0])
  }

  const handleApproveOT = async (attendanceId: string) => {
    await supabase
      .from('ot_requests')
      .update({ status: 'approved' })
      .eq('attendance_id', attendanceId)
      .eq('status', 'pending')
    fetchRecords(date)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Date selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={prevDay} style={{ padding: '6px 10px', backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, cursor: 'pointer', color: '#A0A0A0' }}>
          <ChevronLeft size={15} />
        </button>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ padding: '7px 12px', backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13, cursor: 'pointer' }}
        />
        <button onClick={nextDay} style={{ padding: '6px 10px', backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, cursor: 'pointer', color: '#A0A0A0' }}>
          <ChevronRight size={15} />
        </button>
        <span style={{ fontSize: 13, color: '#A0A0A0' }}>
          {new Date(date).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <Spinner /> : records.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
            <CalendarDays size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
            <p>No attendance records for this date.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Staff', 'Role', 'Clock In', 'Clock Out', 'Status', 'Late (min)', 'OT (hrs)', 'Location', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={r.staff_profiles?.full_name ?? '?'} />
                        <div>
                          <p style={{ fontSize: 13, color: '#F0F0F0', margin: 0 }}>{r.staff_profiles?.full_name ?? 'â€”'}</p>
                          <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{r.staff_profiles?.department ?? ''}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 9999,
                        backgroundColor: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A',
                      }}>{r.staff_profiles?.position ?? 'â€”'}</span>
                    </td>
                    <td style={{
                      padding: '10px 14px', fontFamily: 'monospace', fontSize: 12,
                      color: r.status === 'late' ? '#F59E0B' : r.clock_in_time ? '#22C55E' : '#666',
                    }}>{fmtTime(r.clock_in_time)}</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: r.clock_out_time ? '#A0A0A0' : '#666' }}>
                      {fmtTime(r.clock_out_time)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <StatusBadge status={r.status} map={ATTENDANCE_STATUS} />
                    </td>
                    <td style={{ padding: '10px 14px', color: r.late_minutes && r.late_minutes > 0 ? '#EF4444' : '#666', fontSize: 12 }}>
                      {r.late_minutes ? `${r.late_minutes} min` : 'â€”'}
                    </td>
                    <td style={{ padding: '10px 14px', color: r.ot_hours && r.ot_hours > 0 ? '#F15A22' : '#666', fontSize: 12, fontWeight: r.ot_hours ? 600 : 400 }}>
                      {r.ot_hours ? `${r.ot_hours}h` : 'â€”'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.location_verified === true && <MapPin size={14} color="#22C55E" />}
                      {r.location_verified === false && <MapPin size={14} color="#EF4444" />}
                      {r.location_verified === null && <span style={{ color: '#666', fontSize: 11 }}>â€”</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditRecord(r)} style={{
                          padding: '4px 8px', borderRadius: 6, fontSize: 11,
                          backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', cursor: 'pointer',
                        }}>
                          <Edit2 size={11} />
                        </button>
                        {r.ot_hours && r.ot_hours > 0 && (
                          <button
                            onClick={() => handleApproveOT(r.id)}
                            style={{
                              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.3)',
                              color: '#F15A22', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >Approve OT</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editRecord && (
        <EditAttendanceModal
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSaved={() => fetchRecords(date)}
        />
      )}
    </div>
  )
}

// â”€â”€â”€ Leave Requests Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function LeaveRequestsTab({ branchId }: { branchId: string | null }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>('all')

  const fetchLeave = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('leave_requests')
      .select('*, staff_profiles!staff_id(full_name, position)')
      .order('created_at', { ascending: false })
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q
    setRequests(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { fetchLeave() }, [fetchLeave])

  const handleApprove = async (id: string) => {
    await supabase.from('leave_requests').update({ status: 'approved' }).eq('id', id)
    fetchLeave()
  }
  const handleReject = async (id: string) => {
    await supabase.from('leave_requests').update({ status: 'rejected' }).eq('id', id)
    fetchLeave()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['pending', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              backgroundColor: filter === f ? '#F15A22' : 'transparent',
              border: `1px solid ${filter === f ? '#F15A22' : '#2A2A2A'}`,
              color: filter === f ? '#fff' : '#A0A0A0', cursor: 'pointer', textTransform: 'capitalize',
            }}
          >{f === 'pending' ? 'Pending' : 'All Requests'}</button>
        ))}
      </div>

      {(() => {
        const visible = filter === 'pending' ? requests.filter(r => r.status === 'pending') : requests
        return (
      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <Spinner /> : visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
            <Umbrella size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
            <p>No {filter === 'pending' ? 'pending ' : ''}leave requests.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Staff', 'Leave Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #1E1E1E',
                      backgroundColor: r.status === 'pending' ? 'rgba(245,158,11,0.03)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={r.staff_profiles?.full_name ?? '?'} />
                        <div>
                          <p style={{ fontSize: 13, color: '#F0F0F0', margin: 0 }}>{r.staff_profiles?.full_name ?? 'â€”'}</p>
                          <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{r.staff_profiles?.position ?? ''}</p>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 9999,
                        backgroundColor: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A', textTransform: 'capitalize',
                      }}>{r.leave_type?.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{fmtDate(r.date_from)}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{fmtDate(r.date_to)}</td>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600, fontSize: 13 }}>{r.total_days}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12, maxWidth: 200 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.reason ?? 'â€”'}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <StatusBadge status={r.status} map={REQUEST_STATUS} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => handleApprove(r.id)}
                            style={{
                              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                              color: '#22C55E', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                            }}
                          ><Check size={11} /> Approve</button>
                          <button
                            onClick={() => handleReject(r.id)}
                            style={{
                              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                              color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                            }}
                          ><X size={11} /> Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        )
      })()}
    </div>
  )
}

// â”€â”€â”€ OT Requests Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function OTRequestsTab({ branchId }: { branchId: string | null }) {
  const [requests, setRequests] = useState<OTRequest[]>([])
  const [loading, setLoading] = useState(true)

  const fetchOT = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('ot_requests')
      .select('*, staff_profiles!staff_id(full_name, position)')
      .order('date', { ascending: false })
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q
    setRequests(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { fetchOT() }, [fetchOT])

  const handleApprove = async (id: string) => {
    await supabase.from('ot_requests').update({ status: 'approved' }).eq('id', id)
    fetchOT()
  }
  const handleReject = async (id: string) => {
    await supabase.from('ot_requests').update({ status: 'rejected' }).eq('id', id)
    fetchOT()
  }

  return (
    <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
      {loading ? <Spinner /> : requests.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
          <Clock size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
          <p>No overtime requests found.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Staff', 'Date', 'OT Hours', 'Reason', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={r.staff_profiles?.full_name ?? '?'} />
                      <div>
                        <p style={{ fontSize: 13, color: '#F0F0F0', margin: 0 }}>{r.staff_profiles?.full_name ?? 'â€”'}</p>
                        <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{r.staff_profiles?.position ?? ''}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{fmtDate(r.date)}</td>
                  <td style={{ padding: '10px 14px', color: '#F15A22', fontWeight: 700, fontSize: 13 }} colSpan={2}>{r.ot_hours}h</td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12, maxWidth: 180 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.reason ?? 'â€”'}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <StatusBadge status={r.status} map={REQUEST_STATUS} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleApprove(r.id)}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                            color: '#22C55E', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        ><Check size={11} /> Approve</button>
                        <button
                          onClick={() => handleReject(r.id)}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                            color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        ><X size={11} /> Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Monthly Report Tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function MonthlyReportTab({ branchId }: { branchId: string | null }) {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [summary, setSummary] = useState<MonthlySummary[]>([])
  const [loading, setLoading] = useState(true)

  const fetchReport = useCallback(async () => {
    setLoading(true)
    const [year, mon] = month.split('-').map(Number)
    const from = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()
    const to = `${month}-${String(lastDay).padStart(2, '0')}`

    // Get all staff for the branch
    let staffQ = supabase.from('staff_profiles').select('id, full_name, position').eq('is_active', true)
    if (branchId) staffQ = staffQ.eq('branch_id', branchId)
    const { data: staffList } = await staffQ

    if (!staffList || staffList.length === 0) { setSummary([]); setLoading(false); return }

    // Get attendance records for the month
    const { data: records } = await supabase
      .from('attendance_records')
      .select('staff_id, status, ot_hours')
      .gte('date', from)
      .lte('date', to)
      .in('staff_id', staffList.map(s => s.id))

    const recs = records ?? []
    const workingDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000 * 5 / 7)

    const built: MonthlySummary[] = staffList.map(staff => {
      const mine = recs.filter(r => r.staff_id === staff.id)
      return {
        staff_id: staff.id,
        full_name: staff.full_name,
        position: staff.position,
        working_days: workingDays,
        present: mine.filter(r => r.status === 'present' || r.status === 'late').length,
        late: mine.filter(r => r.status === 'late').length,
        absent: mine.filter(r => r.status === 'absent').length,
        ot_hours: mine.reduce((s, r) => s + (r.ot_hours ?? 0), 0),
      }
    })
    setSummary(built)
    setLoading(false)
  }, [branchId, month])

  useEffect(() => { fetchReport() }, [fetchReport])

  const exportCSV = () => {
    const headers = ['Name', 'Position', 'Working Days', 'Present', 'Late', 'Absent', 'OT Hours', 'Compliance %']
    const rows = summary.map(s => [
      s.full_name, s.position ?? '', s.working_days, s.present, s.late, s.absent,
      s.ot_hours.toFixed(1), s.working_days > 0 ? ((s.present / s.working_days) * 100).toFixed(1) + '%' : '0%',
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `attendance_${month}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          style={{
            padding: '7px 12px', backgroundColor: '#161616', border: '1px solid #2A2A2A',
            borderRadius: 8, color: '#F0F0F0', fontSize: 13, cursor: 'pointer',
          }}
        />
        <button
          onClick={exportCSV}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8,
            color: '#A0A0A0', fontSize: 12, cursor: 'pointer',
          }}
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <Spinner /> : summary.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>No data for this month.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Name', 'Working Days', 'Present', 'Late', 'Absent', 'OT Hours', 'Compliance'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.map(s => {
                  const compliance = s.working_days > 0 ? (s.present / s.working_days) * 100 : 0
                  return (
                    <tr key={s.staff_id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={s.full_name} />
                          <div>
                            <p style={{ fontSize: 13, color: '#F0F0F0', margin: 0 }}>{s.full_name}</p>
                            <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{s.position ?? ''}</p>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{s.working_days}</td>
                      <td style={{ padding: '10px 14px', color: '#22C55E', fontWeight: 600 }}>{s.present}</td>
                      <td style={{ padding: '10px 14px', color: '#F59E0B', fontWeight: 600 }}>{s.late}</td>
                      <td style={{ padding: '10px 14px', color: '#EF4444', fontWeight: 600 }}>{s.absent}</td>
                      <td style={{ padding: '10px 14px', color: '#F15A22', fontWeight: 600 }}>{s.ot_hours.toFixed(1)}h</td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, backgroundColor: '#2A2A2A', borderRadius: 9999, overflow: 'hidden', minWidth: 60 }}>
                            <div style={{
                              height: '100%', borderRadius: 9999,
                              width: `${Math.min(compliance, 100)}%`,
                              backgroundColor: compliance >= 90 ? '#22C55E' : compliance >= 70 ? '#F59E0B' : '#EF4444',
                            }} />
                          </div>
                          <span style={{
                            fontSize: 12, fontWeight: 600, minWidth: 36,
                            color: compliance >= 90 ? '#22C55E' : compliance >= 70 ? '#F59E0B' : '#EF4444',
                          }}>{compliance.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// â”€â”€â”€ Staff Self-Service: My Attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function MyAttendanceTab({ staffId }: { staffId: string }) {
  const [records, setRecords]   = useState<AttendanceRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [month, setMonth]       = useState(() => new Date().toISOString().slice(0, 7)) // YYYY-MM

  useEffect(() => {
    setLoading(true)
    const from = `${month}-01`
    const to   = `${month}-31`
    supabase.from('attendance_records')
      .select('*')
      .eq('staff_id', staffId)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: false })
      .then(({ data }) => { setRecords(data ?? []); setLoading(false) })
  }, [staffId, month])

  const totalPresent = records.filter(r => r.status === 'present' || r.status === 'late').length
  const totalLate    = records.filter(r => r.status === 'late').length
  const totalAbsent  = records.filter(r => r.status === 'absent').length
  const totalOT      = records.reduce((s, r) => s + (r.ot_hours ?? 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Month selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ padding: '7px 12px', backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13 }} />
      </div>

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {[
          { label: 'Present', value: totalPresent, color: '#22C55E' },
          { label: 'Late',    value: totalLate,    color: '#F59E0B' },
          { label: 'Absent',  value: totalAbsent,  color: '#EF4444' },
          { label: 'OT hrs',  value: totalOT,      color: '#F15A22' },
        ].map(s => (
          <div key={s.label} style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Records list */}
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <Spinner /> : records.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
            <CalendarDays size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
            <p>No attendance records for this month.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Date', 'Clock In', 'Clock Out', 'Status', 'Late', 'OT', 'Selfie'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                  <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{fmtDate(r.date)}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: r.status === 'late' ? '#F59E0B' : '#22C55E' }}>
                    {r.clock_in_time ? new Date(r.clock_in_time).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }) : 'â€”'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#A0A0A0' }}>
                    {r.clock_out_time ? new Date(r.clock_out_time).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }) : 'â€”'}
                  </td>
                  <td style={{ padding: '10px 14px' }}><StatusBadge status={r.status} map={ATTENDANCE_STATUS} /></td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: r.late_minutes ? '#EF4444' : '#444' }}>
                    {r.late_minutes ? `${r.late_minutes} min` : 'â€”'}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: r.ot_hours ? '#F15A22' : '#444', fontWeight: r.ot_hours ? 600 : 400 }}>
                    {r.ot_hours ? `${r.ot_hours}h` : 'â€”'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {(r as any).clock_in_selfie_url ? (
                      <img src={(r as any).clock_in_selfie_url} alt="selfie"
                        style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', border: '1px solid #2A2A2A', cursor: 'pointer' }}
                        onClick={() => window.open((r as any).clock_in_selfie_url, '_blank')} />
                    ) : <span style={{ color: '#444', fontSize: 11 }}>â€”</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// â”€â”€â”€ Staff Self-Service: My Leave Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const LEAVE_TYPES = ['annual', 'medical', 'emergency', 'unpaid', 'maternity', 'paternity', 'other']

function MyLeaveTab({ staffId, branchId }: { staffId: string; branchId: string }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ leave_type: 'annual', date_from: '', date_to: '', reason: '' })
  const [saving, setSaving]     = useState(false)

  const fetchMine = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('leave_requests').select('*')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false })
    if (error) toast.error('Could not load leave requests: ' + error.message)
    setRequests(data ?? [])
    setLoading(false)
  }, [staffId])

  useEffect(() => { fetchMine() }, [fetchMine])

  async function submitLeave() {
    if (!form.date_from || !form.date_to) return
    setSaving(true)
    const days = Math.max(1, Math.ceil((new Date(form.date_to).getTime() - new Date(form.date_from).getTime()) / 86400000) + 1)
    const { data: inserted, error } = await supabase.rpc('submit_leave_request', {
      p_leave_type: form.leave_type,
      p_date_from:  form.date_from,
      p_date_to:    form.date_to,
      p_total_days: days,
      p_reason:     form.reason || null,
    }).select().single()
    setSaving(false)
    if (error) { toast.error(error.message); return }
    logAudit({ action: 'Leave Request Submitted', module: 'Attendance', record_type: 'leave_requests', details: { leave_type: form.leave_type, date_from: form.date_from, date_to: form.date_to }, branch_id: branchId })
    toast.success('Leave request submitted')
    setShowForm(false)
    setForm({ leave_type: 'annual', date_from: '', date_to: '', reason: '' })
    // optimistically prepend, then re-fetch to stay in sync
    if (inserted) setRequests(prev => [inserted as any, ...prev])
    fetchMine()
  }

  const iS: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setShowForm(v => !v)}
          style={{ background: '#F15A22', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }}>
          {showForm ? 'Cancel' : '+ Apply Leave'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>New Leave Request</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Leave Type</label>
              <select value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))} style={{ ...iS, appearance: 'none' }}>
                {LEAVE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>From</label>
              <DatePickerInput value={form.date_from} onChange={v => setForm(f => ({ ...f, date_from: v, date_to: f.date_to < v ? v : f.date_to }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>To</label>
              <DatePickerInput value={form.date_to} min={form.date_from || undefined} onChange={v => setForm(f => ({ ...f, date_to: v }))} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reason (optional)</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              style={{ ...iS, resize: 'vertical', minHeight: 64 }} placeholder="Reason for leaveâ€¦" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={submitLeave} disabled={saving || !form.date_from || !form.date_to}
              style={{ background: '#F15A22', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Submittingâ€¦' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <Spinner /> : requests.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
            <Umbrella size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
            <p>No leave requests yet.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Type', 'From', 'To', 'Days', 'Reason', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A', textTransform: 'capitalize' }}>
                      {r.leave_type?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{fmtDate(r.date_from)}</td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{fmtDate(r.date_to)}</td>
                  <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{r.total_days}</td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12, maxWidth: 200 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.reason ?? 'â€”'}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}><StatusBadge status={r.status} map={REQUEST_STATUS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// â”€â”€â”€ Staff Self-Service: My OT Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function MyOTTab({ staffId, branchId }: { staffId: string; branchId: string }) {
  const [requests, setRequests] = useState<OTRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ date: '', ot_hours: '', reason: '' })
  const [saving, setSaving]     = useState(false)

  const fetchMine = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('ot_requests').select('*')
      .eq('staff_id', staffId)
      .order('date', { ascending: false })
    if (error) toast.error('Could not load OT requests: ' + error.message)
    setRequests(data ?? [])
    setLoading(false)
  }, [staffId])

  useEffect(() => { fetchMine() }, [fetchMine])

  async function submitOT() {
    if (!form.date || !form.ot_hours) return
    setSaving(true)
    const hours = parseFloat(form.ot_hours)
    const otStart = new Date(`${form.date}T18:00:00`)
    const otEnd   = new Date(otStart.getTime() + hours * 3600000)
    const { data: inserted, error } = await supabase.rpc('submit_ot_request', {
      p_date:     form.date,
      p_ot_start: otStart.toISOString(),
      p_ot_end:   otEnd.toISOString(),
      p_ot_hours: hours,
      p_reason:   form.reason || null,
    }).select().single()
    setSaving(false)
    if (error) { toast.error(error.message); return }
    logAudit({ action: 'OT Request Submitted', module: 'Attendance', record_type: 'ot_requests', details: { date: form.date, ot_hours: form.ot_hours }, branch_id: branchId })
    toast.success('OT request submitted')
    setShowForm(false)
    setForm({ date: '', ot_hours: '', reason: '' })
    if (inserted) setRequests(prev => [inserted as any, ...prev])
    fetchMine()
  }

  const iS: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setShowForm(v => !v)}
          style={{ background: '#F15A22', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: 'pointer' }}>
          {showForm ? 'Cancel' : '+ Request OT'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>New OT Request</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>OT Date</label>
              <DatePickerInput value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>OT Hours</label>
              <input type="number" min="0.5" max="12" step="0.5" value={form.ot_hours} onChange={e => setForm(f => ({ ...f, ot_hours: e.target.value }))} style={iS} placeholder="e.g. 2.5" />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reason</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              style={{ ...iS, resize: 'vertical', minHeight: 64 }} placeholder="Why did you work overtime?" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={submitOT} disabled={saving || !form.date || !form.ot_hours}
              style={{ background: '#F15A22', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Submittingâ€¦' : 'Submit OT Request'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? <Spinner /> : requests.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
            <Clock size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
            <p>No OT requests yet.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Date', 'OT Hours', 'Reason', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{fmtDate(r.date)}</td>
                  <td style={{ padding: '10px 14px', color: '#F15A22', fontWeight: 700 }}>{r.ot_hours}h</td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12, maxWidth: 240 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.reason ?? 'â€”'}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}><StatusBadge status={r.status} map={REQUEST_STATUS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// â”€â”€â”€ Clock In / Out Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface TodayRecord {
  id: string
  clock_in_time: string | null
  clock_out_time: string | null
  status: string
}

function ClockInOutModal({ mode, staffId, branchId, todayRecord, onClose, onDone }: {
  mode: 'clock_in' | 'clock_out'
  staffId: string
  branchId: string
  todayRecord: TodayRecord | null
  onClose: () => void
  onDone: () => void
}) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const [photo,    setPhoto]   = useState<string | null>(null)
  const [camErr,   setCamErr]  = useState('')
  const [saving,   setSaving]  = useState(false)

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(s => {
        streamRef.current = s
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() }
      })
      .catch(() => setCamErr('Camera access denied. Please allow camera permission and try again.'))
    return () => streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  function capture() {
    if (!videoRef.current || !canvasRef.current) return
    const v = videoRef.current
    const c = canvasRef.current
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    setPhoto(c.toDataURL('image/jpeg', 0.85))
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function retake() {
    setPhoto(null)
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(s => {
        streamRef.current = s
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() }
      })
  }

  async function confirm() {
    if (!photo) return
    setSaving(true)
    try {
      const blob = await (await fetch(photo)).blob()
      const fileName = `${staffId}/${mode}_${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('attendance-selfies').upload(fileName, blob, { contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('attendance-selfies').getPublicUrl(fileName)
      const photoUrl = urlData.publicUrl

      const now = new Date()
      const today = now.toISOString().slice(0, 10)

      if (mode === 'clock_in') {
        const h = now.getHours(), m = now.getMinutes()
        const lateMinutes = Math.max(0, h * 60 + m - 9 * 60)
        const status = lateMinutes > 0 ? 'late' : 'present'
        const { error } = await supabase.from('attendance_records').insert({
          staff_id: staffId, branch_id: branchId,
          date: today, clock_in_time: now.toISOString(),
          clock_in_selfie_url: photoUrl,
          status, late_minutes: lateMinutes || null,
        })
        if (error) throw error
        toast.success(`Clocked in at ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}${lateMinutes > 0 ? ` Â· ${lateMinutes} min late` : ''}`)
      } else {
        const clockIn = todayRecord?.clock_in_time ? new Date(todayRecord.clock_in_time) : null
        const workedHours = clockIn ? (now.getTime() - clockIn.getTime()) / 3_600_000 : 0
        const otHours = Math.max(0, Math.round((workedHours - 8) * 10) / 10)
        const { error } = await supabase.from('attendance_records').update({
          clock_out_time: now.toISOString(),
          clock_out_selfie_url: photoUrl,
          ot_hours: otHours > 0 ? otHours : null,
        }).eq('id', todayRecord!.id)
        if (error) throw error
        const h = now.getHours(), m = now.getMinutes()
        toast.success(`Clocked out at ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}${otHours > 0 ? ` Â· ${otHours}h OT` : ''}`)
      }
      onDone()
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to record attendance')
    } finally {
      setSaving(false)
    }
  }

  const label = mode === 'clock_in' ? 'Clock In' : 'Clock Out'
  const accent = mode === 'clock_in' ? '#22C55E' : '#F15A22'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 420, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1E1E1E' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Camera size={16} color={accent} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>{label}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4 }}><X size={16} /></button>
        </div>

        {/* Camera / photo area */}
        <div style={{ position: 'relative', background: '#000', aspectRatio: '4/3', overflow: 'hidden' }}>
          {camErr ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 13, textAlign: 'center', padding: 24 }}>{camErr}</div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: photo ? 'none' : 'block', transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {photo && (
                <img src={photo} alt="selfie" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              )}
            </>
          )}
          {/* Live indicator */}
          {!photo && !camErr && (
            <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: '4px 10px' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444', animation: 'blink 1s ease infinite' }} />
              <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>LIVE</span>
            </div>
          )}
        </div>

        {/* Time stamp */}
        <div style={{ padding: '10px 20px', background: '#111', textAlign: 'center' }}>
          <span style={{ fontSize: 13, color: '#A0A0A0' }}>
            {new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            {' Â· '}
            <strong style={{ color: accent }}>{new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}</strong>
          </span>
        </div>

        {/* Actions */}
        <div style={{ padding: '16px 20px', display: 'flex', gap: 10 }}>
          {photo ? (
            <>
              <button onClick={retake} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>
                Retake
              </button>
              <button onClick={confirm} disabled={saving}
                style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Savingâ€¦' : `Confirm ${label}`}
              </button>
            </>
          ) : (
            <button onClick={capture} disabled={!!camErr}
              style={{ flex: 1, padding: '12px 0', borderRadius: 8, border: 'none', background: camErr ? '#2A2A2A' : accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: camErr ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Camera size={16} /> Capture Photo
            </button>
          )}
        </div>
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  )
}

// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function AttendancePage() {
  const user = useAuthStore(s => s.user)
  const branchId = (user?.role === 'super_admin' || user?.role === 'ops_manager') ? null : (user?.branch_id ?? null)

  const [activeTab, setActiveTab]       = useState<'daily' | 'leave' | 'ot' | 'monthly'>('daily')
  const [staffTab, setStaffTab]         = useState<'attendance' | 'leave' | 'ot'>('attendance')
  const [kpi, setKpi] = useState({ present: 0, late: 0, absent: 0, on_leave: 0, ot_pending: 0 })
  const [kpiLoading, setKpiLoading] = useState(true)

  // â”€â”€ Clock In/Out state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [myStaffId,    setMyStaffId]    = useState<string | null>(null)
  const [myBranchId,   setMyBranchId]   = useState<string | null>(null)
  const [todayRecord,  setTodayRecord]  = useState<TodayRecord | null>(null)
  const [clockChecked, setClockChecked] = useState(false)
  const [showClock,    setShowClock]    = useState<'clock_in' | 'clock_out' | null>(null)

  const refreshTodayRecord = useCallback(async (staffId: string) => {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase.from('attendance_records')
      .select('id, clock_in_time, clock_out_time, status')
      .eq('staff_id', staffId).eq('date', today).maybeSingle()
    setTodayRecord(data as TodayRecord | null)
  }, [])

  useEffect(() => {
    if (!user?.id) return
    supabase.from('staff_profiles').select('id, branch_id').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setMyStaffId(data.id)
          setMyBranchId(data.branch_id ?? user.branch_id ?? null)
          refreshTodayRecord(data.id)
        }
        setClockChecked(true)
      })
  }, [user?.id, refreshTodayRecord])

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    setKpiLoading(true)

    Promise.all([
      // Today's attendance
      (() => {
        let q = supabase.from('attendance_records').select('status').eq('date', today)
        if (branchId) q = (q as any).eq('branch_id', branchId)
        return q
      })(),
      // Pending OT
      (() => {
        let q = supabase.from('ot_requests').select('id', { count: 'exact' }).eq('status', 'pending')
        if (branchId) q = (q as any).eq('branch_id', branchId)
        return q
      })(),
    ]).then(([att, ot]) => {
      const records = att.data ?? []
      setKpi({
        present: records.filter((r: any) => r.status === 'present').length,
        late: records.filter((r: any) => r.status === 'late').length,
        absent: records.filter((r: any) => r.status === 'absent').length,
        on_leave: records.filter((r: any) => r.status === 'on_leave').length,
        ot_pending: ot.count ?? 0,
      })
      setKpiLoading(false)
    })
  }, [branchId])

  const isManager = user?.role === 'super_admin' || user?.role === 'ops_manager'

  const tabs = [
    { key: 'daily', label: 'Daily Board' },
    { key: 'leave', label: 'Leave Requests' },
    { key: 'ot', label: 'OT Requests' },
    { key: 'monthly', label: 'Monthly Report' },
  ] as const

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1400 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Attendance</h1>
          <p style={{ fontSize: 13, color: '#A0A0A0', marginTop: 4 }}>
            {new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* Clock In / Out button â€” only if user has a staff profile */}
        {clockChecked && myStaffId && myBranchId && (() => {
          const alreadyOut = !!(todayRecord?.clock_out_time)
          const alreadyIn  = !!(todayRecord?.clock_in_time)
          if (alreadyOut) return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 10, padding: '10px 16px' }}>
              <CheckCircle size={15} color="#22C55E" />
              <div>
                <div style={{ fontSize: 11, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Today</div>
                <div style={{ fontSize: 12, color: '#A0A0A0' }}>
                  In {new Date(todayRecord!.clock_in_time!).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
                  {' â†’ '}
                  Out {new Date(todayRecord!.clock_out_time!).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )
          if (alreadyIn) return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E' }} />
                <span style={{ fontSize: 12, color: '#A0A0A0' }}>
                  Clocked in at <strong style={{ color: '#F0F0F0' }}>{new Date(todayRecord!.clock_in_time!).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}</strong>
                </span>
              </div>
              <button onClick={() => setShowClock('clock_out')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F15A22', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, padding: '10px 18px', cursor: 'pointer' }}>
                <LogOut size={15} /> Clock Out
              </button>
            </div>
          )
          return (
            <button onClick={() => setShowClock('clock_in')}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#22C55E', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, padding: '10px 18px', cursor: 'pointer' }}>
              <LogIn size={15} /> Clock In
            </button>
          )
        })()}
      </div>

      {/* KPI cards â€” managers only */}
      {isManager && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiCard label="Present Today"    value={kpiLoading ? 0 : kpi.present}    icon={CheckCircle}    color="#22C55E" />
          <KpiCard label="Late Today"       value={kpiLoading ? 0 : kpi.late}       icon={Clock}          color="#F59E0B" />
          <KpiCard label="Absent Today"     value={kpiLoading ? 0 : kpi.absent}     icon={XCircle}        color="#EF4444" />
          <KpiCard label="On Leave"         value={kpiLoading ? 0 : kpi.on_leave}   icon={Umbrella}       color="#3B82F6" />
          <KpiCard label="OT Pending"       value={kpiLoading ? 0 : kpi.ot_pending} icon={AlertTriangle}  color="#F15A22" />
        </div>
      )}

      {/* Dashboard tabs â€” managers only */}
      {isManager && (
        <>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #2A2A2A' }}>
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400,
                  color: activeTab === t.key ? '#F15A22' : '#A0A0A0',
                  borderBottom: activeTab === t.key ? '2px solid #F15A22' : '2px solid transparent',
                  marginBottom: -1, whiteSpace: 'nowrap',
                }}
              >{t.label}</button>
            ))}
          </div>
          {activeTab === 'daily'   && <DailyBoardTab branchId={branchId} />}
          {activeTab === 'leave'   && <LeaveRequestsTab branchId={branchId} />}
          {activeTab === 'ot'      && <OTRequestsTab branchId={branchId} />}
          {activeTab === 'monthly' && <MonthlyReportTab branchId={branchId} />}
        </>
      )}

      {/* Staff self-service tabs â€” ALL staff including managers */}
      {myStaffId && myBranchId && (
        <>
          {/* Section heading for managers only */}
          {isManager && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <div style={{ flex: 1, height: 1, background: '#2A2A2A' }} />
              <span style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' }}>My Requests</span>
              <div style={{ flex: 1, height: 1, background: '#2A2A2A' }} />
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #2A2A2A' }}>
            {([
              { key: 'attendance', label: 'My Attendance' },
              { key: 'leave',      label: 'Leave Request' },
              { key: 'ot',         label: 'OT Request'    },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setStaffTab(t.key)}
                style={{
                  padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: staffTab === t.key ? 600 : 400,
                  color: staffTab === t.key ? '#F15A22' : '#A0A0A0',
                  borderBottom: staffTab === t.key ? '2px solid #F15A22' : '2px solid transparent',
                  marginBottom: -1, whiteSpace: 'nowrap',
                }}
              >{t.label}</button>
            ))}
          </div>

          {staffTab === 'attendance' && <MyAttendanceTab staffId={myStaffId} />}
          {staffTab === 'leave'      && <MyLeaveTab staffId={myStaffId} branchId={myBranchId} />}
          {staffTab === 'ot'         && <MyOTTab    staffId={myStaffId} branchId={myBranchId} />}
        </>
      )}

      {/* If staff profile not found yet, show a hint */}
      {clockChecked && !myStaffId && (
        <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
          <Clock size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
          <p>Your staff profile is not set up yet. Please contact your manager.</p>
        </div>
      )}

      {/* Clock In/Out modal */}
      {showClock && myStaffId && myBranchId && (
        <ClockInOutModal
          mode={showClock}
          staffId={myStaffId}
          branchId={myBranchId}
          todayRecord={todayRecord}
          onClose={() => setShowClock(null)}
          onDone={() => {
            setShowClock(null)
            refreshTodayRecord(myStaffId)
          }}
        />
      )}
    </div>
  )
}
