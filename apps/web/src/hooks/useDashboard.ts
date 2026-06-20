import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface DashboardStats {
  active_jobs: number
  today_appointments: number
  low_stock_items: number
  unpaid_invoices: number
  unpaid_invoices_total: number
  monthly_revenue: number
}

export interface RecentJob {
  id: string
  job_number: string
  status: string
  service_type: string
  created_at: string
  customer_name: string
  plate_number: string
  branch_name: string
}

export interface LowStockItem {
  id: string
  name: string
  sku: string
  quantity: number
  low_stock_threshold: number
  branch_name: string
}

export interface MonthlyRevenue {
  month: string
  branch_id: string
  branch_name: string
  revenue: number
}

export interface JobCountByStatus {
  status: string
  count: number
}

export interface TopService {
  service_type: string
  count: number
}

export function useDashboard(branchId: string | null) {
  const [stats, setStats] = useState<DashboardStats>({
    active_jobs: 0,
    today_appointments: 0,
    low_stock_items: 0,
    unpaid_invoices: 0,
    unpaid_invoices_total: 0,
    monthly_revenue: 0,
  })
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const activeStatuses = ['received', 'inspecting', 'waiting_approval', 'in_progress', 'waiting_for_parts']
      const today = new Date().toISOString().split('T')[0]
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

      // Active jobs
      let jobsQuery = supabase
        .from('job_orders')
        .select('id', { count: 'exact', head: true })
        .in('status', activeStatuses)
      if (branchId) jobsQuery = jobsQuery.eq('branch_id', branchId)
      const { count: activeJobs } = await jobsQuery

      // Today appointments
      let apptQuery = supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .gte('appointment_date', today)
        .lt('appointment_date', `${today}T23:59:59`)
      if (branchId) apptQuery = apptQuery.eq('branch_id', branchId)
      const { count: todayAppts } = await apptQuery

      // Low stock items
      let stockQuery = supabase
        .from('inventory')
        .select('id, quantity, low_stock_threshold', { count: 'exact' })
      if (branchId) stockQuery = stockQuery.eq('branch_id', branchId)
      const { data: inventoryData } = await stockQuery
      const lowStockCount = (inventoryData ?? []).filter(
        (item) => item.quantity < item.low_stock_threshold
      ).length

      // Unpaid invoices
      let unpaidQuery = supabase
        .from('invoices')
        .select('id, total_amount')
        .eq('payment_status', 'unpaid')
      if (branchId) unpaidQuery = unpaidQuery.eq('branch_id', branchId)
      const { data: unpaidData } = await unpaidQuery
      const unpaidInvoices = unpaidData?.length ?? 0
      const unpaidTotal = (unpaidData ?? []).reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0)

      // Monthly revenue (paid invoices this month)
      let revenueQuery = supabase
        .from('invoices')
        .select('total_amount')
        .eq('payment_status', 'paid')
        .gte('created_at', monthStart)
      if (branchId) revenueQuery = revenueQuery.eq('branch_id', branchId)
      const { data: revenueData } = await revenueQuery
      const monthlyRevenue = (revenueData ?? []).reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0)

      setStats({
        active_jobs: activeJobs ?? 0,
        today_appointments: todayAppts ?? 0,
        low_stock_items: lowStockCount,
        unpaid_invoices: unpaidInvoices,
        unpaid_invoices_total: unpaidTotal,
        monthly_revenue: monthlyRevenue,
      })

      // Recent jobs (last 10)
      let recentQuery = supabase
        .from('job_orders')
        .select(`
          id, job_number, status, service_type, created_at,
          customer:customers(full_name),
          vehicle:vehicles(plate_number),
          branch:branches(name)
        `)
        .order('created_at', { ascending: false })
        .limit(10)
      if (branchId) recentQuery = recentQuery.eq('branch_id', branchId)
      const { data: recentData } = await recentQuery
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRecentJobs(
        (recentData ?? []).map((j: any) => ({
          id: j.id,
          job_number: j.job_number,
          status: j.status,
          service_type: j.service_type,
          created_at: j.created_at,
          customer_name: (Array.isArray(j.customer) ? j.customer[0]?.full_name : j.customer?.full_name) ?? '—',
          plate_number: (Array.isArray(j.vehicle) ? j.vehicle[0]?.plate_number : j.vehicle?.plate_number) ?? '—',
          branch_name: (Array.isArray(j.branch) ? j.branch[0]?.name : j.branch?.name) ?? '—',
        }))
      )

      // Low stock items
      let lowQuery = supabase
        .from('inventory')
        .select(`id, name, sku, quantity, low_stock_threshold, branch:branches(name)`)
      if (branchId) lowQuery = lowQuery.eq('branch_id', branchId)
      const { data: lowData } = await lowQuery
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setLowStockItems(
        (lowData ?? [])
          .filter((item: any) => item.quantity < item.low_stock_threshold)
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            sku: item.sku,
            quantity: item.quantity,
            low_stock_threshold: item.low_stock_threshold,
            branch_name: (Array.isArray(item.branch) ? item.branch[0]?.name : item.branch?.name) ?? '—',
          }))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  return { stats, recentJobs, lowStockItems, loading, error, refetch: fetchStats }
}

export async function getDashboardStats(branchId?: string | null): Promise<DashboardStats> {
  const activeStatuses = ['received', 'inspecting', 'waiting_approval', 'in_progress', 'waiting_for_parts']
  const today = new Date().toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  let jobsQuery = supabase
    .from('job_orders')
    .select('id', { count: 'exact', head: true })
    .in('status', activeStatuses)
  if (branchId) jobsQuery = jobsQuery.eq('branch_id', branchId)
  const { count: activeJobs } = await jobsQuery

  let apptQuery = supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .gte('appointment_date', today)
    .lt('appointment_date', `${today}T23:59:59`)
  if (branchId) apptQuery = apptQuery.eq('branch_id', branchId)
  const { count: todayAppts } = await apptQuery

  let stockQuery = supabase
    .from('inventory')
    .select('id, quantity, low_stock_threshold')
  if (branchId) stockQuery = stockQuery.eq('branch_id', branchId)
  const { data: inventoryData } = await stockQuery
  const lowStockCount = (inventoryData ?? []).filter(
    (item) => item.quantity < item.low_stock_threshold
  ).length

  let unpaidQuery = supabase
    .from('invoices')
    .select('id, total_amount')
    .eq('payment_status', 'unpaid')
  if (branchId) unpaidQuery = unpaidQuery.eq('branch_id', branchId)
  const { data: unpaidData } = await unpaidQuery
  const unpaidInvoices = unpaidData?.length ?? 0
  const unpaidTotal = (unpaidData ?? []).reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0)

  let revenueQuery = supabase
    .from('invoices')
    .select('total_amount')
    .eq('payment_status', 'paid')
    .gte('created_at', monthStart)
  if (branchId) revenueQuery = revenueQuery.eq('branch_id', branchId)
  const { data: revenueData } = await revenueQuery
  const monthlyRevenue = (revenueData ?? []).reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0)

  return {
    active_jobs: activeJobs ?? 0,
    today_appointments: todayAppts ?? 0,
    low_stock_items: lowStockCount,
    unpaid_invoices: unpaidInvoices,
    unpaid_invoices_total: unpaidTotal,
    monthly_revenue: monthlyRevenue,
  }
}
