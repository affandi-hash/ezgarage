import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Job, Booking, JobStatus } from '@/types'

export interface DashboardStats {
  bookings_today: number
  active_cars: number
  active_bikes: number
  ready: number
  long_due: number
  waiting_approval: number
  waiting_parts: number
  est_revenue: number
  completed_month: number
  avg_days: number
}

export interface WorkshopSnapshot {
  status: JobStatus
  count: number
}

interface UseDashboardReturn {
  stats: DashboardStats | null
  recentJobs: Job[]
  todayBookings: Booking[]
  workshopSnapshot: WorkshopSnapshot[]
  loading: boolean
  error: string | null
  refetch: () => void
}

const ACTIVE_STATUSES: JobStatus[] = [
  'checked_in',
  'diagnosing',
  'waiting_approval',
  'waiting_parts',
  'in_progress',
  'ready',
  'long_due',
]

export function useDashboard(branchId?: string | null): UseDashboardReturn {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [todayBookings, setTodayBookings] = useState<Booking[]>([])
  const [workshopSnapshot, setWorkshopSnapshot] = useState<WorkshopSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

      // Fetch all active jobs with relations
      let jobsQuery = supabase
        .from('jobs')
        .select(`
          id, job_number, branch_id, customer_id, vehicle_id, status,
          service_type, vehicle_type, estimated_cost, assigned_foreman_id,
          assigned_mechanic_id, checked_in_at, days_in_garage, payment_status,
          diagnosis_summary, customer_complaint, internal_notes, source, arrival_mode,
          customer:customers(id, full_name, phone),
          vehicle:vehicles(id, plate_number, make, model, vehicle_type)
        `)
        .in('status', ACTIVE_STATUSES)
        .order('checked_in_at', { ascending: false })

      if (branchId) jobsQuery = jobsQuery.eq('branch_id', branchId)

      const { data: activeJobs, error: jobsError } = await jobsQuery
      if (jobsError) throw new Error(jobsError.message)
      const jobs = (activeJobs || []) as unknown as Job[]

      // Today's bookings
      let bookingsQuery = supabase
        .from('bookings')
        .select('*')
        .eq('booking_date', todayStr)
        .order('booking_date', { ascending: true })

      if (branchId) bookingsQuery = bookingsQuery.eq('branch_id', branchId)

      const { data: bookingsData, error: bookingsError } = await bookingsQuery
      if (bookingsError) throw new Error(bookingsError.message)
      const bookings = (bookingsData || []) as Booking[]

      // Completed this month
      let closedQuery = supabase
        .from('jobs')
        .select('id, estimated_cost', { count: 'exact' })
        .eq('status', 'closed')
        .gte('checked_in_at', monthStart)

      if (branchId) closedQuery = closedQuery.eq('branch_id', branchId)
      const { data: closedJobs, count: closedCount } = await closedQuery

      // Workshop snapshot count by status
      const statusCounts: Record<string, number> = {}
      jobs.forEach((j) => {
        statusCounts[j.status] = (statusCounts[j.status] || 0) + 1
      })

      const snapshot: WorkshopSnapshot[] = ACTIVE_STATUSES.map((s) => ({
        status: s,
        count: statusCounts[s] || 0,
      }))

      // Calculate stats — prefer joined vehicle.vehicle_type over job-level column
      const getVehicleType = (j: Job) => ((j as any).vehicle?.vehicle_type ?? j.vehicle_type ?? 'car').toLowerCase()
      const activeCars  = jobs.filter((j) => getVehicleType(j) === 'car').length
      const activeBikes = jobs.filter((j) => getVehicleType(j) === 'bike').length
      const ready = jobs.filter((j) => j.status === 'ready').length
      const longDue = jobs.filter((j) => j.status === 'long_due').length
      const waitingApproval = jobs.filter((j) => j.status === 'waiting_approval').length
      const waitingParts = jobs.filter((j) => j.status === 'waiting_parts').length

      const estRevenue = (closedJobs || []).reduce(
        (sum: number, j: any) => sum + (j.estimated_cost || 0),
        0
      )

      const totalDays = jobs.reduce((sum, j) => sum + (j.days_in_garage || 0), 0)
      const avgDays = jobs.length > 0 ? Math.round(totalDays / jobs.length) : 0

      setStats({
        bookings_today: bookings.length,
        active_cars: activeCars,
        active_bikes: activeBikes,
        ready,
        long_due: longDue,
        waiting_approval: waitingApproval,
        waiting_parts: waitingParts,
        est_revenue: estRevenue,
        completed_month: closedCount || 0,
        avg_days: avgDays,
      })

      setRecentJobs(jobs.slice(0, 10))
      setTodayBookings(bookings)
      setWorkshopSnapshot(snapshot)
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { stats, recentJobs, todayBookings, workshopSnapshot, loading, error, refetch: fetchData }
}
