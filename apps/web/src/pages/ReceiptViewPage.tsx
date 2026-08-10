import { useEffect, useState } from 'react'
import { ReceiptSheet, type ReceiptData, type ReceiptBranchInfo } from '@/components/receipts/ReceiptSheet'

// Customer/ESP-member-facing counterpart to PrintReceiptPage, sharing the
// same ReceiptSheet design. It has no data-fetching of its own and no
// route param -- the caller (CustomerPortalPage / EspMemberLoginPage) has
// already had its identity re-verified server-side by portal-receipts or
// esp-receipt, and hands the already-fetched receipt data across via
// sessionStorage right before opening this tab. That avoids ever putting a
// phone number, password, or IC digits in a URL, and avoids standing up a
// second public data-fetching endpoint just to re-answer "whose receipt is
// this" a second time.
const STORAGE_KEY = 'ezgarage_receipt_view_payload'

export function ReceiptViewPage() {
  const [payload, setPayload] = useState<{ inv: ReceiptData; branchInfo: ReceiptBranchInfo | null } | null | 'missing'>(null)

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) { setPayload('missing'); return }
    try {
      setPayload(JSON.parse(raw))
    } catch {
      setPayload('missing')
    }
  }, [])

  useEffect(() => {
    if (payload && payload !== 'missing') {
      document.title = `Receipt ${payload.inv.receipt_number}`
      setTimeout(() => window.print(), 500)
    }
  }, [payload])

  if (payload === 'missing') {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
        This receipt link has expired. Please go back and click "View Receipt" again.
      </div>
    )
  }
  if (!payload) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</div>
  }

  return (
    <>
      <style>{`
        @media print { .no-print { display: none !important } body { margin: 0 } }
        @page { size: A5; margin: 12mm }
        * { box-sizing: border-box }
      `}</style>

      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
        <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Receipt — {payload.inv.receipt_number}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => window.close()} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Close</button>
          <button onClick={() => window.print()} style={{ background: '#F15A22', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Print / Save PDF</button>
        </div>
      </div>

      <ReceiptSheet inv={payload.inv} branchInfo={payload.branchInfo} />
    </>
  )
}

export function openReceiptView(inv: ReceiptData, branchInfo: ReceiptBranchInfo | null) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ inv, branchInfo }))
  window.open('/receipt-view', '_blank')
}
