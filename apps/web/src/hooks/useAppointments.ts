import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type {
  Appointment,
  MechanicSchedule,
  CreateAppointmentPayload,
  ConvertToJobPayload,
} from '@/types/appointment'

interface AppointmentsState {
  appointments: Appointment[]
  mechanicSchedules: MechanicSchedule[]
  loading: boolean
  error: string | null

  fetchAppointments: (branchId: string, date?: string) => Promise<void>
  createAppointment: (data: CreateAppointmentPayload) => Promise<{ error: string | null; appointment: Appointment | null }>
  confirmAppointment: (id: string) => Promise<{ error: string | null }>
  convertToJob: (appointmentId: string, jobData: ConvertToJobPayload) => Promise<{ error: string | null; jobId: string | null }>
  getMechanicSchedule: (branchId: string, date: string) => Promise<void>
}

const APPOINTMENT_SELECT = `
  *,
  mechanic:user_profiles!appointments_mechanic_id_fkey(id, full_name),
  job_order:job_orders!appointments_job_order_id_fkey(id, job_number)
`

export const useAppointmentsStore = create<AppointmentsState>((set, get) => ({
  appointments: [],
  mechanicSchedules: [],
  loading: false,
  error: null,

  fetchAppointments: async (branchId: string, date?: string) => {
    set({ loading: true, error: null })

    let query = supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('branch_id', branchId)
      .order('appointment_time', { ascending: true })

    if (date) {
      query = query.eq('appointment_date', date)
    }

    const { data, error } = await query

    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ appointments: (data as Appointment[]) ?? [], loading: false })
  },

  createAppointment: async (payload: CreateAppointmentPayload) => {
    const insertData = {
      ...payload,
      source: payload.source ?? 'direct',
      status: 'pending' as const,
    }

    const { data, error } = await supabase
      .from('appointments')
      .insert([insertData])
      .select(APPOINTMENT_SELECT)
      .single()

    if (error) return { error: error.message, appointment: null }

    const appointment = data as Appointment
    set((state) => ({ appointments: [...state.appointments, appointment] }))
    return { error: null, appointment }
  },

  confirmAppointment: async (id: string) => {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: error.message }

    set((state) => ({
      appointments: state.appointments.map((a) =>
        a.id === id ? { ...a, status: 'confirmed' as const } : a
      ),
    }))
    return { error: null }
  },

  convertToJob: async (appointmentId: string, jobData: ConvertToJobPayload) => {
    const appointment = get().appointments.find((a) => a.id === appointmentId)
    if (!appointment) return { error: 'Appointment not found', jobId: null }

    // Create the job order
    const { data: jobRow, error: jobError } = await supabase
      .from('job_orders')
      .insert([{
        branch_id: jobData.branch_id,
        service_type: jobData.service_type,
        description: jobData.description ?? null,
        assigned_to: jobData.assigned_to ?? appointment.mechanic_id ?? null,
        status: 'received',
      }])
      .select('id, job_number')
      .single()

    if (jobError) return { error: jobError.message, jobId: null }

    // Link appointment to job order and mark completed
    const { error: updateError } = await supabase
      .from('appointments')
      .update({
        job_order_id: jobRow.id,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)

    if (updateError) return { error: updateError.message, jobId: null }

    set((state) => ({
      appointments: state.appointments.map((a) =>
        a.id === appointmentId
          ? { ...a, status: 'completed' as const, job_order_id: jobRow.id, job_order: jobRow }
          : a
      ),
    }))

    return { error: null, jobId: jobRow.id }
  },

  getMechanicSchedule: async (branchId: string, date: string) => {
    set({ loading: true, error: null })

    const { data, error } = await supabase
      .from('mechanic_schedules')
      .select(`*, mechanic:user_profiles!mechanic_schedules_mechanic_id_fkey(id, full_name)`)
      .eq('branch_id', branchId)
      .eq('schedule_date', date)

    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ mechanicSchedules: (data as MechanicSchedule[]) ?? [], loading: false })
  },
}))
