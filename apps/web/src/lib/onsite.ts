// Shared types and helpers for the ON-SITE (mobile van) feature. The tables
// and RPCs live in migrations 152 and 153.

export type OsStatus =
  | 'requested' | 'awaiting_deposit' | 'confirmed' | 'en_route' | 'arrived'
  | 'in_progress' | 'completed' | 'cancelled' | 'no_show' | 'declined' | 'expired'

export type OsDepositStatus = 'unpaid' | 'paid' | 'refund_due' | 'refunded' | 'forfeited' | 'none'
export type OsTier = 'tier1' | 'tier2'

export interface OsBooking {
  id: string
  tenant_id: string
  branch_id: string
  booking_number: string
  token: string
  status: OsStatus
  request_type: 'standard' | 'special'
  special_reason: string | null
  customer_id: string | null
  vehicle_id: string | null
  customer_name: string
  customer_phone: string
  customer_email: string | null
  vehicle_type: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_plate: string
  tier: string | null
  package_id: string | null
  package_name: string | null
  grade_id: string | null
  grade_name: string | null
  address: string | null
  postcode: string | null
  zone_name: string | null
  access_notes: string | null
  slot_id: string | null
  slot_label: string | null
  service_date: string | null
  slot_start: string | null
  slot_end: string | null
  price_base: number | null
  price_zone: number
  price_offhours: number
  price_total: number | null
  deposit_amount: number
  invoice_id: string | null
  deposit_status: OsDepositStatus
  hold_expires_at: string | null
  reschedule_count: number
  technician_id: string | null
  confirmed_at: string | null
  en_route_at: string | null
  arrived_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  photos_before: string[]
  photos_after: string[]
  parts_used: { name: string; qty: number; note?: string }[]
  health_check: { item: string; status: 'green' | 'amber' | 'red'; note?: string }[]
  tech_notes: string | null
  customer_signed_at: string | null
  customer_signature: string | null
  hub_quote_id: string | null
  refund_due_at: string | null
  refunded_at: string | null
  refund_reference: string | null
  created_at: string
}

export const OS_STATUS_LABEL: Record<OsStatus, string> = {
  requested: 'Request',
  awaiting_deposit: 'Awaiting deposit',
  confirmed: 'Confirmed',
  en_route: 'En route',
  arrived: 'Arrived',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  declined: 'Declined',
  expired: 'Expired',
}

export const OS_STATUS_COLOR: Record<OsStatus, string> = {
  requested: '#F59E0B',
  awaiting_deposit: '#F59E0B',
  confirmed: '#3B82F6',
  en_route: '#8B5CF6',
  arrived: '#8B5CF6',
  in_progress: '#F15A22',
  completed: '#22C55E',
  cancelled: '#6B7280',
  no_show: '#EF4444',
  declined: '#6B7280',
  expired: '#6B7280',
}

// Human text for the error codes the booking RPCs return.
export const OS_ERRORS: Record<string, string> = {
  tenant_not_found: 'This booking page is not available.',
  not_configured: 'ON-SITE booking is not set up yet.',
  invalid_details: 'Please check your name, phone number, plate and address.',
  invalid_email: 'That email address does not look right.',
  too_many_open: 'You already have open bookings. Please finish or cancel them first.',
  unknown_vehicle: 'We do not have this vehicle in our list yet.',
  hub_only: 'This vehicle is serviced at our workshop, not by the van.',
  package_unavailable: 'This package is not available for your vehicle yet.',
  outside_zone: 'We do not cover this postcode yet.',
  slot_required: 'Please choose a date and time.',
  slot_not_found: 'That time is no longer available.',
  slot_taken: 'Sorry, someone just took that slot. Please pick another.',
  slot_closed: 'That time is not open for booking.',
  date_blocked: 'We are not working on that date. Please pick another day.',
  day_not_served: 'We do not work on that day. Please pick another day.',
  outside_window: 'That date is outside the booking window. Please pick another day.',
  too_soon: 'That time is too close to book online. Please pick another.',
  invalid_staff_id: 'Enter your BB staff ID, like BB1234.',
  day_full: 'That day is full. Please pick another day.',
  date_required: 'Please pick a day.',
  too_late: 'It is too late to reschedule. You can still cancel, but the deposit is not refundable.',
  max_reschedules: 'This booking has reached the reschedule limit.',
  not_changeable: 'This booking can no longer be changed.',
  not_found: 'Booking not found.',
  not_a_pending_request: 'This is not a pending request.',
  price_required: 'Enter a price for this request.',
  no_refund_due: 'No refund is due on this booking.',
  reference_required: 'Enter the bank transfer reference.',
  no_hub_branch: 'The Hub branch is not set in ON-SITE settings.',
  already_referred: 'A Hub quotation already exists for this booking.',
}

export function osError(code: unknown): string {
  return OS_ERRORS[String(code)] ?? 'Something went wrong. Please try again.'
}

// BB Staff Car Care Day (pickup and return, migration 166).
export interface BbDay { date: string; left: number; available: boolean }

// What the customer sees for each BB status (the van labels above do not fit a pickup).
export const BB_STATUS_LABEL: Partial<Record<OsStatus, string>> = {
  confirmed: 'Booked',
  en_route: 'Collecting',
  arrived: 'Collected',
  in_progress: 'In service',
  completed: 'Returned',
}

// Staff ID is "BB" + 4 digits; case and spaces are ignored (the server normalises the same way).
export const normStaffId = (s: string) => s.replace(/\s/g, '').toUpperCase()
export const staffIdOk = (s: string) => /^BB[0-9]{4}$/.test(normStaffId(s))

// "RM 199" for whole amounts, "RM 199.50" otherwise.
export function rmShort(n: number | null | undefined): string {
  if (n == null) return ''
  return Number.isInteger(Number(n)) ? `RM ${Number(n).toLocaleString('en-MY')}` : rm(n)
}

export const rm = (n: number | null | undefined) =>
  n == null ? '-' : 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const ISO_DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
]
