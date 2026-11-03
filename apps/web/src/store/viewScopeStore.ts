import { create } from 'zustand'
import { supabase, registerViewScope, registerActingTenant } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { Tenant } from '@/types'

// What the platform owner (is_platform_admin super admin) is looking at and working in: every business, one business, or one branch.
// selection: 'all' | 't:<tenantId>' | 'b:<tenantId>:<branchId>'
// Picking a business or branch also makes the owner work AS that business: new records are stamped with it, and the database
// (via the x-acting-tenant header) applies that business's rules, exactly as for its own super admin.
export interface ScopeBranch { id: string; name: string; tenant_id: string }
export interface ScopeTenant { id: string; name: string }

const KEY = 'ezwf_view_scope'
function readSaved(): string {
  try { return sessionStorage.getItem(KEY) || 'all' } catch { return 'all' }
}

interface ViewScopeState {
  selection: string
  tenants: ScopeTenant[]
  branches: ScopeBranch[]
  setSelection: (s: string) => void
  load: () => Promise<void>
}

export const useViewScope = create<ViewScopeState>((set) => ({
  selection: readSaved(),
  tenants: [],
  branches: [],
  setSelection: (selection) => {
    try { sessionStorage.setItem(KEY, selection) } catch { /* private window */ }
    set({ selection })
  },
  load: async () => {
    const [t, b] = await Promise.all([
      supabase.from('tenants').select('id, name').order('name'),
      supabase.from('branches').select('id, name, tenant_id').order('name'),
    ])
    set({ tenants: (t.data ?? []) as ScopeTenant[], branches: (b.data ?? []) as ScopeBranch[] })
  },
}))

export function viewScopeOf(selection: string): { tenantId: string | null; branchId: string | null } {
  if (selection.startsWith('t:')) return { tenantId: selection.slice(2), branchId: null }
  if (selection.startsWith('b:')) {
    const [, tenantId, branchId] = selection.split(':')
    return { tenantId: tenantId || null, branchId: branchId || null }
  }
  return { tenantId: null, branchId: null }
}

export function viewScopeLabel(selection: string, tenants: ScopeTenant[], branches: ScopeBranch[]): string {
  const { tenantId, branchId } = viewScopeOf(selection)
  if (!tenantId) return tenants.length > 1 ? 'All businesses, all branches' : 'All branches'
  const name = tenants.find(t => t.id === tenantId)?.name ?? 'Business'
  if (!branchId) return `${name}, all branches`
  return `${name} · ${branches.find(x => x.id === branchId)?.name ?? 'branch'}`
}

const isOwner = (u: { role?: string; is_platform_admin?: boolean } | null | undefined) => !!u && u.role === 'super_admin' && !!u.is_platform_admin

// Platform owner: follows the header choice. Any other super admin: tied to their own company.
registerViewScope(() => {
  const u = useAuthStore.getState().user
  if (!u || u.role !== 'super_admin') return null
  if (!u.is_platform_admin) return u.tenant_id ? { tenantId: u.tenant_id, branchId: null } : null
  return viewScopeOf(useViewScope.getState().selection)
})

// The business the owner is working inside, when it is not their own
registerActingTenant(() => {
  const u = useAuthStore.getState().user
  if (!isOwner(u)) return null
  const home = u!.home_tenant_id ?? u!.tenant_id
  const t = viewScopeOf(useViewScope.getState().selection).tenantId
  return t && t !== home ? t : null
})

// Make the logged-in user (and the business rules in `tenant`) match the business being worked in, so every screen that
// stamps records with user.tenant_id / user.branch_id, or reads tenant.tight_controls, behaves as that business.
let syncing = false
async function syncActing() {
  if (syncing) return
  const { user, tenant, setUser, setTenant } = useAuthStore.getState()
  if (!isOwner(user) || !user) return
  const homeTenant = user.home_tenant_id ?? user.tenant_id
  const homeBranch = user.home_branch_id !== undefined ? user.home_branch_id : user.branch_id
  const sel = viewScopeOf(useViewScope.getState().selection)
  const wantTenant = sel.tenantId && sel.tenantId !== homeTenant ? sel.tenantId : homeTenant
  let wantBranch: string | null = homeBranch
  if (wantTenant !== homeTenant) {
    const list = useViewScope.getState().branches.filter(b => b.tenant_id === wantTenant)
    wantBranch = sel.branchId ?? list[0]?.id ?? null
    if (!wantBranch) return // branch list not loaded yet; runs again when it is
  } else if (sel.branchId) {
    wantBranch = sel.branchId
  }
  const profileOk = user.tenant_id === wantTenant && user.branch_id === wantBranch
  const tenantOk = tenant?.id === wantTenant
  if (profileOk && tenantOk) return
  syncing = true
  try {
    if (!profileOk) {
      setUser(wantTenant === homeTenant && wantBranch === homeBranch
        ? { ...user, tenant_id: homeTenant, branch_id: homeBranch, home_tenant_id: undefined, home_branch_id: undefined }
        : { ...user, tenant_id: wantTenant, branch_id: wantBranch, home_tenant_id: homeTenant, home_branch_id: homeBranch })
    }
    if (!tenantOk) {
      const { data } = await supabase.from('tenants').select('*').eq('id', wantTenant).single()
      if (data) setTenant(data as Tenant)
    }
  } finally {
    syncing = false
  }
}
useViewScope.subscribe((s, p) => { if (s.selection !== p.selection || s.branches !== p.branches) void syncActing() })
useAuthStore.subscribe((s, p) => { if (s.user !== p.user || s.tenant !== p.tenant) queueMicrotask(() => void syncActing()) })
