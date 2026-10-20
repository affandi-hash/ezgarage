import type { ReactNode } from 'react'
import { canManageUsers } from '@/lib/money'

// The Users module is for a super admin or the Branch Admin only (MAC's ops managers keep it).
export function UsersGate({ children }: { children: ReactNode }) {
  if (canManageUsers()) return <>{children}</>
  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#A0A0A0' }}>
      <div style={{ color: '#F0F0F0', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Users</div>
      Managing accounts is limited to the Branch Admin and super admin.
    </div>
  )
}
