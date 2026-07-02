import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Eye,
  X,
  ChevronDown,
  ChevronUp,
  Upload,
  Plus,
  FileText,
  CreditCard,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useOutletContext } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: string
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  credit_limit: number | null
  credit_days: number | null
}

interface SupplierInvoice {
  id: string
  tenant_id: string
  branch_id: string | null
  supplier_id: string
  stock_purchase_id: string | null
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  total_amount: number
  amount_paid: number
  status: 'unpaid' | 'partial' | 'paid' | 'overdue'
  file_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  suppliers?: Supplier | null
}

interface SupplierPayment {
  id: string
  tenant_id: string
  supplier_invoice_id: string
  payment_date: string
  amount: number
  payment_method: 'cash' | 'transfer' | 'cheque'
  reference: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

type StatusFilter = 'all' | 'unpaid' | 'partial' | 'paid' | 'overdue'

interface NewInvoiceForm {
  supplier_id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  total_amount: string
  notes: string
}

interface PaymentForm {
  payment_date: string
  amount: string
  payment_method: 'cash' | 'transfer' | 'cheque'
  reference: string
  notes: string
}

interface EditInvoiceForm {
  invoice_number: string
  invoice_date: string
  due_date: string
  total_amount: string
  notes: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRM(n: number): string {
  return 'RM ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'paid') return false
  return dueDate < today()
}

function isDueSoon(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'paid') return false
  const todayStr = today()
  const weekOut = addDays(todayStr, 7)
  return dueDate >= todayStr && dueDate <= weekOut
}

function calcStatus(totalAmount: number, amountPaid: number, dueDate: string | null): SupplierInvoice['status'] {
  if (amountPaid >= totalAmount) return 'paid'
  if (amountPaid > 0) return 'partial'
  if (dueDate && dueDate < today()) return 'overdue'
  return 'unpaid'
}

const STATUS_COLOR: Record<SupplierInvoice['status'], string> = {
  unpaid: '#A0A0A0',
  partial: '#F59E0B',
  paid: '#22C55E',
  overdue: '#EF4444',
}

const STATUS_BG: Record<SupplierInvoice['status'], string> = {
  unpaid: 'rgba(160,160,160,0.12)',
  partial: 'rgba(245,158,11,0.12)',
  paid: 'rgba(34,197,94,0.12)',
  overdue: 'rgba(239,68,68,0.12)',
}

const EMPTY_NEW_INVOICE: NewInvoiceForm = {
  supplier_id: '',
  invoice_number: '',
  invoice_date: today(),
  due_date: '',
  total_amount: '',
  notes: '',
}

const EMPTY_PAYMENT: PaymentForm = {
  payment_date: today(),
  amount: '',
  payment_method: 'transfer',
  reference: '',
  notes: '',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string
  value: number
  color: string
  icon: React.ReactNode
}

function SummaryCard({ label, value, color, icon }: SummaryCardProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 20,
        borderRadius: 12,
        flex: '1 1 180px',
        minWidth: 160,
        background: '#161616',
        border: '1px solid #2A2A2A',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: 8,
          background: `${color}18`,
          flexShrink: 0,
        }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ color: '#A0A0A0', fontSize: 12, margin: 0, whiteSpace: 'nowrap' }}>{label}</p>
        <p style={{ color, fontSize: 20, fontWeight: 700, margin: '2px 0 0', whiteSpace: 'nowrap' }}>
          {formatRM(value)}
        </p>
      </div>
    </div>
  )
}

interface StatusBadgeProps {
  status: SupplierInvoice['status']
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'capitalize',
        color: STATUS_COLOR[status],
        background: STATUS_BG[status],
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  )
}

// ─── New Invoice Modal ─────────────────────────────────────────────────────────

interface NewInvoiceModalProps {
  suppliers: Supplier[]
  onClose: () => void
  onSave: (form: NewInvoiceForm) => Promise<void>
  saving: boolean
}

