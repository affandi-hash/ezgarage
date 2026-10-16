import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, ShieldAlert } from 'lucide-react'

type Row = Record<string, unknown>
interface Report {
  error?: string
  voided_invoices: Row[]; voided_receipts: Row[]; invoice_changes: Row[]; number_gaps: { series: string; missing: number[] }[]
  jobs_without_invoice: Row[]; jobs_without_invoice_internal?: Row[]; payments_without_proof: Row[]; deletions: Row[]; pending_deletions: number
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-')
const rm = (v: unknown) => (v === null || v === undefined ? '-' : `RM ${Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const by = (r: Row) => (r.by ? `${r.by}${r.role ? ` (${String(r.role).replace('_', ' ')})` : ''}` : '-')

const inp: React.CSSProperties = { background: '#1C1C1C', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0', padding: '8px 10px', fontSize: 13 }
const th: React.CSSProperties = { textAlign: 'left', color: '#6A6A6A', fontSize: 11, fontWeight: 600, padding: '6px 8px', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { color: '#D0D0D0', fontSize: 12.5, padding: '6px 8px', borderTop: '1px solid #222', verticalAlign: 'top' }

function Section({ title, hint, rows, cols }: { title: string; hint: string; rows: Row[]; cols: { h: string; f: (r: Row) => string }[] }) {
  return (
    <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 15 }}>{title}</div>
        <div style={{ color: rows.length ? '#F59E0B' : '#22C55E', fontSize: 12, fontWeight: 700 }}>{rows.length ? `${rows.length} to look at` : 'Nothing found'}</div>
      </div>
      <div style={{ color: '#A0A0A0', fontSize: 12, margin: '2px 0 8px' }}>{hint}</div>
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{cols.map(c => <th key={c.h} style={th}>{c.h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c.h} style={td}>{c.f(r)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function IntegrityReportPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(iso(new Date()))
  const [rep, setRep] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    const { data, error } = await supabase.rpc('integrity_report', { p_from: from, p_to: to })
    const r = data as Report | null
    if (error || !r || r.error) setErr(error?.message ?? (r?.error === 'forbidden' ? 'You do not have access to this report.' : 'Could not load the report.'))
    else setRep(r)
    setLoading(false)
  }, [from, to])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><ShieldAlert size={22} color="#F15A22" /> Integrity Report</h1>
      <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 14px' }}>
        The places where money or records can quietly go missing. Each line is something worth a quick question, not proof of anything wrong.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ color: '#A0A0A0', fontSize: 12 }}>From <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={inp} /></label>
        <label style={{ color: '#A0A0A0', fontSize: 12 }}>To <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={inp} /></label>
        {rep && rep.pending_deletions > 0 && <span style={{ color: '#F59E0B', fontSize: 13, fontWeight: 700 }}>{rep.pending_deletions} deletion request(s) waiting in Approvals</span>}
      </div>
      {loading && <div style={{ color: '#A0A0A0' }}><Loader2 size={16} /> Loading…</div>}
      {err && <div style={{ color: '#F87171' }}>{err}</div>}
      {rep && !loading && !err && (
        <>
          <Section title="Deleted records" hint="Everything removed from the system, with who did it and the reason."
            rows={rep.deletions} cols={[{ h: 'When', f: r => when(r.at) }, { h: 'What', f: r => `${String(r.table).replace(/_/g, ' ')}: ${r.label ?? ''}` },
              { h: 'How', f: r => String(r.kind).replace('_', ' ') }, { h: 'By', f: r => String(r.by ?? '-') }, { h: 'Approved by', f: r => String(r.approved_by ?? '-') }, { h: 'Reason', f: r => String(r.reason ?? '-') }]} />
          <Section title="Voided invoices" hint="An invoice cancelled after it was issued. Check the reason makes sense."
            rows={rep.voided_invoices} cols={[{ h: 'When', f: r => when(r.at) }, { h: 'Invoice', f: r => String(r.invoice_number ?? '-') }, { h: 'Total', f: r => rm(r.total) },
              { h: 'Paid', f: r => rm(r.amount_paid) }, { h: 'By', f: by }, { h: 'Reason', f: r => String(r.reason ?? '-') }]} />
          <Section title="Voided payments" hint="A recorded payment that was cancelled, which reopens the invoice balance."
            rows={rep.voided_receipts} cols={[{ h: 'When', f: r => when(r.at) }, { h: 'Invoice', f: r => String(r.invoice_number ?? '-') }, { h: 'Amount', f: r => rm(r.amount) },
              { h: 'Method', f: r => String(r.method ?? '-') }, { h: 'By', f: by }, { h: 'Reason', f: r => String(r.reason ?? '-') }]} />
          <Section title="Issued invoices that were changed" hint="Total, discount or items changed after the invoice went out."
            rows={rep.invoice_changes} cols={[{ h: 'When', f: r => when(r.at) }, { h: 'Invoice', f: r => String(r.invoice_number ?? '-') }, { h: 'Total', f: r => `${rm(r.old_total)} → ${rm(r.new_total)}` },
              { h: 'Discount', f: r => `${rm(r.old_discount)} → ${rm(r.new_discount)}` }, { h: 'Paid', f: r => rm(r.amount_paid) }, { h: 'By', f: by }]} />
          <Section title="Jobs handed back with no invoice (outside customers)" hint="A car that is ready or delivered but has no invoice. The most common way a job goes unrecorded."
            rows={rep.jobs_without_invoice} cols={[{ h: 'Job', f: r => String(r.job_number ?? '-') }, { h: 'Customer', f: r => String(r.customer ?? '-') }, { h: 'Plate', f: r => String(r.plate ?? '-') },
              { h: 'Status', f: r => String(r.status).replace('_', ' ') }, { h: 'Since', f: r => when(r.at) }, { h: 'Opened by', f: r => String(r.created_by ?? '-') }]} />
          <Section title="Jobs with no invoice (internal fleet)" hint="Customers or vehicles whose invoices are flagged internal fleet, such as the Brainy Bunch group and Motoverse itself. Often intended, but confirm each is billed internally."
            rows={rep.jobs_without_invoice_internal ?? []} cols={[{ h: 'Job', f: r => String(r.job_number ?? '-') }, { h: 'Customer', f: r => String(r.customer ?? '-') }, { h: 'Plate', f: r => String(r.plate ?? '-') },
              { h: 'Status', f: r => String(r.status).replace('_', ' ') }, { h: 'Since', f: r => when(r.at) }, { h: 'Opened by', f: r => String(r.created_by ?? '-') }]} />
          <Section title="Payments with no proof" hint="Cash, transfer or QR payments recorded without a receipt photo or gateway reference."
            rows={rep.payments_without_proof} cols={[{ h: 'When', f: r => when(r.at) }, { h: 'Invoice', f: r => String(r.invoice_number ?? '-') }, { h: 'Amount', f: r => rm(r.amount) },
              { h: 'Method', f: r => String(r.method ?? '-').replace('_', ' ') }, { h: 'Recorded by', f: by }]} />
          <Section title="Gaps in invoice numbers" hint="Invoice numbers inside this period that do not exist. A gap can be harmless, but each one should be explainable."
            rows={rep.number_gaps as unknown as Row[]} cols={[{ h: 'Series', f: r => String(r.series) }, { h: 'Missing numbers', f: r => (r.missing as number[]).join(', ') }]} />
        </>
      )}
    </div>
  )
}
