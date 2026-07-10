import { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Search, CheckCircle, Clock, Wrench, Car, Loader2, AlertCircle,
  FileText, Upload, ThumbsUp, MessageCircle, ChevronDown, ChevronUp, X,
  CreditCard, QrCode, Landmark,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

const RAUDHAHPAY_CREATE_PAYMENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/raudhahpay-create-payment`

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  surface2: '#1C1C1C',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
  green: '#22C55E',
  blue: '#3B82F6',
  red: '#EF4444',
}

interface PortalJob {
  id: string
  job_number: string
  service_type: string
  status: string
  complaint: string | null
  diagnosis: string | null
  next_action: string | null
  checked_in_at: string
  estimated_cost: number | null
  final_amount: number | null
  estimate_approved_at: string | null
  estimate_approved_by: string | null
  created_at: string
  invoice_id: string | null
  invoice_number: string | null
  inv_subtotal: number | null
  inv_tax: number | null
  inv_total: number | null
  inv_paid: number | null
  inv_status: string | null
  inv_lines: Array<{ description: string; qty: number; unit_price: number; total: number }> | null
}

interface PortalResult {
  vehicle: { id: string; plate_number: string; make: string; model: string; year: number }
  customer: { full_name: string; phone: string }
  jobs: PortalJob[]
}

const STATUS_LABELS: Record<string, string> = {
  checked_in: 'Checked In',
  diagnosing: 'Diagnosing',
  waiting_parts: 'Waiting for Parts',
  in_progress: 'In Progress',
  quality_check: 'Quality Check',
  ready: 'Ready for Collection',
  completed: 'Completed',
  collected: 'Collected',
  cancelled: 'Cancelled',
}

const STATUS_COLORS: Record<string, string> = {
  checked_in: '#3B82F6',
  diagnosing: '#8B5CF6',
  waiting_parts: '#EAB308',
  in_progress: C.orange,
  quality_check: '#06B6D4',
  ready: '#22C55E',
  completed: '#6B7280',
  collected: '#6B7280',
  cancelled: C.red,
}

const STATUS_ORDER = ['checked_in', 'diagnosing', 'waiting_parts', 'in_progress', 'quality_check', 'ready', 'completed']

function formatDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatRM(v: number | null) {
  if (v == null) return 'TBD'
  return `RM ${v.toFixed(2)}`
}

function StatusTimeline({ currentStatus }: { currentStatus: string }) {
  const idx = STATUS_ORDER.indexOf(currentStatus)
  if (currentStatus === 'cancelled') return null
  return (
    <div style={{ marginTop: 20, marginBottom: 8, overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 480 }}>
        {STATUS_ORDER.map((s, i) => {
          const done = i <= idx
          const active = s === currentStatus
          const color = active ? (STATUS_COLORS[s] || C.orange) : done ? C.green : C.border
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: done ? color : 'transparent',
                  border: `2px solid ${color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {done && <CheckCircle size={11} color="#fff" />}
                </div>
                <span style={{ fontSize: 9, color: active ? color : C.textSecondary, textAlign: 'center', width: 60, lineHeight: 1.2, fontWeight: active ? 700 : 400 }}>
                  {STATUS_LABELS[s]}
                </span>
              </div>
              {i < STATUS_ORDER.length - 1 && (
                <div style={{ flex: 1, height: 2, background: (done && i < idx) ? C.green : C.border, marginBottom: 22 }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Invoice Modal ─────────────────────────────────────────────────────────────

function InvoiceModal({ job, onClose }: { job: PortalJob; onClose: () => void }) {
  const lines = job.inv_lines ?? []
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ padding: '18px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{job.invoice_number ?? 'Invoice'}</div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>Job: {job.job_number}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSecondary, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {lines.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Description', 'Qty', 'Unit Price', 'Total'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: h === 'Description' ? 'left' : 'right', color: C.textSecondary, fontWeight: 500, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.surface2}` }}>
                    <td style={{ padding: '8px 8px', color: C.textPrimary }}>{ln.description}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.textSecondary }}>{ln.qty}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.textSecondary }}>{formatRM(ln.unit_price)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', color: C.textPrimary, fontWeight: 600 }}>{formatRM(ln.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: C.textSecondary, fontSize: 13, textAlign: 'center', padding: 20 }}>No line items found.</div>
          )}

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Subtotal', value: formatRM(job.inv_subtotal) },
              { label: 'Tax (SST)', value: formatRM(job.inv_tax) },
              { label: 'Total', value: formatRM(job.inv_total), bold: true },
              { label: 'Amount Paid', value: formatRM(job.inv_paid), color: C.green },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: C.textSecondary }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: r.bold ? 700 : 500, color: r.color ?? C.textPrimary }}>{r.value}</span>
              </div>
            ))}
            {job.inv_total != null && job.inv_paid != null && job.inv_total > job.inv_paid && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>Balance Due</span>
                <span style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>{formatRM(job.inv_total - job.inv_paid)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Payment Upload ────────────────────────────────────────────────────────────

function PaymentUpload({ jobId, jobNumber }: { jobId: string; jobNumber: string }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const upload = async () => {
    if (!file) return
    setUploading(true); setErr('')
    const ext = file.name.split('.').pop()
    const path = `${jobId}/payment_proof_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('portal-uploads').upload(path, file, { upsert: false })
    if (error) { setErr(error.message); setUploading(false); return }
    setDone(true); setUploading(false)
  }

  if (done) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: '#0D1F0D', border: `1px solid ${C.green}44`, fontSize: 13, color: C.green }}>
        <CheckCircle size={15} /> Payment proof uploaded successfully. Our team will verify shortly.
      </div>
    )
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.1)', border: `1px solid rgba(59,130,246,0.3)`, color: C.blue, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          <Upload size={14} /> Upload Payment Proof
        </button>
      ) : (
        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Upload Payment Proof — {jobNumber}</div>
          <div
            onClick={() => ref.current?.click()}
            style={{
              border: `2px dashed ${file ? C.green : C.border}`, borderRadius: 8,
              padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
              background: file ? '#0D1F0D' : 'transparent',
            }}
          >
            <input ref={ref} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <div style={{ fontSize: 13, color: C.green }}>{file.name} ({(file.size / 1024).toFixed(0)} KB)</div>
            ) : (
              <div style={{ color: C.textSecondary, fontSize: 13 }}>Tap to choose image or PDF</div>
            )}
          </div>
          {err && <div style={{ fontSize: 12, color: C.red }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={upload}
              disabled={!file || uploading}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: C.blue, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (!file || uploading) ? 'not-allowed' : 'pointer', opacity: (!file || uploading) ? 0.6 : 1 }}
            >
              {uploading ? 'Uploading…' : 'Send to Workshop'}
            </button>
            <button onClick={() => { setOpen(false); setFile(null) }} style={{ padding: '9px 14px', borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, color: C.textSecondary, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Pay Online ────────────────────────────────────────────────────────────────

// FPX is temporarily disabled — RaudhahPay confirmed bugs on their side
// with the FPX/MEPS handoff (transactions never reach the bank's login
// page). Flip back to true once they've fixed it.
const FPX_ENABLED = false

// Credit/debit card isn't live yet either — RaudhahPay's own API rejects
// it with "This merchant does not have credit_card configured", meaning
// it needs to be provisioned on their side for this merchant account
// first. Flip to true once that's done and a real test succeeds.
const CARD_ENABLED = false

function PayOnlineSection({ invoiceId, balanceDue }: { invoiceId: string; balanceDue: number }) {
  const [loading, setLoading] = useState<'fpx' | 'duitnow' | 'credit_card' | null>(null)
  const [error, setError] = useState('')

  async function startPayment(method: 'fpx' | 'duitnow' | 'credit_card') {
    setLoading(method); setError('')
    try {
      const res = await fetch(RAUDHAHPAY_CREATE_PAYMENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ invoice_id: invoiceId, payment_method: method, redirect_url: window.location.href }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to start payment. Please try again.'); setLoading(null); return }

      // RaudhahPay's hosted checkout page renders the FPX bank list or DuitNow
      // QR itself based on the payment_method the bill was created with —
      // there's no separate inline QR asset for us to render.
      window.location.href = data.payment_url
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(null)
    }
  }

  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Pay Online</div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>Balance due: <strong style={{ color: C.orange }}>{formatRM(balanceDue)}</strong></div>
      </div>

      {error && <div style={{ fontSize: 12, color: C.red }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FPX_ENABLED ? (
          <button
            onClick={() => startPayment('fpx')}
            disabled={loading !== null}
            style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading && loading !== 'fpx' ? 0.6 : 1 }}
          >
            {loading === 'fpx' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Landmark size={14} />}
            Pay via FPX
          </button>
        ) : (
          <div
            title="FPX is temporarily unavailable — please use QR or Card instead."
            style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textSecondary, fontSize: 13, fontWeight: 700, opacity: 0.5, cursor: 'not-allowed' }}
          >
            <Landmark size={14} />
            FPX Unavailable
          </div>
        )}
        <button
          onClick={() => startPayment('duitnow')}
          disabled={loading !== null}
          style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading && loading !== 'duitnow' ? 0.6 : 1 }}
        >
          {loading === 'duitnow' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <QrCode size={14} />}
          Pay via QR
        </button>
        {CARD_ENABLED ? (
          <button
            onClick={() => startPayment('credit_card')}
            disabled={loading !== null}
            style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textPrimary, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading && loading !== 'credit_card' ? 0.6 : 1 }}
          >
            {loading === 'credit_card' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CreditCard size={14} />}
            Debit/Credit Card
          </button>
        ) : (
          <div
            title="Card payments are coming soon."
            style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textSecondary, fontSize: 13, fontWeight: 700, opacity: 0.5, cursor: 'not-allowed' }}
          >
            <CreditCard size={14} />
            Card (Coming Soon)
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Job Card ─────────────────────────────────────────────────────────────────

