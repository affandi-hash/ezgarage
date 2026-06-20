import { useState, useEffect } from 'react'
import { useInventoryStore } from '@/hooks/useInventory'
import { useAuthStore } from '@/store/authStore'
import type { ItemCategory, CreateInventoryItemPayload } from '@/types/inventory'

interface AddItemModalProps {
  onClose: () => void
  onSuccess: () => void
}

const CATEGORIES: ItemCategory[] = [
  'engine', 'brakes', 'electrical', 'body', 'tyres',
  'fluids', 'filters', 'suspension', 'accessories', 'other',
]

const UNITS = ['pcs', 'set', 'litre', 'kg', 'metre', 'box', 'pair']

export function AddItemModal({ onClose, onSuccess }: AddItemModalProps) {
  const user = useAuthStore((s) => s.user)
  const { addStock, fetchSuppliers, suppliers } = useInventoryStore()

  const [form, setForm] = useState({
    name: '',
    sku: '',
    category: '' as ItemCategory | '',
    unit: '',
    quantity: '',
    low_stock_threshold: '',
    unit_cost: '',
    selling_price: '',
    supplier_id: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  const set = (key: keyof typeof form, val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.branch_id || !form.category) return
    setSubmitting(true)
    setError(null)

    const payload: CreateInventoryItemPayload = {
      branch_id: user.branch_id,
      name: form.name.trim(),
      sku: form.sku.trim(),
      category: form.category,
      unit: form.unit,
      quantity: Number(form.quantity),
      low_stock_threshold: Number(form.low_stock_threshold),
      unit_cost: Number(form.unit_cost),
      selling_price: Number(form.selling_price),
      ...(form.supplier_id ? { supplier_id: form.supplier_id } : {}),
    }

    const { error: err } = await addStock(payload)
    setSubmitting(false)
    if (err) { setError(err); return }
    onSuccess()
    onClose()
  }

  const inputClass =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Add Inventory Item</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[80vh]">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Item Name *</label>
              <input
                required
                type="text"
                placeholder="e.g. Engine Oil 5W-30"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SKU *</label>
              <input
                required
                type="text"
                placeholder="e.g. OIL-5W30-1L"
                value={form.sku}
                onChange={(e) => set('sku', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
              <select
                required
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                className={inputClass}
              >
                <option value="">Select category</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unit *</label>
              <select
                required
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
                className={inputClass}
              >
                <option value="">Select unit</option>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantity *</label>
              <input
                required
                type="number"
                min="0"
                placeholder="0"
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Low Stock Threshold *</label>
              <input
                required
                type="number"
                min="1"
                placeholder="5"
                value={form.low_stock_threshold}
                onChange={(e) => set('low_stock_threshold', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unit Cost (RM) *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.unit_cost}
                onChange={(e) => set('unit_cost', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Selling Price (RM) *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.selling_price}
                onChange={(e) => set('selling_price', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Supplier (optional)</label>
            <select
              value={form.supplier_id}
              onChange={(e) => set('supplier_id', e.target.value)}
              className={inputClass}
            >
              <option value="">No supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-orange-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {submitting ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
