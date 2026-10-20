import { useAuthStore } from '@/store/authStore'

// The money powers: voiding a payment, voiding an invoice that has payments, adding or replacing proof on a payment,
// recording a supplier payment by hand (and changing an issued invoice, which the screens do not offer).
// For a company with the stricter rules on, only a super admin or the Branch Admin may use them. A company with the
// rules off (MAC Service) keeps its earlier role lists. The database enforces the same; this only hides the buttons.
export function canUseMoneyPowers(legacyRoles: string[]): boolean {
  const { user, tenant } = useAuthStore.getState()
  if (!user) return false
  if (tenant?.tight_controls === false) return legacyRoles.includes(user.role)
  return user.role === 'super_admin' || !!user.is_branch_admin
}

export const MONEY_ERRORS: Record<string, string> = {
  branch_admin_only: 'Only the Branch Admin can do this.',
  mfa_required: 'Enter your authenticator code first (Security page), then try again.',
  forbidden: 'You do not have permission to do this.',
}
