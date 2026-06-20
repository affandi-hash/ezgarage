import { create } from 'zustand'
import { supabase } from '@/lib/supabase'

type Role = 'ceo' | 'branch_manager' | 'operation_manager' | 'hr_manager' | 'staff' | 'customer'

interface UserProfile {
  id: string
  full_name: string
  role: Role
  branch_id: string | null
}

interface AuthState {
  user: UserProfile | null
  loading: boolean
  setUser: (user: UserProfile | null) => void
  setLoading: (loading: boolean) => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, full_name, role, branch_id')
      .eq('id', data.user.id)
      .single()

    if (profile) set({ user: profile })
    return { error: null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null })
  },
}))
