// The visual design of a payment receipt, shared by every place a receipt
// gets shown -- staff printing one manually (PrintReceiptPage) and a
// customer/ESP member viewing one for an online payment (ReceiptViewPage).
// One template, so the two can never drift apart again.

export interface ReceiptData {
  receipt_number: string
  invoice_number: string
  customer_name: string | null
  vehicle_plate: string | null
  payment_date: string
  status: string
  subtotal: number | null
  discount_amount: number | null
  total_amount: number
  amount_paid: number
  payment_method: string | null
  payment_reference: string | null
}

export interface ReceiptBranchInfo {
  name: string
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
}

export function ReceiptSheet({ inv, branchInfo }: { inv: ReceiptData; branchInfo: ReceiptBranchInfo | null }) {
  return (
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
        <div><span style={{ color: '#888' }}>Receipt No:</span> <strong style={{ fontFamily: 'monospace' }}>{inv.receipt_number}</strong></div>
        <div style={{ textAlign: 'right' }}><span style={{ color: '#888' }}>Date:</span> <strong>{new Date(inv.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div>
        <div><span style={{ color: '#888' }}>Customer:</span> <strong>{inv.customer_name ?? '—'}</strong></div>
        {inv.vehicle_plate && (
          <div style={{ textAlign: 'right' }}><span style={{ color: '#888' }}>Vehicle:</span> <strong style={{ fontFamily: 'monospace' }}>{inv.vehicle_plate}</strong></div>
        )}
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
  )
}
