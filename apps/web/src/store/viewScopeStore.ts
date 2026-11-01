import { create } from 'zustand'
import { supabase, registerViewScope } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// What the platform owner (is_platform_admin) is looking at: every business, one business, or one branch.
// selection: 'all' | 't:<tenantId>' | '<branchId>'
export interface ScopeBranch { id: string; name: string; tenant_id: string }
export interface ScopeTenant { id: string; name: string }

interface ViewScopeState {
  selection: string
  tenants: ScopeTenant[]
  branches: ScopeBranch[]
  setSelection: (s: string) => void
  load: () => Promise<void>
}

export const useViewScope = create<ViewScopeState>((set) => ({
  selection: 'all',
  tenants: [],
  branches: [],
  setSelection: (selection) => set({ selection }),
  load: async () => {
    // loaded without a scope, so the platform owner sees every business here
    const [t, b] = await Promise.all([
      supabase.from('tenants').select('id, name').order('name'),
      supabase.from('branches').select('id, name, tenant_id').order('name'),
    ])
    set({ tenants: (t.data ?? []) as ScopeTenant[], branches: (b.data ?? []) as ScopeBranch[] })
  },
}))

export function viewScopeOf(selection: string, branches: ScopeBranch[]): { tenantId: string | null; branchId: string | null } {
  if (selection === 'all') return { tenantId: null, branchId: null }
  if (selection.startsWith('t:')) return { tenantId: selection.slice(2), branchId: null }
  const br = branches.find(x => x.id === selection)
  return { tenantId: br?.tenant_id ?? null, branchId: br ? br.id : null }
}

export function viewScopeLabel(selection: string, tenants: ScopeTenant[], branches: ScopeBranch[]): string {
  if (selection === 'all') return tenants.length > 1 ? 'All businesses, all branches' : 'All branches'
  if (selection.startsWith('t:')) return `${tenants.find(t => t.id === selection.slice(2))?.name ?? 'Business'}, all branches`
  const br = branches.find(x => x.id === selection)
  return br ? `${tenants.find(t => t.id === br.tenant_id)?.name ?? ''} · ${br.name}` : 'All branches'
}

// Platform owner: follows the header selection. Any other super admin: tied to their own company.
registerViewScope(() => {
  const u = useAuthStore.getState().user
  if (!u || u.role !== 'super_admin') return null
  if (!u.is_platform_admin) return u.tenant_id ? { tenantId: u.tenant_id, branchId: null } : null
  const s = useViewScope.getState()
  return viewScopeOf(s.selection, s.branches)
})
