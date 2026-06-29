import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

interface LineItem {
  item_type: string
  description: string
  qty: number
  uom: string
  unit_price: number
  amount: number
}

interface Invoice {
  id: string
  branch_id: string
  invoice_number: string
  customer_name: string
  customer_phone: string
  customer_email: string
  vehicle_plate: string
  vehicle_info: string
  vehicle_mileage: string
  opened_by: string
  issue_date: string
  status: string
  line_items: LineItem[]
  subtotal: number
  discount_amount: number
  total_amount: number
  amount_paid: number
  balance_due: number
  payment_method: string
}

interface BranchInfo {
  name: string
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
}

function formatDate(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']

function numToWords(n: number): string {
  if (n === 0) return 'ZERO'
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' AND ' + numToWords(n % 100) : '')
  if (n < 1000000) return numToWords(Math.floor(n / 1000)) + ' THOUSAND' + (n % 1000 ? ' ' + numToWords(n % 1000) : '')
  return numToWords(Math.floor(n / 1000000)) + ' MILLION' + (n % 1000000 ? ' ' + numToWords(n % 1000000) : '')
}

function amountInWords(amount: number): string {
  const ringgit = Math.floor(amount)
  const sen = Math.round((amount - ringgit) * 100)
  let words = numToWords(ringgit) + ' RINGGIT'
  if (sen > 0) words += ' AND ' + numToWords(sen) + ' SEN'
  return words + ' ONLY'
}