function JobCard({ job, plate, phone, icFirst6, tenantSlug }: { job: PortalJob; plate: string; phone: string; icFirst6: string; tenantSlug?: string }) {
  const [expanded, setExpanded] = useState(true)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveErr, setApproveErr] = useState('')
  const [approved, setApproved] = useState(!!job.estimate_approved_at)

  const statusColor = STATUS_COLORS[job.status] || C.textSecondary
  const statusLabel = STATUS_LABELS[job.status] || job.status

  const canApproveEstimate = job.estimated_cost != null && !approved &&
    ['diagnosing', 'waiting_parts'].includes(job.status)

  const hasInvoice = !!job.invoice_id
  const balanceDue = job.inv_total != null && job.inv_paid != null ? job.inv_total - job.inv_paid : 0
  const showPaymentUpload = ['ready', 'completed', 'collected'].includes(job.status) && hasInvoice
  const showPayOnline = showPaymentUpload && balanceDue > 0

  const doApprove = async () => {
    setApproving(true); setApproveErr('')
    const { data, error } = await supabase.rpc('portal_approve_estimate', {
      p_job_id: job.id,
      p_plate: plate,
      p_phone: phone,
      p_ic_first6: icFirst6,
      p_tenant_slug: tenantSlug || null,
    })
    setApproving(false)
    if (error || data?.error) { setApproveErr(data?.error ?? error?.message ?? 'Failed'); return }
    setApproved(true)
  }

  return (
    <>
      {invoiceOpen && <InvoiceModal job={job} onClose={() => setInvoiceOpen(false)} />}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {/* Header */}
        <div
          onClick={() => setExpanded(v => !v)}
          style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.orange }}>{job.job_number}</div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{job.service_type} · {formatDate(job.checked_in_at || job.created_at)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ padding: '3px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: statusColor + '22', color: statusColor, border: `1px solid ${statusColor}44`, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
              {statusLabel}
            </span>
            {expanded ? <ChevronUp size={16} color={C.textSecondary} /> : <ChevronDown size={16} color={C.textSecondary} />}
          </div>
        </div>

        {/* Body */}
        {expanded && (
          <div style={{ borderTop: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <StatusTimeline currentStatus={job.status} />

            {/* Details grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {job.complaint && (
                <div>
                  <div style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Your Complaint</div>
                  <div style={{ fontSize: 13, color: C.textPrimary }}>{job.complaint}</div>
                </div>
              )}
              {job.diagnosis && (
                <div>
                  <div style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Diagnosis</div>
                  <div style={{ fontSize: 13, color: C.textPrimary }}>{job.diagnosis}</div>
                </div>
              )}
              {job.next_action && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Next Action</div>
                  <div style={{ fontSize: 13, color: C.blue }}>{job.next_action}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Estimated Cost</div>
                <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>
                  {job.estimated_cost != null ? formatRM(job.estimated_cost) : 'TBD'}
                </div>
              </div>
              {job.final_amount != null && (
                <div>
                  <div style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Final Amount</div>
                  <div style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{formatRM(job.final_amount)}</div>
                </div>
              )}
            </div>

            {/* Estimate Approval */}
            {canApproveEstimate && (
              <div style={{ background: 'rgba(241,90,34,0.07)', border: `1px solid rgba(241,90,34,0.25)`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>Estimate Approval Required</div>
                <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12 }}>
                  The workshop has estimated <strong style={{ color: C.orange }}>{formatRM(job.estimated_cost)}</strong> for this job. Please approve to proceed.
                </div>
                {approveErr && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{approveErr}</div>}
                <button
                  onClick={doApprove}
                  disabled={approving}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: approving ? 'not-allowed' : 'pointer', opacity: approving ? 0.7 : 1 }}
                >
                  <ThumbsUp size={14} /> {approving ? 'Approving…' : 'Approve Estimate'}
                </button>
              </div>
            )}

            {approved && job.estimated_cost != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: '#0D1F0D', border: `1px solid ${C.green}44`, fontSize: 13, color: C.green }}>
                <CheckCircle size={14} /> Estimate approved. Workshop will proceed with the repair.
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {hasInvoice && (
                <button
                  onClick={() => setInvoiceOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 8, background: 'rgba(241,90,34,0.1)', border: `1px solid rgba(241,90,34,0.3)`, color: C.orange, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  <FileText size={14} /> View Invoice
                </button>
              )}
            </div>

            {showPayOnline && (
              <PayOnlineSection invoiceId={job.invoice_id!} balanceDue={balanceDue} />
            )}

            {showPaymentUpload && (
              <PaymentUpload jobId={job.id} jobNumber={job.job_number} />
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function CustomerPortalPage() {
  const { tenantSlug } = useParams()
  const [plate, setPlate] = useState('')
  const [phone, setPhone] = useState('')
  const [icFirst6, setIcFirst6] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PortalResult | null>(null)
  const [searched, setSearched] = useState(false)
  const [tenantName, setTenantName] = useState('Our Workshop')
  const [logoUrl, setLogoUrl] = useState('')
  const [whatsappNumber, setWhatsappNumber] = useState('')

  useEffect(() => {
    supabase.rpc('get_portal_config', { p_tenant_slug: tenantSlug || null }).then(({ data }) => {
      if (data?.name) setTenantName(data.name)
      if (data?.logo_url) setLogoUrl(data.logo_url)
      if (data?.whatsapp_number) setWhatsappNumber(data.whatsapp_number.replace(/\D/g, ''))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug])

  // Restore the session after returning from an external payment (FPX
  // requires leaving the app entirely). Everything needed lives in
  // sessionStorage, not the URL — RaudhahPay's own redirect back to us
  // appends its own callback query params onto whatever redirect_url we
  // gave it, and has been observed doing so by blindly concatenating a
  // second "?" instead of "&" (e.g. "...?plate=ABC?amount=2.00&bill_id=...").
  // That corrupts anything read from window.location.search — including a
  // plate param — since everything after the first "?" until the next "&"
  // becomes part of that field's value. Keeping the redirect_url itself
  // free of any query string and restoring purely from sessionStorage
  // makes us immune to that regardless of what RaudhahPay appends.
  useEffect(() => {
    const cached = sessionStorage.getItem('portal_session')
    if (cached) {
      try {
        const { plate: p, phone: ph, icFirst6: ic } = JSON.parse(cached)
        if (p && ph && ic) {
          setPlate(p)
          setPhone(ph)
          setIcFirst6(ic)
          runSearch(p, ph, ic)
        }
      } catch { /* ignore malformed cache */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runSearch(p: string, ph: string, ic: string) {
    setError('')
    setLoading(true)
    setResult(null)
    setSearched(false)

    const { data, error: rpcErr } = await supabase.rpc('portal_lookup', {
      p_plate: p,
      p_phone: ph,
      p_ic_first6: ic,
      p_tenant_slug: tenantSlug || null,
    })

    setLoading(false)
    setSearched(true)

    if (rpcErr) { setError('Something went wrong. Please try again.'); return }

    if (data?.error) {
      const msgs: Record<string, string> = {
        vehicle_not_found: 'Vehicle not found. Please check your plate number.',
        customer_not_found: 'No customer record found for this vehicle.',
        phone_mismatch: 'Phone number does not match records for this vehicle. Please verify and try again.',
        ic_not_on_file: "We don't have an IC number on file for this vehicle yet. Please contact the workshop so our team can add it to your record.",
        ic_mismatch: 'IC number does not match records for this vehicle. Please verify and try again.',
        tenant_not_found: 'This workshop link is invalid or no longer active.',
      }
      setError(msgs[data.error] ?? 'Lookup failed. Please contact the workshop.')
      return
    }

    setResult(data as PortalResult)
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!plate.trim() || !phone.trim() || icFirst6.length !== 6) return
    const p = plate.trim()
    const ph = phone.trim()
    const ic = icFirst6.trim()
    sessionStorage.setItem('portal_session', JSON.stringify({ plate: p, phone: ph, icFirst6: ic }))
    await runSearch(p, ph, ic)
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {logoUrl ? (
            <img src={logoUrl} alt={tenantName} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'contain', background: '#fff' }} />
          ) : (
            <div style={{ width: 34, height: 34, background: C.orange, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wrench size={17} color="#fff" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.textPrimary, letterSpacing: -0.3 }}>{tenantName}</div>
            <div style={{ fontSize: 11, color: C.textSecondary }}>Customer Service Portal</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 80px' }}>
        {/* Search form */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28, marginBottom: 28 }}>
          <div style={{ marginBottom: 22 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: '0 0 6px' }}>Track Your Vehicle Service</h1>
            <p style={{ color: C.textSecondary, fontSize: 13, margin: 0 }}>Enter your vehicle plate number, phone number, and the first 6 digits of your IC.</p>
          </div>
          <form onSubmit={handleSearch}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Plate Number</label>
                <input
                  value={plate}
                  onChange={e => setPlate(e.target.value.toUpperCase())}
                  placeholder="e.g. WXY 1234"
                  style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPrimary, padding: '10px 14px', fontSize: 15, letterSpacing: 2, boxSizing: 'border-box', outline: 'none' }}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Phone Number</label>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="e.g. 012-3456789"
                  style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPrimary, padding: '10px 14px', fontSize: 15, boxSizing: 'border-box', outline: 'none' }}
                  required
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 11, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>First 6 Digits of IC</label>
                <input
                  value={icFirst6}
                  onChange={e => setIcFirst6(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="e.g. 900101"
                  maxLength={6}
                  style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPrimary, padding: '10px 14px', fontSize: 16, letterSpacing: 4, boxSizing: 'border-box', outline: 'none' }}
                  required
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%', background: C.orange, border: 'none', borderRadius: 8, color: '#fff', padding: '12px 0', cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={15} />}
              {loading ? 'Searching…' : 'Check Status'}
            </button>
          </form>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#1C1010', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={15} color={C.red} />
            <span style={{ color: C.red, fontSize: 13 }}>{error}</span>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Vehicle + customer header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Car size={18} color={C.orange} />
                <div>
                  <span style={{ fontSize: 18, fontWeight: 800, color: C.orange, letterSpacing: 1 }}>{result.vehicle.plate_number}</span>
                  <span style={{ color: C.textSecondary, marginLeft: 10, fontSize: 13 }}>{result.vehicle.year} {result.vehicle.make} {result.vehicle.model}</span>
                </div>
              </div>
              <span style={{ fontSize: 13, color: C.textSecondary }}>Hi, <strong style={{ color: C.textPrimary }}>{result.customer.full_name}</strong></span>
            </div>

            {/* Jobs */}
            {result.jobs.length === 0 ? (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 40, textAlign: 'center', color: C.textSecondary }}>
                <Clock size={30} style={{ marginBottom: 10, opacity: 0.4 }} />
                <div style={{ fontSize: 14 }}>No service records found for this vehicle.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {result.jobs.map(job => (
                  <JobCard key={job.id} job={job} plate={plate} phone={phone} icFirst6={icFirst6} tenantSlug={tenantSlug} />
                ))}
              </div>
            )}

            {/* WhatsApp contact */}
            <div style={{ marginTop: 28, textAlign: 'center' }}>
              <a
                href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi, I'm checking on my vehicle ${result.vehicle.plate_number}.`)}`}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 999, background: '#25D36622', border: '1px solid #25D36644', color: '#25D366', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
              >
                <MessageCircle size={16} /> Chat with Workshop on WhatsApp
              </a>
            </div>
          </>
        )}

        {searched && !result && !error && !loading && (
          <div style={{ textAlign: 'center', color: C.textSecondary, fontSize: 13, padding: 32 }}>No records found.</div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
