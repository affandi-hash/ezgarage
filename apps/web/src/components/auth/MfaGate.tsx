import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { MfaPanel } from '@/components/auth/MfaPanel'

// When the company requires the second step, a Branch Admin or super admin sees this before anything else until they have
// entered their authenticator code in this session. Everyone else passes straight through.
export function MfaGate({ children }: { children: ReactNode }) {
  const { user, tenant } = useAuthStore()
  const required = !!tenant?.require_mfa && (user?.role === 'super_admin' || !!user?.is_branch_admin)
  const [ok, setOk] = useState<boolean | null>(null)

  useEffect(() => {
    if (!required) { setOk(true); return }
    let cancelled = false
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => { if (!cancelled) setOk(data?.currentLevel === 'aal2') })
    return () => { cancelled = true }
  }, [required, user?.id])

  if (ok === null) return null
  if (ok) return <>{children}</>
  return (
    <div style={{ minHeight: '100vh', background: '#0E0E0E', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 14 }}>
      <div style={{ color: '#F0F0F0', fontSize: 18, fontWeight: 800 }}>One more step</div>
      <div style={{ color: '#A0A0A0', fontSize: 13, textAlign: 'center', maxWidth: 420 }}>Your account holds the money powers, so we need the code from your authenticator app before you continue.</div>
      <MfaPanel onVerified={() => setOk(true)} />
    </div>
  )
}
