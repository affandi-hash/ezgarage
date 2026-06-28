import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAuthStore } from '@/store/authStore'

export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const isSuperAdmin = user?.role === 'super_admin'
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(
    isSuperAdmin ? null : (user?.branch_id ?? null)
  )

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0E0E0E',
      }}
    >
      <Sidebar />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <Header
          selectedBranchId={selectedBranchId}
          onBranchChange={isSuperAdmin ? setSelectedBranchId : undefined}
        />
        <main
          style={{
            flex: 1,
            overflow: 'hidden',
            backgroundColor: '#0E0E0E',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
            <Outlet context={{ selectedBranchId }} />
          </div>
        </main>
      </div>
    </div>
  )
}