export function PrintInvoicePage() {
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
    supabase.from('branches').select('name,address,phone,email,logo_url,bank_name,bank_account_number,bank_account_name')
      .eq('id', branchId).single()
      .then(({ data }) => { if (data) setBranchInfo(data as BranchInfo) })
  }, [invoice?.branch_id, user?.branch_id])

  useEffect(() => {
    if (invoice && branchInfo !== undefined) {
      document.title = `Invoice ${invoice.invoice_number}`
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
        @page { size: A4; margin: 15mm }
        * { box-sizing: border-box }
      `}</style>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 24px', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
        <button onClick={() => window.close()} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
        <button onClick={() => window.print()} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Print / Save PDF</button>
      </div>

      <div style={{ maxWidth: 794, margin: '24px auto', padding: '32px 40px', background: '#fff', fontFamily: "'Tw Cen MT', 'Century Gothic', sans-serif", color: '#111', fontSize: 12 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, borderBottom: '2px solid #F15A22', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {branchInfo?.logo_url && (
              <img src={branchInfo.logo_url} alt="Logo" style={{ width: 144, height: 144, objectFit: 'contain', flexShrink: 0 }} />
            )}
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#F15A22', letterSpacing: 1, fontFamily: "'Cocogoose', sans-serif", textTransform: 'uppercase' }}>{branchInfo?.name ?? 'MOTOVERSE GARAGE'}</div>
              {branchInfo?.address && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{branchInfo.address}</div>}
              {(branchInfo?.phone || branchInfo?.email) && (
                <div style={{ fontSize: 12, color: '#555' }}>
                  {[branchInfo.phone && `Tel: ${branchInfo.phone}`, branchInfo.email].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, marginBottom: 4 }}>INVOICE</div>
            <div style={{ fontSize: 12, color: '#555' }}>No: <span style={{ fontWeight: 700, color: '#111', fontFamily: 'monospace' }}>{inv.invoice_number}</span></div>
            <div style={{ fontSize: 12, color: '#555' }}>Date: {formatDate(inv.issue_date)}</div>
            {inv.opened_by && <div style={{ fontSize: 12, color: '#555' }}>Opened By: {inv.opened_by}</div>}
          </div>
        </div>

        {/* Customer / Vehicle block */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginBottom: 12, border: '1px solid #ccc' }}>
          <div style={{ padding: '8px 12px', borderRight: '1px solid #ccc' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Customer</div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{inv.customer_name || '—'}</div>
            <div style={{ fontSize: 12, color: '#444' }}>{inv.customer_phone}</div>
            <div style={{ fontSize: 12, color: '#444' }}>{inv.customer_email}</div>
          </div>
          <div style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Vehicle</div>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <tbody>
                <tr>
                  <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' }}>Plate No.</td>
                  <td style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{inv.vehicle_plate}</td>
                </tr>
                <tr>
                  <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' }}>Manufacturer / Model</td>
                  <td style={{ fontWeight: 600 }}>{inv.vehicle_info}</td>
                </tr>
                {inv.vehicle_mileage && (
                  <tr>
                    <td style={{ color: '#666', paddingRight: 8, whiteSpace: 'nowrap' }}>Mileage</td>
                    <td>{inv.vehicle_mileage} km</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Line Items Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <thead>
            <tr style={{ background: '#F15A22', color: '#fff' }}>
              <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 36 }}>NO</th>
              <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700 }}>ITEM</th>
              <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 50 }}>QTY</th>
              <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, width: 50 }}>UOM</th>
              <th style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, width: 90 }}>UNIT PRICE</th>
              <th style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, width: 90 }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {inv.line_items.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #e8e8e8', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, color: '#666' }}>{i + 1}</td>
                <td style={{ padding: '7px 10px', fontSize: 12 }}>{item.description}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12 }}>{item.qty}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 12, color: '#666' }}>{item.uom || 'unit'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12 }}>{item.unit_price.toFixed(2)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{item.amount.toFixed(2)}</td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 5 - inv.line_items.length) }).map((_, i) => (
              <tr key={`blank-${i}`} style={{ borderBottom: '1px solid #e8e8e8' }}>
                <td style={{ padding: '7px 10px' }}>&nbsp;</td>
                <td /><td /><td /><td /><td />
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals block */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: 280, border: '1px solid #ccc' }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>TOTAL ITEM ({inv.line_items.length})</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{inv.subtotal?.toFixed(2)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>EXTRA DISCOUNT</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>{(inv.discount_amount ?? 0).toFixed(2)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>BEF. ROUNDING</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>{((inv.subtotal ?? 0) - (inv.discount_amount ?? 0)).toFixed(2)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>ROUNDING</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>0.00</td>
              </tr>
              <tr style={{ background: '#F15A22', color: '#fff' }}>
                <td style={{ padding: '7px 12px', fontSize: 13, fontWeight: 800 }}>TOTAL</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 14, fontWeight: 800 }}>RM {inv.total_amount?.toFixed(2)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '5px 12px', fontSize: 12, color: '#555' }}>
                  PAID ({inv.payment_method ? inv.payment_method.replace('_', ' ').toUpperCase() : '—'})
                </td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 12 }}>{(inv.amount_paid ?? 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>DUE</td>
                <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: (inv.balance_due ?? 0) > 0 ? '#c0392b' : '#1a7b4b' }}>
                  RM {(inv.balance_due ?? 0).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Amount in words */}
        <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '8px 12px', marginBottom: 12, background: '#fafafa' }}>
          <span style={{ fontSize: 12, color: '#888', marginRight: 6 }}>Amount in words:</span>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>RINGGIT MALAYSIA {amountInWords(inv.total_amount ?? 0)}</span>
        </div>

        {/* Bank + Signature */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '10px 12px', background: '#fafafa' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Bank Details</div>
            {branchInfo?.bank_name || branchInfo?.bank_account_number || branchInfo?.bank_account_name ? (
              <>
                {branchInfo.bank_name && <div style={{ fontSize: 12 }}><strong>{branchInfo.bank_name}</strong></div>}
                {branchInfo.bank_account_number && <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{branchInfo.bank_account_number}</div>}
                {branchInfo.bank_account_name && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{branchInfo.bank_account_name}</div>}
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>No bank details set</div>
            )}
          </div>
          <div style={{ border: '1px solid #ccc', borderRadius: 4, padding: '10px 12px', minHeight: 70, background: '#fafafa', position: 'relative' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Authorised Signature</div>
            {inv.status === 'paid' && (
              <div style={{ position: 'absolute', top: 12, right: 12, border: '3px solid #1a7b4b', borderRadius: 6, padding: '4px 12px', color: '#1a7b4b', fontWeight: 900, fontSize: 18, letterSpacing: 2, transform: 'rotate(-8deg)', opacity: 0.8 }}>
                PAID
              </div>
            )}
            <div style={{ marginTop: 28, borderTop: '1px solid #999', fontSize: 12, color: '#888', paddingTop: 4 }}>{branchInfo?.name ?? 'Authorised Signatory'}</div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', borderTop: '1px solid #eee', paddingTop: 8, marginBottom: 12 }}>
          Thank you for your business! · This is a computer-generated invoice.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
          <span style={{ fontSize: 12, color: '#bbb', letterSpacing: 0.5 }}>Powered by:</span>
          <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>EZ Garage</span>
          <span style={{ fontSize: 12, color: '#ccc' }}>·</span>
          <span style={{ fontSize: 12, color: '#aaa' }}>http://ezgarage.app</span>
        </div>
      </div>
    </>
  )
}
