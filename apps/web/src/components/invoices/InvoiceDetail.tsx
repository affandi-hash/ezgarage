import { useEffect, useState } from 'react'
import { useInvoicesStore } from '@/hooks/useInvoices'
import { useAuthStore } from '@/store/authStore'
import type { LineItemType, PaymentMethod, PaymentStatus } from '@/types/invoice'

interface InvoiceDetailProps {
  invoiceId: string
  onBack: () => void
}

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  text: '#F0F0F0',
  muted: '#A0A0A0',
  orange: '#F15A22',
  orangeHover: '#d94e1a',
  inputBg: '#1E1E1E',
}

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, React.CSSProperties> = {
  unpaid: { background: 'rgba(239,68,68,0.15)', color: '#f87171' },
  partial: { background: 'rgba(234,179,8,0.15)', color: '#facc15' },
  paid: { background: 'rgba(34,197,94,0.15)', color: '#4ade80' },
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online_transfer', label: 'Online Transfer' },
  { value: 'qr', label: 'QR Pay' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.inputBg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  color: C.text,
  outline: 'none',
  boxSizing: 'border-box',
}

function formatMYR(amount: number) {
  return `RM ${amount.toFixed(2)}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function InvoiceDetail({ invoiceId, onBack }: InvoiceDetailProps) {
  const { selectedInvoice, loading, fetchInvoiceById, updatePaymentStatus, addLineItem, removeLineItem, clearSelected } = useInvoicesStore()
  const user = useAuthStore((s) => s.user)

  const [showPayModal, setShowPayModal] = useState(false)
  const [payStatus, setPayStatus] = useState<PaymentStatus>('paid')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [savingPay, setSavingPay] = useState(false)

  const [showAddItem, setShowAddItem] = useState(false)
  const [newItem, setNewItem] = useState<{
    description: string
    item_type: LineItemType
    quantity: number
    unit_price: number
  }>({
    description: '',
    item_type: 'service',
    quantity: 1,
    unit_price: 0,
  })
  const [addingItem, setAddingItem] = useState(false)

  const [backHover, setBackHover] = useState(false)
  const [markPaidHover, setMarkPaidHover] = useState(false)
  const [addItemHover, setAddItemHover] = useState(false)
  const [addItemCancelHover, setAddItemCancelHover] = useState(false)
  const [addItemConfirmHover, setAddItemConfirmHover] = useState(false)
  const [payCancelHover, setPayCancelHover] = useState(false)
  const [payConfirmHover, setPayConfirmHover] = useState(false)

  const canManage = user?.role && ['ceo', 'branch_manager', 'operation_manager'].includes(user.role)

  useEffect(() => {
    fetchInvoiceById(invoiceId)
    return () => clearSelected()
  }, [invoiceId])

  const handleMarkPaid = async () => {
    if (!selectedInvoice) return
    setSavingPay(true)
    await updatePaymentStatus(selectedInvoice.id, payStatus, payMethod)
    setSavingPay(false)
    setShowPayModal(false)
    fetchInvoiceById(invoiceId)
  }

  const handleAddItem = async () => {
    if (!selectedInvoice || !newItem.description) return
    setAddingItem(true)
    await addLineItem(selectedInvoice.id, newItem)
    setAddingItem(false)
    setShowAddItem(false)
    setNewItem({ description: '', item_type: 'service', quantity: 1, unit_price: 0 })
    fetchInvoiceById(invoiceId)
  }

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedInvoice) return
    await removeLineItem(selectedInvoice.id, itemId)
    fetchInvoiceById(invoiceId)
  }

  if (loading || !selectedInvoice) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
        <div
          style={{
            width: 24,
            height: 24,
            border: `2px solid ${C.orange}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      </div>
    )
  }

  const inv = selectedInvoice

  return (
    <div style={{ padding: 24, maxWidth: 896, margin: '0 auto' }}>
      {/* Back */}
      <button
        onClick={onBack}
        onMouseEnter={() => setBackHover(true)}
        onMouseLeave={() => setBackHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 13,
          color: backHover ? C.text : C.muted,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: 24,
        }}
      >
        &larr; Back to Invoices
      </button>

      {/* Invoice Header */}
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 700,
                  color: C.text,
                  fontFamily: 'monospace',
                }}
              >
                {inv.invoice_number}
              </h1>
              <span
                style={{
                  ...PAYMENT_STATUS_STYLES[inv.payment_status],
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'capitalize',
                }}
              >
                {inv.payment_status}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Issued {formatDate(inv.created_at)}</p>
          </div>
          {canManage && inv.payment_status !== 'paid' && (
            <button
              onClick={() => setShowPayModal(true)}
              onMouseEnter={() => setMarkPaidHover(true)}
              onMouseLeave={() => setMarkPaidHover(false)}
              style={{
                padding: '8px 16px',
                background: markPaidHover ? '#16a34a' : '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Mark as Paid
            </button>
          )}
        </div>

        {/* Customer + Vehicle info */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 16,
            fontSize: 13,
          }}
        >
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Customer</p>
            <p style={{ margin: 0, fontWeight: 500, color: C.text }}>{inv.customer?.full_name ?? '—'}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Phone</p>
            <p style={{ margin: 0, fontWeight: 500, color: C.text }}>{inv.customer?.phone ?? '—'}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Vehicle</p>
            <p style={{ margin: 0, fontWeight: 500, color: C.text, fontFamily: 'monospace' }}>{inv.job_order?.vehicle?.plate_number ?? '—'}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Make / Model</p>
            <p style={{ margin: 0, fontWeight: 500, color: C.text }}>
              {inv.job_order?.vehicle ? `${inv.job_order.vehicle.make} ${inv.job_order.vehicle.model}` : '—'}
            </p>
          </div>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Job Order</p>
            <p style={{ margin: 0, fontWeight: 500, color: C.orange, fontFamily: 'monospace' }}>{inv.job_order?.job_number ?? '—'}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Service</p>
            <p style={{ margin: 0, fontWeight: 500, color: C.text }}>{inv.job_order?.service_type ?? '—'}</p>
          </div>
          {inv.payment_method && (
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Payment Method</p>
              <p style={{ margin: 0, fontWeight: 500, color: C.text, textTransform: 'capitalize' }}>
                {inv.payment_method.replace('_', ' ')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>Line Items</h2>
          {canManage && (
            <button
              onClick={() => setShowAddItem(!showAddItem)}
              onMouseEnter={() => setAddItemHover(true)}
              onMouseLeave={() => setAddItemHover(false)}
              style={{
                fontSize: 12,
                padding: '6px 12px',
                background: addItemHover ? C.orangeHover : C.orange,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              + Add Item
            </button>
          )}
        </div>

        {/* Add item form */}
        {showAddItem && (
          <div
            style={{
              padding: '16px 20px',
              background: 'rgba(241,90,34,0.06)',
              borderBottom: `1px solid rgba(241,90,34,0.15)`,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Description</label>
                <input
                  type="text"
                  value={newItem.description}
                  onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))}
                  placeholder="e.g. Labour — brake pad replacement"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Type</label>
                <select
                  value={newItem.item_type}
                  onChange={(e) => setNewItem((p) => ({ ...p, item_type: e.target.value as 'service' | 'part' }))}
                  style={inputStyle}
                >
                  <option value="service">Service</option>
                  <option value="part">Part</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Qty</label>
                <input
                  type="number"
                  min={1}
                  value={newItem.quantity}
                  onChange={(e) => setNewItem((p) => ({ ...p, quantity: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Unit Price (RM)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={newItem.unit_price}
                  onChange={(e) => setNewItem((p) => ({ ...p, unit_price: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowAddItem(false)}
                onMouseEnter={() => setAddItemCancelHover(true)}
                onMouseLeave={() => setAddItemCancelHover(false)}
                style={{
                  padding: '8px 16px',
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  fontSize: 13,
                  color: addItemCancelHover ? C.text : C.muted,
                  background: addItemCancelHover ? C.bg : 'transparent',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                disabled={addingItem || !newItem.description}
                onMouseEnter={() => setAddItemConfirmHover(true)}
                onMouseLeave={() => setAddItemConfirmHover(false)}
                style={{
                  padding: '8px 16px',
                  background: addingItem || !newItem.description ? C.orange : addItemConfirmHover ? C.orangeHover : C.orange,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: addingItem || !newItem.description ? 'not-allowed' : 'pointer',
                  opacity: addingItem || !newItem.description ? 0.5 : 1,
                }}
              >
                {addingItem ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Description
                </th>
                <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Type
                </th>
                <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Qty
                </th>
                <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Unit Price
                </th>
                <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: 11, fontWeight: 500, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Total
                </th>
                {canManage && <th style={{ padding: '12px 16px', width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {(inv.items ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 6 : 5}
                    style={{ padding: '32px 20px', textAlign: 'center', color: C.muted, fontSize: 12 }}
                  >
                    No line items yet. Add items above.
                  </td>
                </tr>
              ) : (
                (inv.items ?? []).map((item) => (
                  <LineItemRow
                    key={item.id}
                    item={item}
                    canManage={!!canManage}
                    onRemove={() => handleRemoveItem(item.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '16px 20px' }}>
          <div
            style={{
              marginLeft: 'auto',
              maxWidth: 280,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted }}>
              <span>Subtotal</span>
              <span>{formatMYR(inv.subtotal)}</span>
            </div>
            {inv.discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4ade80' }}>
                <span>Discount</span>
                <span>- {formatMYR(inv.discount)}</span>
              </div>
            )}
            {inv.tax > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted }}>
                <span>Tax</span>
                <span>{formatMYR(inv.tax)}</span>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 700,
                color: C.text,
                fontSize: 15,
                borderTop: `1px solid ${C.border}`,
                paddingTop: 8,
                marginTop: 4,
              }}
            >
              <span>TOTAL</span>
              <span>{formatMYR(inv.total)}</span>
            </div>
          </div>
        </div>

        {inv.notes && (
          <div style={{ borderTop: `1px solid ${C.border}`, padding: '16px 20px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 11, color: C.muted }}>Notes</p>
            <p style={{ margin: 0, fontSize: 13, color: C.text }}>{inv.notes}</p>
          </div>
        )}
      </div>

      {/* Mark as Paid modal */}
      {showPayModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            padding: 16,
          }}
        >
          <div
            style={{
              background: C.surface,
              borderRadius: 16,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              width: '100%',
              maxWidth: 384,
              padding: 24,
              border: `1px solid ${C.border}`,
            }}
          >
            <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: C.text }}>
              Update Payment
            </h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 8 }}>
                Payment Status
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['partial', 'paid'] as PaymentStatus[]).map((s) => (
                  <PayStatusButton
                    key={s}
                    label={s}
                    active={payStatus === s}
                    onClick={() => setPayStatus(s)}
                  />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 8 }}>
                Payment Method
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {PAYMENT_METHODS.map((m) => (
                  <PayMethodButton
                    key={m.value}
                    label={m.label}
                    active={payMethod === m.value}
                    onClick={() => setPayMethod(m.value)}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowPayModal(false)}
                onMouseEnter={() => setPayCancelHover(true)}
                onMouseLeave={() => setPayCancelHover(false)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: payCancelHover ? C.text : C.muted,
                  background: payCancelHover ? C.bg : 'transparent',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaid}
                disabled={savingPay}
                onMouseEnter={() => setPayConfirmHover(true)}
                onMouseLeave={() => setPayConfirmHover(false)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: savingPay ? '#22c55e' : payConfirmHover ? '#16a34a' : '#22c55e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: savingPay ? 'not-allowed' : 'pointer',
                  opacity: savingPay ? 0.5 : 1,
                }}
              >
                {savingPay ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Sub-components for hover state isolation ---

function LineItemRow({
  item,
  canManage,
  onRemove,
}: {
  item: { id: string; description: string; item_type: string; quantity: number; unit_price: number }
  canManage: boolean
  onRemove: () => void
}) {
  const [hover, setHover] = useState(false)
  const [removeHover, setRemoveHover] = useState(false)

  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: hover ? '#1E1E1E' : 'transparent', borderBottom: `1px solid ${C.border}` }}
    >
      <td style={{ padding: '12px 20px', color: C.text }}>{item.description}</td>
      <td style={{ padding: '12px 16px' }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            ...(item.item_type === 'service'
              ? { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }
              : { background: 'rgba(168,85,247,0.15)', color: '#c084fc' }),
          }}
        >
          {item.item_type}
        </span>
      </td>
      <td style={{ padding: '12px 16px', textAlign: 'right', color: C.muted }}>{item.quantity}</td>
      <td style={{ padding: '12px 16px', textAlign: 'right', color: C.muted }}>{formatMYR(item.unit_price)}</td>
      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: C.text }}>
        {formatMYR(item.quantity * item.unit_price)}
      </td>
      {canManage && (
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <button
            onClick={onRemove}
            onMouseEnter={() => setRemoveHover(true)}
            onMouseLeave={() => setRemoveHover(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: removeHover ? '#f87171' : '#f87171aa',
              padding: 0,
            }}
          >
            &times;
          </button>
        </td>
      )}
    </tr>
  )
}

function PayStatusButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        padding: '8px 0',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        textTransform: 'capitalize',
        cursor: 'pointer',
        border: active ? `1px solid ${C.orange}` : `1px solid ${hover ? C.orange + '66' : C.border}`,
        background: active ? C.orange : 'transparent',
        color: active ? '#fff' : C.muted,
      }}
    >
      {label}
    </button>
  )
}

function PayMethodButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        textAlign: 'left',
        cursor: 'pointer',
        border: active ? `1px solid ${C.orange}` : `1px solid ${hover ? C.orange + '66' : C.border}`,
        background: active ? C.orange : 'transparent',
        color: active ? '#fff' : C.muted,
      }}
    >
      {label}
    </button>
  )
}
