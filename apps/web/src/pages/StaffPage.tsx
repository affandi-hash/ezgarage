import { useEffect, useState, useRef } from 'react'
import {
  Search,
  Plus,
  X,
  ChevronRight,
  User,
  Phone,
  Mail,
  Calendar,
  Building2,
  Shield,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Briefcase,
  Edit2,
  UserX,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Ban,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatName, formatPhone, formatEmail, formatIC } from '@/lib/formatters'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaffProfile {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  department: string | null
  position: string | null
  specialty: string[] | null
  hire_date: string | null
  employment_type: string | null
  branch_id: string | null
  is_active: boolean
  ic_number: string | null
  bank_name: string | null
  bank_account: string | null
  emergency_name: string | null
  emergency_phone: string | null
  emergency_relation: string | null
  users?: { role: string; approval_status: string } | null
  branches?: { name: string } | null
  work_start?: string | null
  work_end?: string | null
  late_threshold_min?: number | null
  ot_threshold_min?: number | null
}

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
}

interface NewStaffForm {
  full_name: string
  phone: string
  email: string
  ic_number: string
  department: string
  position: string
  specialty_input: string
  specialties: string[]
  hire_date: string
  employment_type: string
  branch_id: string
  bank_name: string
  bank_account: string
  emergency_name: string
  emergency_phone: string
  emergency_relation: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPARTMENTS = ['Workshop', 'Front Desk', 'Parts', 'Finance', 'Management', 'IT', 'HR']
const EMPLOYMENT_TYPES: { label: string; value: string }[] = [
  { label: 'Full-time', value: 'full_time' },
  { label: 'Part-time', value: 'part_time' },
  { label: 'Contract',  value: 'contract' },
  { label: 'Intern',    value: 'intern' },
]
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  present:   { bg: 'rgba(34,197,94,0.12)',  color: '#22C55E', label: 'Present' },
  late:      { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', label: 'Late' },
  absent:    { bg: 'rgba(239,68,68,0.12)',  color: '#EF4444', label: 'Absent' },
  on_leave:  { bg: 'rgba(59,130,246,0.12)', color: '#3B82F6', label: 'On Leave' },
  mc:        { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6', label: 'MC' },
  off:       { bg: 'rgba(107,114,128,0.12)',color: '#6B7280', label: 'Off Day' },
}

// ─── Helper Components ─────────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const sizes = { sm: 32, md: 40, lg: 56, xl: 72 }
  const px = sizes[size]
  const fontSize = size === 'xl' ? 24 : size === 'lg' ? 18 : size === 'md' ? 14 : 12
  return (
    <div style={{
      width: px, height: px, borderRadius: '50%',
      backgroundColor: 'rgba(241,90,34,0.15)',
      color: '#F15A22',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize, flexShrink: 0, userSelect: 'none',
    }}>
      {initials}
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #2A2A2A', borderTopColor: '#F15A22',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
      backgroundColor: bg, color,
    }}>{label}</span>
  )
}

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12,
      overflow: 'hidden', ...style,
    }}>
      {children}
    </div>
  )
}

// ─── Attendance Tab ────────────────────────────────────────────────────────────

