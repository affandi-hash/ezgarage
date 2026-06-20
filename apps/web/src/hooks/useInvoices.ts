import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type {
  Invoice,
  InvoiceItem,
  PaymentStatus,
  PaymentMethod,
  CreateInvoiceItemPayload,
} from '@/types/invoice'

interface InvoicesState {
  invoices: Invoice[]
  selectedInvoice: Invoice | null
  loading: boolean
  error: string | null

  fetchInvoices: (branchId: string, status?: PaymentStatus) => Promise<void>
  fetchInvoiceById: (id: string) => Promise<void>
  createInvoiceFromJob: (jobOrderId: string, branchId: string) => Promise<{ error: string | null; invoice: Invoice | null }>
  updatePaymentStatus: (id: string, status: PaymentStatus, method?: PaymentMethod) => Promise<{ error: string | null }>
  addLineItem: (invoiceId: string, item: Omit<CreateInvoiceItemPayload, 'invoice_id'>) => Promise<{ error: string | null }>
  removeLineItem: (invoiceId: string, itemId: string) => Promise<{ error: string | null }>
  clearSelected: () => void
}

const INVOICE_SELECT = `
  *,
  customer:customers(id, full_name, phone),
  job_order:job_orders(
    id, job_number, service_type,
    vehicle:vehicles(id, plate_number, make, model, year)
  ),
  items:invoice_items(*)
`


