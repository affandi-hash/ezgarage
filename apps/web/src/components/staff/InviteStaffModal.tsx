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
    branch_id: user?.role !== 'ceo' ? (user?.branch_id ?? '') : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCeo = user?.role === 'ceo'

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

  const inputCls =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Invite Staff Member</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className={labelCls}>Full Name *</label>
            <input
              type="text"
              required
              value={form.full_name}
              onChange={(e) => setField('full_name', e.target.value)}
              placeholder="Ahmad bin Ali"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Email Address *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="staff@motoverse.my"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Role *</label>
            <select
              required
              value={form.role}
              onChange={(e) => setField('role', e.target.value as StaffRole)}
              className={inputCls}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Branch *</label>
            {isCeo ? (
              <select
                required
                value={form.branch_id}
                onChange={(e) => setField('branch_id', e.target.value)}
                className={inputCls}
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
                className={`${inputCls} bg-gray-50 text-gray-400 cursor-not-allowed`}
              />
            )}
          </div>

          {error && (
            <p className="text-red-500 text-xs">{error}</p>
          )}
        </form>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={saving}
            className="px-5 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Sending Invite…' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  )
}
