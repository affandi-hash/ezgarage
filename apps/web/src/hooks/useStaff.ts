import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { StaffMember, Schedule, ScheduleUpsertPayload, DayOfWeek, InviteStaffPayload } from '@/types/staff'

interface StaffState {
  staff: StaffMember[]
  selectedStaff: StaffMember | null
  schedules: Schedule[]
  loading: boolean
  scheduleLoading: boolean
  error: string | null

  fetchStaff: (branchId: string | null) => Promise<void>
  inviteStaff: (payload: InviteStaffPayload) => Promise<{ error: string | null }>
  deactivateStaff: (id: string) => Promise<{ error: string | null }>
  reactivateStaff: (id: string) => Promise<{ error: string | null }>
  selectStaff: (member: StaffMember | null) => void
  fetchSchedules: (mechanicId: string) => Promise<void>
  updateSchedule: (mechanicId: string, dates: ScheduleUpsertPayload[]) => Promise<{ error: string | null }>
}

export const useStaffStore = create<StaffState>((set, get) => ({
  staff: [],
  selectedStaff: null,
  schedules: [],
  loading: false,
  scheduleLoading: false,
  error: null,

  fetchStaff: async (branchId: string | null) => {
    set({ loading: true, error: null })

    let query = supabase
      .from('user_profiles')
      .select(`
        id,
        full_name,
        email,
        role,
        branch_id,
        status,
        avatar_url,
        created_at,
        updated_at,
        branch:branches(id, name)
      `)
      .order('full_name', { ascending: true })

    // CEO sees all branches; others scoped to their branch
    if (branchId) {
      query = query.eq('branch_id', branchId)
    }

    const { data, error } = await query

    if (error) {
      set({ error: error.message, loading: false })
      return
    }

    set({ staff: (data as unknown as StaffMember[]) ?? [], loading: false })
  },

  inviteStaff: async (payload: InviteStaffPayload) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/api/staff/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      const body = await res.json()
      if (!res.ok) return { error: body.error ?? 'Invite failed' }

      return { error: null }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invite failed'
      return { error: msg }
    }
  },

  deactivateStaff: async (id: string) => {
    const { error } = await supabase
      .from('user_profiles')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: error.message }

    set((state) => ({
      staff: state.staff.map((s) =>
        s.id === id ? { ...s, status: 'inactive' as const } : s
      ),
    }))

    return { error: null }
  },

  reactivateStaff: async (id: string) => {
    const { error } = await supabase
      .from('user_profiles')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: error.message }

    set((state) => ({
      staff: state.staff.map((s) =>
        s.id === id ? { ...s, status: 'active' as const } : s
      ),
    }))

    return { error: null }
  },

  selectStaff: (member) => set({ selectedStaff: member, schedules: [] }),

  fetchSchedules: async (mechanicId: string) => {
    set({ scheduleLoading: true })

    const { data, error } = await supabase
      .from('mechanic_schedules')
      .select('*')
      .eq('mechanic_id', mechanicId)
      .order('day_of_week')

    if (error) {
      set({ scheduleLoading: false })
      return
    }

    set({ schedules: (data as Schedule[]) ?? [], scheduleLoading: false })
  },

  updateSchedule: async (mechanicId: string, dates: ScheduleUpsertPayload[]) => {
    // Upsert all days at once using on_conflict
    const rows = dates.map((d) => ({ ...d, mechanic_id: mechanicId }))

    const { error } = await supabase
      .from('mechanic_schedules')
      .upsert(rows, { onConflict: 'mechanic_id,day_of_week' })

    if (error) return { error: error.message }

    // Refresh local state
    await get().fetchSchedules(mechanicId)

    return { error: null }
  },
}))

// Named exports matching task spec
export const fetchStaff = (branchId: string | null) =>
  useStaffStore.getState().fetchStaff(branchId)

export const inviteStaff = (payload: InviteStaffPayload) =>
  useStaffStore.getState().inviteStaff(payload)

export const deactivateStaff = (id: string) =>
  useStaffStore.getState().deactivateStaff(id)

export const updateSchedule = (mechanicId: string, dates: ScheduleUpsertPayload[]) =>
  useStaffStore.getState().updateSchedule(mechanicId, dates)

export type { DayOfWeek }
