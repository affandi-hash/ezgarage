export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
export type AppointmentSource = 'direct' | 'mia_whatsapp'

export interface Appointment {
  id: string
  appointment_number: string
  branch_id: string
  customer_id: string | null
  // Walk-in / Mia intake fields (before customer record exists)
  customer_phone: string
  customer_name: string
  plate_number: string
  vehicle_make: string
  vehicle_model: string
  vehicle_year: number | null
  service_type: string
  appointment_date: string // YYYY-MM-DD
  appointment_time: string // HH:MM
  notes: string | null
  source: AppointmentSource
  status: AppointmentStatus
  mechanic_id: string | null
  job_order_id: string | null
  created_at: string
  updated_at: string
  // Joined
  mechanic?: {
    id: string
    full_name: string
  }
  job_order?: {
    id: string
    job_number: string
  }
}

export interface MechanicSchedule {
  id: string
  branch_id: string
  mechanic_id: string
  schedule_date: string // YYYY-MM-DD
  is_available: boolean
  shift_start: string | null // HH:MM
  shift_end: string | null   // HH:MM
  notes: string | null
  created_at: string
  mechanic?: {
    id: string
    full_name: string
  }
}

export interface CreateAppointmentPayload {
  branch_id: string
  customer_phone: string
  customer_name: string
  plate_number: string
  vehicle_make: string
  vehicle_model: string
  vehicle_year?: number | null
  service_type: string
  appointment_date: string
  appointment_time: string
  notes?: string
  source?: AppointmentSource
  mechanic_id?: string | null
}

export interface ConvertToJobPayload {
  branch_id: string
  service_type: string
  description?: string
  assigned_to?: string
}