function AttendanceTab({ staffId }: { staffId: string }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('attendance_records')
      .select('*')
      .eq('staff_id', staffId)
      .order('date', { ascending: false })
      .limit(10)
      .then(({ data }) => { setRecords(data ?? []); setLoading(false) })
  }, [staffId])

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const thisMonth = records.filter(r => r.date >= monthStart)
  const summary = {
    present: thisMonth.filter(r => r.status === 'present').length,
    late: thisMonth.filter(r => r.status === 'late').length,
    absent: thisMonth.filter(r => r.status === 'absent').length,
    on_leave: thisMonth.filter(r => r.status === 'on_leave').length,
  }

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Present', value: summary.present, color: '#22C55E' },
          { label: 'Late', value: summary.late, color: '#F59E0B' },
          { label: 'Absent', value: summary.absent, color: '#EF4444' },
          { label: 'On Leave', value: summary.on_leave, color: '#3B82F6' },
        ].map(s => (
          <div key={s.label} style={{
            backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: '12px 14px',
          }}>
            <p style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</p>
            <p style={{ fontSize: 11, color: '#A0A0A0', marginTop: 2 }}>{s.label} this month</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <SectionCard>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#F0F0F0' }}>Recent Attendance (Last 10 Days)</p>
        </div>
        {records.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No attendance records found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Date', 'Clock In', 'Clock Out', 'Status', 'Late (min)', 'OT (hrs)'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const s = STATUS_BADGE[r.status] ?? STATUS_BADGE.absent
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                      <td style={{ padding: '10px 16px', color: '#F0F0F0', fontFamily: 'monospace', fontSize: 12 }}>{r.date}</td>
                      <td style={{ padding: '10px 16px', color: r.status === 'late' ? '#F59E0B' : '#22C55E', fontFamily: 'monospace', fontSize: 12 }}>
                        {r.clock_in_time ? r.clock_in_time.slice(0, 5) : '—'}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#A0A0A0', fontFamily: 'monospace', fontSize: 12 }}>
                        {r.clock_out_time ? r.clock_out_time.slice(0, 5) : '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <Badge label={s.label} color={s.color} bg={s.bg} />
                      </td>
                      <td style={{ padding: '10px 16px', color: r.late_minutes && r.late_minutes > 0 ? '#EF4444' : '#A0A0A0', fontSize: 12 }}>
                        {r.late_minutes ?? 0}
                      </td>
                      <td style={{ padding: '10px 16px', color: r.ot_hours && r.ot_hours > 0 ? '#F15A22' : '#A0A0A0', fontSize: 12 }}>
                        {r.ot_hours ?? 0}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────

function JobsTab({ staffId }: { staffId: string }) {
  const [jobs, setJobs] = useState<Array<{ id: string; job_number: string; status: string; customer?: { full_name: string }; vehicle?: { plate_number: string }; service_type: string }>>([])
  const [completedCount, setCompletedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    Promise.all([
      supabase.from('jobs')
        .select('id, job_number, status, service_type, customers(full_name), vehicles(plate_number)')
        .or(`assigned_foreman_id.eq.${staffId},assigned_mechanic_id.eq.${staffId}`)
        .not('status', 'in', '("closed")')
        .order('created_at', { ascending: false }),
      supabase.from('jobs')
        .select('id', { count: 'exact' })
        .or(`assigned_foreman_id.eq.${staffId},assigned_mechanic_id.eq.${staffId}`)
        .eq('status', 'closed')
        .gte('updated_at', monthStart),
    ]).then(([active, closed]) => {
      const mapped = (active.data ?? []).map((j: any) => ({
        id: j.id, job_number: j.job_number, status: j.status, service_type: j.service_type,
        customer: j.customers, vehicle: j.vehicles,
      }))
      setJobs(mapped)
      setCompletedCount(closed.count ?? 0)
      setLoading(false)
    })
  }, [staffId])

  const JOB_STATUS_COLORS: Record<string, string> = {
    new: '#6B7280', booked: '#3B82F6', checked_in: '#8B5CF6', diagnosing: '#F59E0B',
    waiting_approval: '#EF4444', waiting_parts: '#F97316', in_progress: '#10B981', ready: '#22C55E',
  }

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <CheckCircle size={18} color="#22C55E" />
        <div>
          <p style={{ fontSize: 20, fontWeight: 700, color: '#22C55E' }}>{completedCount}</p>
          <p style={{ fontSize: 12, color: '#A0A0A0' }}>Jobs completed this month</p>
        </div>
      </div>

      <SectionCard>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#F0F0F0' }}>Active Jobs ({jobs.length})</p>
        </div>
        {jobs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>
            <Briefcase size={32} color="#2A2A2A" style={{ margin: '0 auto 8px' }} />
            <p>No active jobs assigned.</p>
          </div>
        ) : (
          <div>
            {jobs.map(j => {
              const col = JOB_STATUS_COLORS[j.status] ?? '#6B7280'
              return (
                <div key={j.id} style={{
                  padding: '12px 16px', borderBottom: '1px solid #1E1E1E',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#F15A22', minWidth: 80 }}>{j.job_number}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: '#F0F0F0' }}>{j.customer?.full_name ?? '—'}</p>
                    <p style={{ fontSize: 11, color: '#A0A0A0' }}>{j.vehicle?.plate_number ?? '—'} · {j.service_type?.replace(/_/g, ' ')}</p>
                  </div>
                  <Badge label={j.status.replace(/_/g, ' ')} color={col} bg={`${col}20`} />
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ─── Staff Profile Panel ───────────────────────────────────────────────────────

function StaffProfile({
  staff,
  onBack,
  onEdit,
  onToggleActive,
}: {
  staff: StaffProfile
  onBack: () => void
  onEdit: (s: StaffProfile) => void
  onToggleActive: (s: StaffProfile) => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule' | 'attendance' | 'jobs'>('overview')

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'jobs', label: 'Jobs' },
  ] as const

  const specialties = Array.isArray(staff.specialty) ? staff.specialty : []

  const maskIC = (ic: string | null) => {
    if (!ic) return '—'
    if (ic.length < 7) return ic
    return `****-**-${ic.slice(-4)}`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* Back */}
      <button
        onClick={onBack}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 0 16px', color: '#A0A0A0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
      >
        ← Back to list
      </button>

      {/* Header card */}
      <SectionCard style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <Avatar name={staff.full_name} size="xl" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>{staff.full_name}</h2>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: staff.is_active ? '#22C55E' : '#EF4444', flexShrink: 0,
              }} />
            </div>
            <p style={{ fontSize: 13, color: '#F15A22', margin: '4px 0 2px' }}>{staff.position ?? '—'}</p>
            <p style={{ fontSize: 12, color: '#A0A0A0' }}>{staff.department ?? '—'}</p>
            {staff.branches && (
              <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                <Building2 size={10} style={{ display: 'inline', marginRight: 4 }} />
                {staff.branches.name}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => onEdit(staff)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8,
                color: '#F0F0F0', cursor: 'pointer', fontSize: 12,
              }}
            >
              <Edit2 size={13} /> Edit
            </button>
            <button
              onClick={() => onToggleActive(staff)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                backgroundColor: staff.is_active ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                border: `1px solid ${staff.is_active ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                borderRadius: 8, color: staff.is_active ? '#EF4444' : '#22C55E', cursor: 'pointer', fontSize: 12,
              }}
            >
              {staff.is_active ? <><UserX size={13} /> Deactivate</> : <><UserCheck size={13} /> Reactivate</>}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #2A2A2A', marginBottom: 16 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400,
              color: activeTab === t.key ? '#F15A22' : '#A0A0A0',
              borderBottom: activeTab === t.key ? '2px solid #F15A22' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionCard>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Info</p>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { icon: Phone, label: 'Phone', value: staff.phone ?? '—' },
                { icon: Mail, label: 'Email', value: staff.email ?? '—' },
                { icon: Shield, label: 'IC Number', value: maskIC(staff.ic_number) },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <row.icon size={15} color="#666" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#666', width: 80, flexShrink: 0 }}>{row.label}</span>
                  <span style={{ fontSize: 13, color: '#F0F0F0' }}>{row.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Employment</p>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { icon: Calendar, label: 'Hire Date', value: staff.hire_date ?? '—' },
                { icon: Briefcase, label: 'Type', value: staff.employment_type ?? '—' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <row.icon size={15} color="#666" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#666', width: 80, flexShrink: 0 }}>{row.label}</span>
                  <span style={{ fontSize: 13, color: '#F0F0F0' }}>{row.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          {specialties.length > 0 && (
            <SectionCard>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A' }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Specialties</p>
              </div>
              <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {specialties.map(sp => (
                  <span key={sp} style={{
                    padding: '4px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 500,
                    backgroundColor: 'rgba(241,90,34,0.12)', color: '#F15A22',
                    border: '1px solid rgba(241,90,34,0.25)',
                  }}>{sp}</span>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <SectionCard>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#A0A0A0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Work Schedule</p>
          </div>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <p style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>Work Days</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ALL_DAYS.map(day => {
                  const active = (staff.work_days ?? []).includes(day)
                  return (
                    <span key={day} style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      backgroundColor: active ? 'rgba(241,90,34,0.15)' : '#1E1E1E',
                      color: active ? '#F15A22' : '#666',
                      border: `1px solid ${active ? 'rgba(241,90,34,0.3)' : '#2A2A2A'}`,
                    }}>{day}</span>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'Work Hours', value: `${staff.work_start ?? '09:00'} — ${staff.work_end ?? '18:00'}` },
                { label: 'Late Grace Period', value: `${staff.late_threshold_min ?? 15} min` },
                { label: 'OT Threshold', value: `${staff.ot_threshold_min ?? 30} min after shift end` },
              ].map(item => (
                <div key={item.label} style={{
                  backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: '12px 14px',
                }}>
                  <p style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{item.label}</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      {activeTab === 'attendance' && <AttendanceTab staffId={staff.id} />}
      {activeTab === 'jobs' && <JobsTab staffId={staff.id} />}
    </div>
  )
}

// ─── New Staff Slide-in Form ───────────────────────────────────────────────────

function NewStaffDrawer({
  onClose,
  onSuccess,
  branchId,
}: {
  onClose: () => void
  onSuccess: () => void
  branchId: string | null
}) {
  const { user } = useAuthStore()
  const [form, setForm] = useState<NewStaffForm>({
    full_name: '', phone: '', email: '', ic_number: '',
    department: '', position: '', specialty_input: '', specialties: [],
    hire_date: new Date().toISOString().split('T')[0], employment_type: 'Full-time',
    branch_id: branchId ?? '',
    bank_name: '', bank_account: '',
    emergency_name: '', emergency_phone: '', emergency_relation: '',
  })
  const [bankOpen, setBankOpen] = useState(false)
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof NewStaffForm, val: string | string[]) =>
    setForm(f => ({ ...f, [key]: val }))

  const addSpecialty = () => {
    const v = form.specialty_input.trim()
    if (v && !form.specialties.includes(v)) {
      setForm(f => ({ ...f, specialties: [...f.specialties, v], specialty_input: '' }))
    }
  }

  const removeSpecialty = (sp: string) =>
    setForm(f => ({ ...f, specialties: f.specialties.filter(s => s !== sp) }))

  const handleSubmit = async () => {
    if (!form.full_name || !form.phone) { setError('Full name and phone are required.'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('staff_profiles').insert({
      full_name: form.full_name,
      phone: form.phone,
      email: form.email || null,
      ic_number: form.ic_number || null,
      department: form.department || null,
      position: form.position || null,
      specialty: form.specialties.length > 0 ? form.specialties : null,
      hire_date: form.hire_date || null,
      employment_type: form.employment_type || null,
      branch_id: form.branch_id || null,
      bank_name: form.bank_name || null,
      bank_account: form.bank_account || null,
      emergency_name: form.emergency_name || null,
      emergency_phone: form.emergency_phone || null,
      emergency_relation: form.emergency_relation || null,
      is_active: true,
      tenant_id: user?.tenant_id,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
    backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: 12, color: '#A0A0A0', marginBottom: 6, display: 'block' }
  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 49 }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, zIndex: 50,
        backgroundColor: '#0E0E0E', borderLeft: '1px solid #2A2A2A',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #2A2A2A',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Add New Staff</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444',
            }}>{error}</div>
          )}

          {/* Basic Info */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Basic Information</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Full Name *</label>
                <input style={inputStyle} value={form.full_name} onChange={e => set('full_name', e.target.value)} onBlur={e => set('full_name', formatName(e.target.value))} placeholder="e.g. Ahmad bin Ali" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Phone *</label>
                  <input style={inputStyle} value={form.phone} onChange={e => set('phone', e.target.value)} onBlur={e => set('phone', formatPhone(e.target.value))} placeholder="0121234567" />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Email</label>
                  <input style={inputStyle} value={form.email} onChange={e => set('email', e.target.value)} onBlur={e => set('email', formatEmail(e.target.value))} placeholder="staff@email.com" type="email" />
                </div>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>IC Number</label>
                <input style={inputStyle} value={form.ic_number} onChange={e => set('ic_number', e.target.value)} onBlur={e => set('ic_number', formatIC(e.target.value))} placeholder="890101-01-1234" />
              </div>
            </div>
          </div>

          {/* Role & Department */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Role & Department</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Department</label>
                  <select style={inputStyle} value={form.department} onChange={e => set('department', e.target.value)}>
                    <option value="">Select...</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Position</label>
                  <input style={inputStyle} value={form.position} onChange={e => set('position', e.target.value)} placeholder="e.g. Senior Mechanic" />
                </div>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Specialties</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={form.specialty_input}
                    onChange={e => set('specialty_input', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpecialty() } }}
                    placeholder="Type and press Enter"
                  />
                  <button
                    onClick={addSpecialty}
                    style={{
                      padding: '8px 12px', borderRadius: 8, backgroundColor: '#1E1E1E',
                      border: '1px solid #2A2A2A', color: '#F0F0F0', cursor: 'pointer', fontSize: 13,
                    }}
                  >Add</button>
                </div>
                {form.specialties.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {form.specialties.map(sp => (
                      <span key={sp} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '3px 10px', borderRadius: 9999, fontSize: 12,
                        backgroundColor: 'rgba(241,90,34,0.12)', color: '#F15A22',
                        border: '1px solid rgba(241,90,34,0.25)',
                      }}>
                        {sp}
                        <button onClick={() => removeSpecialty(sp)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F15A22', padding: 0, lineHeight: 1 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Employment */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Employment Details</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Hire Date</label>
                <input style={inputStyle} type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Employment Type</label>
                <select style={inputStyle} value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                  {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Bank Details (collapsible) */}
          <div style={{ border: '1px solid #2A2A2A', borderRadius: 10, overflow: 'hidden' }}>
            <button
              onClick={() => setBankOpen(b => !b)}
              style={{
                width: '100%', padding: '12px 16px', background: '#161616', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                color: '#A0A0A0', fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600 }}>Bank Details (Optional)</span>
              {bankOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {bankOpen && (
              <div style={{ padding: 16, backgroundColor: '#1E1E1E', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Bank Name</label>
                  <input style={inputStyle} value={form.bank_name} onChange={e => set('bank_name', e.target.value)} placeholder="e.g. Maybank" />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Account Number</label>
                  <input style={inputStyle} value={form.bank_account} onChange={e => set('bank_account', e.target.value)} placeholder="1234567890" />
                </div>
              </div>
            )}
          </div>

          {/* Emergency Contact (collapsible) */}
          <div style={{ border: '1px solid #2A2A2A', borderRadius: 10, overflow: 'hidden' }}>
            <button
              onClick={() => setEmergencyOpen(b => !b)}
              style={{
                width: '100%', padding: '12px 16px', background: '#161616', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                color: '#A0A0A0', fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600 }}>Emergency Contact (Optional)</span>
              {emergencyOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {emergencyOpen && (
              <div style={{ padding: 16, backgroundColor: '#1E1E1E', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Contact Name</label>
                  <input style={inputStyle} value={form.emergency_name} onChange={e => set('emergency_name', e.target.value)} placeholder="Full name" />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Relation</label>
                  <input style={inputStyle} value={form.emergency_relation} onChange={e => set('emergency_relation', e.target.value)} placeholder="e.g. Spouse, Parent" />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Contact Phone</label>
                  <input style={inputStyle} value={form.emergency_phone} onChange={e => set('emergency_phone', e.target.value)} placeholder="0121234567" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #2A2A2A', flexShrink: 0,
          display: 'flex', gap: 10,
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              flex: 2, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              backgroundColor: '#F15A22', border: 'none', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >{saving ? 'Saving…' : 'Add Staff Member'}</button>
        </div>
      </div>
    </>
  )
}

// ─── Edit Staff Drawer ─────────────────────────────────────────────────────────

function EditStaffDrawer({
  staff,
  onClose,
  onSuccess,
  onDeactivate,
}: {
  staff: StaffProfile
  onClose: () => void
  onSuccess: () => void
  onDeactivate?: (updatedStaff: StaffProfile) => void
}) {
  const [form, setForm] = useState({
    full_name: staff.full_name,
    phone: staff.phone ?? '',
    email: staff.email ?? '',
    ic_number: staff.ic_number ?? '',
    department: staff.department ?? '',
    position: staff.position ?? '',
    hire_date: staff.hire_date ?? '',
    employment_type: staff.employment_type ?? 'full_time',
    bank_name: staff.bank_name ?? '',
    bank_account: staff.bank_account ?? '',
    emergency_name: staff.emergency_name ?? '',
    emergency_phone: staff.emergency_phone ?? '',
    emergency_relation: staff.emergency_relation ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof typeof form, val: string) =>
    setForm(f => ({ ...f, [key]: val }))

  const handleSubmit = async () => {
    if (!form.full_name || !form.phone) { setError('Full name and phone are required.'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('staff_profiles').update({
      full_name: form.full_name,
      phone: form.phone,
      email: form.email || null,
      ic_number: form.ic_number || null,
      department: form.department || null,
      position: form.position || null,
      hire_date: form.hire_date || null,
      employment_type: form.employment_type || null,
      bank_name: form.bank_name || null,
      bank_account: form.bank_account || null,
      emergency_name: form.emergency_name || null,
      emergency_phone: form.emergency_phone || null,
      emergency_relation: form.emergency_relation || null,
    }).eq('id', staff.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
    backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: 12, color: '#A0A0A0', marginBottom: 6, display: 'block' }
  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 49 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, zIndex: 50,
        backgroundColor: '#0E0E0E', borderLeft: '1px solid #2A2A2A',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Edit Staff</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>{error}</div>
          )}
          <div style={fieldStyle}><label style={labelStyle}>Full Name *</label><input style={inputStyle} value={form.full_name} onChange={e => set('full_name', e.target.value)} onBlur={e => set('full_name', formatName(e.target.value))} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}><label style={labelStyle}>Phone *</label><input style={inputStyle} value={form.phone} onChange={e => set('phone', e.target.value)} onBlur={e => set('phone', formatPhone(e.target.value))} /></div>
            <div style={fieldStyle}><label style={labelStyle}>Email</label><input style={inputStyle} type="email" value={form.email} onChange={e => set('email', e.target.value)} onBlur={e => set('email', formatEmail(e.target.value))} /></div>
          </div>
          <div style={fieldStyle}><label style={labelStyle}>IC Number</label><input style={inputStyle} value={form.ic_number} onChange={e => set('ic_number', e.target.value)} onBlur={e => set('ic_number', formatIC(e.target.value))} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Department</label>
              <select style={inputStyle} value={form.department} onChange={e => set('department', e.target.value)}>
                <option value="">Select...</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={fieldStyle}><label style={labelStyle}>Position</label><input style={inputStyle} value={form.position} onChange={e => set('position', e.target.value)} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}><label style={labelStyle}>Hire Date</label><input style={inputStyle} type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} /></div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Employment Type</label>
              <select style={inputStyle} value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}><label style={labelStyle}>Bank Name</label><input style={inputStyle} value={form.bank_name} onChange={e => set('bank_name', e.target.value)} /></div>
            <div style={fieldStyle}><label style={labelStyle}>Bank Account</label><input style={inputStyle} value={form.bank_account} onChange={e => set('bank_account', e.target.value)} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}><label style={labelStyle}>Emergency Name</label><input style={inputStyle} value={form.emergency_name} onChange={e => set('emergency_name', e.target.value)} /></div>
            <div style={fieldStyle}><label style={labelStyle}>Relation</label><input style={inputStyle} value={form.emergency_relation} onChange={e => set('emergency_relation', e.target.value)} /></div>
            <div style={fieldStyle}><label style={labelStyle}>Emergency Phone</label><input style={inputStyle} value={form.emergency_phone} onChange={e => set('emergency_phone', e.target.value)} /></div>
          </div>

          {/* Danger Zone */}
          <div style={{ backgroundColor: '#1A0E0E', border: '1px solid #3D1515', borderRadius: 10, padding: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#F87171', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Danger Zone</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#F87171', margin: 0 }}>Deactivate Staff</p>
                <p style={{ fontSize: 12, color: '#A0A0A0', marginTop: 4 }}>This will immediately revoke access for this staff member.</p>
              </div>
              <button
                onClick={async () => {
                  if (!window.confirm('Deactivate this staff member?')) return
                  const { error: err } = await supabase.from('staff_profiles').update({ is_active: false }).eq('id', staff.id)
                  if (!err) {
                    onDeactivate?.({ ...staff, is_active: false })
                    onClose()
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                  backgroundColor: '#1A0E0E', border: '1px solid #3D1515', borderRadius: 8,
                  color: '#F87171', cursor: 'pointer', fontSize: 13, fontWeight: 600, flexShrink: 0,
                }}
              >
                <Ban size={14} /> Deactivate
              </button>
            </div>
          </div>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid #2A2A2A', flexShrink: 0, display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ flex: 2, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 700, backgroundColor: '#F15A22', border: 'none', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function StaffPage() {
  const user = useAuthStore(s => s.user)
  const branchId = (user?.role === 'super_admin' || user?.role === 'ops_manager') ? null : (user?.branch_id ?? null)

  const [staff, setStaff] = useState<StaffProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [selected, setSelected] = useState<StaffProfile | null>(null)
  const [showDrawer, setShowDrawer] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffProfile | null>(null)

  const fetchStaff = async () => {
    setLoading(true)
    let q = supabase
      .from('staff_profiles')
      .select('*, users!user_id(role, approval_status), branches!branch_id(name)')
      .order('full_name')
    if (branchId) q = q.eq('branch_id', branchId)
    const { data } = await q
    setStaff(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchStaff() }, [branchId])

  const filtered = staff.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !search ||
      s.full_name.toLowerCase().includes(q) ||
      (s.position ?? '').toLowerCase().includes(q) ||
      (s.department ?? '').toLowerCase().includes(q)
    const matchDept = !deptFilter || s.department === deptFilter
    const matchActive = activeFilter === 'all' ? true : activeFilter === 'active' ? s.is_active : !s.is_active
    return matchSearch && matchDept && matchActive
  })

  const departments = [...new Set(staff.map(s => s.department).filter(Boolean))] as string[]

  const handleToggleActive = async (s: StaffProfile) => {
    if (!confirm(`${s.is_active ? 'Deactivate' : 'Reactivate'} ${s.full_name}?`)) return
    await supabase.from('staff_profiles').update({ is_active: !s.is_active }).eq('id', s.id)
    fetchStaff()
    setSelected(prev => prev?.id === s.id ? { ...prev, is_active: !prev.is_active } : prev)
  }

  return (
    <div style={{
      display: 'flex', height: '100%', backgroundColor: '#0E0E0E', overflow: 'hidden',
    }}>
      {/* Left panel: staff list */}
      <div style={{
        width: selected ? 340 : '100%', minWidth: selected ? 340 : undefined,
        flexShrink: 0, borderRight: selected ? '1px solid #2A2A2A' : 'none',
        display: 'flex', flexDirection: 'column', height: '100%',
      }}>
        {/* Toolbar */}
        <div style={{ padding: '20px 20px 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Staff</h1>
            <button
              onClick={() => setShowDrawer(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                backgroundColor: '#F15A22', border: 'none', borderRadius: 8,
                color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Plus size={14} /> Add Staff
            </button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={14} color="#666" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              style={{
                width: '100%', padding: '8px 10px 8px 32px', borderRadius: 8, fontSize: 13,
                backgroundColor: '#161616', border: '1px solid #2A2A2A', color: '#F0F0F0', outline: 'none',
                boxSizing: 'border-box',
              }}
              placeholder="Search name, role, department…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['all', 'active', 'inactive'] as const).map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                style={{
                  padding: '4px 12px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
                  backgroundColor: activeFilter === f ? '#F15A22' : 'transparent',
                  border: `1px solid ${activeFilter === f ? '#F15A22' : '#2A2A2A'}`,
                  color: activeFilter === f ? '#fff' : '#A0A0A0', cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >{f}</button>
            ))}
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              style={{
                padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
                backgroundColor: deptFilter ? '#1E1E1E' : 'transparent',
                border: '1px solid #2A2A2A', color: deptFilter ? '#F0F0F0' : '#A0A0A0', cursor: 'pointer',
              }}
            >
              <option value="">All Depts</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {/* Staff list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <Spinner />}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              <User size={32} color="#2A2A2A" style={{ margin: '0 auto 10px' }} />
              <p style={{ fontSize: 13 }}>No staff members found.</p>
            </div>
          )}
          {!loading && filtered.map(s => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 20px', background: selected?.id === s.id ? '#161616' : 'none',
                border: 'none', borderBottom: '1px solid #161616', cursor: 'pointer',
                textAlign: 'left', transition: 'background 0.15s',
              }}
            >
              <Avatar name={s.full_name} size="md" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#F0F0F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.full_name}</span>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    backgroundColor: s.is_active ? '#22C55E' : '#EF4444',
                  }} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {s.position && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 9999,
                      backgroundColor: '#1E1E1E', color: '#A0A0A0', border: '1px solid #2A2A2A',
                    }}>{s.position}</span>
                  )}
                  {s.department && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 9999,
                      backgroundColor: 'rgba(241,90,34,0.1)', color: '#F15A22',
                    }}>{s.department}</span>
                  )}
                </div>
              </div>
              <ChevronRight size={14} color="#2A2A2A" />
            </button>
          ))}
        </div>

        <div style={{ padding: '10px 20px', borderTop: '1px solid #161616' }}>
          <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{filtered.length} member{filtered.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Right panel: profile */}
      {selected && (
        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          <StaffProfile
            staff={selected}
            onBack={() => setSelected(null)}
            onEdit={s => setEditingStaff(s)}
            onToggleActive={handleToggleActive}
          />
        </div>
      )}

      {showDrawer && (
        <NewStaffDrawer
          branchId={branchId}
          onClose={() => setShowDrawer(false)}
          onSuccess={fetchStaff}
        />
      )}

      {editingStaff && (
        <EditStaffDrawer
          staff={editingStaff}
          onClose={() => setEditingStaff(null)}
          onSuccess={() => { fetchStaff(); setEditingStaff(null) }}
          onDeactivate={(updatedStaff) => {
            setStaff(prev => prev.map(s => s.id === updatedStaff.id ? updatedStaff : s))
            setSelected(prev => prev?.id === updatedStaff.id ? updatedStaff : prev)
            setEditingStaff(null)
            fetchStaff()
          }}
        />
      )}
    </div>
  )
}
