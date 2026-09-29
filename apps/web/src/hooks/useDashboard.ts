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
      const pad = (n: number) => String(n).padStart(2, '0')
      const monthStartDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`
      const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 1)
      const monthEndDate = `${nextMonthDate.getFullYear()}-${pad(nextMonthDate.getMonth() + 1)}-01`

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

      // Completed this month -- counts jobs actually DELIVERED this month
      // (status_updated_at, the timestamp the app stamps whenever a job's
      // status changes), not jobs merely CHECKED IN this month. The previous
      // checked_in_at filter missed every job that started last month but
      // was finished this month, and would also have wrongly counted a job
      // checked in this month and delivered next month had one existed --
      // undercounting real September completions by 5 jobs (39 vs the true 44).
      let closedQuery = supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'delivered')
        .gte('status_updated_at', monthStart)

      if (branchId) closedQuery = closedQuery.eq('branch_id', branchId)
      const { count: closedCount } = await closedQuery

      // Revenue (Month) -- actual cash collected this month, sourced from
      // paid invoices (issue_date in the current month), the same
      // definition "Revenue" already uses everywhere else in the app
      // (Reports, Finance). This previously summed jobs.final_amount for
      // delivered jobs CHECKED IN this month -- an entirely different,
      // undocumented accrual-style figure that doesn't match "Revenue"
      // anywhere else in the product and overstated real collections by
      // ~62% (RM30,863.25 vs the true RM19,087.25 for September 2026).
      let revenueQuery = supabase
        .from('invoices')
        .select('total_amount, subtotal')
        .eq('status', 'paid')
        .gte('issue_date', monthStartDate)
        .lt('issue_date', monthEndDate)

      if (branchId) revenueQuery = revenueQuery.eq('branch_id', branchId)
      const { data: paidInvoices } = await revenueQuery

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

      const estRevenue = (paidInvoices || []).reduce(
        (sum: number, inv: { total_amount: number | null; subtotal: number | null }) => sum + (inv.total_amount ?? inv.subtotal ?? 0),
        0
      )

      // days_in_garage is a stored column the app never actually populates --
      // compute how long each still-active job has been checked in directly
      // from checked_in_at instead of trusting an always-zero field.
      const now = Date.now()
      const totalDays = jobs.reduce((sum, j) => {
        if (!j.checked_in_at) return sum
        const days = (now - new Date(j.checked_in_at).getTime()) / 86400000
        return sum + Math.max(0, days)
      }, 0)
      const avgDays = jobs.length > 0 ? Math.round((totalDays / jobs.length) * 10) / 10 : 0

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