function NewInvoiceModal({ suppliers, onClose, onSave, saving }: NewInvoiceModalProps) {
  const [form, setForm] = useState<NewInvoiceForm>(EMPTY_NEW_INVOICE)
  const [errors, setErrors] = useState<Partial<Record<keyof NewInvoiceForm, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)

  function set<K extends keyof NewInvoiceForm>(field: K, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  // Auto-calc due_date when supplier or invoice_date changes
  useEffect(() => {
    if (!form.supplier_id || !form.invoice_date) return
    const sup = suppliers.find((s) => s.id === form.supplier_id)
    if (sup?.credit_days) {
      setForm((f) => ({ ...f, due_date: addDays(f.invoice_date, sup.credit_days!) }))
    }
  }, [form.supplier_id, form.invoice_date, suppliers])

  function validate(): boolean {
    const e: Partial<Record<keyof NewInvoiceForm, string>> = {}
    if (!form.supplier_id) e.supplier_id = 'Select a supplier'
    if (!form.invoice_date) e.invoice_date = 'Invoice date is required'
    if (!form.due_date) e.due_date = 'Due date is required'
    if (!form.total_amount || Number(form.total_amount) <= 0) e.total_amount = 'Enter a valid amount'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    setSaveError(null)
    try {
      await onSave(form)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save invoice')
    }
  }

  const inp: React.CSSProperties = {
    background: '#0E0E0E',
    border: '1px solid #2A2A2A',
    color: '#F0F0F0',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 14,
    width: '100%',
    outline: 'none',
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
        padding: 16,
        background: 'rgba(0,0,0,0.75)',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          background: '#1E1E1E',
          border: '1px solid #2A2A2A',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid #2A2A2A',
            flexShrink: 0,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#F0F0F0' }}>New Supplier Invoice</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: '0 8px', minHeight: 44 }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ overflowY: 'auto', flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Supplier */}
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#A0A0A0', marginBottom: 6 }}>
                Supplier <span style={{ color: '#F15A22' }}>*</span>
              </label>
              <select
                value={form.supplier_id}
                onChange={(e) => set('supplier_id', e.target.value)}
                style={{ ...inp, borderColor: errors.supplier_id ? '#F15A22' : '#2A2A2A', color: form.supplier_id ? '#F0F0F0' : '#6B7280' }}
              >
                <option value="">— Select Supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.supplier_id && <p style={{ fontSize: 11, marginTop: 4, color: '#F15A22' }}>{errors.supplier_id}</p>}
            </div>

            {/* Invoice number */}
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#A0A0A0', marginBottom: 6 }}>Invoice Number</label>
              <input
                type="text"
                value={form.invoice_number}
                onChange={(e) => set('invoice_number', e.target.value)}
                placeholder="e.g. INV-2025-0001"
                style={inp}
              />
            </div>

            {/* Invoice date + Due date */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: '#A0A0A0', marginBottom: 6 }}>
                  Invoice Date <span style={{ color: '#F15A22' }}>*</span>
                </label>
                <input
                  type="date"
                  value={form.invoice_date}
                  onChange={(e) => set('invoice_date', e.target.value)}
                  style={{ ...inp, borderColor: errors.invoice_date ? '#F15A22' : '#2A2A2A' }}
                />
                {errors.invoice_date && <p style={{ fontSize: 11, marginTop: 4, color: '#F15A22' }}>{errors.invoice_date}</p>}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: '#A0A0A0', marginBottom: 6 }}>
                  Due Date <span style={{ color: '#F15A22' }}>*</span>
                </label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => set('due_date', e.target.value)}
                  style={{ ...inp, borderColor: errors.due_date ? '#F15A22' : '#2A2A2A' }}
                />
                {errors.due_date && <p style={{ fontSize: 11, marginTop: 4, color: '#F15A22' }}>{errors.due_date}</p>}
              </div>
            </div>

            {/* Total amount */}
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#A0A0A0', marginBottom: 6 }}>
                Total Amount (RM) <span style={{ color: '#F15A22' }}>*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.total_amount}
                onChange={(e) => set('total_amount', e.target.value)}
                placeholder="0.00"
                style={{ ...inp, borderColor: errors.total_amount ? '#F15A22' : '#2A2A2A' }}
              />
              {errors.total_amount && <p style={{ fontSize: 11, marginTop: 4, color: '#F15A22' }}>{errors.total_amount}</p>}
            </div>

            {/* Notes */}
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#A0A0A0', marginBottom: 6 }}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Additional remarks..."
                rows={3}
                style={{ ...inp, resize: 'none' }}
              />
            </div>
          </div>

          {saveError && (
            <div style={{ padding: '0 24px 12px' }}>
              <p style={{ color: '#EF4444', fontSize: 13, margin: 0, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px' }}>{saveError}</p>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 12,
              padding: '16px 24px',
              borderTop: '1px solid #2A2A2A',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#2A2A2A',
                color: '#A0A0A0',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '0 20px',
                minHeight: 44,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: saving ? '#5A2A10' : '#F15A22',
                color: '#F0F0F0',
                border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                padding: '0 20px',
                minHeight: 44,
              }}
            >
              {saving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              Save Invoice
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  invoice: SupplierInvoice
  payments: SupplierPayment[]
  paymentsLoading: boolean
  onClose: () => void
  onPaymentSaved: () => void
  onInvoiceUpdated: (updated: SupplierInvoice) => void
  tenantId: string
  userId: string
}

function DetailPanel({
  invoice,
  payments,
  paymentsLoading,
  onClose,
  onPaymentSaved,
  onInvoiceUpdated,
  tenantId,
  userId,
}: DetailPanelProps) {
  const supplier = invoice.suppliers
  const balance = invoice.total_amount - invoice.amount_paid

  // Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState<PaymentForm>({
    ...EMPTY_PAYMENT,
    amount: balance > 0 ? balance.toFixed(2) : '',
  })
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  // Edit invoice section
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<EditInvoiceForm>({
    invoice_number: invoice.invoice_number ?? '',
    invoice_date: invoice.invoice_date ?? '',
    due_date: invoice.due_date ?? '',
    total_amount: String(invoice.total_amount),
    notes: invoice.notes ?? '',
  })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // File upload
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function setPayField<K extends keyof PaymentForm>(field: K, value: string) {
    setPaymentForm((f) => ({ ...f, [field]: value }))
    setPaymentError(null)
  }

  function setEditField<K extends keyof EditInvoiceForm>(field: K, value: string) {
    setEditForm((f) => ({ ...f, [field]: value }))
    setEditError(null)
  }

  async function handleSavePayment(ev: React.FormEvent) {
    ev.preventDefault()
    const amt = parseFloat(paymentForm.amount)
    if (!paymentForm.payment_date) { setPaymentError('Payment date is required'); return }
    if (isNaN(amt) || amt <= 0) { setPaymentError('Enter a valid payment amount'); return }

    setPaymentSaving(true)
    setPaymentError(null)
    try {
      const { error: insErr } = await supabase.from('supplier_payments').insert({
        tenant_id: tenantId,
        supplier_invoice_id: invoice.id,
        payment_date: paymentForm.payment_date,
        amount: amt,
        payment_method: paymentForm.payment_method,
        reference: paymentForm.reference.trim() || null,
        notes: paymentForm.notes.trim() || null,
        created_by: userId || null,
      })
      if (insErr) throw insErr

      const newAmountPaid = invoice.amount_paid + amt
      const newStatus = calcStatus(invoice.total_amount, newAmountPaid, invoice.due_date)

      const { data: updInv, error: updErr } = await supabase
        .from('supplier_invoices')
        .update({ amount_paid: newAmountPaid, status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', invoice.id)
        .select('*, suppliers(*)')
        .single()

      if (updErr) throw updErr

      onInvoiceUpdated(updInv as SupplierInvoice)
      setShowPaymentForm(false)
      setPaymentForm({ ...EMPTY_PAYMENT, amount: '' })
      onPaymentSaved()
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to save payment')
    } finally {
      setPaymentSaving(false)
    }
  }

  async function handleSaveEdit(ev: React.FormEvent) {
    ev.preventDefault()
    const totalAmt = parseFloat(editForm.total_amount)
    if (isNaN(totalAmt) || totalAmt <= 0) { setEditError('Enter a valid total amount'); return }
    if (!editForm.invoice_date) { setEditError('Invoice date is required'); return }
    if (!editForm.due_date) { setEditError('Due date is required'); return }

    setEditSaving(true)
    setEditError(null)
    try {
      const newStatus = calcStatus(totalAmt, invoice.amount_paid, editForm.due_date)
      const { data: updInv, error: updErr } = await supabase
        .from('supplier_invoices')
        .update({
          invoice_number: editForm.invoice_number.trim() || null,
          invoice_date: editForm.invoice_date,
          due_date: editForm.due_date,
          total_amount: totalAmt,
          notes: editForm.notes.trim() || null,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id)
        .select('*, suppliers(*)')
        .single()

      if (updErr) throw updErr
      onInvoiceUpdated(updInv as SupplierInvoice)
      setEditOpen(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update invoice')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const ext = file.name.split('.').pop()
      const filename = `${Date.now()}.${ext}`
      const path = `${invoice.id}/${filename}`

      const { error: upErr } = await supabase.storage.from('supplier-invoices').upload(path, file, { upsert: true })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('supplier-invoices').getPublicUrl(path)
      const publicUrl = urlData.publicUrl

      const { data: updInv, error: updErr } = await supabase
        .from('supplier_invoices')
        .update({ file_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', invoice.id)
        .select('*, suppliers(*)')
        .single()

      if (updErr) throw updErr
      onInvoiceUpdated(updInv as SupplierInvoice)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const inp: React.CSSProperties = {
    background: '#0E0E0E',
    border: '1px solid #2A2A2A',
    color: '#F0F0F0',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    width: '100%',
    outline: 'none',
  }

  const sectionHead: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#A0A0A0',
    margin: '0 0 10px',
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        maxWidth: '100vw',
        background: '#161616',
        borderLeft: '1px solid #2A2A2A',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '20px 20px 16px',
          borderBottom: '1px solid #2A2A2A',
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          background: '#161616',
          zIndex: 1,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: '#A0A0A0', fontSize: 12, margin: '0 0 2px' }}>{supplier?.name ?? '—'}</p>
          <h3 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: '0 0 6px', wordBreak: 'break-word' }}>
            {invoice.invoice_number || 'No Invoice #'}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge status={invoice.status} />
            <span style={{ color: '#A0A0A0', fontSize: 12 }}>
              Due {formatDate(invoice.due_date)}
            </span>
          </div>
          {supplier && (supplier.credit_days || supplier.credit_limit) && (
            <p style={{ color: '#6B7280', fontSize: 11, margin: '8px 0 0' }}>
              Credit: {supplier.credit_days ?? '—'} days
              {supplier.credit_limit ? ` | Limit: ${formatRM(supplier.credit_limit)}` : ''}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: '0 4px', minHeight: 44, flexShrink: 0 }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Amount summary */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { label: 'Total', value: invoice.total_amount, color: '#F0F0F0' },
            { label: 'Paid', value: invoice.amount_paid, color: '#22C55E' },
            { label: 'Balance', value: balance, color: balance > 0 ? '#F15A22' : '#22C55E' },
          ].map((item) => (
            <div
              key={item.label}
              style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}
            >
              <p style={{ color: '#A0A0A0', fontSize: 11, margin: '0 0 4px' }}>{item.label}</p>
              <p style={{ color: item.color, fontSize: 14, fontWeight: 700, margin: 0 }}>{formatRM(item.value)}</p>
            </div>
          ))}
        </div>

        {/* Dates */}
        <div>
          <p style={sectionHead}>Invoice Details</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Invoice Date', value: formatDate(invoice.invoice_date) },
              { label: 'Due Date', value: formatDate(invoice.due_date) },
              { label: 'Created', value: formatDate(invoice.created_at) },
            ].map((row) => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#A0A0A0' }}>{row.label}</span>
                <span style={{ color: '#F0F0F0', fontWeight: 500 }}>{row.value}</span>
              </div>
            ))}
            {invoice.notes && (
              <div style={{ marginTop: 6, padding: '8px 10px', background: '#1E1E1E', borderRadius: 6, fontSize: 13, color: '#A0A0A0' }}>
                {invoice.notes}
              </div>
            )}
          </div>
        </div>

        {/* File section */}
        <div>
          <p style={sectionHead}>Invoice File</p>
          {invoice.file_url ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <a
                href={invoice.file_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#1E1E1E',
                  border: '1px solid #2A2A2A',
                  color: '#F15A22',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                  flex: 1,
                  justifyContent: 'center',
                }}
              >
                <FileText size={14} /> View Invoice
              </a>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#1E1E1E',
                  border: '1px solid #2A2A2A',
                  color: '#A0A0A0',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                }}
              >
                {uploading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
                Replace
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                background: 'rgba(241,90,34,0.08)',
                border: '1px dashed rgba(241,90,34,0.4)',
                color: '#F15A22',
                borderRadius: 8,
                padding: '12px 0',
                fontSize: 13,
                fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer',
              }}
            >
              {uploading ? (
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Upload size={14} />
              )}
              {uploading ? 'Uploading…' : 'Upload Invoice'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
              e.target.value = ''
            }}
          />
          {uploadError && (
            <p style={{ fontSize: 12, color: '#EF4444', marginTop: 6 }}>{uploadError}</p>
          )}
        </div>

        {/* Payment history */}
        <div>
          <p style={sectionHead}>Payment History</p>
          {paymentsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
              <Loader2 size={20} style={{ color: '#F15A22', animation: 'spin 1s linear infinite' }} />
            </div>
          ) : payments.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '20px 0',
                color: '#4A4A4A',
                fontSize: 13,
                border: '1px dashed #2A2A2A',
                borderRadius: 8,
              }}
            >
              No payments recorded yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {payments.map((pay) => (
                <div
                  key={pay.id}
                  style={{
                    background: '#1E1E1E',
                    border: '1px solid #2A2A2A',
                    borderRadius: 8,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ color: '#F0F0F0', fontSize: 14, fontWeight: 700, margin: 0 }}>{formatRM(pay.amount)}</p>
                      <p style={{ color: '#A0A0A0', fontSize: 12, margin: '3px 0 0' }}>
                        {formatDate(pay.payment_date)} · <span style={{ textTransform: 'capitalize' }}>{pay.payment_method}</span>
                        {pay.reference ? ` · Ref: ${pay.reference}` : ''}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background:
                          pay.payment_method === 'cash'
                            ? 'rgba(34,197,94,0.12)'
                            : pay.payment_method === 'transfer'
                            ? 'rgba(59,130,246,0.12)'
                            : 'rgba(245,158,11,0.12)',
                        color:
                          pay.payment_method === 'cash'
                            ? '#22C55E'
                            : pay.payment_method === 'transfer'
                            ? '#3B82F6'
                            : '#F59E0B',
                      }}
                    >
                      {pay.payment_method}
                    </span>
                  </div>
                  {pay.notes && (
                    <p style={{ color: '#6B7280', fontSize: 12, margin: '6px 0 0' }}>{pay.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add payment */}
          {!showPaymentForm && invoice.status !== 'paid' && (
            <button
              onClick={() => {
                const currentBalance = invoice.total_amount - invoice.amount_paid
                setPaymentForm({ ...EMPTY_PAYMENT, amount: currentBalance > 0 ? currentBalance.toFixed(2) : '' })
                setPaymentError(null)
                setShowPaymentForm(true)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                background: '#F15A22',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 0',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: 10,
              }}
            >
              <CreditCard size={14} /> Add Payment
            </button>
          )}

          {showPaymentForm && (
            <form
              onSubmit={handleSavePayment}
              style={{
                marginTop: 12,
                background: '#1E1E1E',
                border: '1px solid #2A2A2A',
                borderRadius: 10,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <p style={{ ...sectionHead, margin: '0 0 4px' }}>Add Payment</p>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>
                  Payment Date *
                </label>
                <input
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={(e) => setPayField('payment_date', e.target.value)}
                  style={inp}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Amount (RM) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPayField('amount', e.target.value)}
                  placeholder="0.00"
                  style={inp}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Method</label>
                  <select
                    value={paymentForm.payment_method}
                    onChange={(e) => setPayField('payment_method', e.target.value)}
                    style={inp}
                  >
                    <option value="cash">Cash</option>
                    <option value="transfer">Transfer</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Reference</label>
                  <input
                    type="text"
                    value={paymentForm.reference}
                    onChange={(e) => setPayField('reference', e.target.value)}
                    placeholder="e.g. TXN-001"
                    style={inp}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Notes</label>
                <input
                  type="text"
                  value={paymentForm.notes}
                  onChange={(e) => setPayField('notes', e.target.value)}
                  placeholder="Optional remarks"
                  style={inp}
                />
              </div>

              {paymentError && (
                <p style={{ color: '#EF4444', fontSize: 12, margin: 0 }}>{paymentError}</p>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { setShowPaymentForm(false); setPaymentError(null) }}
                  style={{
                    flex: 1,
                    background: '#2A2A2A',
                    color: '#A0A0A0',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: 'pointer',
                    padding: '9px 0',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paymentSaving}
                  style={{
                    flex: 2,
                    background: paymentSaving ? '#5A2A10' : '#F15A22',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: paymentSaving ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '9px 0',
                  }}
                >
                  {paymentSaving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                  Save Payment
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Edit Invoice section */}
        <div>
          <button
            onClick={() => setEditOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'none',
              border: '1px solid #2A2A2A',
              borderRadius: 8,
              color: '#A0A0A0',
              padding: '10px 14px',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            <span>Edit Invoice</span>
            {editOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {editOpen && (
            <form
              onSubmit={handleSaveEdit}
              style={{
                marginTop: 10,
                background: '#1E1E1E',
                border: '1px solid #2A2A2A',
                borderRadius: 10,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Invoice Number</label>
                <input
                  type="text"
                  value={editForm.invoice_number}
                  onChange={(e) => setEditField('invoice_number', e.target.value)}
                  placeholder="e.g. INV-2025-0001"
                  style={inp}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Invoice Date *</label>
                  <input
                    type="date"
                    value={editForm.invoice_date}
                    onChange={(e) => setEditField('invoice_date', e.target.value)}
                    style={inp}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Due Date *</label>
                  <input
                    type="date"
                    value={editForm.due_date}
                    onChange={(e) => setEditField('due_date', e.target.value)}
                    style={inp}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Total Amount (RM) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.total_amount}
                  onChange={(e) => setEditField('total_amount', e.target.value)}
                  style={inp}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#A0A0A0', marginBottom: 4 }}>Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditField('notes', e.target.value)}
                  rows={2}
                  style={{ ...inp, resize: 'none' }}
                />
              </div>

              {editError && <p style={{ color: '#EF4444', fontSize: 12, margin: 0 }}>{editError}</p>}

              <button
                type="submit"
                disabled={editSaving}
                style={{
                  background: editSaving ? '#2A2A2A' : '#F15A22',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: editSaving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 0',
                }}
              >
                {editSaving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                Save Changes
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function FinancePage() {
  const { user } = useAuthStore()
  const { selectedBranchId } = useOutletContext<{ selectedBranchId: string | null }>()

  const tenantId: string = user?.tenant_id ?? ''
  const userId: string = user?.id ?? ''
  const branchId: string = selectedBranchId ?? user?.branch_id ?? ''

  // Data
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [supplierFilter, setSupplierFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Selected invoice (detail panel)
  const [selectedInvoice, setSelectedInvoice] = useState<SupplierInvoice | null>(null)
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)

  // New invoice modal
  const [showNewModal, setShowNewModal] = useState(false)
  const [newSaving, setNewSaving] = useState(false)

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadSuppliers = useCallback(async () => {
    if (!tenantId) return
    const { data } = await supabase
      .from('suppliers')
      .select('id, name, contact_person, phone, email, credit_limit, credit_days')
      .eq('tenant_id', tenantId)
      .order('name')
    setSuppliers((data as Supplier[]) ?? [])
  }, [tenantId])

  const loadInvoices = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('supplier_invoices')
        .select('*, suppliers(id, name, contact_person, phone, email, credit_limit, credit_days)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })

      if (branchId) query = query.eq('branch_id', branchId)

      const { data, error: dbErr } = await query
      if (dbErr) throw dbErr

      const rows = (data as SupplierInvoice[]) ?? []

      // Batch update overdue invoices
      const overdueIds = rows
        .filter((inv) => inv.due_date && inv.due_date < today() && ['unpaid', 'partial'].includes(inv.status))
        .map((inv) => inv.id)

      if (overdueIds.length > 0) {
        await supabase
          .from('supplier_invoices')
          .update({ status: 'overdue', updated_at: new Date().toISOString() })
          .in('id', overdueIds)

        rows.forEach((inv) => {
          if (overdueIds.includes(inv.id)) inv.status = 'overdue'
        })
      }

      setInvoices(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [tenantId, branchId])

  useEffect(() => {
    loadSuppliers()
    loadInvoices()
  }, [loadSuppliers, loadInvoices])

  // ── Load payments for selected invoice ───────────────────────────────────────

  const loadPayments = useCallback(async (invoiceId: string) => {
    setPaymentsLoading(true)
    const { data } = await supabase
      .from('supplier_payments')
      .select('*')
      .eq('supplier_invoice_id', invoiceId)
      .order('payment_date', { ascending: false })
    setPayments((data as SupplierPayment[]) ?? [])
    setPaymentsLoading(false)
  }, [])

  useEffect(() => {
    if (selectedInvoice) loadPayments(selectedInvoice.id)
  }, [selectedInvoice?.id, loadPayments])

  // ── Summary metrics ───────────────────────────────────────────────────────────

  const todayStr = today()
  const weekOutStr = addDays(todayStr, 7)
  const monthOutStr = addDays(todayStr, 30)

  const summaryOverdue = invoices
    .filter((inv) => inv.due_date && inv.due_date < todayStr && inv.status !== 'paid')
    .reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0)

  const summaryDueWeek = invoices
    .filter((inv) => inv.due_date && inv.due_date >= todayStr && inv.due_date <= weekOutStr && inv.status !== 'paid')
    .reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0)

  const summaryDue30 = invoices
    .filter((inv) => inv.due_date && inv.due_date >= todayStr && inv.due_date <= monthOutStr && inv.status !== 'paid')
    .reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0)

  const summaryOutstanding = invoices
    .filter((inv) => inv.status !== 'paid')
    .reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0)

  // ── Filtering ─────────────────────────────────────────────────────────────────

  const filtered = invoices.filter((inv) => {
    if (supplierFilter !== 'all' && inv.supplier_id !== supplierFilter) return false
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false
    if (dateFrom && inv.invoice_date && inv.invoice_date < dateFrom) return false
    if (dateTo && inv.invoice_date && inv.invoice_date > dateTo) return false
    return true
  })

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handleNewInvoiceSave(form: NewInvoiceForm) {
    setNewSaving(true)
    try {
      const { error: insErr } = await supabase.from('supplier_invoices').insert({
        tenant_id: tenantId,
        branch_id: branchId || null,
        supplier_id: form.supplier_id,
        invoice_number: form.invoice_number.trim() || null,
        invoice_date: form.invoice_date,
        due_date: form.due_date,
        total_amount: parseFloat(form.total_amount),
        amount_paid: 0,
        status: 'unpaid',
        notes: form.notes.trim() || null,
      })
      if (insErr) throw insErr
      setShowNewModal(false)
      await loadInvoices()
    } catch (err) {
      // re-throw so the modal can show it
      throw err
    } finally {
      setNewSaving(false)
    }
  }

  function handleInvoiceUpdated(updated: SupplierInvoice) {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)))
    setSelectedInvoice(updated)
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'partial', label: 'Partial' },
    { key: 'paid', label: 'Paid' },
    { key: 'overdue', label: 'Overdue' },
  ]

  return (
    <>
      {/* Spinner keyframe via style tag */}
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

      <div
        style={{
          minHeight: '100vh',
          padding: 24,
          background: '#0E0E0E',
          color: '#F0F0F0',
          paddingRight: selectedInvoice ? 444 : 24,
          transition: 'padding-right 0.2s ease',
        }}
      >
        {/* ── Page header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 700, margin: 0 }}>Finance</h1>
            <p style={{ color: '#A0A0A0', fontSize: 13, marginTop: 4 }}>
              Accounts Payable — Supplier Invoice Management
            </p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#F15A22',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '0 20px',
              minHeight: 44,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={16} /> New Invoice
          </button>
        </div>

        {/* ── Summary cards ── */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
          <SummaryCard
            label="Overdue"
            value={summaryOverdue}
            color="#EF4444"
            icon={<AlertCircle size={20} />}
          />
          <SummaryCard
            label="Due This Week"
            value={summaryDueWeek}
            color="#F15A22"
            icon={<CreditCard size={20} />}
          />
          <SummaryCard
            label="Due 30 Days"
            value={summaryDue30}
            color="#F59E0B"
            icon={<FileText size={20} />}
          />
          <SummaryCard
            label="Total Outstanding"
            value={summaryOutstanding}
            color="#3B82F6"
            icon={<FileText size={20} />}
          />
        </div>

        {/* ── Filter bar ── */}
        <div
          style={{
            background: '#161616',
            border: '1px solid #2A2A2A',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          {/* Status chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {STATUS_TABS.map((tab) => {
              const active = statusFilter === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  style={{
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    background: active ? '#F15A22' : '#1E1E1E',
                    color: active ? '#F0F0F0' : '#A0A0A0',
                    border: active ? 'none' : '1px solid #2A2A2A',
                    padding: '0 16px',
                    minHeight: 36,
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Supplier + date range */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              style={{
                background: '#0E0E0E',
                border: '1px solid #2A2A2A',
                color: supplierFilter === 'all' ? '#6B7280' : '#F0F0F0',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                outline: 'none',
                minWidth: 180,
              }}
            >
              <option value="all">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#A0A0A0', fontSize: 13 }}>From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  outline: 'none',
                  background: '#0E0E0E',
                  border: '1px solid #2A2A2A',
                  color: '#F0F0F0',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#A0A0A0', fontSize: 13 }}>To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  outline: 'none',
                  background: '#0E0E0E',
                  border: '1px solid #2A2A2A',
                  color: '#F0F0F0',
                }}
              />
            </div>

            {(supplierFilter !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => { setSupplierFilter('all'); setDateFrom(''); setDateTo('') }}
                style={{
                  background: '#2A2A2A',
                  color: '#A0A0A0',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '0 16px',
                  minHeight: 36,
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #2A2A2A' }}>
          {loading ? (
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 12 }}
            >
              <Loader2 size={28} style={{ color: '#F15A22', animation: 'spin 1s linear infinite' }} />
              <span style={{ color: '#A0A0A0', fontSize: 14 }}>Loading invoices…</span>
            </div>
          ) : error ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '80px 0',
                gap: 12,
              }}
            >
              <AlertCircle size={40} style={{ color: '#EF4444' }} />
              <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>{error}</p>
              <button
                onClick={loadInvoices}
                style={{
                  background: '#F15A22',
                  color: '#F0F0F0',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '0 20px',
                  minHeight: 40,
                }}
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '80px 0',
                gap: 10,
              }}
            >
              <FileText size={48} style={{ color: '#2A2A2A' }} />
              <p style={{ fontWeight: 600, color: '#A0A0A0', margin: 0 }}>No invoices found</p>
              <p style={{ fontSize: 13, color: '#4A4A4A', margin: 0 }}>
                {statusFilter !== 'all' || supplierFilter !== 'all' || dateFrom || dateTo
                  ? 'Try adjusting your filters'
                  : 'Create your first supplier invoice to get started'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr style={{ background: '#161616', borderBottom: '1px solid #2A2A2A' }}>
                    {[
                      'Supplier',
                      'Inv #',
                      'Invoice Date',
                      'Due Date',
                      'Total',
                      'Paid',
                      'Balance',
                      'Status',
                      '',
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '12px 16px',
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color: '#A0A0A0',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv, idx) => {
                    const bal = inv.total_amount - inv.amount_paid
                    const overdue = isOverdue(inv.due_date, inv.status)
                    const dueSoon = !overdue && isDueSoon(inv.due_date, inv.status)
                    const dueDateColor = overdue ? '#EF4444' : dueSoon ? '#F15A22' : '#F0F0F0'
                    const isSelected = selectedInvoice?.id === inv.id

                    return (
                      <tr
                        key={inv.id}
                        style={{
                          background: isSelected ? 'rgba(241,90,34,0.06)' : idx % 2 === 0 ? '#0E0E0E' : '#161616',
                          borderBottom: '1px solid #2A2A2A',
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onClick={() => setSelectedInvoice(inv)}
                      >
                        {/* Supplier */}
                        <td style={{ padding: '12px 16px' }}>
                          <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: '#F0F0F0', whiteSpace: 'nowrap' }}>
                            {inv.suppliers?.name ?? '—'}
                          </p>
                          {inv.suppliers?.phone && (
                            <p style={{ fontSize: 11, margin: '2px 0 0', color: '#A0A0A0' }}>{inv.suppliers.phone}</p>
                          )}
                        </td>

                        {/* Inv # */}
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#F15A22' }}>
                            {inv.invoice_number ?? '—'}
                          </span>
                        </td>

                        {/* Invoice Date */}
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 13, color: '#A0A0A0', whiteSpace: 'nowrap' }}>
                            {formatDate(inv.invoice_date)}
                          </span>
                        </td>

                        {/* Due Date */}
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 13, color: dueDateColor, fontWeight: overdue || dueSoon ? 600 : 400, whiteSpace: 'nowrap' }}>
                            {formatDate(inv.due_date)}
                          </span>
                        </td>

                        {/* Total */}
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 13, color: '#F0F0F0', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {formatRM(inv.total_amount)}
                          </span>
                        </td>

                        {/* Paid */}
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 13, color: inv.amount_paid > 0 ? '#22C55E' : '#4A4A4A', whiteSpace: 'nowrap' }}>
                            {formatRM(inv.amount_paid)}
                          </span>
                        </td>

                        {/* Balance */}
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              fontSize: 13,
                              color: bal > 0 ? '#F15A22' : '#22C55E',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatRM(bal)}
                          </span>
                        </td>

                        {/* Status */}
                        <td style={{ padding: '12px 16px' }}>
                          <StatusBadge status={inv.status} />
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '12px 16px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedInvoice(inv)
                            }}
                            style={{
                              background: isSelected ? 'rgba(241,90,34,0.15)' : '#1E1E1E',
                              border: `1px solid ${isSelected ? '#F15A22' : '#2A2A2A'}`,
                              color: isSelected ? '#F15A22' : '#A0A0A0',
                              borderRadius: 8,
                              cursor: 'pointer',
                              padding: '0 10px',
                              minHeight: 34,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="View details"
                          >
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Row count */}
        {!loading && !error && filtered.length > 0 && (
          <p style={{ fontSize: 11, textAlign: 'right', color: '#4A4A4A', margin: '10px 0 0' }}>
            Showing {filtered.length} of {invoices.length} invoices
          </p>
        )}
      </div>

      {/* ── Detail Panel ── */}
      {selectedInvoice && (
        <>
          {/* Backdrop on mobile */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              zIndex: 39,
              display: 'none',
            }}
            onClick={() => setSelectedInvoice(null)}
          />
          <DetailPanel
            invoice={selectedInvoice}
            payments={payments}
            paymentsLoading={paymentsLoading}
            onClose={() => setSelectedInvoice(null)}
            onPaymentSaved={() => loadPayments(selectedInvoice.id)}
            onInvoiceUpdated={handleInvoiceUpdated}
            tenantId={tenantId}
            userId={userId}
          />
        </>
      )}

      {/* ── New Invoice Modal ── */}
      {showNewModal && (
        <NewInvoiceModal
          suppliers={suppliers}
          onClose={() => setShowNewModal(false)}
          onSave={handleNewInvoiceSave}
          saving={newSaving}
        />
      )}
    </>
  )
}
