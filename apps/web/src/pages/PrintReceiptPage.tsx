import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { ReceiptSheet } from '@/components/receipts/ReceiptSheet'

interface Invoice {
  id: string
  branch_id: string
  invoice_number: string
  receipt_number: string | null
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
      document.title = `Receipt ${invoice.receipt_number ?? invoice.invoice_number}`
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
        <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Receipt — {inv.receipt_number ?? inv.invoice_number}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => window.close()} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
          <button onClick={() => window.print()} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Print / Save PDF</button>
        </div>
      </div>

      <ReceiptSheet
        inv={{
          receipt_number: inv.receipt_number ?? inv.invoice_number,
          invoice_number: inv.invoice_number,
          customer_name: inv.customer_name,
          vehicle_plate: inv.vehicle_plate,
          payment_date: inv.payment_date || inv.issue_date,
          status: inv.status,
          subtotal: inv.subtotal,
          discount_amount: inv.discount_amount,
          total_amount: inv.total_amount,
          amount_paid: inv.amount_paid,
          payment_method: inv.payment_method,
          payment_reference: inv.payment_reference,
        }}
        branchInfo={branchInfo}
      />
    </>
  )
}
