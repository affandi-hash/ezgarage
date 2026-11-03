import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// View scope. A super admin's database access spans every company (the policies let a super admin through for any
// company), so the app narrows what it asks for:
//   - the platform owner (is_platform_admin) works across all businesses and picks "all", one business, or one branch in the
//     header selector; reads are narrowed to that choice, on every page
//   - any other super admin is tied to their own company
// Narrowing is applied to reads, updates and deletes on company tables (inserts are untouched). A branch choice is applied only
// to the tables below, where branch_id is the branch the record was made at.
const COMPANY_TABLES = new Set([
  'action_requests', 'ai_token_usage', 'attendance_records', 'audit_logs', 'bays', 'bookings', 'branches', 'customer_updates', 'customers',
  'deleted_records', 'deletion_requests', 'esp_announcements', 'esp_communities', 'esp_maintenance_items', 'esp_members',
  'esp_vehicle_maintenance_log', 'esp_vehicle_maintenance_overrides', 'expenses', 'ezacc_allocations', 'ezacc_feeds', 'ezacc_ignored_payees',
  'ezacc_payments', 'fleet_bookings', 'fleet_costs', 'fleet_documents', 'fleet_issues', 'fleet_maintenance', 'fleet_trips', 'fleet_vehicles',
  'fleet_vendors', 'invoice_payment_failures', 'invoice_payment_plans', 'invoices', 'job_complaints', 'job_photos', 'job_types', 'jobs',
  'labour_charges', 'leave_requests', 'monthly_working_days', 'os_addons', 'os_blackouts', 'os_bookings', 'os_notifications', 'os_oil_grades',
  'os_packages', 'os_prices', 'os_settings', 'os_slots', 'os_vehicle_rules', 'os_zones', 'ot_requests', 'parts_catalogue', 'parts_requests',
  'payment_proof_submissions', 'quotations', 'receipt_proof_history', 'receipts', 'report_settings', 'sales_marketing_audience_segments',
  'sales_marketing_business_analysis', 'sales_marketing_business_profile', 'sales_marketing_campaigns', 'sales_marketing_competitors',
  'sales_marketing_goals', 'sales_marketing_period_metrics', 'sales_marketing_plan_initiatives', 'sales_marketing_plans',
  'sales_marketing_seasonal_events', 'sheet_sync_config', 'staff_profiles', 'staff_schedules', 'status_change_requests', 'status_colors',
  'stock_daily_snapshots', 'stock_movements', 'stock_transfers', 'supplier_invoices', 'supplier_payments', 'suppliers', 'users',
  'vehicle_mileage_log', 'vehicles', 'wa_templates', 'weekly_report_snapshots', 'workshop_rules',
])
const BRANCH_TABLES = new Set([
  'invoices', 'jobs', 'receipts', 'expenses', 'quotations', 'bookings', 'os_bookings', 'supplier_invoices', 'parts_requests',
  'payment_proof_submissions', 'job_complaints', 'labour_charges',
])
export interface ViewScope { tenantId: string | null; branchId: string | null }
let currentScope: () => ViewScope | null = () => null
export function registerViewScope(fn: () => ViewScope | null) { currentScope = fn }
// The business the platform owner is working inside (null = their own). Sent on every request so the database and the
// background functions act for that business; the database ignores it for anyone who is not the platform owner.
let actingTenant: () => string | null = () => null
export function registerActingTenant(fn: () => string | null) { actingTenant = fn }

export function scopeUrl(rawUrl: string, method: string, scope: ViewScope | null): string {
  if (!scope || (!scope.tenantId && !scope.branchId) || method === 'POST') return rawUrl
  try {
    const url = new URL(rawUrl)
    const m = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/)
    if (!m || !COMPANY_TABLES.has(m[1])) return rawUrl
    if (scope.tenantId && !url.searchParams.has('tenant_id')) url.searchParams.set('tenant_id', `eq.${scope.tenantId}`)
    if (scope.branchId && (method === 'GET' || method === 'HEAD') && BRANCH_TABLES.has(m[1]) && !url.searchParams.has('branch_id')) {
      url.searchParams.set('branch_id', `eq.${scope.branchId}`)
    }
    return url.toString()
  } catch {
    return rawUrl
  }
}

// The database, and the two account functions below, understand the header. Other background functions do not list it as an
// allowed header, so it is not sent to them.
const ACTING_PATHS = ['/rest/v1/', '/functions/v1/invite-user', '/functions/v1/reset-user-password']
function sendsActingHeader(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.origin === new URL(supabaseUrl).origin && ACTING_PATHS.some(p => u.pathname.startsWith(p))
  } catch {
    return false
  }
}

const scopedFetch: typeof fetch = (input, init) => {
  const scope = currentScope()
  const acting = actingTenant()
  if (!scope && !acting) return fetch(input, init)
  const isReq = typeof Request !== 'undefined' && input instanceof Request
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  const method = (init?.method ?? (isReq ? (input as Request).method : 'GET')).toUpperCase()
  const next = scopeUrl(raw, method, scope)
  let nextInit = init
  if (acting && typeof supabaseUrl === 'string' && sendsActingHeader(raw)) {
    const headers = new Headers(init?.headers ?? (isReq ? (input as Request).headers : undefined))
    headers.set('x-acting-tenant', acting)
    nextInit = { ...init, headers }
  }
  if (next === raw) return fetch(input, nextInit)
  return fetch(isReq ? new Request(next, input as Request) : next, nextInit)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: scopedFetch } })
