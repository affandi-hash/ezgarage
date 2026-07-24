import { useState, useEffect } from 'react'
import { ShieldCheck, Loader2, Paperclip, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'

const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }
const inputStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0',
  borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#A0A0A0' }

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

interface Submission {
  id: string
  invoice_id: string
  storage_path: string
  claimed_amount: number | null
  claimed_reference: string | null
  created_at: string
  invoices: {
    id: string
    invoice_number: string
    customer_name: string
    vehicle_plate: string
    total_amount: number
    amount_paid: number
    balance_due: number
  } | null
}

function ApproveModal({ submission, onClose, onDone }: { submission: Submission; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(true)
  const [currentBalance, setCurrentBalance] = useState(0)
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState('bank_transfer')
  const [date, setDate] = useState(todayStr())
  const [reference, setReference] = useState(submission.claimed_reference ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('invoices').select('total_amount, amount_paid').eq('id', submission.invoice_id).single().then(({ data }) => {
      const balance = data ? Number(data.total_amount) - Number(data.amount_paid) : 0
      setCurrentBalance(balance)
      const claimed = submission.claimed_amount != null ? Number(submission.claimed_amount) : balance
      setAmount(Math.max(0, Math.min(claimed, balance)))
      setLoading(false)
    })
  }, [submission.invoice_id])

  async function submit() {
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    setSaving(true)
    const { data: result, error } = await supabase.rpc('approve_payment_proof_submission', {
      p_submission_id: submission.id,
      p_amount: amount,
      p_payment_method: method,
      p_payment_date: date,
      p_reference: reference || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    if (result?.error) {
      const messages: Record<string, string> = {
        forbidden: 'You do not have permission to approve this payment',
        submission_not_found: 'Submission not found',
        already_reviewed: 'This submission has already been reviewed',
        invalid_amount: 'Enter a valid amount',
        amount_exceeds_balance: 'Amount exceeds the remaining balance',
      }
      toast.error(messages[result.error] ?? 'Failed to approve payment')
      return
    }
    toast.success('Payment approved')
    onDone()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, width: '100%', maxWidth: 420 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Confirm Payment -- {submission.invoices?.invoice_number}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}><Loader2 className="animate-spin" size={20} color="#666" /></div>
        ) : currentBalance <= 0 ? (
          <div style={{ padding: 20 }}>
            <div style={{ fontSize: 13, color: '#EF4444', marginBottom: 12 }}>This invoice is already fully paid -- reject this submission instead.</div>
            <button onClick={onClose} style={{ padding: '10px', borderRadius: 8, border: '1px solid #2A2A2A', background: 'transparent', color: '#A0A0A0', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%' }}>Close</button>
          </div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 12, color: '#6B7280' }}>Current balance due: <strong style={{ color: '#F0F0F0' }}>RM {currentBalance.toFixed(2)}</strong></div>
            <div>
              <label style={labelStyle}>Amount</label>
              <input style={inputStyle} type="number" min={0} step={0.01} value={amount} onChange={e => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <label style={labelStyle}>Payment Method</label>
              <select style={inputStyle} value={method} onChange={e => setMethod(e.target.value)}>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="qr">QR</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Payment Date</label>
              <input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Reference</label>
              <input style={inputStyle} value={reference} onChange={e => setReference(e.target.value)} />
            </div>
            <button onClick={submit} disabled={saving} style={{ padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Approving…' : 'Approve Payment'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function PaymentVerificationsPage() {
  const { user } = useAuthStore()
  const [rows, setRows] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [approvingRow, setApprovingRow] = useState<Submission | null>(null)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    supabase
      .from('payment_proof_submissions')
      .select('id, invoice_id, storage_path, claimed_amount, claimed_reference, created_at, invoices!invoice_id(id, invoice_number, customer_name, vehicle_plate, total_amount, amount_paid, balance_due)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setRows((data ?? []) as unknown as Submission[])
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [user?.tenant_id])

  async function handleViewProof(storagePath: string, id: string) {
    setViewingId(id)
    const { data, error } = await supabase.storage.from('portal-uploads').createSignedUrl(storagePath, 3600)
    setViewingId(null)
    if (error || !data?.signedUrl) { toast.error('Failed to open proof of payment'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleReject(row: Submission) {
    const reason = window.prompt('Reason for rejecting this proof:')
    if (reason === null) return
    const { error } = await supabase.from('payment_proof_submissions').update({
      status: 'rejected', rejection_reason: reason || null, reviewed_by: user?.id, reviewed_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) { toast.error(error.message); return }
    toast.success('Submission rejected')
    load()
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0' }}>Payment Verifications</h1>

      <div style={cardStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={16} color="#F15A22" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Customer-Uploaded Proof of Payment -- Pending Review</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666' }}><Loader2 className="animate-spin" size={20} /></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>Nothing pending review.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Invoice', 'Customer', 'Vehicle', 'Claimed Amount', 'Reference', 'Submitted', 'Proof', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{r.invoices?.invoice_number ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0' }}>{r.invoices?.customer_name ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontFamily: 'monospace' }}>{r.invoices?.vehicle_plate ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0' }}>{r.claimed_amount != null ? `RM ${Number(r.claimed_amount).toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{r.claimed_reference ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={() => handleViewProof(r.storage_path, r.id)} disabled={viewingId === r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, color: '#F15A22', cursor: 'pointer', fontSize: 12 }}>
                        {viewingId === r.id ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />} View
                      </button>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setApprovingRow(r)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#22C55E', cursor: 'pointer' }}>Approve</button>
                        <button onClick={() => handleReject(r)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#EF4444', cursor: 'pointer' }}>Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {approvingRow && (
        <ApproveModal submission={approvingRow} onClose={() => setApprovingRow(null)} onDone={() => { setApprovingRow(null); load() }} />
      )}
    </div>
  )
}
