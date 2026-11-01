import { Fragment, useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAuthStore } from '@/store/authStore'
import { canSeeAllBranches } from '@/lib/branchScope'
import { MfaGate } from '@/components/auth/MfaGate'
import { useViewScope, viewScopeOf } from '@/store/viewScopeStore'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

export function AppLayout() {
  const user = useAuthStore((s) => s.user)
  const seesAllBranches = canSeeAllBranches(user?.role)
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(
    seesAllBranches ? null : (user?.branch_id ?? null)
  )
  const isPlatform = !!user?.is_platform_admin && user?.role === 'super_admin'
  const view = useViewScope()
  // the platform owner's header choice (all / one business / one branch) decides the branch filter for every page
  const ownerBranchId = viewScopeOf(view.selection, view.branches).branchId
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const isMobile = useIsMobile()

  // Close drawer on route change or resize to desktop
  useEffect(() => { if (!isMobile) setMobileNavOpen(false) }, [isMobile])

  return (
    <MfaGate>
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: '#0E0E0E' }}>
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <Header
          selectedBranchId={selectedBranchId}
          onBranchChange={seesAllBranches ? setSelectedBranchId : undefined}
          onMenuToggle={() => setMobileNavOpen(o => !o)}
        />
        <main style={{ flex: 1, overflow: 'hidden', backgroundColor: '#0E0E0E', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
            {/* keyed by the choice so a page reloads its data when the owner switches business or branch */}
            <Fragment key={isPlatform ? view.selection : 'fixed'}>
              <Outlet context={{ selectedBranchId: isPlatform ? ownerBranchId : selectedBranchId }} />
            </Fragment>
          </div>
        </main>
      </div>
    </div>
    </MfaGate>
  )
}
