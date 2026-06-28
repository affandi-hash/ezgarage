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

const theme = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  text: '#F0F0F0',
  muted: '#A0A0A0',
  orange: '#F15A22',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${theme.border}`,
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '14px',
  backgroundColor: theme.bg,
  color: theme.text,
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 500,
  color: theme.muted,
  marginBottom: '4px',
}

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
  const [cancelHover, setCancelHover] = useState(false)
  const [submitHover, setSubmitHover] = useState(false)
  const [closeHover, setCloseHover] = useState(false)

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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
      }}
    >
      <div
        style={{
          backgroundColor: theme.surface,
          borderRadius: '16px',
          width: '100%',
          maxWidth: '512px',
          margin: '0 16px',
          overflow: 'hidden',
          border: `1px solid ${theme.border}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: theme.text, margin: 0 }}>
            Add Inventory Item
          </h2>
          <button
            onClick={onClose}
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
              color: closeHover ? theme.text : theme.muted,
              padding: '2px 4px',
              transition: 'color 0.15s',
            }}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            overflowY: 'auto',
            maxHeight: '80vh',
          }}
        >
          {/* Row: Name + SKU */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Item Name *</label>
              <input
                required
                type="text"
                placeholder="e.g. Engine Oil 5W-30"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>SKU *</label>
              <input
                required
                type="text"
                placeholder="e.g. OIL-5W30-1L"
                value={form.sku}
                onChange={(e) => set('sku', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Row: Category + Unit */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Category *</label>
              <select
                required
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                style={inputStyle}
              >
                <option value="">Select category</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unit *</label>
              <select
                required
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
                style={inputStyle}
              >
                <option value="">Select unit</option>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row: Quantity + Low Stock Threshold */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Quantity *</label>
              <input
                required
                type="number"
                min="0"
                placeholder="0"
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Low Stock Threshold *</label>
              <input
                required
                type="number"
                min="1"
                placeholder="5"
                value={form.low_stock_threshold}
                onChange={(e) => set('low_stock_threshold', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Row: Unit Cost + Selling Price */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Unit Cost (RM) *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.unit_cost}
                onChange={(e) => set('unit_cost', e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Selling Price (RM) *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.selling_price}
                onChange={(e) => set('selling_price', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Supplier */}
          <div>
            <label style={labelStyle}>Supplier (optional)</label>
            <select
              value={form.supplier_id}
              onChange={(e) => set('supplier_id', e.target.value)}
              style={inputStyle}
            >
              <option value="">No supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <p style={{ fontSize: '12px', color: '#F87171', margin: 0 }}>{error}</p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', paddingTop: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              onMouseEnter={() => setCancelHover(true)}
              onMouseLeave={() => setCancelHover(false)}
              style={{
                flex: 1,
                border: `1px solid ${theme.border}`,
                backgroundColor: cancelHover ? '#1F1F1F' : 'transparent',
                color: theme.muted,
                borderRadius: '8px',
                padding: '9px 0',
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              onMouseEnter={() => setSubmitHover(true)}
              onMouseLeave={() => setSubmitHover(false)}
              style={{
                flex: 1,
                backgroundColor: submitting ? '#A0400F' : submitHover ? '#D94E1A' : theme.orange,
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                padding: '9px 0',
                fontSize: '14px',
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.6 : 1,
                transition: 'background-color 0.15s',
              }}
            >
              {submitting ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
