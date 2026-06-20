export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

export type PaymentMethod = 'cash' | 'card' | 'online_transfer' | 'qr'

export type LineItemType = 'service' | 'part'

export interface InvoiceItem {
  id: string
  invoice_id: string
  description: string
  type: LineItemType
  quantity: number
  unit_price: number
  total: number
  created_at: string
}

export interface Invoice {
  id: string
  invoice_number: string
  branch_id: string
  job_order_id: string
  customer_id: string
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  subtotal: number
  discount: number
  tax: number
  total_amount: number
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  // Joined fields
  customer?: {
    id: string
    full_name: string
    phone: string
  }
  job_order?: {
    id: string
    job_number: string
    service_type: string
    vehicle?: {
      id: string
      plate_number: string
      make: string
      model: string
      year: number | null
    }
  }
  items?: InvoiceItem[]
}

export interface CreateInvoicePayload {
  branch_id: string
  job_order_id: string
  customer_id: string
  notes?: string
  discount?: number
  tax?: number
}

export interface CreateInvoiceItemPayload {
  invoice_id: string
  description: string
  type: LineItemType
  quantity: number
  unit_price: number
}

export interface InvoiceTotals {
  subtotal: number
  discount: number
  tax: number
  total: number
}

export function calculateTotals(
  items: Pick<InvoiceItem, 'quantity' | 'unit_price'>[],
  discount = 0,
  taxRate = 0,
): InvoiceTotals {
  const subtotal = items.reduce((acc, item) => acc + item.quantity * item.unit_price, 0)
  const taxAmount = ((subtotal - discount) * taxRate) / 100
  return {
    subtotal,
    discount,
    tax: taxAmount,
    total: subtotal - discount + taxAmount,
  }
}
