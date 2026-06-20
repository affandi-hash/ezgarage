import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { InviteStaffModal } from '@/components/staff/InviteStaffModal'
import { StaffScheduleView } from '@/components/staff/StaffScheduleView'
import { useStaffStore } from '@/hooks/useStaff'
import { useAuthStore } from '@/store/authStore'
import type { StaffMember, StaffRole } from '@/types/staff'

const ROLE_LABELS: Record<StaffRole, string> = {
  ceo: 'CEO',
  branch_manager: 'Branch Manager',
  operation_manager: 'Operation Manager',
  hr_manager: 'HR Manager',
  staff: 'Staff',
}

const ROLE_COLORS: Record<StaffRole, string> = {
  ceo: 'bg-purple-100 text-purple-700',
  branch_manager: 'bg-blue-100 text-blue-700',
  operation_manager: 'bg-indigo-100 text-indigo-700',
  hr_manager: 'bg-teal-100 text-teal-700',
  staff: 'bg-gray-100 text-gray-600',
}

const ALL_ROLES: StaffRole[] = ['ceo', 'branch_manager', 'operation_manager', 'hr_manager', 'staff']

function AvatarPlaceholder({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm'

  return (
    <div
      className={`${sizeClass} rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-semibold flex-shrink-0`}
    >
      {initials}
    </div>
  )
}

export function StaffPage() {
  const user = useAuthStore((s) => s.user)
  const {
    staff,
    selectedStaff,
    loading,
    fetchStaff,
    deactivateStaff,
    reactivateStaff,
    selectStaff,
  } = useStaffStore()

  const [roleFilter, setRoleFilter] = useState<StaffRole | ''>('')
  const [showInvite, setShowInvite] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const branchId = user?.role === 'ceo' ? null : (user?.branch_id ?? null)
  const canManageStaff = user?.role === 'ceo' || user?.role === 'branch_manager'

  useEffect(() => {
    fetchStaff(branchId)
  }, [branchId, fetchStaff])

  const filteredStaff = roleFilter
    ? staff.filter((s) => s.role === roleFilter)
    : staff

  const handleDeactivate = async (member: StaffMember) => {
    if (!confirm(`Deactivate ${member.full_name}? They will lose system access.`)) return
    setActionLoading(member.id)
    const { error } = await deactivateStaff(member.id)
    if (error) alert(error)
    setActionLoading(null)
  }

  const handleReactivate = async (member: StaffMember) => {
    setActionLoading(member.id)
    const { error } = await reactivateStaff(member.id)
    if (error) alert(error)
    setActionLoading(null)
  }

  const handleInviteSuccess = () => {
    fetchStaff(branchId)
  }

  // Detail panel
  if (selectedStaff) {
    return (
      <>
        <Header title="Staff" />
        <div className="p-6 space-y-5">
          {/* Back */}
          <button
            onClick={() => selectStaff(null)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <span className="text-base leading-none">&larr;</span>
            Back to Staff List
          </button>

          {/* Staff header */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-start gap-5">
            <AvatarPlaceholder name={selectedStaff.full_name} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-800">{selectedStaff.full_name}</h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    ROLE_COLORS[selectedStaff.role] ?? 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {ROLE_LABELS[selectedStaff.role] ?? selectedStaff.role}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    selectedStaff.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {selectedStaff.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{selectedStaff.email}</p>
              {selectedStaff.branch && (
                <p className="text-xs text-gray-400 mt-0.5">Branch: {selectedStaff.branch.name}</p>
              )}
            </div>

            {canManageStaff && (
              <div className="flex gap-2">
                {selectedStaff.status === 'active' ? (
                  <button
                    onClick={() => handleDeactivate(selectedStaff)}
                    disabled={actionLoading === selectedStaff.id}
                    className="px-3 py-1.5 border border-red-200 text-red-500 rounded-lg text-xs hover:bg-red-50 disabled:opacity-50"
                  >
                    {actionLoading === selectedStaff.id ? '…' : 'Deactivate'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleReactivate(selectedStaff)}
                    disabled={actionLoading === selectedStaff.id}
                    className="px-3 py-1.5 border border-green-200 text-green-600 rounded-lg text-xs hover:bg-green-50 disabled:opacity-50"
                  >
                    {actionLoading === selectedStaff.id ? '…' : 'Reactivate'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <StaffScheduleView
              mechanicId={selectedStaff.id}
              mechanicName={selectedStaff.full_name}
            />
          </div>
        </div>
      </>
    )
  }

  // List view
  return (
    <>
      <Header title="Staff" />
      <div className="p-6 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setRoleFilter('')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                roleFilter === ''
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              All
            </button>
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r === roleFilter ? '' : r)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  roleFilter === r
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>

          {canManageStaff && (
            <button
              onClick={() => setShowInvite(true)}
              className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors flex-shrink-0"
            >
              + Invite Staff
            </button>
          )}
        </div>

        {/* Staff list */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {loading && (
            <div className="py-10 text-center text-sm text-gray-400">Loading staff…</div>
          )}
          {!loading && filteredStaff.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-400">No staff members found.</div>
          )}
          {!loading && filteredStaff.length > 0 && (
            <div className="divide-y divide-gray-100">
              {filteredStaff.map((member) => (
                <button
                  key={member.id}
                  onClick={() => selectStaff(member)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <AvatarPlaceholder name={member.full_name} size="md" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800 text-sm">{member.full_name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          ROLE_COLORS[member.role] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {ROLE_LABELS[member.role] ?? member.role}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {member.email}
                      {member.branch && (
                        <span className="ml-2 text-gray-300">|</span>
                      )}
                      {member.branch && (
                        <span className="ml-2">{member.branch.name}</span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        member.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-500'
                      }`}
                    >
                      {member.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-gray-300 text-sm">&rsaquo;</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 text-right">
          {filteredStaff.length} member{filteredStaff.length !== 1 ? 's' : ''}
        </p>
      </div>

      {showInvite && (
        <InviteStaffModal
          onClose={() => setShowInvite(false)}
          onSuccess={handleInviteSuccess}
        />
      )}
    </>
  )
}
