import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'

interface Req {
  id: string; table_name: string; record_id: string; record_label: string | null; snapshot: Record<string, unknown>
  reason: string; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; requested_by: string; requested_at: string
  decided_by: string | null; decided_at: string | null; decision_note: string | null
}
interface Gone {
  id: string; table_name: string; record_id: string | null; record_label: string | null; snapshot: Record<string, unknown>
  kind: 'approved' | 'super_admin' | 'direct' | 'system'; reason: string | null; deleted_by: string | null; approved_by: string | null; deleted_at: string
}

const TABLE_LABEL: Record<string, string> = {
  jobs: 'Job', bookings: 'Booking', customers: 'Customer', vehicles: 'Vehicle', quotations: 'Quotation', expenses: 'Expense', suppliers: 'Supplier',
  parts_requests: 'Stock purchase', parts_catalogue: 'Catalogue part', labour_charges: 'Labour charge', job_complaints: 'Complaint',
  leave_requests: 'Leave request', ot_requests: 'OT request', staff_schedules: 'Schedule', customer_updates: 'Customer update',
  attendance_records: 'Attendance', staff_profiles: 'Staff profile', users: 'User', branches: 'Branch',
  fleet_vehicles: 'Fleet vehicle', fleet_documents: 'Fleet document', fleet_bookings: 'Fleet booking', fleet_costs: 'Fleet cost',
  fleet_issues: 'Fleet issue', fleet_maintenance: 'Fleet maintenance', fleet_trips: 'Fleet trip', fleet_vendors: 'Fleet vendor',
}
const tname = (t: string) => TABLE_LABEL[t] ?? t.replace(/_/g, ' ')
const KIND_LABEL: Record<Gone['kind'], string> = {
  approved: 'Approved by super admin', super_admin: 'Deleted by super admin', direct: 'Deleted (settings item)', system: 'System / maintenance',
}
const HIDE_KEYS = new Set(['tenant_id', 'id', 'created_at', 'updated_at'])
const when = (iso: string) => new Date(iso).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const card: React.CSSProperties = { background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 14, marginBottom: 10 }
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #2A2A2A', background: '#1C1C1C', color: '#F0F0F0', fontSize: 13, cursor: 'pointer' }

function Facts({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([k, v]) => !HIDE_KEYS.has(k) && v !== null && v !== '' && typeof v !== 'object')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '4px 16px', marginTop: 10, fontSize: 12 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <span style={{ color: '#6A6A6A' }}>{k.replace(/_/g, ' ')}: </span><span style={{ color: '#D0D0D0', wordBreak: 'break-word' }}>{String(v)}</span>
        </div>
      ))}
    </div>
  )
}

