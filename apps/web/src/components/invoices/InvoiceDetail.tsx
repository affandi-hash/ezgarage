import { useEffect, useState } from 'react'
import { useInvoicesStore } from '@/hooks/useInvoices'
import { useAuthStore } from '@/store/authStore'
import type { LineItemType, PaymentMethod, PaymentStatus } from '@/types/invoice'

interface InvoiceDetailProps {
  invoiceId: string
  onBack: () => void
}

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online_transfer', label: 'Online Transfer' },
  { value: 'qr', label: 'QR Pay' },
]

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
    type: LineItemType
    quantity: number
    unit_price: number
  }>({
    description: '',
    type: 'service',
    quantity: 1,
    unit_price: 0,
  })
  const [addingItem, setAddingItem] = useState(false)

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
    setNewItem({ description: '', type: 'service', quantity: 1, unit_price: 0 })
    fetchInvoiceById(invoiceId)
  }

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedInvoice) return
    await removeLineItem(selectedInvoice.id, itemId)
    fetchInvoiceById(invoiceId)
  }

  if (loading || !selectedInvoice) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const inv = selectedInvoice

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-6">
        &larr; Back to Invoices
      </button>

      {/* Invoice Header */}
      <div className="bg-white border border-gray-100 rounded-xl p-6 mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-gray-800 font-mono">{inv.invoice_number}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${PAYMENT_STATUS_STYLES[inv.payment_status]}`}>
                {inv.payment_status}
              </span>
            </div>
            <p className="text-sm text-gray-500">Issued {formatDate(inv.created_at)}</p>
          </div>
          {canManage && inv.payment_status !== 'paid' && (
            <button
              onClick={() => setShowPayModal(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              Mark as Paid
            </button>
          )}
        </div>

        {/* Customer + Vehicle info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Customer</p>
            <p className="font-medium text-gray-800">{inv.customer?.full_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Phone</p>
            <p className="font-medium text-gray-800">{inv.customer?.phone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Vehicle</p>
            <p className="font-medium text-gray-800 font-mono">{inv.job_order?.vehicle?.plate_number ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Make / Model</p>
            <p className="font-medium text-gray-800">
              {inv.job_order?.vehicle ? `${inv.job_order.vehicle.make} ${inv.job_order.vehicle.model}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Job Order</p>
            <p className="font-medium text-orange-600 font-mono">{inv.job_order?.job_number ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Service</p>
            <p className="font-medium text-gray-800">{inv.job_order?.service_type ?? '—'}</p>
          </div>
          {inv.payment_method && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Payment Method</p>
              <p className="font-medium text-gray-800 capitalize">{inv.payment_method.replace('_', ' ')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-5">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
          {canManage && (
            <button
              onClick={() => setShowAddItem(!showAddItem)}
              className="text-xs px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-medium"
            >
              + Add Item
            </button>
          )}
        </div>

        {/* Add item form */}
        {showAddItem && (
          <div className="px-5 py-4 bg-orange-50 border-b border-orange-100">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input
                  type="text"
                  value={newItem.description}
                  onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))}
                  placeholder="e.g. Labour — brake pad replacement"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Type</label>
                <select
                  value={newItem.type}
                  onChange={(e) => setNewItem((p) => ({ ...p, type: e.target.value as 'service' | 'part' }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                >
                  <option value="service">Service</option>
                  <option value="part">Part</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Qty</label>
                <input
                  type="number"
                  min={1}
                  value={newItem.quantity}
                  onChange={(e) => setNewItem((p) => ({ ...p, quantity: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Unit Price (RM)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={newItem.unit_price}
                  onChange={(e) => setNewItem((p) => ({ ...p, unit_price: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddItem(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                disabled={addingItem || !newItem.description}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
              >
                {addingItem ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Qty</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Unit Price</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                {canManage && <th className="px-4 py-3 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(inv.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-5 py-8 text-center text-gray-400 text-xs">
                    No line items yet. Add items above.
                  </td>
                </tr>
              ) : (
                (inv.items ?? []).map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-800">{item.description}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.type === 'service' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {item.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatMYR(item.unit_price)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-800">{formatMYR(item.quantity * item.unit_price)}</td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-red-400 hover:text-red-600 text-xs transition-colors"
                        >
                          &times;
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="border-t border-gray-100 px-5 py-4">
          <div className="ml-auto max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatMYR(inv.subtotal)}</span>
            </div>
            {inv.discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount</span>
                <span>- {formatMYR(inv.discount)}</span>
              </div>
            )}
            {inv.tax > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Tax</span>
                <span>{formatMYR(inv.tax)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2 mt-2">
              <span>TOTAL</span>
              <span>{formatMYR(inv.total_amount)}</span>
            </div>
          </div>
        </div>

        {inv.notes && (
          <div className="border-t border-gray-100 px-5 py-4">
            <p className="text-xs text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-700">{inv.notes}</p>
          </div>
        )}
      </div>

      {/* Mark as Paid modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Update Payment</h2>

            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-2">Payment Status</label>
              <div className="flex gap-2">
                {(['partial', 'paid'] as PaymentStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setPayStatus(s)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${
                      payStatus === s
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-gray-200 text-gray-600 hover:border-orange-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs text-gray-500 mb-2">Payment Method</label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setPayMethod(m.value)}
                    className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors text-left ${
                      payMethod === m.value
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-gray-200 text-gray-600 hover:border-orange-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPayModal(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaid}
                disabled={savingPay}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
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
