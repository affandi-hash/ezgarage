import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useInvoicesStore } from '@/hooks/useInvoices'
import { useAuthStore } from '@/store/authStore'
import type { LineItemType } from '@/types/invoice'

interface CompletedJob {
  id: string
  job_number: string
  service_type: string
  customer?: { id: string; full_name: string; phone: string }
  vehicle?: { id: string; plate_number: string; make: string; model: string }
}

interface ManualItem {
  key: string
  description: string
  type: LineItemType
  quantity: number
  unit_price: number
}

interface CreateInvoiceModalProps {
  onClose: () => void
  onSuccess: () => void
}

export function CreateInvoiceModal({ onClose, onSuccess }: CreateInvoiceModalProps) {
  const user = useAuthStore((s) => s.user)
  const { createInvoiceFromJob, addLineItem } = useInvoicesStore()

  const [jobs, setJobs] = useState<CompletedJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [selectedJobId, setSelectedJobId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [manualItems, setManualItems] = useState<ManualItem[]>([
    { key: crypto.randomUUID(), description: '', type: 'service', quantity: 1, unit_price: 0 },
  ])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.branch_id) return
    setLoadingJobs(true)
    supabase
      .from('job_orders')
      .select(`id, job_number, service_type, customer:customers(id, full_name, phone), vehicle:vehicles(id, plate_number, make, model)`)
      .eq('branch_id', user.branch_id)
      .in('status', ['done', 'collected'])
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setJobs((data as unknown as CompletedJob[]) ?? [])
        setLoadingJobs(false)
      })
  }, [user?.branch_id])

  const selectedJob = jobs.find((j) => j.id === selectedJobId)

  const addManualRow = () => {
    setManualItems((prev) => [...prev, { key: crypto.randomUUID(), description: '', type: 'service', quantity: 1, unit_price: 0 }])
  }

  const updateManualRow = (key: string, field: keyof ManualItem, value: string | number | LineItemType) => {
    setManualItems((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    )
  }

  const removeManualRow = (key: string) => {
    setManualItems((prev) => prev.filter((row) => row.key !== key))
  }

  const handleCreate = async () => {
    if (!selectedJobId || !user?.branch_id) {
      setError('Please select a job order.')
      return
    }
    setCreating(true)
    setError(null)

    const { error: createError, invoice } = await createInvoiceFromJob(selectedJobId, user.branch_id)
    if (createError || !invoice) {
      setError(createError ?? 'Failed to create invoice.')
      setCreating(false)
      return
    }

    // Add manual labour items
    const validManual = manualItems.filter((r) => r.description.trim() !== '')
    for (const row of validManual) {
      await addLineItem(invoice.id, {
        description: row.description,
        type: row.type,
        quantity: row.quantity,
        unit_price: row.unit_price,
      })
    }

    setCreating(false)
    onSuccess()
    onClose()
  }

  const manualSubtotal = manualItems.reduce((acc, r) => acc + r.quantity * r.unit_price, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Create Invoice from Job</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Job selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Select Completed Job</label>
            {loadingJobs ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                Loading jobs...
              </div>
            ) : (
              <select
                value={selectedJobId}
                onChange={(e) => setSelectedJobId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
              >
                <option value="">— Select a job order —</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_number} · {j.customer?.full_name ?? '?'} · {j.vehicle?.plate_number ?? '?'} ({j.service_type})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Selected job preview */}
          {selectedJob && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-400">Customer</p>
                <p className="font-medium text-gray-800">{selectedJob.customer?.full_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Vehicle</p>
                <p className="font-medium font-mono text-gray-800">{selectedJob.vehicle?.plate_number ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Make / Model</p>
                <p className="font-medium text-gray-800">
                  {selectedJob.vehicle ? `${selectedJob.vehicle.make} ${selectedJob.vehicle.model}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Service</p>
                <p className="font-medium text-gray-800">{selectedJob.service_type}</p>
              </div>
            </div>
          )}

          {/* Labour / manual items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-600">Labour &amp; Additional Items</p>
              <button
                onClick={addManualRow}
                className="text-xs text-orange-500 hover:text-orange-700 font-medium"
              >
                + Add Row
              </button>
            </div>

            <div className="space-y-2">
              {manualItems.map((row, idx) => (
                <div key={row.key} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-5">
                    {idx === 0 && <p className="text-xs text-gray-400 mb-1">Description</p>}
                    <input
                      type="text"
                      placeholder="e.g. Labour charge"
                      value={row.description}
                      onChange={(e) => updateManualRow(row.key, 'description', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <p className="text-xs text-gray-400 mb-1">Type</p>}
                    <select
                      value={row.type}
                      onChange={(e) => updateManualRow(row.key, 'type', e.target.value as LineItemType)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                    >
                      <option value="service">Service</option>
                      <option value="part">Part</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <p className="text-xs text-gray-400 mb-1">Qty</p>}
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => updateManualRow(row.key, 'quantity', Number(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <p className="text-xs text-gray-400 mb-1">Unit Price</p>}
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={row.unit_price}
                      onChange={(e) => updateManualRow(row.key, 'unit_price', Number(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                  </div>
                  <div className="col-span-1 flex items-end pb-1.5">
                    <button
                      onClick={() => removeManualRow(row.key)}
                      className="text-red-400 hover:text-red-600 text-base leading-none w-full text-center mt-5"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {manualItems.length > 0 && (
              <p className="text-right text-xs text-gray-500 mt-2">
                Labour subtotal: <span className="font-semibold text-gray-700">RM {manualSubtotal.toFixed(2)}</span>
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Notes (optional)</label>
            <textarea
              rows={2}
              placeholder="Any additional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>

          {error && (
            <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !selectedJobId}
            className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}
