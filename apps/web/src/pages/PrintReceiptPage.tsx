import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

interface Invoice {
  id: string
  branch_id: string
  invoice_number: string
  customer_name: string
  vehicle_plate: string
  issue_date: string
  payment_date: string
  status: string
  subtotal: number
  discount_amount: number
  total_amount: number
  amount_paid: number
  payment_method: string
  payment_reference: string
}

interface BranchInfo {
  name: string
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
}

function formatDate(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function PrintReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [branchInfo, setBranchInfo] = useState<BranchInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    supabase.from('invoices').select('*').eq('id', id).single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Invoice not found'); return }
        setInvoice(data as Invoice)
      })
  }, [id])

  useEffect(() => {
    const branchId = invoice?.branch_id ?? user?.branch_id
    if (!branchId) return
    supabase.from('branches').select('name,address,phone,email,logo_url')
      .eq('id', branchId).single()
      .then(({ data }) => { if (data) setBranchInfo(data as BranchInfo) })
  }, [invoice?.branch_id, user?.branch_id])

  useEffect(() => {
    if (invoice && branchInfo !== undefined) {
      document.title = `Receipt ${invoice.invoice_number}`
      setTimeout(() => window.print(), 500)
    }
  }, [invoice, branchInfo])

  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#c0392b' }}>{error}</div>
  if (!invoice) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</div>

  const inv = invoice

  return (
    <>
      <style>{`
        @media print { .no-print { display: none !important } body { margin: 0 } }
        @page { size: A5; margin: 12mm }
        * { box-sizing: border-box }
      `}</style>

      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
        <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Receipt — {inv.invoice_number}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => window.close()} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
          <button onClick={() => window.print()} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Print / Save PDF</button>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '24px auto', padding: '28px 32px', background: '#fff', fontFamily: "'Tw Cen MT', 'Century Gothic', sans-serif", color: '#111', fontSize: 12 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #F15A22', paddingBottom: 12, marginBottom: 14 }}>
          {branchInfo?.logo_url && (
            <img src={branchInfo.logo_url} alt="Logo" style={{ height: 56, objectFit: 'contain', marginBottom: 6 }} />
          )}
          <div style={{ fontSize: 20, fontWeight: 700, color: '#F15A22', letterSpacing: 1, fontFamily: "'Cocogoose', sans-serif", textTransform: 'uppercase' }}>{branchInfo?.name ?? 'MOTOVERSE GARAGE'}</div>
          {branchInfo?.address && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{branchInfo.address}</div>}
          {(branchInfo?.phone || branchInfo?.email) && (
            <div style={{ fontSize: 11, color: '#666' }}>
              {[branchInfo?.phone && `Tel: ${branchInfo.phone}`, branchInfo?.email].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 900, letterSpacing: 4, color: '#111' }}>RECEIPT</div>
        </div>

        {/* Receipt meta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 14, fontSize: 12 }}>
          <div><span style={{ color: '#888' }}>Receipt No:</span> <strong style={{ fontFamily: 'monospace' }}>{inv.invoice_number}</strong></div>
          <div style={{ textAlign: 'right' }}><span style={{ color: '#888' }}>Date:</span> <strong>{inv.payment_date ? new Date(inv.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : formatDate(inv.issue_date)}</strong></div>
          <div><span style={{ color: '#888' }}>Customer:</span> <strong>{inv.customer_name}</strong></div>
          <div style={{ textAlign: 'right' }}><span style={{ color: '#888' }}>Vehicle:</span> <strong style={{ fontFamily: 'monospace' }}>{inv.vehicle_plate}</strong></div>
        </div>

        {/* Payment summary */}
        <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ background: '#F15A22', color: '#fff', padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Payment Summary</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '8px 14px', fontSize: 12, color: '#555' }}>Invoice Reference</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{inv.invoice_number}</td>
              </tr>
              {(inv.discount_amount ?? 0) > 0 && (
                <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: '#555' }}>Subtotal</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12 }}>RM {(inv.subtotal ?? 0).toFixed(2)}</td>
                </tr>
              )}
              {(inv.discount_amount ?? 0) > 0 && (
                <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: '#555' }}>Discount</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12, color: '#e05' }}>- RM {(inv.discount_amount ?? 0).toFixed(2)}</td>
                </tr>
              )}
              <tr style={{ background: '#fafafa' }}>
                <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800 }}>Total Amount</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 15, fontWeight: 800 }}>RM {(inv.total_amount ?? 0).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Payment confirmation box */}
        <div style={{ border: '2px solid #1a7b4b', borderRadius: 8, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0fff6', position: 'relative' }}>
          <div>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>Payment Received</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>RM {(inv.amount_paid ?? 0).toFixed(2)}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
              {inv.payment_method ? inv.payment_method.replace('_', ' ').toUpperCase() : 'CASH'}
              {inv.payment_reference ? ` · Ref: ${inv.payment_reference}` : ''}
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#1a7b4b', border: '3px solid #1a7b4b', borderRadius: 6, padding: '4px 14px', letterSpacing: 3, transform: 'rotate(-8deg)', opacity: 0.85 }}>
            PAID
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', borderTop: '1px solid #eee', paddingTop: 8, marginBottom: 6 }}>
          Thank you for your payment! Please keep this receipt for your records.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#ccc' }}>Powered by:</span>
          <span style={{ fontSize: 11, color: '#bbb', fontWeight: 600 }}>EZ Garage</span>
          <span style={{ fontSize: 11, color: '#ccc' }}>·</span>
          <span style={{ fontSize: 11, color: '#bbb' }}>http://ezgarage.app</span>
        </div>
      </div>
    </>
  )
}
