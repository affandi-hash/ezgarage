export type Role =
  | 'super_admin'
  | 'ops_manager'
  | 'front_desk'
  | 'foreman'
  | 'mechanic'
  | 'parts_admin'
  | 'finance'
  | 'fleet_admin'
  | 'driver'
  | 'customer'

export type JobStatus =
  | 'new'
  | 'booked'
  | 'checked_in'
  | 'diagnosing'
  | 'waiting_approval'
  | 'waiting_parts'
  | 'in_progress'
  | 'ready'
  | 'closed'
  | 'long_due'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type CustomerType = 'individual' | 'corporate' | 'fleet'
export type CustomerStatus = 'active' | 'inactive' | 'blacklisted'
export type VehicleType = 'car' | 'bike'
export type ServiceType = 'service' | 'repair' | 'inspection' | 'body_work' | 'tyre' | 'other'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type BookingStatus = 'pending' | 'confirmed' | 'arrived' | 'cancelled' | 'no_show' | 'completed'
export type ArrivalMode = 'walk_in' | 'booked' | 'fleet' | 'insurance'

export interface UserProfile {
  id: string
  full_name: string
  email: string
  role: Role
  branch_id: string | null
  approval_status: ApprovalStatus
  is_active: boolean
  tenant_id: string
  must_change_password: boolean
}

export interface Tenant {
  id: string
  name: string
  slug: string
  email: string
  phone: string | null
  logo_url: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string
  plan: 'free' | 'starter' | 'pro' | 'enterprise'
  is_active: boolean
  trial_ends_at: string | null
  created_at: string
}

export interface Branch {
  id: string
  name: string
  address: string
  phone: string
}

export interface Customer {
  id: string
  full_name: string
  phone: string
  email: string | null
  ic_last4: string | null
  area: string | null
  customer_type: CustomerType
  customer_status: CustomerStatus
  branch_id: string | null
}

export interface Vehicle {
  id: string
  plate_number: string
  vehicle_type: VehicleType
  make: string
  model: string
  year: number | null
  color: string | null
  customer_id: string | null
  branch_id: string | null
  current_mileage: number | null
}

export interface Job {
  id: string
  job_number: string
  branch_id: string | null
  customer_id: string | null
  vehicle_id: string | null
  status: JobStatus
  service_type: ServiceType
  vehicle_type: VehicleType
  source: string | null
  arrival_mode: ArrivalMode | null
  diagnosis_summary: string | null
  estimated_cost: number | null
  assigned_foreman_id: string | null
  assigned_mechanic_id: string | null
  checked_in_at: string | null
  days_in_garage: number | null
  payment_status: PaymentStatus
  customer_complaint: string | null
  internal_notes: string | null
  // joined fields
  customer?: Pick<Customer, 'id' | 'full_name' | 'phone'>
  vehicle?: Pick<Vehicle, 'id' | 'plate_number' | 'make' | 'model' | 'vehicle_type'>
  foreman?: Pick<StaffProfile, 'id' | 'full_name'>
  mechanic?: Pick<StaffProfile, 'id' | 'full_name'>
}

export interface Booking {
  id: string
  booking_number: string
  branch_id: string | null
  customer_name: string
  customer_phone: string
  vehicle_plate: string
  booking_date: string
  booking_time: string | null
  service_type: ServiceType
  source: string | null
  arrival_mode: ArrivalMode | null
  status: BookingStatus
  deposit_amount: number | null
  deposit_paid: boolean
  notes: string | null
  problem_description: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
}

export interface StaffProfile {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  department: string | null
  position: string | null
  specialty: string | null
  hire_date: string | null
  branch_id: string | null
  is_active: boolean
}

export const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  new: '#6B7280',
  booked: '#3B82F6',
  checked_in: '#8B5CF6',
  diagnosing: '#F59E0B',
  waiting_approval: '#EF4444',
  waiting_parts: '#F97316',
  in_progress: '#10B981',
  ready: '#22C55E',
  closed: '#4B5563',
  long_due: '#DC2626',
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: 'New',
  booked: 'Booked',
  checked_in: 'Checked In',
  diagnosing: 'Diagnosing',
  waiting_approval: 'Waiting Approval',
  waiting_parts: 'Waiting Parts',
  in_progress: 'In Progress',
  ready: 'Ready',
  closed: 'Closed',
  long_due: 'Long Due',
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  ops_manager: 'Ops Manager',
  front_desk: 'Front Desk',
  foreman: 'Foreman',
  mechanic: 'Mechanic',
  parts_admin: 'Parts Admin',
  finance: 'Finance',
  fleet_admin: 'Fleet Admin',
  driver: 'Driver',
  customer: 'Customer',
}