export function ApprovalsPage() {
  const user = useAuthStore(s => s.user)
  const isSuper = user?.role === 'super_admin'
  const [tab, setTab] = useState<'pending' | 'decided' | 'log'>('pending')
  const [reqs, setReqs] = useState<Req[]>([])
  const [gone, setGone] = useState<Gone[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, g, u] = await Promise.all([
      supabase.from('deletion_requests').select('*').order('requested_at', { ascending: false }).limit(300),
      supabase.from('deleted_records').select('*').order('deleted_at', { ascending: false }).limit(300),
      supabase.from('users').select('id, full_name'),
    ])
    setReqs((r.data ?? []) as Req[])
    setGone((g.data ?? []) as Gone[])
    setNames(Object.fromEntries((u.data ?? []).map((x: { id: string; full_name: string }) => [x.id, x.full_name])))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const pending = useMemo(() => reqs.filter(r => r.status === 'pending'), [reqs])
  const decided = useMemo(() => reqs.filter(r => r.status !== 'pending'), [reqs])
  const who = (id: string | null) => (id ? names[id] ?? 'Unknown' : '-')

  async function decide(r: Req, approve: boolean) {
    let note: string | null = null
    if (approve) {
      if (!window.confirm(`Approve deleting ${tname(r.table_name).toLowerCase()} "${r.record_label ?? ''}"? A full copy is kept in the deleted-records log.`)) return
    } else {
      note = window.prompt('Why is this rejected? (optional)')
      if (note === null) return
    }
    setBusy(r.id)
    const { data, error } = await supabase.rpc('decide_deletion', { p_request: r.id, p_approve: approve, p_note: note || null })
    setBusy(null)
    const res = data as { ok?: boolean; error?: string; detail?: string } | null
    if (error || !res?.ok) {
      const msg: Record<string, string> = { forbidden: 'Only a super admin can decide.', already_decided: 'Already decided.', already_gone: 'The record no longer exists.' }
      toast(res?.detail ?? msg[res?.error ?? ''] ?? error?.message ?? 'Failed', 'error')
      load()
      return
    }
    toast(approve ? 'Approved and deleted.' : 'Request rejected.')
    load()
  }

  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button onClick={() => setTab(k)} style={{ ...btn, background: tab === k ? '#F15A22' : '#1C1C1C', borderColor: tab === k ? '#F15A22' : '#2A2A2A', color: tab === k ? '#fff' : '#F0F0F0' }}>
      {label}{n ? ` (${n})` : ''}
    </button>
  )

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={22} color="#F15A22" /> Approvals</h1>
        <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>
          Staff cannot delete important records. They send a request, and a super admin approves it here. Invoices, receipts and supplier bills can never be deleted, only voided.
          {!isSuper && ' You can view requests, but only a super admin can approve or reject.'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {tabBtn('pending', 'Waiting for approval', pending.length)}
        {tabBtn('decided', 'Decided')}
        {tabBtn('log', 'Deleted records')}
      </div>

      {loading ? <div style={{ color: '#A0A0A0', padding: 24 }}><Loader2 size={18} className="spin" /> Loading…</div> : (
        <>
          {tab === 'pending' && (pending.length === 0
            ? <div style={{ ...card, color: '#A0A0A0' }}>Nothing is waiting for approval.</div>
            : pending.map(r => (
              <div key={r.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                    <div style={{ color: '#F0F0F0', fontWeight: 700, fontSize: 15 }}>{tname(r.table_name)}: {r.record_label ?? r.record_id}</div>
                    <div style={{ color: '#A0A0A0', fontSize: 12, marginTop: 2 }}>Asked by {who(r.requested_by)} on {when(r.requested_at)}</div>
                    <div style={{ color: '#F0F0F0', fontSize: 13, marginTop: 8 }}><span style={{ color: '#6A6A6A' }}>Reason: </span>{r.reason}</div>
                  </div>
                  {isSuper && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <button disabled={busy === r.id} onClick={() => decide(r, true)} style={{ ...btn, background: '#7F1D1D', borderColor: '#991B1B', color: '#fff' }}><CheckCircle2 size={15} /> Approve delete</button>
                      <button disabled={busy === r.id} onClick={() => decide(r, false)} style={btn}><XCircle size={15} /> Reject</button>
                    </div>
                  )}
                </div>
                <button onClick={() => setOpen(open === r.id ? null : r.id)} style={{ background: 'none', border: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer', padding: '8px 0 0', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />} What is being deleted
                </button>
                {open === r.id && <Facts data={r.snapshot} />}
              </div>
            )))}

          {tab === 'decided' && (decided.length === 0
            ? <div style={{ ...card, color: '#A0A0A0' }}>No decisions yet.</div>
            : decided.map(r => (
              <div key={r.id} style={card}>
                <div style={{ color: '#F0F0F0', fontWeight: 700 }}>{tname(r.table_name)}: {r.record_label ?? r.record_id}
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: r.status === 'approved' ? '#7F1D1D' : r.status === 'rejected' ? '#1E3A5F' : '#2A2A2A', color: '#fff' }}>{r.status}</span>
                </div>
                <div style={{ color: '#A0A0A0', fontSize: 12, marginTop: 4 }}>Asked by {who(r.requested_by)} on {when(r.requested_at)}: {r.reason}</div>
                {r.decided_at && <div style={{ color: '#A0A0A0', fontSize: 12, marginTop: 2 }}>Decided by {who(r.decided_by)} on {when(r.decided_at)}{r.decision_note ? `: ${r.decision_note}` : ''}</div>}
              </div>
            )))}

          {tab === 'log' && (gone.length === 0
            ? <div style={{ ...card, color: '#A0A0A0' }}>Nothing has been deleted since this log started.</div>
            : gone.map(g => (
              <div key={g.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ color: '#F0F0F0', fontWeight: 700 }}>{tname(g.table_name)}: {g.record_label ?? g.record_id}</div>
                  <div style={{ color: '#A0A0A0', fontSize: 12 }}>{when(g.deleted_at)}</div>
                </div>
                <div style={{ color: '#A0A0A0', fontSize: 12, marginTop: 4 }}>
                  {KIND_LABEL[g.kind]}{g.deleted_by ? ` · by ${who(g.deleted_by)}` : ''}{g.reason ? ` · ${g.reason}` : ''}
                </div>
                <button onClick={() => setOpen(open === g.id ? null : g.id)} style={{ background: 'none', border: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer', padding: '8px 0 0', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {open === g.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Saved copy
                </button>
                {open === g.id && <Facts data={g.snapshot} />}
              </div>
            )))}
        </>
      )}
    </div>
  )
}
