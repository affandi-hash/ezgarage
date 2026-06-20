export type JobStatus =
  | 'received'
  | 'inspecting'
  | 'waiting_approval'
  | 'in_progress'
  | 'waiting_for_parts'
  | 'done'
  | 'collected'

export interface JobOrder {
  id: string
  job_number: string
  branch_id: string
  customer_id: string
  vehicle_id: string
  service_type: string
  description: string | null
  status: JobStatus
  customer_approval: boolean
  assigned_to: string | null
  created_at: string
  updated_at: string
  // Joined fields
  customer?: {
    id: string
    full_name: string
    phone: string
  }
  vehicle?: {
    id: string
    plate_number: string
    make: string
    model: string
    year: number | null
  }
  assigned_mechanic?: {
    id: string
    full_name: string
  }
}

export interface JobStatusLog {
  id: string
  job_order_id: string
  previous_status: JobStatus | null
  new_status: JobStatus
  notes: string | null
  changed_by: string
  created_at: string
  changed_by_profile?: {
    full_name: string
  }
}

export interface JobPhoto {
  id: string
  job_order_id: string
  url: string
  caption: string | null
  uploaded_by: string
  created_at: string
}

export interface JobMechanic {
  id: string
  job_order_id: string
  mechanic_id: string
  assigned_at: string
  mechanic?: {
    id: string
    full_name: string
  }
}

export interface CreateJobPayload {
  branch_id: string
  customer_id: string
  vehicle_id: string
  service_type: string
  description?: string
  assigned_to?: string
}
