import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { JobOrder, JobStatus, CreateJobPayload, JobStatusLog, JobPhoto, JobMechanic } from '@/types/job'

interface JobsState {
  jobs: JobOrder[]
  selectedJob: JobOrder | null
  statusLogs: JobStatusLog[]
  photos: JobPhoto[]
  mechanics: JobMechanic[]
  loading: boolean
  error: string | null

  fetchJobs: (branchId: string) => Promise<void>
  createJob: (data: CreateJobPayload) => Promise<{ error: string | null; job: JobOrder | null }>
  updateJobStatus: (id: string, status: JobStatus, notes?: string) => Promise<{ error: string | null }>
  getJobById: (id: string) => Promise<void>
  clearSelected: () => void
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  selectedJob: null,
  statusLogs: [],
  photos: [],
  mechanics: [],
  loading: false,
  error: null,

  fetchJobs: async (branchId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('job_orders')
      .select(`
        *,
        customer:customers(id, full_name, phone),
        vehicle:vehicles(id, plate_number, make, model, year),
        assigned_mechanic:user_profiles!job_orders_assigned_to_fkey(id, full_name)
      `)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ jobs: (data as JobOrder[]) ?? [], loading: false })
  },

  createJob: async (payload: CreateJobPayload) => {
    const { data, error } = await supabase
      .from('job_orders')
      .insert([payload])
      .select(`
        *,
        customer:customers(id, full_name, phone),
        vehicle:vehicles(id, plate_number, make, model, year),
        assigned_mechanic:user_profiles!job_orders_assigned_to_fkey(id, full_name)
      `)
      .single()

    if (error) return { error: error.message, job: null }

    const job = data as JobOrder
    set((state) => ({ jobs: [job, ...state.jobs] }))
    return { error: null, job }
  },

  updateJobStatus: async (id: string, status: JobStatus, notes?: string) => {
    const currentJob = get().jobs.find((j) => j.id === id) ?? get().selectedJob
    const previous_status = currentJob?.status ?? null

    const { error: updateError } = await supabase
      .from('job_orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (updateError) return { error: updateError.message }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('job_status_logs').insert([{
        job_order_id: id,
        previous_status,
        new_status: status,
        notes: notes ?? null,
        changed_by: user.id,
      }])
    }

    set((state) => ({
      jobs: state.jobs.map((j) => j.id === id ? { ...j, status } : j),
      selectedJob: state.selectedJob?.id === id ? { ...state.selectedJob, status } : state.selectedJob,
    }))

    return { error: null }
  },

  getJobById: async (id: string) => {
    set({ loading: true, error: null })

    const [jobRes, logsRes, photosRes, mechanicsRes] = await Promise.all([
      supabase
        .from('job_orders')
        .select(`
          *,
          customer:customers(id, full_name, phone),
          vehicle:vehicles(id, plate_number, make, model, year),
          assigned_mechanic:user_profiles!job_orders_assigned_to_fkey(id, full_name)
        `)
        .eq('id', id)
        .single(),
      supabase
        .from('job_status_logs')
        .select(`*, changed_by_profile:user_profiles!job_status_logs_changed_by_fkey(full_name)`)
        .eq('job_order_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('job_photos')
        .select('*')
        .eq('job_order_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('job_mechanics')
        .select(`*, mechanic:user_profiles!job_mechanics_mechanic_id_fkey(id, full_name)`)
        .eq('job_order_id', id),
    ])

    set({
      selectedJob: jobRes.data as JobOrder ?? null,
      statusLogs: (logsRes.data as JobStatusLog[]) ?? [],
      photos: (photosRes.data as JobPhoto[]) ?? [],
      mechanics: (mechanicsRes.data as JobMechanic[]) ?? [],
      loading: false,
      error: jobRes.error?.message ?? null,
    })
  },

  clearSelected: () => set({ selectedJob: null, statusLogs: [], photos: [], mechanics: [] }),
}))
