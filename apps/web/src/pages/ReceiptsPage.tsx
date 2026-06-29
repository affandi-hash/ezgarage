import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Receipt, Search, X, Printer, ChevronRight } from 'lucide-react'

// ─── Interface ─────────────────────────────────────────────────────────────────

interface ReceiptRecord {
  id: string
  branch_id: string
  invoice_number: string
  receipt_number: string | null
  customer_name: string
  customer_phone: string
  vehicle_plate: string
  vehicle_info: string
  total_amount: number
  amount_paid: number
  balance_due: number
  payment_method: string | null
  payment_date: string | null
  payment_reference: string | null
  issue_date: string
  is_internal_fleet?: boolean
}

// ─── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  text: '#F0F0F0',
  text2: '#A0A0A0',
  green: '#22C55E',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatRM(n: number | null | undefined) {
  return 'RM ' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function methodLabel(m: string | null | undefined) {
  if (!m) return '—'
  return m.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Print receipt HTML ────────────────────────────────────────────────────────

function buildReceiptHtml(r: ReceiptRecord): string {
  const payDate = r.payment_date ? fmtDate(r.payment_date) : fmtDate(r.issue_date)
  const method = methodLabel(r.payment_method)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt ${r.receipt_number ?? r.invoice_number}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; }
  .page { max-width: 400px; margin: 0 auto; padding: 32px 24px; }
  .header { text-align: center; margin-bottom: 24px; }
  .logo-text { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #F15A22; }
  .tagline { font-size: 10px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-top: 2px; }
  .divider { border: none; border-top: 1px dashed #ddd; margin: 16px 0; }
  .divider-solid { border: none; border-top: 2px solid #1a1a1a; margin: 16px 0; }
  .receipt-title { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #555; margin-bottom: 4px; }
  .receipt-number { text-align: center; font-size: 18px; font-weight: 800; color: #1a1a1a; margin-bottom: 2px; }
  .receipt-date { text-align: center; font-size: 11px; color: #888; margin-bottom: 20px; }
  .section { margin-bottom: 16px; }
  .section-label { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #aaa; margin-bottom: 6px; }
  .field { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .field-key { font-size: 11px; color: #666; }
  .field-val { font-size: 12px; font-weight: 600; color: #1a1a1a; text-align: right; max-width: 60%; }
  .amount-box { background: #f7f7f7; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center; }
  .amount-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .amount-value { font-size: 28px; font-weight: 800; color: #1a1a1a; }
  .paid-stamp { text-align: center; margin: 20px 0 8px; }
  .paid-badge { display: inline-block; border: 3px solid #22C55E; color: #22C55E; font-size: 22px; font-weight: 900; letter-spacing: 6px; padding: 6px 20px; border-radius: 4px; transform: rotate(-3deg); }
  .footer { text-align: center; font-size: 10px; color: #aaa; margin-top: 24px; line-height: 1.6; }
  .invoice-ref { font-size: 10px; color: #888; text-align: center; margin-top: 4px; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo-text">Motoverse</div>
    <div class="tagline">Official Payment Receipt</div>
  </div>

  <hr class="divider-solid">

  <div class="receipt-title">Receipt</div>
  <div class="receipt-number">${r.receipt_number ?? '—'}</div>
  <div class="receipt-date">${payDate}</div>

  <hr class="divider">

  <div class="section">
    <div class="section-label">Customer</div>
    <div class="field"><span class="field-key">Name</span><span class="field-val">${r.customer_name}</span></div>
    ${r.customer_phone ? `<div class="field"><span class="field-key">Phone</span><span class="field-val">${r.customer_phone}</span></div>` : ''}
  </div>

  <div class="section">
    <div class="section-label">Vehicle</div>
    <div class="field"><span class="field-key">Plate</span><span class="field-val">${r.vehicle_plate || '—'}</span></div>
    ${r.vehicle_info ? `<div class="field"><span class="field-key">Vehicle</span><span class="field-val">${r.vehicle_info}</span></div>` : ''}
  </div>

  <div class="section">
    <div class="section-label">Payment</div>
    <div class="field"><span class="field-key">Method</span><span class="field-val">${method}</span></div>
    ${r.payment_reference ? `<div class="field"><span class="field-key">Reference</span><span class="field-val">${r.payment_reference}</span></div>` : ''}
    <div class="field"><span class="field-key">Invoice Total</span><span class="field-val">RM ${r.total_amount.toFixed(2)}</span></div>
  </div>

  <div class="amount-box">
    <div class="amount-label">Amount Paid</div>
    <div class="amount-value">RM ${r.amount_paid.toFixed(2)}</div>
  </div>

  ${r.balance_due > 0 ? `
  <div class="field" style="padding: 0 4px; margin-bottom: 12px;">
    <span class="field-key" style="color:#F15A22;font-weight:600">Balance Due</span>
    <span class="field-val" style="color:#F15A22">RM ${r.balance_due.toFixed(2)}</span>
  </div>` : ''}

  <div class="paid-stamp">
    <span class="paid-badge">PAID</span>
  </div>

  <div class="invoice-ref">Invoice Ref: ${r.invoice_number}</div>

  <hr class="divider">

  <div class="footer">
    Thank you for your payment!<br>
    Please keep this receipt for your records.<br>
    <strong>Motoverse Garage</strong>
  </div>
</div>
</body>
</html>`
}

// ─── Payment Method Options ────────────────────────────────────────────────────

const METHOD_OPTS = [
  { value: '', label: 'All Methods' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online_transfer', label: 'Online Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
]

// ─── ReceiptsPage ──────────────────────────────────────────────────────────────

export function ReceiptsPage() {
  const { user } = useAuthStore()
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<ReceiptRecord | null>(null)

  const loadReceipts = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('invoices')
      .select('id,branch_id,invoice_number,receipt_number,customer_name,customer_phone,vehicle_plate,vehicle_info,total_amount,amount_paid,balance_due,payment_method,payment_date,payment_reference,issue_date,is_internal_fleet')
      .gt('amount_paid', 0)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (user?.role !== 'super_admin' && user?.branch_id)
      q = q.eq('branch_id', user.branch_id)
    const { data } = await q
    setReceipts((data as ReceiptRecord[]) ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => { loadReceipts() }, [loadReceipts])

  // ─── Filtered list ──────────────────────────────────────────────────────────

  const filtered = receipts.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !r.customer_name.toLowerCase().includes(q) &&
        !r.vehicle_plate.toLowerCase().includes(q) &&
        !(r.receipt_number ?? '').toLowerCase().includes(q) &&
        !r.invoice_number.toLowerCase().includes(q)
      ) return false
    }
    if (methodFilter && r.payment_method !== methodFilter) return false
    if (dateFrom && r.payment_date && r.payment_date < dateFrom) return false
    if (dateTo && r.payment_date && r.payment_date > dateTo) return false
    return true
  })

  // ─── Print ──────────────────────────────────────────────────────────────────

  function printReceipt(r: ReceiptRecord) {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(buildReceiptHtml(r))
    w.document.close()
    w.onload = () => { w.focus(); w.print() }
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────

  const chip = (active: boolean): React.CSSProperties => ({
    background: active ? C.orange : C.surface,
    color: active ? '#fff' : C.text2,
    border: `1px solid ${active ? C.orange : C.border}`,
    borderRadius: 20,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  })

  const inputStyle: React.CSSProperties = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    color: C.text,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, overflow: 'hidden' }}>

      {/* ── Left panel: list ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: `1px solid ${C.border}` }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Receipt size={20} color={C.orange} />
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Receipts</h1>
          </div>
          <p style={{ fontSize: 12, color: C.text2 }}>All payments received — read-only record</p>
        </div>

        {/* Filters */}
        <div style={{ padding: '12px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
            <Search size={14} color={C.text2} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search customer, plate, receipt no…"
              style={{ ...inputStyle, width: '100%', paddingLeft: 32 }}
            />
          </div>

          {/* Method */}
          <select
            value={methodFilter}
            onChange={e => setMethodFilter(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {METHOD_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {/* Date from/to */}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle }} title="From date" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle }} title="To date" />

          {(search || methodFilter || dateFrom || dateTo) && (
            <button
              onClick={() => { setSearch(''); setMethodFilter(''); setDateFrom(''); setDateTo('') }}
              style={{ ...chip(false), display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Count */}
        <div style={{ padding: '8px 24px', fontSize: 11, color: C.text2, borderBottom: `1px solid ${C.border}` }}>
          {loading ? 'Loading…' : `${filtered.length} receipt${filtered.length !== 1 ? 's' : ''}`}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.text2 }}>Loading receipts…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.text2 }}>
              {search || methodFilter || dateFrom || dateTo ? 'No receipts match your filters.' : 'No payment receipts yet.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.surface, position: 'sticky', top: 0, zIndex: 1 }}>
                  {['Receipt No.', 'Date', 'Invoice', 'Customer', 'Vehicle', 'Amount Paid', 'Method', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.text2, letterSpacing: '0.05em', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      cursor: 'pointer',
                      background: selected?.id === r.id ? 'rgba(241,90,34,0.06)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (selected?.id !== r.id) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = selected?.id === r.id ? 'rgba(241,90,34,0.06)' : 'transparent' }}
                  >
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: C.orange, whiteSpace: 'nowrap' }}>
                      {r.receipt_number ?? <span style={{ color: C.text2, fontWeight: 400 }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 16px', color: C.text2, whiteSpace: 'nowrap' }}>{fmtDate(r.payment_date)}</td>
                    <td style={{ padding: '10px 16px', color: C.text2, fontSize: 12, whiteSpace: 'nowrap' }}>{r.invoice_number}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ fontWeight: 500 }}>{r.customer_name}</div>
                      {r.customer_phone && <div style={{ fontSize: 11, color: C.text2 }}>{r.customer_phone}</div>}
                    </td>
                    <td style={{ padding: '10px 16px', color: C.text2, fontSize: 12 }}>
                      <div style={{ fontWeight: 500, color: C.text }}>{r.vehicle_plate || '—'}</div>
                      {r.vehicle_info && <div style={{ fontSize: 11 }}>{r.vehicle_info}</div>}
                    </td>
                    <td style={{ padding: '10px 16px', fontWeight: 700, whiteSpace: 'nowrap' }}>{formatRM(r.amount_paid)}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ background: '#1E1E1E', border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: C.text2 }}>
                        {methodLabel(r.payment_method)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <ChevronRight size={14} color={C.text2} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Right panel: receipt detail ── */}
      <div style={{ width: selected ? 360 : 0, minWidth: selected ? 360 : 0, overflow: 'hidden', transition: 'width 0.2s ease, min-width 0.2s ease', background: C.surface, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.border}` }}>
        {selected && (
          <>
            {/* Panel header */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.orange }}>{selected.receipt_number ?? '—'}</div>
                <div style={{ fontSize: 11, color: C.text2 }}>Invoice: {selected.invoice_number}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => printReceipt(selected)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.orange, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  <Printer size={14} /> Print
                </button>
                <button
                  onClick={() => setSelected(null)}
                  style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text2, padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Panel body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

              {/* PAID stamp */}
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <span style={{ display: 'inline-block', border: `3px solid ${C.green}`, color: C.green, fontSize: 20, fontWeight: 900, letterSpacing: 6, padding: '6px 20px', borderRadius: 4, transform: 'rotate(-3deg)' }}>
                  PAID
                </span>
              </div>

              {/* Amount */}
              <div style={{ background: '#1A1A1A', border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: C.text2, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Amount Paid</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{formatRM(selected.amount_paid)}</div>
                {selected.balance_due > 0 && (
                  <div style={{ fontSize: 12, color: C.orange, marginTop: 6, fontWeight: 600 }}>Balance Due: {formatRM(selected.balance_due)}</div>
                )}
              </div>

              {/* Fields */}
              {[
                { label: 'Payment Date', value: fmtDate(selected.payment_date) },
                { label: 'Payment Method', value: methodLabel(selected.payment_method) },
                selected.payment_reference ? { label: 'Reference', value: selected.payment_reference } : null,
                { label: 'Invoice Total', value: formatRM(selected.total_amount) },
              ].filter(Boolean).map(f => f && (
                <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                  <span style={{ color: C.text2 }}>{f.label}</span>
                  <span style={{ fontWeight: 600 }}>{f.value}</span>
                </div>
              ))}

              <div style={{ marginTop: 20, marginBottom: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.text2 }}>Customer</div>
              {[
                { label: 'Name', value: selected.customer_name },
                { label: 'Phone', value: selected.customer_phone || '—' },
              ].map(f => (
                <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                  <span style={{ color: C.text2 }}>{f.label}</span>
                  <span style={{ fontWeight: 600 }}>{f.value}</span>
                </div>
              ))}

              <div style={{ marginTop: 20, marginBottom: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.text2 }}>Vehicle</div>
              {[
                { label: 'Plate', value: selected.vehicle_plate || '—' },
                { label: 'Info', value: selected.vehicle_info || '—' },
              ].map(f => (
                <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                  <span style={{ color: C.text2 }}>{f.label}</span>
                  <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{f.value}</span>
                </div>
              ))}

              {selected.is_internal_fleet && (
                <div style={{ marginTop: 16, display: 'inline-block', fontSize: 10, fontWeight: 700, color: C.orange, border: `1px solid ${C.orange}`, borderRadius: 4, padding: '2px 8px', letterSpacing: '0.5px' }}>
                  INTRACOMPANY · INTERNAL FLEET
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
