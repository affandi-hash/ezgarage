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

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.inputBg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '7px 10px',
  fontSize: 13,
  color: C.text,
  outline: 'none',
  boxSizing: 'border-box',
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

  const [closeHover, setCloseHover] = useState(false)
  const [addRowHover, setAddRowHover] = useState(false)
  const [cancelHover, setCancelHover] = useState(false)
  const [createHover, setCreateHover] = useState(false)

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

    const validManual = manualItems.filter((r) => r.description.trim() !== '')
    for (const row of validManual) {
      await addLineItem(invoice.id, {
        description: row.description,
        item_type: row.type,
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
          maxWidth: 672,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${C.border}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text }}>
            Create Invoice from Job
          </h2>
          <button
            onClick={onClose}
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1,
              color: closeHover ? C.text : C.muted,
              padding: 0,
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {/* Job selector */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 500,
                color: C.muted,
                marginBottom: 6,
              }}
            >
              Select Completed Job
            </label>
            {loadingJobs ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted }}>
                <div
                  style={{
                    width: 16,
                    height: 16,
                    border: `2px solid ${C.orange}`,
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                  }}
                />
                Loading jobs...
              </div>
            ) : (
              <select
                value={selectedJobId}
                onChange={(e) => setSelectedJobId(e.target.value)}
                style={{
                  ...inputStyle,
                  borderRadius: 12,
                  padding: '10px 12px',
                }}
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
            <div
              style={{
                background: C.bg,
                borderRadius: 12,
                padding: 16,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                border: `1px solid ${C.border}`,
              }}
            >
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Customer</p>
                <p style={{ margin: 0, fontWeight: 500, color: C.text, fontSize: 13 }}>{selectedJob.customer?.full_name ?? '—'}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Vehicle</p>
                <p style={{ margin: 0, fontWeight: 500, color: C.text, fontSize: 13, fontFamily: 'monospace' }}>{selectedJob.vehicle?.plate_number ?? '—'}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Make / Model</p>
                <p style={{ margin: 0, fontWeight: 500, color: C.text, fontSize: 13 }}>
                  {selectedJob.vehicle ? `${selectedJob.vehicle.make} ${selectedJob.vehicle.model}` : '—'}
                </p>
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 11, color: C.muted }}>Service</p>
                <p style={{ margin: 0, fontWeight: 500, color: C.text, fontSize: 13 }}>{selectedJob.service_type}</p>
              </div>
            </div>
          )}

          {/* Labour / manual items */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <p style={{ margin: 0, fontSize: 11, fontWeight: 500, color: C.muted }}>
                Labour &amp; Additional Items
              </p>
              <button
                onClick={addManualRow}
                onMouseEnter={() => setAddRowHover(true)}
                onMouseLeave={() => setAddRowHover(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  color: addRowHover ? C.orangeHover : C.orange,
                  padding: 0,
                }}
              >
                + Add Row
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {manualItems.map((row, idx) => (
                <div
                  key={row.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '5fr 2fr 2fr 2fr 1fr',
                    gap: 8,
                    alignItems: 'start',
                  }}
                >
                  <div>
                    {idx === 0 && (
                      <p style={{ margin: '0 0 4px', fontSize: 11, color: C.muted }}>Description</p>
                    )}
                    <input
                      type="text"
                      placeholder="e.g. Labour charge"
                      value={row.description}
                      onChange={(e) => updateManualRow(row.key, 'description', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    {idx === 0 && (
                      <p style={{ margin: '0 0 4px', fontSize: 11, color: C.muted }}>Type</p>
                    )}
                    <select
                      value={row.type}
                      onChange={(e) => updateManualRow(row.key, 'type', e.target.value as LineItemType)}
                      style={inputStyle}
                    >
                      <option value="service">Service</option>
                      <option value="part">Part</option>
                    </select>
                  </div>
                  <div>
                    {idx === 0 && (
                      <p style={{ margin: '0 0 4px', fontSize: 11, color: C.muted }}>Qty</p>
                    )}
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => updateManualRow(row.key, 'quantity', Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    {idx === 0 && (
                      <p style={{ margin: '0 0 4px', fontSize: 11, color: C.muted }}>Unit Price</p>
                    )}
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={row.unit_price}
                      onChange={(e) => updateManualRow(row.key, 'unit_price', Number(e.target.value))}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                    <RemoveRowButton onClick={() => removeManualRow(row.key)} hasLabel={idx === 0} />
                  </div>
                </div>
              ))}
            </div>

            {manualItems.length > 0 && (
              <p style={{ margin: '8px 0 0', textAlign: 'right', fontSize: 11, color: C.muted }}>
                Labour subtotal:{' '}
                <span style={{ fontWeight: 600, color: C.text }}>RM {manualSubtotal.toFixed(2)}</span>
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 500,
                color: C.muted,
                marginBottom: 6,
              }}
            >
              Notes (optional)
            </label>
            <textarea
              rows={2}
              placeholder="Any additional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                ...inputStyle,
                borderRadius: 12,
                padding: '8px 12px',
                resize: 'none',
              }}
            />
          </div>

          {error && (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: '#f87171',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8,
                padding: '8px 12px',
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '16px 24px',
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <button
            onClick={onClose}
            onMouseEnter={() => setCancelHover(true)}
            onMouseLeave={() => setCancelHover(false)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              fontSize: 13,
              color: cancelHover ? C.text : C.muted,
              background: cancelHover ? C.bg : 'transparent',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !selectedJobId}
            onMouseEnter={() => setCreateHover(true)}
            onMouseLeave={() => setCreateHover(false)}
            style={{
              flex: 1,
              padding: '10px 0',
              background: creating || !selectedJobId ? C.orange : createHover ? C.orangeHover : C.orange,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              cursor: creating || !selectedJobId ? 'not-allowed' : 'pointer',
              opacity: creating || !selectedJobId ? 0.5 : 1,
            }}
          >
            {creating ? 'Creating...' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RemoveRowButton({ onClick, hasLabel }: { onClick: () => void; hasLabel: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 16,
        lineHeight: 1,
        color: hover ? '#f87171' : '#f87171aa',
        width: '100%',
        textAlign: 'center',
        marginTop: hasLabel ? 20 : 0,
        padding: 0,
      }}
    >
      &times;
    </button>
  )
}
