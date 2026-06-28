import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { UserProfile, Tenant } from '@/types'

interface AuthState {
  user: UserProfile | null
  tenant: Tenant | null
  loading: boolean
  setUser: (user: UserProfile | null) => void
  setTenant: (tenant: Tenant | null) => void
  setLoading: (loading: boolean) => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  loading: true,

  setUser: (user) => set({ user }),
  setTenant: (tenant) => set({ tenant }),
  setLoading: (loading) => set({ loading }),

  signIn: async (email, password) => {
    function safeMsg(raw: unknown, fallback: string): string {
      if (typeof raw === 'string' && raw.trim() && raw.trim() !== '{}' && raw.trim() !== '[]') return raw.trim()
      return fallback
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: safeMsg(error.message, 'Invalid email or password. Please try again.') }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, full_name, email, role, branch_id, approval_status, is_active, tenant_id, must_change_password')
        .eq('id', data.user.id)
        .single()

      if (profileError || !profile) {
        await supabase.auth.signOut()
        return { error: 'Account not set up yet. Please contact your administrator.' }
      }

      if (!profile.is_active) {
        await supabase.auth.signOut()
        return { error: 'Your account is inactive. Please contact your administrator.' }
      }

      if (profile.approval_status !== 'approved') {
        await supabase.auth.signOut()
        return { error: 'Your account is pending approval. Please contact your administrator.' }
      }

      const { data: tenant } = await supabase.from('tenants').select('*').eq('id', profile.tenant_id).single()
      set({ user: profile as UserProfile, tenant: tenant ?? null, loading: false })
      return { error: null }
    } catch (err: unknown) {
      await supabase.auth.signOut().catch(() => {})
      return { error: safeMsg(err instanceof Error ? err.message : err, 'An unexpected error occurred. Please try again.') }
    }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, tenant: null })
  },
}))