export const useInvoicesStore = create<InvoicesState>((set, get) => ({
  invoices: [],
  selectedInvoice: null,
  loading: false,
  error: null,

  fetchInvoices: async (branchId: string, status?: PaymentStatus) => {
    set({ loading: true, error: null })
    let query = supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('payment_status', status)

    const { data, error } = await query
    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ invoices: (data as Invoice[]) ?? [], loading: false })
  },

  fetchInvoiceById: async (id: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', id)
      .single()

    set({
      selectedInvoice: error ? null : (data as Invoice),
      loading: false,
      error: error?.message ?? null,
    })
  },

  createInvoiceFromJob: async (jobOrderId: string, branchId: string) => {
    // Fetch job + parts
    const [jobRes, partsRes] = await Promise.all([
      supabase
        .from('job_orders')
        .select(`*, customer:customers(id, full_name, phone), vehicle:vehicles(id, plate_number, make, model, year)`)
        .eq('id', jobOrderId)
        .single(),
      supabase
        .from('job_parts')
        .select(`*, item:inventory_items(id, name, sku)`)
        .eq('job_order_id', jobOrderId),
    ])

    if (jobRes.error) return { error: jobRes.error.message, invoice: null }
    const job = jobRes.data

    // Get auth user for created_by
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) return { error: 'Not authenticated', invoice: null }

    // Generate invoice number
    const branchCode = branchId.toLowerCase().includes('kota') ? 'KB' : 'PJ'
    const year = new Date().getFullYear()
    const { count } = await supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId)

    const seq = String((count ?? 0) + 1).padStart(4, '0')
    const invoice_number = `INV-${branchCode}-${year}-${seq}`

    // Build line items from job_parts
    const partItems = (partsRes.data ?? []).map((p: { item?: { name?: string; sku?: string }; quantity: number; selling_price: number }) => ({
      description: p.item?.name ?? 'Part',
      type: 'part' as const,
      quantity: p.quantity,
      unit_price: p.selling_price,
      total: p.quantity * p.selling_price,
    }))

    const subtotal = partItems.reduce((acc: number, i: { total: number }) => acc + i.total, 0)

    // Create invoice record
    const { data: invData, error: invError } = await supabase
      .from('invoices')
      .insert([{
        invoice_number,
        branch_id: branchId,
        job_order_id: jobOrderId,
        customer_id: job.customer_id,
        payment_status: 'unpaid',
        payment_method: null,
        subtotal,
        discount: 0,
        tax: 0,
        total_amount: subtotal,
        notes: null,
        created_by: authData.user.id,
      }])
      .select(INVOICE_SELECT)
      .single()

    if (invError) return { error: invError.message, invoice: null }

    // Insert line items
    if (partItems.length > 0) {
      await supabase.from('invoice_items').insert(
        partItems.map((item: { description: string; type: 'part' | 'service'; quantity: number; unit_price: number; total: number }) => ({
          invoice_id: invData.id,
          ...item,
        }))
      )
    }

    // Refresh invoice with items
    const { data: finalInv } = await supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', invData.id)
      .single()

    const invoice = (finalInv ?? invData) as Invoice
    set((state) => ({ invoices: [invoice, ...state.invoices] }))
    return { error: null, invoice }
  },

  updatePaymentStatus: async (id: string, status: PaymentStatus, method?: PaymentMethod) => {
    const { error } = await supabase
      .from('invoices')
      .update({
        payment_status: status,
        payment_method: method ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) return { error: error.message }

    set((state) => ({
      invoices: state.invoices.map((inv) =>
        inv.id === id ? { ...inv, payment_status: status, payment_method: method ?? inv.payment_method } : inv
      ),
      selectedInvoice: state.selectedInvoice?.id === id
        ? { ...state.selectedInvoice, payment_status: status, payment_method: method ?? state.selectedInvoice.payment_method }
        : state.selectedInvoice,
    }))

    return { error: null }
  },

  addLineItem: async (invoiceId: string, item: Omit<CreateInvoiceItemPayload, 'invoice_id'>) => {
    const total = item.quantity * item.unit_price
    const { data, error } = await supabase
      .from('invoice_items')
      .insert([{ invoice_id: invoiceId, ...item, total }])
      .select()
      .single()

    if (error) return { error: error.message }

    // Refresh items and recalculate totals
    const { data: allItems } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)

    const items = (allItems ?? []) as InvoiceItem[]
    const inv = get().invoices.find((i) => i.id === invoiceId) ?? get().selectedInvoice
    const discount = inv?.discount ?? 0
    const tax = inv?.tax ?? 0

    const subtotal = items.reduce((acc, i) => acc + i.quantity * i.unit_price, 0)
    const totalAmount = subtotal - discount + tax

    await supabase
      .from('invoices')
      .update({ subtotal, total_amount: totalAmount, updated_at: new Date().toISOString() })
      .eq('id', invoiceId)

    const newItem = data as InvoiceItem
    set((state) => ({
      invoices: state.invoices.map((inv) =>
        inv.id === invoiceId
          ? { ...inv, subtotal, total_amount: totalAmount, items: [...(inv.items ?? []), newItem] }
          : inv
      ),
      selectedInvoice: state.selectedInvoice?.id === invoiceId
        ? {
            ...state.selectedInvoice,
            subtotal,
            total_amount: totalAmount,
            items: [...(state.selectedInvoice.items ?? []), newItem],
          }
        : state.selectedInvoice,
    }))

    return { error: null }
  },

  removeLineItem: async (invoiceId: string, itemId: string) => {
    const { error } = await supabase.from('invoice_items').delete().eq('id', itemId)
    if (error) return { error: error.message }

    const { data: allItems } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)

    const items = (allItems ?? []) as InvoiceItem[]
    const inv = get().invoices.find((i) => i.id === invoiceId) ?? get().selectedInvoice
    const discount = inv?.discount ?? 0
    const tax = inv?.tax ?? 0

    const subtotal = items.reduce((acc, i) => acc + i.quantity * i.unit_price, 0)
    const totalAmount = subtotal - discount + tax

    await supabase
      .from('invoices')
      .update({ subtotal, total_amount: totalAmount, updated_at: new Date().toISOString() })
      .eq('id', invoiceId)

    set((state) => ({
      invoices: state.invoices.map((inv) =>
        inv.id === invoiceId
          ? { ...inv, subtotal, total_amount: totalAmount, items: items }
          : inv
      ),
      selectedInvoice: state.selectedInvoice?.id === invoiceId
        ? { ...state.selectedInvoice, subtotal, total_amount: totalAmount, items }
        : state.selectedInvoice,
    }))

    return { error: null }
  },

  clearSelected: () => set({ selectedInvoice: null }),
}))
