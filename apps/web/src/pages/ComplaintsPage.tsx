import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { scopedBranchId, canSeeAllBranches } from '@/lib/branchScope'
import { useOutletContext } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import { Plus, X, Loader2, Search, Pencil, Trash2, CheckCircle2, RotateCcw, MessageSquareWarning } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Complaint {
  id: string
  branch_id: string
  complaint_date: string
  customer_name: string | null
  reference: string | null
  description: string
  status: 'open' | 'resolved'
  resolution: string | null
  resolved_at: string | null
  created_at: string
}

interface BranchOpt { id: string; name: string }

const WRITE_ROLES = ['super_admin', 'ops_manager', 'foreman', 'front_desk']
const DELETE_ROLES = ['super_admin', 'ops_manager']

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Local-calendar YYYY-MM-DD (avoids the UTC shift of toISOString)
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  const d = s.length <= 10 ? new Date(`${s}T00:00:00`) : new Date(s)
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
}

function daysBetween(fromDate: string, toTs: string): number {
  const a = new Date(`${fromDate}T00:00:00`).getTime()
  const b = new Date(`${localDate(new Date(toTs))}T00:00:00`).getTime()
  return Math.max(0, Math.round((b - a) / 86400000))
}

const inp: React.CSSProperties = {
  width: '100%', background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8,
  padding: '10px 12px', color: '#F0F0F0', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = { display: 'block', color: '#A0A0A0', fontSize: 12, fontWeight: 600, marginBottom: 6 }
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8,
  border: '1px solid #2A2A2A', background: '#161616', color: '#F0F0F0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

// ─── Add / edit modal ─────────────────────────────────────────────────────────

function ComplaintModal({ editing, defaultBranchId, tenantId, userId, onClose, onSaved }: {
  editing: Complaint | null
  defaultBranchId: string | null
  tenantId: string
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const today = localDate(new Date())
  const [date, setDate] = useState(editing?.complaint_date ?? today)
  const [customer, setCustomer] = useState(editing?.customer_name ?? '')
  const [reference, setReference] = useState(editing?.reference ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [branchId, setBranchId] = useState(defaultBranchId ?? '')
  const [branches, setBranches] = useState<BranchOpt[]>([])
  const [saving, setSaving] = useState(false)
  const needBranch = !editing && !defaultBranchId

  // Only when we couldn't work out a branch: let the user pick one
  useEffect(() => {
    if (!needBranch) return
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).order('name')
      .then(({ data }) => setBranches((data as BranchOpt[]) ?? []))
  }, [needBranch, tenantId])

  async function save() {
    if (!description.trim()) { toast('Description is required', 'error'); return }
    if (!date) { toast('Date is required', 'error'); return }
    if (needBranch && !branchId) { toast('Choose a branch', 'error'); return }
    setSaving(true)
    const fields = {
      complaint_date: date,
      customer_name: customer.trim() || null,
      reference: reference.trim() || null,
      description: description.trim(),
    }
    const { error } = editing
      ? await supabase.from('job_complaints').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', editing.id)
      : await supabase.from('job_complaints').insert({ ...fields, tenant_id: tenantId, branch_id: branchId, created_by: userId })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(editing ? 'Complaint updated' : 'Complaint added', 'success')
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16, width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
          <h2 style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 700, margin: 0 }}>{editing ? 'Edit Complaint' : 'Add Complaint'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Date</label>
            <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} style={inp} />
          </div>
          {needBranch && (
            <div>
              <label style={lbl}>Branch *</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} style={inp}>
                <option value="">Select branch</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={lbl}>Customer name</label>
            <input value={customer} onChange={e => setCustomer(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>Reference</label>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Job no., invoice no. or plate" style={inp} />
          </div>
          <div>
            <label style={lbl}>Description *</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 20px', borderTop: '1px solid #2A2A2A' }}>
          <button onClick={onClose} style={btn}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btn, background: '#F15A22', borderColor: '#F15A22', color: '#fff', opacity: saving ? 0.7 : 1 }}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editing ? 'Save' : 'Add complaint'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ComplaintsPage() {
  const { user } = useAuthStore()
  const { selectedBranchId } = useOutletContext<{ selectedBranchId: string | null }>()
  const tenantId = user?.tenant_id ?? ''
  const userId = user?.id ?? ''
  const role = user?.role ?? ''
  const canWrite = WRITE_ROLES.includes(role)
  const canDelete = DELETE_ROLES.includes(role)
  const filterBranch = canSeeAllBranches(role) ? scopedBranchId(user, selectedBranchId) : (user?.branch_id ?? null)
  const insertBranch = scopedBranchId(user, selectedBranchId) ?? user?.branch_id ?? null

  const [rows, setRows] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'all' | 'open' | 'resolved'>('all')
  const [month, setMonth] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Complaint | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    let q = supabase.from('job_complaints')
      .select('id, branch_id, complaint_date, customer_name, reference, description, status, resolution, resolved_at, created_at')
      .eq('tenant_id', tenantId)
      .order('complaint_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)
    if (filterBranch) q = q.eq('branch_id', filterBranch)
    const { data, error: err } = await q
    if (err) setError(err.message)
    else setRows((data as Complaint[]) ?? [])
    setLoading(false)
  }, [tenantId, filterBranch])

  useEffect(() => { load() }, [load])

  // Summary chips (over everything loaded, ignoring the filters)
  const stats = useMemo(() => {
    const thisMonth = localDate(new Date()).slice(0, 7)
    const open = rows.filter(r => r.status === 'open').length
    const resolved = rows.filter(r => r.status === 'resolved' && r.resolved_at)
    const resolvedThisMonth = resolved.filter(r => localDate(new Date(r.resolved_at as string)).startsWith(thisMonth)).length
    const avg = resolved.length
      ? (resolved.reduce((s, r) => s + daysBetween(r.complaint_date, r.resolved_at as string), 0) / resolved.length).toFixed(1)
      : '-'
    return { open, resolvedThisMonth, avg }
  }, [rows])

  const monthOptions = useMemo(() => {
    const out: string[] = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return out
  }, [])

  const visible = rows.filter(r => {
    if (status !== 'all' && r.status !== status) return false
    if (month && !r.complaint_date.startsWith(month)) return false
    const s = search.trim().toLowerCase()
    if (s && !`${r.customer_name ?? ''} ${r.reference ?? ''} ${r.description}`.toLowerCase().includes(s)) return false
    return true
  })

  async function patch(c: Complaint, fields: Record<string, unknown>, okMsg: string) {
    setBusyId(c.id)
    const { error: err } = await supabase.from('job_complaints')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', c.id)
    setBusyId(null)
    if (err) { toast(err.message, 'error'); return }
    toast(okMsg, 'success')
    load()
  }

  function markResolved(c: Complaint) {
    const note = window.prompt('How was this complaint resolved?')
    if (note === null) return
    if (!note.trim()) { toast('A resolution note is required', 'error'); return }
    patch(c, { status: 'resolved', resolution: note.trim(), resolved_at: new Date().toISOString() }, 'Marked as resolved')
  }

  function reopen(c: Complaint) {
    patch(c, { status: 'open', resolution: null, resolved_at: null }, 'Complaint reopened')
  }

  async function remove(c: Complaint) {
    if (!window.confirm('Delete this complaint? This cannot be undone.')) return
    setBusyId(c.id)
    const { error: err } = await supabase.from('job_complaints').delete().eq('id', c.id)
    setBusyId(null)
    if (err) { toast(err.message, 'error'); return }
    toast('Complaint deleted', 'success')
    load()
  }

  const chip = (label: string, value: string | number, color = '#F0F0F0') => (
    <div style={{ flex: '1 1 140px', background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ color: '#A0A0A0', fontSize: 12 }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  )

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ minWidth: 0, flex: '1 1 240px' }}>
          <h1 style={{ color: '#F0F0F0', fontSize: 22, fontWeight: 800, margin: 0 }}>Complaints</h1>
          <p style={{ color: '#A0A0A0', fontSize: 13, margin: '4px 0 0' }}>Customer complaints about our service. The daily count feeds the Operations sheet.</p>
        </div>
        {canWrite && (
          <button onClick={() => { setEditing(null); setShowModal(true) }}
            style={{ ...btn, background: '#F15A22', borderColor: '#F15A22', color: '#fff' }}>
            <Plus size={16} /> Add complaint
          </button>
        )}
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {chip('Open', stats.open, stats.open > 0 ? '#F59E0B' : '#F0F0F0')}
        {chip('Resolved this month', stats.resolvedThisMonth, '#22C55E')}
        {chip('Average days to resolve', stats.avg)}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={status} onChange={e => setStatus(e.target.value as 'all' | 'open' | 'resolved')} style={{ ...inp, width: 'auto', flex: '1 1 120px' }}>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ ...inp, width: 'auto', flex: '1 1 150px' }}>
          <option value="">All time</option>
          {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <div style={{ position: 'relative', flex: '2 1 200px' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: 13, color: '#A0A0A0' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, reference, description"
            style={{ ...inp, paddingLeft: 34 }} />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48, color: '#A0A0A0' }}><Loader2 size={24} className="animate-spin" /></div>
      ) : error ? (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 16, color: '#EF4444', fontSize: 14 }}>
          Could not load complaints: {error}{' '}
          <button onClick={load} style={{ ...btn, marginLeft: 8 }}>Retry</button>
        </div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#A0A0A0', background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }}>
          <MessageSquareWarning size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
          <div style={{ fontSize: 14 }}>{rows.length === 0 ? 'No complaints logged yet.' : 'No complaints match these filters.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(c => {
            const open = c.status === 'open'
            const busy = busyId === c.id
            return (
              <div key={c.id} style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#A0A0A0', fontSize: 12 }}>{fmtDate(c.complaint_date)}</span>
                  <span style={{
                    padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
                    color: open ? '#F59E0B' : '#22C55E', background: open ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                  }}>{open ? 'Open' : 'Resolved'}</span>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ color: '#F0F0F0', fontSize: 15, fontWeight: 700 }}>{c.customer_name || 'Unnamed customer'}</span>
                  {c.reference && <span style={{ color: '#F15A22', fontSize: 12, fontWeight: 600 }}>{c.reference}</span>}
                </div>
                <p style={{ color: '#F0F0F0', fontSize: 14, margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.description}</p>
                {!open && (
                  <div style={{ marginTop: 10, padding: '8px 10px', background: '#1E1E1E', borderRadius: 8, borderLeft: '3px solid #22C55E' }}>
                    <div style={{ color: '#A0A0A0', fontSize: 11, marginBottom: 2 }}>Resolved {fmtDate(c.resolved_at)}</div>
                    <div style={{ color: '#F0F0F0', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.resolution || '-'}</div>
                  </div>
                )}
                {canWrite && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button disabled={busy} style={btn} onClick={() => { setEditing(c); setShowModal(true) }}><Pencil size={14} /> Edit</button>
                    {open
                      ? <button disabled={busy} style={{ ...btn, color: '#22C55E' }} onClick={() => markResolved(c)}><CheckCircle2 size={14} /> Mark resolved</button>
                      : <button disabled={busy} style={btn} onClick={() => reopen(c)}><RotateCcw size={14} /> Reopen</button>}
                    {canDelete && <button disabled={busy} style={{ ...btn, color: '#EF4444' }} onClick={() => remove(c)}><Trash2 size={14} /> Delete</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <ComplaintModal
          editing={editing}
          defaultBranchId={insertBranch}
          tenantId={tenantId}
          userId={userId}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}
