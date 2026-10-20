import { MfaPanel } from '@/components/auth/MfaPanel'
import { useAuthStore } from '@/store/authStore'
import { Lock } from 'lucide-react'

export function SecurityPage() {
  const { user, tenant } = useAuthStore()
  const needs = tenant?.require_mfa && (user?.role === 'super_admin' || user?.is_branch_admin)
  return (
    <div style={{ padding: 16, maxWidth: 700, margin: '0 auto' }}>
      <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Lock size={22} color="#F15A22" /> Security</h1>
      <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 16px' }}>
        {needs
          ? 'Your account holds the money powers, so every sign-in needs the code from your authenticator app.'
          : 'Set up an authenticator app on your own phone. Branch Admins and super admins will be asked for its code before using the money powers once the company turns that on.'}
      </p>
      <MfaPanel />
    </div>
  )
}
