import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useInventoryStore } from '@/hooks/useInventory'
import { useAuthStore } from '@/store/authStore'
import type { CreateTransferRequestPayload } from '@/types/inventory'

interface Branch {
  id: string
  name: string
}

interface TransferRequestModalProps {
  onClose: () => void
  onSuccess: () => void
}

export function TransferRequestModal({ onClose, onSuccess }: TransferRequestModalProps) {
  const user = useAuthStore((s) => s.user)
  const { items, createTransferRequest } = useInventoryStore()

  const [branches, setBranches] = useState<Branch[]>([])
  const [form, setForm] = useState({
    inventory_item_id: '',
    to_branch_id: '',
    quantity: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('branches')
      .select('id, name')
      .neq('id', user?.branch_id ?? '')
      .order('name')
      .then(({ data }) => setBranches((data as Branch[]) ?? []))
  }, [user?.branch_id])

  const setField = (key: keyof typeof form, val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const selectedItem = items.find((i) => i.id === form.inventory_item_id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.branch_id) return

    const qty = Number(form.quantity)
    if (selectedItem && qty > selectedItem.quantity) {
      setError(`Insufficient stock. Available: ${selectedItem.quantity} ${selectedItem.unit}`)
      return
    }

    setSubmitting(true)
    setError(null)

    const payload: CreateTransferRequestPayload = {
      from_branch_id: user.branch_id,
      to_branch_id: form.to_branch_id,
      inventory_item_id: form.inventory_item_id,
      quantity: qty,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    }

    const { error: err } = await createTransferRequest(payload)
    setSubmitting(false)
    if (err) { setError(err); return }
    onSuccess()
    onClose()
  }

  const inputClass =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Request Stock Transfer</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Item *</label>
            <select
              required
              value={form.inventory_item_id}
              onChange={(e) => setField('inventory_item_id', e.target.value)}
              className={inputClass}
            >
              <option value="">Select item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku}) — {item.quantity} {item.unit} available
                </option>
              ))}
            </select>
          </div>

          {selectedItem && (
            <div className="bg-gray-50 rounded-lg px-4 py-2 text-xs text-gray-600">
              Current stock: <span className="font-semibold text-gray-800">{selectedItem.quantity} {selectedItem.unit}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Destination Branch *</label>
            <select
              required
              value={form.to_branch_id}
              onChange={(e) => setField('to_branch_id', e.target.value)}
              className={inputClass}
            >
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quantity *</label>
            <input
              required
              type="number"
              min="1"
              max={selectedItem?.quantity}
              placeholder="0"
              value={form.quantity}
              onChange={(e) => setField('quantity', e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <textarea
              rows={2}
              placeholder="Reason for transfer..."
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className={`${inputClass} resize-none`}
            />
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
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
