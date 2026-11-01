import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Company lock. A super admin's database access spans every company (the policies let a super admin through for any
// company), so without this the owner's reports and lists add up Motoverse AND MAC Service. While a company is locked,
// every read, update and delete the app makes on a company table is limited to that company. Inserts are untouched.
// The lock is the logged-in user's own company; it is registered by the auth store.
const COMPANY_TABLES = new Set([
  'action_requests',
  'ai_token_usage',
  'attendance_records',
  'audit_logs',
  'bays',
  'bookings',
  'branches',
  'customer_updates',
  'customers',
  'deleted_records',
  'deletion_requests',
  'esp_announcements',
  'esp_communities',
  'esp_maintenance_items',
  'esp_members',
  'esp_vehicle_maintenance_log',
  'esp_vehicle_maintenance_overrides',
  'expenses',
  'ezacc_allocations',
  'ezacc_feeds',
  'ezacc_ignored_payees',
  'ezacc_payments',
  'fleet_bookings',
  'fleet_costs',
  'fleet_documents',
  'fleet_issues',
  'fleet_maintenance',
  'fleet_trips',
  'fleet_vehicles',
  'fleet_vendors',
  'invoice_payment_failures',
  'invoice_payment_plans',
  'invoices',
  'job_complaints',
  'job_photos',
  'job_types',
  'jobs',
  'labour_charges',
  'leave_requests',
  'monthly_working_days',
  'os_addons',
  'os_blackouts',
  'os_bookings',
  'os_notifications',
  'os_oil_grades',
  'os_packages',
  'os_prices',
  'os_settings',
  'os_slots',
  'os_vehicle_rules',
  'os_zones',
  'ot_requests',
  'parts_catalogue',
  'parts_requests',
  'payment_proof_submissions',
  'quotations',
  'receipt_proof_history',
  'receipts',
  'report_settings',
  'sales_marketing_audience_segments',
  'sales_marketing_business_analysis',
  'sales_marketing_business_profile',
  'sales_marketing_campaigns',
  'sales_marketing_competitors',
  'sales_marketing_goals',
  'sales_marketing_period_metrics',
  'sales_marketing_plan_initiatives',
  'sales_marketing_plans',
  'sales_marketing_seasonal_events',
  'sheet_sync_config',
  'staff_profiles',
  'staff_schedules',
  'status_change_requests',
  'status_colors',
  'stock_daily_snapshots',
  'stock_movements',
  'stock_transfers',
  'supplier_invoices',
  'supplier_payments',
  'suppliers',
  'users',
  'vehicle_mileage_log',
  'vehicles',
  'wa_templates',
  'weekly_report_snapshots',
  'workshop_rules',
])
let lockedCompany: () => string | null = () => null
export function registerCompanyLock(fn: () => string | null) { lockedCompany = fn }

export function lockUrlToCompany(rawUrl: string, method: string, tenantId: string | null): string {
  if (!tenantId || method === 'POST') return rawUrl
  try {
    const url = new URL(rawUrl)
    const m = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/)
    if (!m || !COMPANY_TABLES.has(m[1]) || url.searchParams.has('tenant_id')) return rawUrl
    url.searchParams.set('tenant_id', `eq.${tenantId}`)
    return url.toString()
  } catch {
    return rawUrl
  }
}

const lockedFetch: typeof fetch = (input, init) => {
  const tenantId = lockedCompany()
  if (!tenantId) return fetch(input, init)
  const isReq = typeof Request !== 'undefined' && input instanceof Request
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  const method = (init?.method ?? (isReq ? (input as Request).method : 'GET')).toUpperCase()
  const next = lockUrlToCompany(raw, method, tenantId)
  if (next === raw) return fetch(input, init)
  return fetch(isReq ? new Request(next, input as Request) : next, init)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: lockedFetch } })
