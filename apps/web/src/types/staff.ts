export type StaffRole = 'ceo' | 'branch_manager' | 'operation_manager' | 'hr_manager' | 'staff'

export type StaffStatus = 'active' | 'inactive'

export interface StaffMember {
  id: string
  full_name: string
  email: string
  role: StaffRole
  branch_id: string | null
  status: StaffStatus
  avatar_url: string | null
  created_at: string
  updated_at: string
  branch?: {
    id: string
    name: string
  }
}

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export interface Schedule {
  id: string
  mechanic_id: string
  day_of_week: DayOfWeek
  is_working: boolean
  shift_start: string | null
  shift_end: string | null
  created_at: string
  updated_at: string
}

export interface ScheduleUpsertPayload {
  mechanic_id: string
  day_of_week: DayOfWeek
  is_working: boolean
  shift_start: string | null
  shift_end: string | null
}

export interface InviteStaffPayload {
  email: string
  role: StaffRole
  branch_id: string
  full_name: string
}
