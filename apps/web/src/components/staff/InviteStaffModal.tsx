import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useStaffStore } from '@/hooks/useStaff'
import { supabase } from '@/lib/supabase'
import type { StaffRole, InviteStaffPayload } from '@/types/staff'

interface Branch {
  id: string
  name: string
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'branch_manager', label: 'Branch Manager' },
  { value: 'operation_manager', label: 'Operation Manager' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'staff', label: 'Staff / Mechanic' },
]

export function InviteStaffModal({ onClose, onSuccess }: Props) {
  const user = useAuthStore((s) => s.user)
  const { inviteStaff } = useStaffStore()

  const [branches, setBranches] = useState<Branch[]>([])
  const [form, setForm] = useState<InviteStaffPayload>({
    email: '',
    full_name: '',
    role: 'staff',
    branch_id: (user?.role as string) !== 'ceo' && user?.role !== 'super_admin' ? (user?.branch_id ?? '') : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closeHover, setCloseHover] = useState(false)
  const [cancelHover, setCancelHover] = useState(false)
  const [submitHover, setSubmitHover] = useState(false)

  const isCeo = (user?.role as string) === 'ceo' || user?.role === 'super_admin'

  useEffect(() => {
    if (!isCeo) return
    supabase
      .from('branches')
      .select('id, name')
      .order('name')
      .then(({ data }) => setBranches((data as Branch[]) ?? []))
  }, [isCeo])

  const setField = <K extends keyof InviteStaffPayload>(field: K, value: InviteStaffPayload[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.role || !form.branch_id) {
      setError('Please fill in all required fields.')
      return
    }
    setSaving(true)
    setError(null)

    const { error: err } = await inviteStaff(form)
    setSaving(false)

    if (err) {
      setError(err)
      return
    }

    onSuccess()
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    border: '1px solid #2A2A2A',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '14px',
    backgroundColor: '#161616',
    color: '#F0F0F0',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const disabledInputStyle: React.CSSProperties = {
    ...inputStyle,
    backgroundColor: '#0E0E0E',
    color: '#A0A0A0',
    cursor: 'not-allowed',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: '#A0A0A0',
    marginBottom: '4px',
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
      }}
    >
      <div
        style={{
          backgroundColor: '#161616',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          width: '100%',
          maxWidth: '448px',
          margin: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #2A2A2A',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid #2A2A2A',
          }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#F0F0F0', margin: 0 }}>
            Invite Staff Member
          </h2>
          <button
            onClick={onClose}
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              lineHeight: 1,
              cursor: 'pointer',
              color: closeHover ? '#F0F0F0' : '#A0A0A0',
              padding: '0 4px',
            }}
          >
            &times;
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <div>
            <label style={labelStyle}>Full Name *</label>
            <input
              type="text"
              required
              value={form.full_name}
              onChange={(e) => setField('full_name', e.target.value)}
              placeholder="Ahmad bin Ali"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Email Address *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="staff@motoverse.my"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Role *</label>
            <select
              required
              value={form.role}
              onChange={(e) => setField('role', e.target.value as StaffRole)}
              style={inputStyle}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Branch *</label>
            {isCeo ? (
              <select
                required
                value={form.branch_id}
                onChange={(e) => setField('branch_id', e.target.value)}
                style={inputStyle}
              >
                <option value="">Select branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                disabled
                value={user?.branch_id ?? ''}
                style={disabledInputStyle}
              />
            )}
          </div>

          {error && (
            <p style={{ color: '#ef4444', fontSize: '12px', margin: 0 }}>{error}</p>
          )}
        </form>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            padding: '16px 24px',
            borderTop: '1px solid #2A2A2A',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            onMouseEnter={() => setCancelHover(true)}
            onMouseLeave={() => setCancelHover(false)}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: cancelHover ? '#F0F0F0' : '#A0A0A0',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={saving}
            onMouseEnter={() => setSubmitHover(true)}
            onMouseLeave={() => setSubmitHover(false)}
            style={{
              padding: '8px 20px',
              backgroundColor: saving ? '#F15A22' : submitHover ? '#d94e1a' : '#F15A22',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
              transition: 'background-color 0.15s',
            }}
          >
            {saving ? 'Sending Invite…' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  )
}
