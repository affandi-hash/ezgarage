// Shared types and helpers for the ON-SITE (mobile van) feature. The tables
// and RPCs live in migrations 152 and 153.

export type OsStatus =
  | 'requested' | 'awaiting_deposit' | 'confirmed' | 'en_route' | 'arrived'
  | 'in_progress' | 'completed' | 'cancelled' | 'no_show' | 'declined' | 'expired'

export type OsDepositStatus = 'unpaid' | 'paid' | 'refund_due' | 'refunded' | 'forfeited' | 'none'
export type OsTier = 'tier1' | 'tier2'

export interface OsAddonLine { id: string; name: string; price: number; price_from?: boolean; plus_parts?: boolean; duration_min?: number; duration_max?: number }
export interface OsBooking {
  addons?: OsAddonLine[]
  price_addons?: number
  est_duration_min?: number | null
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
  addon_required: 'Please choose at least one service.',
  addon_unavailable: 'One of the extras you chose is not available for this service. Please review your choices.',
  too_long: 'That job needs more time than one visit window. Please send it as a request and we will arrange a time.',
  outside_zone: 'We do not cover this postcode yet.',
  slot_required: 'Please choose a date and time.',
  slot_not_found: 'That time is no longer available.',
  slot_taken: 'Sorry, someone just took that slot. Please pick another.',
  slot_span_invalid: 'That time cannot be booked for this job. Please pick another.',
  span_not_needed: 'That time is not needed for this job. Please pick another.',
  slot_closed: 'That time is not open for booking.',
  date_blocked: 'We are not working on that date. Please pick another day.',
  day_not_served: 'We do not work on that day. Please pick another day.',
  outside_window: 'That date is outside the booking window. Please pick another day.',
  too_soon: 'That time is too close to book online. Please pick another.',
  invalid_staff_id: 'Enter your BB staff ID, like BB1234, or just the 4 digits.',
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

// Staff ID is "BB" + 4 digits. Customers may type just the 4 digits, and case and spaces are ignored.
export function normStaffId(s: string): string {
  const t = s.replace(/\s/g, '').toUpperCase()
  return /^[0-9]{4}$/.test(t) ? `BB${t}` : t
}
export const staffIdOk = (s: string) => /^BB[0-9]{4}$/.test(normStaffId(s))

// WhatsApp contact: "01175931383" shows as "011-7593 1383" and links to wa.me with the country code.
function contactDigits(n: string | null | undefined): string {
  const d = (n ?? '').replace(/\D/g, '')
  return d.length >= 8 ? d : ''
}
export function formatContact(n: string | null | undefined): string {
  const d = contactDigits(n)
  if (!d) return ''
  return d.length === 11 && d.startsWith('0') ? `${d.slice(0, 3)}-${d.slice(3, 7)} ${d.slice(7)}` : d
}
export function contactLink(n: string | null | undefined): string {
  const d = contactDigits(n)
  if (!d) return ''
  return `https://wa.me/${d.startsWith('60') ? d : '60' + d.replace(/^0/, '')}`
}

// Booking form drafts kept in sessionStorage so a refresh does not lose what was typed.
// Never put a payment method or a token in a draft.
export type Draft = Record<string, unknown>
export function loadDraft(key: string): Draft {
  try {
    const raw = sessionStorage.getItem(key)
    const o = raw ? JSON.parse(raw) : null
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Draft) : {}
  } catch { return {} }
}
export function saveDraft(key: string, data: Draft): void {
  try { sessionStorage.setItem(key, JSON.stringify(data)) } catch { /* storage unavailable */ }
}
export function clearDraft(key: string): void {
  try { sessionStorage.removeItem(key) } catch { /* storage unavailable */ }
}
export const draftStr = (d: Draft, k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : '')

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

// Readable name for a vehicle price level.
export const TIER_LABEL: Record<string, string> = {
  tier1: 'Tier 1 (local, Japanese, Korean)', tier2: 'Tier 2 (continental)', bike: 'Motorcycle',
  harley_sportster: 'Harley-Davidson Sportster', harley_softail: 'Harley-Davidson Softail / Touring', bb: 'BB staff', hub_only: 'Workshop only',
}
export const addonLabel = (a: OsAddonLine) => `${a.name}${a.plus_parts ? ' (+ parts)' : ''}`

// ── time slots: one slot, two back-to-back slots, or a night slot stretched later ─────────────
export interface SlotInfo {
  slot_id: string; label: string; available: boolean; start?: string; end?: string
  single_max?: number | null; pair_max?: number | null; extend_max?: number | null
  extend_label?: string | null; next_id?: string | null; next_label?: string | null; next_available?: boolean
}
export interface SlotChoice { key: string; slot_id: string; slot2: string | null; extend: boolean; label: string; available: boolean }

// What the customer can pick for a job of estMin minutes. A job that fits one slot sees every slot. A longer job sees
// the two-slot windows and any slot that can stretch later. Nothing is offered when the job does not fit (it becomes a request).
export function slotChoices(slots: SlotInfo[], estMin: number | null | undefined): SlotChoice[] {
  const out: SlotChoice[] = []
  for (const s of slots) {
    const single = s.single_max ?? null
    if (estMin == null || single == null || estMin <= single) {
      out.push({ key: s.slot_id, slot_id: s.slot_id, slot2: null, extend: false, label: s.label, available: s.available })
      continue
    }
    if (s.next_id && s.pair_max != null && estMin <= s.pair_max) {
      out.push({ key: `${s.slot_id}+${s.next_id}`, slot_id: s.slot_id, slot2: s.next_id, extend: false, label: s.next_label ?? s.label, available: s.available && !!s.next_available })
    }
    if (s.extend_label && s.extend_max != null && estMin <= s.extend_max) {
      out.push({ key: `${s.slot_id}~ext`, slot_id: s.slot_id, slot2: null, extend: true, label: s.extend_label, available: s.available })
    }
  }
  return out
}
