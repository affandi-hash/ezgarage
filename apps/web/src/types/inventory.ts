export type TransferStatus =
  | 'pending'
  | 'approved_sender'
  | 'approved_both'
  | 'in_transit'
  | 'received'
  | 'cancelled'

export type ItemCategory =
  | 'engine'
  | 'brakes'
  | 'electrical'
  | 'body'
  | 'tyres'
  | 'fluids'
  | 'filters'
  | 'suspension'
  | 'accessories'
  | 'other'

export interface Supplier {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  created_at: string
}

export interface InventoryItem {
  id: string
  branch_id: string
  supplier_id: string | null
  name: string
  sku: string
  category: ItemCategory
  unit: string
  quantity: number
  low_stock_threshold: number
  unit_cost: number
  selling_price: number
  created_at: string
  updated_at: string
  // Joined
  supplier?: Pick<Supplier, 'id' | 'name'>
}

export interface JobPart {
  id: string
  job_order_id: string
  inventory_item_id: string
  quantity: number
  unit_cost: number
  selling_price: number
  created_at: string
  // Joined
  item?: Pick<InventoryItem, 'id' | 'name' | 'sku'>
}

export interface TransferRequest {
  id: string
  transfer_number: string
  from_branch_id: string
  to_branch_id: string
  inventory_item_id: string
  quantity: number
  status: TransferStatus
  notes: string | null
  requested_by: string
  created_at: string
  updated_at: string
  // Joined
  item?: Pick<InventoryItem, 'id' | 'name' | 'sku'>
  from_branch?: { id: string; name: string }
  to_branch?: { id: string; name: string }
  requester?: { id: string; full_name: string }
}

export interface CreateInventoryItemPayload {
  branch_id: string
  supplier_id?: string
  name: string
  sku: string
  category: ItemCategory
  unit: string
  quantity: number
  low_stock_threshold: number
  unit_cost: number
  selling_price: number
}

export interface CreateTransferRequestPayload {
  from_branch_id: string
  to_branch_id: string
  inventory_item_id: string
  quantity: number
  notes?: string
}
