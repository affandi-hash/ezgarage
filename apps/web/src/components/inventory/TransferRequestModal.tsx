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
  resize: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 500,
  color: theme.muted,
  marginBottom: '4px',
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
  const [cancelHover, setCancelHover] = useState(false)
  const [submitHover, setSubmitHover] = useState(false)
  const [closeHover, setCloseHover] = useState(false)

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
          maxWidth: '448px',
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
            Request Stock Transfer
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
          }}
        >
          {/* Item */}
          <div>
            <label style={labelStyle}>Item *</label>
            <select
              required
              value={form.inventory_item_id}
              onChange={(e) => setField('inventory_item_id', e.target.value)}
              style={inputStyle}
            >
              <option value="">Select item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku}) — {item.quantity} {item.unit} available
                </option>
              ))}
            </select>
          </div>

          {/* Stock info banner */}
          {selectedItem && (
            <div
              style={{
                backgroundColor: '#1A1A1A',
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '12px',
                color: theme.muted,
              }}
            >
              Current stock:{' '}
              <span style={{ fontWeight: 600, color: theme.text }}>
                {selectedItem.quantity} {selectedItem.unit}
              </span>
            </div>
          )}

          {/* Destination Branch */}
          <div>
            <label style={labelStyle}>Destination Branch *</label>
            <select
              required
              value={form.to_branch_id}
              onChange={(e) => setField('to_branch_id', e.target.value)}
              style={inputStyle}
            >
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label style={labelStyle}>Quantity *</label>
            <input
              required
              type="number"
              min="1"
              max={selectedItem?.quantity}
              placeholder="0"
              value={form.quantity}
              onChange={(e) => setField('quantity', e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea
              rows={2}
              placeholder="Reason for transfer..."
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              style={inputStyle}
            />
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
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
