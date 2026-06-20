import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type {
  InventoryItem,
  Supplier,
  TransferRequest,
  CreateInventoryItemPayload,
  CreateTransferRequestPayload,
  TransferStatus,
} from '@/types/inventory'

interface InventoryState {
  items: InventoryItem[]
  suppliers: Supplier[]
  transferRequests: TransferRequest[]
  loading: boolean
  error: string | null

  fetchInventory: (branchId: string) => Promise<void>
  addStock: (data: CreateInventoryItemPayload) => Promise<{ error: string | null }>
  updateQuantity: (id: string, qty: number) => Promise<{ error: string | null }>
  getLowStockItems: (branchId: string) => InventoryItem[]
  fetchSuppliers: () => Promise<void>
  fetchTransferRequests: (branchId: string) => Promise<void>
  createTransferRequest: (data: CreateTransferRequestPayload) => Promise<{ error: string | null }>
  approveTransfer: (id: string, role: 'sender' | 'receiver') => Promise<{ error: string | null }>
  rejectTransfer: (id: string) => Promise<{ error: string | null }>
  confirmReceived: (id: string) => Promise<{ error: string | null }>
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  suppliers: [],
  transferRequests: [],
  loading: false,
  error: null,

  fetchInventory: async (branchId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('inventory')
      .select('*, supplier:suppliers(id, name)')
      .eq('branch_id', branchId)
      .order('name', { ascending: true })

    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ items: (data as InventoryItem[]) ?? [], loading: false })
  },

  addStock: async (payload: CreateInventoryItemPayload) => {
    const { data, error } = await supabase
      .from('inventory')
      .insert([payload])
      .select('*, supplier:suppliers(id, name)')
      .single()

    if (error) return { error: error.message }

    set((state) => ({ items: [...state.items, data as InventoryItem] }))
    return { error: null }
  },

  updateQuantity: async (id: string, qty: number) => {
    const { error } = await supabase
      .from('inventory')
      .update({ quantity: qty, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: error.message }

    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, quantity: qty } : item
      ),
    }))
    return { error: null }
  },

  getLowStockItems: (branchId: string) => {
    return get().items.filter(
      (item) => item.branch_id === branchId && item.quantity < item.low_stock_threshold
    )
  },

  fetchSuppliers: async () => {
    const { data } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true })
    set({ suppliers: (data as Supplier[]) ?? [] })
  },

  fetchTransferRequests: async (branchId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('transfer_requests')
      .select(`
        *,
        item:inventory(id, name, sku),
        from_branch:branches!transfer_requests_from_branch_id_fkey(id, name),
        to_branch:branches!transfer_requests_to_branch_id_fkey(id, name),
        requester:user_profiles!transfer_requests_requested_by_fkey(id, full_name)
      `)
      .or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, loading: false })
      return
    }
    set({ transferRequests: (data as TransferRequest[]) ?? [], loading: false })
  },

  createTransferRequest: async (payload: CreateTransferRequestPayload) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('transfer_requests')
      .insert([{ ...payload, requested_by: user.id }])
      .select(`
        *,
        item:inventory(id, name, sku),
        from_branch:branches!transfer_requests_from_branch_id_fkey(id, name),
        to_branch:branches!transfer_requests_to_branch_id_fkey(id, name),
        requester:user_profiles!transfer_requests_requested_by_fkey(id, full_name)
      `)
      .single()

    if (error) return { error: error.message }

    set((state) => ({ transferRequests: [data as TransferRequest, ...state.transferRequests] }))
    return { error: null }
  },

  approveTransfer: async (id: string, role: 'sender' | 'receiver') => {
    const current = get().transferRequests.find((t) => t.id === id)
    if (!current) return { error: 'Transfer not found' }

    let newStatus: TransferStatus
    if (role === 'sender' && current.status === 'pending') {
      newStatus = 'approved_sender'
    } else if (role === 'receiver' && current.status === 'approved_sender') {
      newStatus = 'approved_both'
    } else if (role === 'sender' && current.status === 'approved_both') {
      newStatus = 'in_transit'
    } else {
      return { error: 'Invalid approval action for current status' }
    }

    const { error } = await supabase
      .from('transfer_requests')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: error.message }

    set((state) => ({
      transferRequests: state.transferRequests.map((t) =>
        t.id === id ? { ...t, status: newStatus } : t
      ),
    }))
    return { error: null }
  },

  rejectTransfer: async (id: string) => {
    const { error } = await supabase
      .from('transfer_requests')
      .update({ status: 'cancelled' as TransferStatus, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: error.message }

    set((state) => ({
      transferRequests: state.transferRequests.map((t) =>
        t.id === id ? { ...t, status: 'cancelled' as TransferStatus } : t
      ),
    }))
    return { error: null }
  },

  confirmReceived: async (id: string) => {
    const current = get().transferRequests.find((t) => t.id === id)
    if (!current) return { error: 'Transfer not found' }
    if (current.status !== 'in_transit') return { error: 'Transfer must be in_transit to confirm receipt' }

    const { error: updateError } = await supabase
      .from('transfer_requests')
      .update({ status: 'received' as TransferStatus, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (updateError) return { error: updateError.message }

    // Update receiving branch stock
    const { data: destItem } = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('branch_id', current.to_branch_id)
      .eq('id', current.inventory_item_id)
      .maybeSingle()

    if (destItem) {
      await supabase
        .from('inventory')
        .update({ quantity: destItem.quantity + current.quantity, updated_at: new Date().toISOString() })
        .eq('id', destItem.id)
    }

    // Deduct from sender branch stock
    const { data: srcItem } = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('branch_id', current.from_branch_id)
      .eq('id', current.inventory_item_id)
      .maybeSingle()

    if (srcItem) {
      await supabase
        .from('inventory')
        .update({ quantity: Math.max(0, srcItem.quantity - current.quantity), updated_at: new Date().toISOString() })
        .eq('id', srcItem.id)
    }

    set((state) => ({
      transferRequests: state.transferRequests.map((t) =>
        t.id === id ? { ...t, status: 'received' as TransferStatus } : t
      ),
    }))
    return { error: null }
  },
}))
