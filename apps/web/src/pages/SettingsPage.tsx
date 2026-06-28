import { useEffect, useState, useCallback } from 'react'
import {
  BookOpen,
  Wrench,
  MessageSquare,
  Palette,
  Building2,
  Clock,
  Plus,
  Save,
  Edit2,
  Trash2,
  ChevronUp,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  Check,
  Globe,
  Eye,
  EyeOff,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logAudit } from '@/lib/audit'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface WorkshopRule {
  id: string
  sort_order: number
  rule_number: number
  title: string
  description: string | null
  is_active: boolean
}

interface JobType {
  id: string
  name: string
  default_duration_minutes: number
  sort_order: number
  is_active: boolean
}

interface WATemplate {
  id: string
  name: string
  trigger_event: string
  body: string
  is_active: boolean
}

interface StatusColor {
  id: string
  status_key: string
  label: string
  color_hex: string
}

interface BranchSettings {
  id: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  geofence_radius_m: number | null
  code: string | null
  logo_url: string | null
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
}

interface WorkingHours {
  id: string
  work_days: string[]
  work_start_time: string
  work_end_time: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '3px solid #2A2A2A', borderTopColor: '#F15A22',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function SaveBtn({ onClick, loading, label = 'Save Changes' }: { onClick: () => void; loading?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px',
        backgroundColor: '#F15A22', border: 'none', borderRadius: 8,
        color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? <div style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} /> : <Save size={13} />}
      {loading ? 'Saving…' : label}
    </button>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0 }}
    >
      {value
        ? <ToggleRight size={24} color="#F15A22" />
        : <ToggleLeft size={24} color="#444" />}
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
  backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0', outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, color: '#A0A0A0', marginBottom: 6, display: 'block',
}

const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px', borderBottom: '1px solid #2A2A2A',
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>{title}</h3>
      {action}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

// ─── Workshop Rules ────────────────────────────────────────────────────────────

function WorkshopRulesSection({ branchId, tenantId }: { branchId: string | null; tenantId: string | null }) {
  const { user } = useAuthStore()
  const [rules, setRules] = useState<WorkshopRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('workshop_rules').select('*').order('sort_order')
    if (branchId) q = q.eq('branch_id', branchId)
    const { data } = await q
    setRules(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { fetch() }, [fetch])

  const startEdit = (r: WorkshopRule) => {
    setEditingId(r.id); setEditTitle(r.title); setEditDesc(r.description ?? '')
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    await supabase.from('workshop_rules').update({ title: editTitle, description: editDesc }).eq('id', editingId)
    setSaving(false); setEditingId(null); fetch()
  }

  const toggleActive = async (r: WorkshopRule) => {
    await supabase.from('workshop_rules').update({ is_active: !r.is_active }).eq('id', r.id)
    fetch()
  }

  const moveRule = async (r: WorkshopRule, dir: 'up' | 'down') => {
    const idx = rules.findIndex(x => x.id === r.id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= rules.length) return
    const swap = rules[swapIdx]
    await Promise.all([
      supabase.from('workshop_rules').update({ sort_order: swap.sort_order }).eq('id', r.id),
      supabase.from('workshop_rules').update({ sort_order: r.sort_order }).eq('id', swap.id),
    ])
    fetch()
  }

  const addRule = async () => {
    const maxOrder = rules.length > 0 ? Math.max(...rules.map(r => r.sort_order)) + 1 : 1
    const maxRuleNum = rules.length > 0 ? Math.max(...rules.map(r => r.rule_number ?? 0)) + 1 : 1
    const { data, error } = await supabase.from('workshop_rules').insert({
      title: 'New Rule', description: '', is_active: true, sort_order: maxOrder,
      rule_number: maxRuleNum, branch_id: branchId, tenant_id: tenantId,
    }).select().single()
    if (error) { alert('Failed to add rule: ' + error.message); return }
    if (data) {
      logAudit({ action: 'create', module: 'settings', record_id: data.id, record_type: 'workshop_rule', details: { title: 'New Rule' }, branch_id: user?.branch_id, user_id: user?.id, tenant_id: tenantId })
      fetch(); setEditingId(data.id); setEditTitle('New Rule'); setEditDesc('')
    }
  }

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this rule?')) return
    await supabase.from('workshop_rules').delete().eq('id', id)
    fetch()
  }

  return (
    <Card>
      <SectionHeader title="Workshop Rules" action={
        <button
          onClick={addRule}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.3)',
            borderRadius: 8, color: '#F15A22', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        ><Plus size={13} /> Add Rule</button>
      } />
      {loading ? <Spinner /> : rules.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No rules yet. Click "+ Add Rule" to create one.</div>
      ) : (
        <div>
          {rules.map((r, i) => (
            <div
              key={r.id}
              style={{
                borderBottom: '1px solid #1E1E1E', padding: '14px 20px',
                backgroundColor: editingId === r.id ? '#1A1A1A' : 'transparent',
                opacity: r.is_active ? 1 : 0.5,
              }}
            >
              {editingId === r.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    style={inputStyle}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Rule title"
                  />
                  <textarea
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    placeholder="Rule description…"
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <SaveBtn onClick={saveEdit} loading={saving} />
                    <button
                      onClick={() => setEditingId(null)}
                      style={{ padding: '8px 14px', borderRadius: 8, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <span style={{
                    minWidth: 28, height: 28, borderRadius: 8, fontSize: 12, fontWeight: 700,
                    backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F15A22',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0', margin: 0 }}>{r.title}</p>
                    {r.description && <p style={{ fontSize: 12, color: '#A0A0A0', marginTop: 4 }}>{r.description}</p>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => moveRule(r, 'up')} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'not-allowed' : 'pointer', color: '#666', padding: 2 }}>
                        <ChevronUp size={13} />
                      </button>
                      <button onClick={() => moveRule(r, 'down')} disabled={i === rules.length - 1} style={{ background: 'none', border: 'none', cursor: i === rules.length - 1 ? 'not-allowed' : 'pointer', color: '#666', padding: 2 }}>
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    <Toggle value={r.is_active} onChange={() => toggleActive(r)} />
                    <button onClick={() => startEdit(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 4 }}><Edit2 size={14} /></button>
                    <button onClick={() => deleteRule(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 4 }}><Trash2 size={14} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Job Types ─────────────────────────────────────────────────────────────────

function JobTypesSection({ branchId, tenantId }: { branchId: string | null; tenantId: string | null }) {
  const { user } = useAuthStore()
  const [jobTypes, setJobTypes] = useState<JobType[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDuration, setEditDuration] = useState('')
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('job_types').select('*').order('sort_order')
    if (branchId) q = q.eq('branch_id', branchId)
    const { data } = await q
    setJobTypes(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { fetch() }, [fetch])

  const startEdit = (jt: JobType) => {
    setEditingId(jt.id); setEditName(jt.name); setEditDuration(String(jt.default_duration_minutes))
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    await supabase.from('job_types').update({ name: editName, default_duration_minutes: parseInt(editDuration) || 60 }).eq('id', editingId)
    setSaving(false); setEditingId(null); fetch()
  }

  const toggleActive = async (jt: JobType) => {
    await supabase.from('job_types').update({ is_active: !jt.is_active }).eq('id', jt.id)
    fetch()
  }

  const addJobType = async () => {
    const maxOrder = jobTypes.length > 0 ? Math.max(...jobTypes.map(j => j.sort_order)) + 1 : 1
    const { data, error } = await supabase.from('job_types').insert({ name: 'New Job Type', default_duration_minutes: 60, is_active: true, sort_order: maxOrder, branch_id: branchId, tenant_id: tenantId }).select().single()
    if (error) { alert('Failed to add job type: ' + error.message); return }
    if (data) {
      logAudit({ action: 'create', module: 'settings', record_id: data.id, record_type: 'job_type', details: { name: 'New Job Type' }, branch_id: user?.branch_id, user_id: user?.id, tenant_id: tenantId })
      fetch(); setEditingId(data.id); setEditName('New Job Type'); setEditDuration('60')
    }
  }

  const deleteJobType = async (id: string) => {
    if (!confirm('Delete this job type?')) return
    await supabase.from('job_types').delete().eq('id', id)
    fetch()
  }

  return (
    <Card>
      <SectionHeader title="Job Types" action={
        <button
          onClick={addJobType}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.3)',
            borderRadius: 8, color: '#F15A22', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        ><Plus size={13} /> Add Job Type</button>
      } />
      {loading ? <Spinner /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Name', 'Duration (min)', 'Active', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobTypes.map(jt => (
                <tr key={jt.id} style={{ borderBottom: '1px solid #1E1E1E', opacity: jt.is_active ? 1 : 0.5 }}>
                  <td style={{ padding: '10px 20px' }}>
                    {editingId === jt.id ? (
                      <input style={{ ...inputStyle, width: 200 }} value={editName} onChange={e => setEditName(e.target.value)} />
                    ) : (
                      <span style={{ color: '#F0F0F0', fontWeight: 500 }}>{jt.name}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 20px' }}>
                    {editingId === jt.id ? (
                      <input style={{ ...inputStyle, width: 80 }} type="number" min="1" step="1" value={editDuration} onChange={e => setEditDuration(e.target.value)} />
                    ) : (
                      <span style={{ color: '#A0A0A0' }}>{jt.default_duration_minutes} min</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 20px' }}>
                    <Toggle value={jt.is_active} onChange={() => toggleActive(jt)} />
                  </td>
                  <td style={{ padding: '10px 20px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {editingId === jt.id ? (
                        <>
                          <button onClick={saveEdit} disabled={saving} style={{ padding: '4px 10px', borderRadius: 6, backgroundColor: '#F15A22', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                            {saving ? '…' : <><Check size={11} /> Save</>}
                          </button>
                          <button onClick={() => setEditingId(null)} style={{ padding: '4px 10px', borderRadius: 6, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(jt)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><Edit2 size={14} /></button>
                          <button onClick={() => deleteJobType(jt.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobTypes.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No job types yet.</div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── WhatsApp Templates ────────────────────────────────────────────────────────

function highlightVariables(text: string): React.ReactNode[] {
  const parts = text.split(/(\{[^}]+\})/g)
  return parts.map((part, i) =>
    /^\{[^}]+\}$/.test(part)
      ? <span key={i} style={{ backgroundColor: 'rgba(241,90,34,0.15)', color: '#F15A22', borderRadius: 4, padding: '0 2px', fontFamily: 'monospace', fontSize: 12 }}>{part}</span>
      : <span key={i}>{part}</span>
  )
}

const TRIGGER_EVENTS = [
  { value: 'job_created',       label: 'Job Created' },
  { value: 'job_ready',         label: 'Vehicle Ready' },
  { value: 'invoice_sent',      label: 'Invoice Sent' },
  { value: 'payment_received',  label: 'Payment Received' },
  { value: 'booking_confirmed', label: 'Booking Confirmed' },
  { value: 'reminder',          label: 'Reminder' },
]

const TRIGGER_COLORS: Record<string, string> = {
  job_created: '#3B82F6', job_ready: '#22C55E', invoice_sent: '#F59E0B',
  payment_received: '#10B981', booking_confirmed: '#8B5CF6', reminder: '#F97316',
}

function WATemplatesSection({ tenantId, branchId }: { tenantId: string | null; branchId: string | null }) {
  const [templates, setTemplates] = useState<WATemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTrigger, setEditTrigger] = useState('')
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTrigger, setNewTrigger] = useState('job_created')
  const [newBody, setNewBody] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('wa_templates').select('*').order('name')
    setTemplates(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const createTemplate = async () => {
    if (!newName.trim() || !newBody.trim()) { alert('Name and message body are required.'); return }
    setCreating(true)
    const { error } = await supabase.from('wa_templates').insert({
      name: newName.trim(), trigger_event: newTrigger, body: newBody.trim(),
      is_active: true, tenant_id: tenantId, branch_id: branchId,
    })
    if (error) { alert('Failed to create template: ' + error.message); setCreating(false); return }
    setCreating(false); setShowCreate(false); setNewName(''); setNewTrigger('job_created'); setNewBody('')
    fetchTemplates()
  }

  const startEdit = (t: WATemplate) => {
    setEditingId(t.id); setEditName(t.name); setEditTrigger(t.trigger_event); setEditBody(t.body)
  }

  const saveTemplate = async (id: string) => {
    setSaving(true)
    await supabase.from('wa_templates').update({ name: editName, trigger_event: editTrigger, body: editBody }).eq('id', id)
    setSaving(false); setEditingId(null); fetchTemplates()
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return
    await supabase.from('wa_templates').delete().eq('id', id)
    fetchTemplates()
  }

  const toggleActive = async (t: WATemplate) => {
    await supabase.from('wa_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    fetchTemplates()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
            Auto-send messages to customers when job status changes. Use <code style={{ color: '#F15A22', fontSize: 12 }}>{'{{variable}}'}</code> for dynamic values.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', flexShrink: 0,
            backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.3)',
            borderRadius: 8, color: '#F15A22', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        ><Plus size={13} /> Add Template</button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 14,
            padding: 24, width: 540, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>New WhatsApp Template</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Template Name</label>
              <input style={inputStyle} placeholder="e.g. Payment Reminder" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Trigger Event</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={newTrigger} onChange={e => setNewTrigger(e.target.value)}>
                {TRIGGER_EVENTS.map(te => <option key={te.value} value={te.value}>{te.label}</option>)}
              </select>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Message Body</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: 140, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}
                placeholder={'Hi {{customer_name}}, your vehicle {{plate_number}} is ready...'}
                value={newBody}
                onChange={e => setNewBody(e.target.value)}
              />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#555' }}>
                Variables: {'{{customer_name}}'} {'{{plate_number}}'} {'{{job_number}}'} {'{{job_type}}'} {'{{appointment_date}}'} {'{{total_amount}}'} {'{{amount_paid}}'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: '8px 16px', borderRadius: 8, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={createTemplate} disabled={creating} style={{ padding: '8px 18px', borderRadius: 8, backgroundColor: '#F15A22', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}>
                {creating ? 'Creating…' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? <Spinner /> : templates.length === 0 ? (
        <Card>
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No templates yet. Click "+ Add Template" to create one.</div>
        </Card>
      ) : (
        templates.map(t => {
          const triggerColor = TRIGGER_COLORS[t.trigger_event] ?? '#A0A0A0'
          return (
            <Card key={t.id}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>{t.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '0.05em',
                    backgroundColor: `${triggerColor}18`, color: triggerColor,
                  }}>{t.trigger_event?.replace(/_/g, ' ')}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Toggle value={t.is_active} onChange={() => toggleActive(t)} />
                  <button onClick={() => startEdit(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><Edit2 size={14} /></button>
                  <button onClick={() => deleteTemplate(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><Trash2 size={14} /></button>
                </div>
              </div>
              <div style={{ padding: '14px 20px' }}>
                {editingId === t.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={fieldStyle}>
                        <label style={labelStyle}>Name</label>
                        <input style={inputStyle} value={editName} onChange={e => setEditName(e.target.value)} />
                      </div>
                      <div style={fieldStyle}>
                        <label style={labelStyle}>Trigger</label>
                        <select style={{ ...inputStyle, cursor: 'pointer' }} value={editTrigger} onChange={e => setEditTrigger(e.target.value)}>
                          {TRIGGER_EVENTS.map(te => <option key={te.value} value={te.value}>{te.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <textarea
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 120, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
                      value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <SaveBtn onClick={() => saveTemplate(t.id)} loading={saving} />
                      <button onClick={() => setEditingId(null)} style={{ padding: '8px 14px', borderRadius: 8, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '12px 14px', borderRadius: 8, backgroundColor: '#0E0E0E', border: '1px solid #1E1E1E', fontSize: 13, color: '#A0A0A0', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {highlightVariables(t.body)}
                  </div>
                )}
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}

// ─── Status Colors ─────────────────────────────────────────────────────────────

function StatusColorsSection({ tenantId }: { tenantId: string | null }) {
  const [statuses, setStatuses] = useState<StatusColor[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editKey, setEditKey] = useState('')
  const [editColor, setEditColor] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newColor, setNewColor] = useState('#3B82F6')
  const [creating, setCreating] = useState(false)

  const fetchColors = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('status_colors').select('*').order('status_key')
    setStatuses(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchColors() }, [fetchColors])

  const createColor = async () => {
    if (!newLabel.trim() || !newKey.trim()) { alert('Label and status key are required.'); return }
    if (!/^[a-z_]+$/.test(newKey)) { alert('Status key must be lowercase letters and underscores only.'); return }
    if (!/^#[0-9A-Fa-f]{6}$/.test(newColor)) { alert('Enter a valid hex color.'); return }
    setCreating(true)
    const { error } = await supabase.from('status_colors').insert({ label: newLabel.trim(), status_key: newKey.trim(), color_hex: newColor, tenant_id: tenantId })
    if (error) { alert('Failed: ' + error.message); setCreating(false); return }
    setCreating(false); setShowCreate(false); setNewLabel(''); setNewKey(''); setNewColor('#3B82F6')
    fetchColors()
  }

  const saveColor = async (id: string) => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(editColor)) { alert('Invalid hex color.'); return }
    setSaving(true)
    await supabase.from('status_colors').update({ label: editLabel, status_key: editKey, color_hex: editColor }).eq('id', id)
    setSaving(false); setEditingId(null); fetchColors()
  }

  const deleteColor = async (id: string) => {
    if (!confirm('Delete this status color?')) return
    await supabase.from('status_colors').delete().eq('id', id)
    fetchColors()
  }

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
            backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.3)',
            borderRadius: 8, color: '#F15A22', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        ><Plus size={13} /> Add Status</button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, padding: 24, width: 400, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>New Status Color</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Label</label>
              <input style={inputStyle} placeholder="e.g. In Progress" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Status Key <span style={{ color: '#555', fontWeight: 400 }}>(lowercase, underscores)</span></label>
              <input style={{ ...inputStyle, fontFamily: 'monospace' }} placeholder="e.g. in_progress" value={newKey} onChange={e => setNewKey(e.target.value.toLowerCase().replace(/[^a-z_]/g, ''))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 40, height: 36, borderRadius: 6, border: '1px solid #2A2A2A', backgroundColor: '#0E0E0E', cursor: 'pointer', padding: 2 }} />
                <input style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} value={newColor} onChange={e => setNewColor(e.target.value)} placeholder="#3B82F6" />
                <span style={{ padding: '4px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600, backgroundColor: `${newColor}20`, color: newColor }}>{newLabel || 'Preview'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: '8px 16px', borderRadius: 8, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={createColor} disabled={creating} style={{ padding: '8px 18px', borderRadius: 8, backgroundColor: '#F15A22', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      <Card>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {statuses.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No status colors yet.</div>
          )}
          {statuses.map(s => (
            <div key={s.id} style={{ backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 10, padding: '12px 14px' }}>
              {editingId === s.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input style={{ ...inputStyle, fontSize: 12 }} placeholder="Label" value={editLabel} onChange={e => setEditLabel(e.target.value)} />
                  <input style={{ ...inputStyle, fontSize: 12, fontFamily: 'monospace' }} placeholder="status_key" value={editKey} onChange={e => setEditKey(e.target.value.toLowerCase().replace(/[^a-z_]/g, ''))} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} style={{ width: 36, height: 32, borderRadius: 6, border: '1px solid #2A2A2A', backgroundColor: '#0E0E0E', cursor: 'pointer', padding: 2 }} />
                    <input style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 12 }} value={editColor} onChange={e => setEditColor(e.target.value)} placeholder="#F15A22" />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => saveColor(s.id)} disabled={saving} style={{ flex: 1, padding: '6px', borderRadius: 6, backgroundColor: '#F15A22', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>{saving ? '…' : 'Save'}</button>
                    <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: '6px', borderRadius: 6, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600, backgroundColor: `${s.color_hex}20`, color: s.color_hex }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: s.color_hex }} />
                      {s.label}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { setEditingId(s.id); setEditLabel(s.label); setEditKey(s.status_key); setEditColor(s.color_hex) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><Edit2 size={13} /></button>
                      <button onClick={() => deleteColor(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: '#555', margin: 0, fontFamily: 'monospace' }}>{s.status_key}</p>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ─── Branch Settings ───────────────────────────────────────────────────────────

function BranchSettingsSection({ branchId }: { branchId: string | null }) {
  const [branch, setBranch] = useState<BranchSettings | null>(null)
  const [form, setForm] = useState<Partial<BranchSettings>>({})
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState('')

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !branchId) return
    if (!file.type.startsWith('image/')) { setLogoError('Please select an image file'); return }
    if (file.size > 2 * 1024 * 1024) { setLogoError('Image must be under 2 MB'); return }
    setLogoError('')
    setLogoUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${branchId}/logo.${ext}`
    const { error: upErr } = await supabase.storage.from('branch-logos').upload(path, file, { upsert: true })
    if (upErr) { setLogoError(upErr.message); setLogoUploading(false); return }
    const { data: urlData } = supabase.storage.from('branch-logos').getPublicUrl(path)
    const logo_url = urlData.publicUrl + '?t=' + Date.now()
    await supabase.from('branches').update({ logo_url }).eq('id', branchId)
    setForm(f => ({ ...f, logo_url }))
    setLogoUploading(false)
  }

  async function handleLogoRemove() {
    if (!branchId) return
    await supabase.from('branches').update({ logo_url: null }).eq('id', branchId)
    setForm(f => ({ ...f, logo_url: null }))
  }

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!branchId) { setLoading(false); return }
    supabase.from('branches').select('*').eq('id', branchId).single().then(({ data }) => {
      setBranch(data); setForm(data ?? {}); setLoading(false)
    })
  }, [branchId])

  const set = (key: keyof BranchSettings, val: string | number) =>
    setForm(f => ({ ...f, [key]: val }))

  const save = async () => {
    if (!branchId) return
    setSaving(true)
    await supabase.from('branches').update({
      name: form.name, address: form.address, phone: form.phone,
      email: form.email, geofence_radius_m: form.geofence_radius_m,
      code: (form.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || null,
      logo_url: form.logo_url ?? null,
      bank_name: form.bank_name ?? null,
      bank_account_number: form.bank_account_number ?? null,
      bank_account_name: form.bank_account_name ?? null,
    }).eq('id', branchId)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  if (!branchId) return (
    <Card>
      <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>Select a branch to manage its settings.</div>
    </Card>
  )

  return (
    <Card>
      <SectionHeader title="Branch Settings" />
      {loading ? <Spinner /> : (
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Branch Name</label>
              <input style={inputStyle} value={form.name ?? ''} onChange={e => set('name', e.target.value)} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, alignItems: 'start' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Branch Code</label>
              <input
                style={inputStyle}
                value={form.code ?? ''}
                onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                placeholder="e.g. MV, HQ, PJ"
                maxLength={5}
              />
              <span style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                Used as prefix for job numbers — e.g. <strong style={{ color: '#F15A22' }}>{(form.code || 'MV')}-2026-0001</strong>
              </span>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Geofence Radius (metres)</label>
              <input style={inputStyle} type="number" min="50" step="10" value={form.geofence_radius_m ?? 200} onChange={e => set('geofence_radius_m', parseInt(e.target.value))} />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Address</label>
            <input style={inputStyle} value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
          </div>

          {/* Company Logo */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Company Logo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Preview */}
              <div style={{
                width: 96, height: 96, borderRadius: 12, border: '2px dashed #2A2A2A',
                backgroundColor: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                {form.logo_url ? (
                  <img src={form.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6 }} />
                ) : (
                  <span style={{ fontSize: 11, color: '#4A4A4A', textAlign: 'center', padding: 8 }}>No logo</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8,
                  padding: '8px 16px', cursor: logoUploading ? 'not-allowed' : 'pointer',
                  fontSize: 13, color: '#F0F0F0', opacity: logoUploading ? 0.6 : 1,
                }}>
                  {logoUploading ? '⏳ Uploading…' : '📁 Choose Image'}
                  <input type="file" accept="image/*" onChange={handleLogoUpload} disabled={logoUploading} style={{ display: 'none' }} />
                </label>
                {form.logo_url && (
                  <button onClick={handleLogoRemove} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', color: '#F87171', fontSize: 12 }}>
                    Remove Logo
                  </button>
                )}
                <span style={{ fontSize: 11, color: '#6B7280' }}>PNG, JPG or SVG · max 2 MB</span>
                {logoError && <span style={{ fontSize: 12, color: '#F87171' }}>{logoError}</span>}
              </div>
            </div>
          </div>

          {/* Bank Details */}
          <div style={{ borderTop: '1px solid #2A2A2A', paddingTop: 20, marginTop: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#A0A0A0', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Bank Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Bank Name</label>
                <input style={inputStyle} value={form.bank_name ?? ''} onChange={e => set('bank_name', e.target.value)} placeholder="e.g. CIMB Bank Berhad" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Account Number</label>
                <input style={inputStyle} value={form.bank_account_number ?? ''} onChange={e => set('bank_account_number', e.target.value)} placeholder="e.g. 8604559324" />
              </div>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Account Name</label>
              <input style={inputStyle} value={form.bank_account_name ?? ''} onChange={e => set('bank_account_name', e.target.value)} placeholder="e.g. Your Company Sdn Bhd" />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SaveBtn onClick={save} loading={saving} />
            {saved && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#22C55E' }}>
                <Check size={14} /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Working Hours ─────────────────────────────────────────────────────────────

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function WorkingHoursSection({ branchId }: { branchId: string | null }) {
  const [wh, setWH] = useState<WorkingHours | null>(null)
  const [form, setForm] = useState<Partial<WorkingHours>>({
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    work_start_time: '09:00', work_end_time: '18:00',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!branchId) { setLoading(false); return }
    supabase
      .from('branches')
      .select('id, work_days, work_start_time, work_end_time')
      .eq('id', branchId)
      .single()
      .then(({ data }) => {
        if (data) {
          setWH(data as WorkingHours)
          setForm({
            work_days: (data as any).work_days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            work_start_time: (data as any).work_start_time ?? '09:00',
            work_end_time: (data as any).work_end_time ?? '18:00',
          })
        }
        setLoading(false)
      })
  }, [branchId])

  const toggleDay = (day: string) => {
    const days = form.work_days ?? []
    setForm(f => ({
      ...f,
      work_days: days.includes(day) ? days.filter(d => d !== day) : [...days, day],
    }))
  }

  const save = async () => {
    if (!branchId) return
    setSaving(true)
    await supabase.from('branches').update({
      work_days: form.work_days,
      work_start_time: form.work_start_time,
      work_end_time: form.work_end_time,
    }).eq('id', branchId)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card>
      <SectionHeader title="Working Hours" />
      {loading ? <Spinner /> : (
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Work days */}
          <div>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Work Days</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ALL_DAYS.map(day => {
                const active = (form.work_days ?? []).includes(day)
                return (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    style={{
                      padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      backgroundColor: active ? 'rgba(241,90,34,0.15)' : '#1E1E1E',
                      color: active ? '#F15A22' : '#666',
                      border: `1px solid ${active ? 'rgba(241,90,34,0.35)' : '#2A2A2A'}`,
                      transition: 'all 0.15s',
                    }}
                  >{day}</button>
                )
              })}
            </div>
          </div>

          {/* Times */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Start Time</label>
              <input
                type="time"
                style={inputStyle}
                value={form.work_start_time ?? '09:00'}
                onChange={e => setForm(f => ({ ...f, work_start_time: e.target.value }))}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>End Time</label>
              <input
                type="time"
                style={inputStyle}
                value={form.work_end_time ?? '18:00'}
                onChange={e => setForm(f => ({ ...f, work_end_time: e.target.value }))}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SaveBtn onClick={save} loading={saving} />
            {saved && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#22C55E' }}>
                <Check size={14} /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Customer Portal Settings ──────────────────────────────────────────────────

interface TenantPortalSettings {
  google_review_link: string | null
  whatsapp_number: string | null
  wati_api_key: string | null
  sst_rate: number
}

function CustomerPortalSection({ tenantId }: { tenantId: string | null }) {
  const [form, setForm] = useState<TenantPortalSettings>({
    google_review_link: null,
    whatsapp_number: null,
    wati_api_key: null,
    sst_rate: 0,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (!tenantId) { setLoading(false); return }
    supabase
      .from('tenants')
      .select('google_review_link, whatsapp_number, wati_api_key')
      .eq('id', tenantId)
      .single()
      .then(({ data }) => {
        if (data) setForm({ ...data, sst_rate: data.sst_rate ?? 0 } as TenantPortalSettings)
        setLoading(false)
      })
  }, [tenantId])

  const save = async () => {
    if (!tenantId) return
    setSaving(true)
    await supabase.from('tenants').update({
      google_review_link: form.google_review_link?.trim() || null,
      whatsapp_number: form.whatsapp_number?.trim() || null,
      wati_api_key: form.wati_api_key?.trim() || null,
      sst_rate: form.sst_rate,
    }).eq('id', tenantId)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const set = (key: keyof TenantPortalSettings, val: string) =>
    setForm(f => ({ ...f, [key]: val }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Info banner */}
      <div style={{
        padding: '14px 18px', borderRadius: 10,
        backgroundColor: 'rgba(241,90,34,0.07)', border: '1px solid rgba(241,90,34,0.2)',
        fontSize: 13, color: '#A0A0A0', lineHeight: 1.6,
      }}>
        Configure WhatsApp notifications and Google Review prompts for your customer portal.
        Customers will receive a WhatsApp message at every status change, and a Google Review
        link when their vehicle is collected.
      </div>

      {/* Tax / SST */}
      <Card>
        <SectionHeader title="Tax Settings" />
        {loading ? <Spinner /> : (
          <div style={{ padding: 24 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>SST Rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                style={{ ...inputStyle, width: 120 }}
                value={form.sst_rate}
                onChange={e => setForm(f => ({ ...f, sst_rate: parseFloat(e.target.value) || 0 }))}
              />
              <span style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                Set to 0 if not SST-registered. Enter 8 for 8% SST. Applied automatically to all new invoices.
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Google Review */}
      <Card>
        <SectionHeader title="Google Review" />
        {loading ? <Spinner /> : (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Google Review Link</label>
              <input
                style={inputStyle}
                placeholder="https://g.page/r/your-place-id/review"
                value={form.google_review_link ?? ''}
                onChange={e => set('google_review_link', e.target.value)}
              />
              <span style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                Go to Google Maps → your business → Share → Copy link. Sent to customer automatically when job status is "Collected".
              </span>
            </div>
            {form.google_review_link && (
              <a
                href={form.google_review_link}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#F15A22', textDecoration: 'none' }}
              >
                <Globe size={13} /> Test link
              </a>
            )}
          </div>
        )}
      </Card>

      {/* WhatsApp / WATI */}
      <Card>
        <SectionHeader title="WhatsApp Notifications (WATI)" />
        {loading ? <Spinner /> : (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>WhatsApp Business Number</label>
              <input
                style={inputStyle}
                placeholder="+60123456789"
                value={form.whatsapp_number ?? ''}
                onChange={e => set('whatsapp_number', e.target.value)}
              />
              <span style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                The WhatsApp number registered with WATI. Include country code (e.g. +601X).
              </span>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>WATI API Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  style={{ ...inputStyle, paddingRight: 40 }}
                  placeholder="eyJhbGciOi…"
                  value={form.wati_api_key ?? ''}
                  onChange={e => set('wati_api_key', e.target.value)}
                />
                <button
                  onClick={() => setShowKey(v => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 4,
                  }}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <span style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                From WATI dashboard → Settings → API. Keep this secret — never share it.
              </span>
            </div>

            {/* How to get WATI */}
            <div style={{
              padding: '12px 16px', borderRadius: 8,
              backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A',
              fontSize: 12, color: '#6B7280', lineHeight: 1.7,
            }}>
              <strong style={{ color: '#A0A0A0', display: 'block', marginBottom: 4 }}>Getting started with WATI</strong>
              1. Sign up at wati.io (free trial available)<br />
              2. Connect your WhatsApp Business number<br />
              3. Create message templates for job status updates<br />
              4. Copy your API key from WATI → Settings → API Access<br />
              5. Paste it above and save
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SaveBtn onClick={save} loading={saving} />
        {saved && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#22C55E' }}>
            <Check size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type SettingsTab = 'rules' | 'job_types' | 'wa_templates' | 'status_colors' | 'branch' | 'working_hours' | 'portal'

const TABS: { key: SettingsTab; label: string; icon: React.ElementType }[] = [
  { key: 'rules',         label: 'Workshop Rules',      icon: BookOpen },
  { key: 'job_types',     label: 'Job Types',           icon: Wrench },
  { key: 'wa_templates',  label: 'WhatsApp Templates',  icon: MessageSquare },
  { key: 'status_colors', label: 'Status Colors',       icon: Palette },
  { key: 'branch',        label: 'Branch Settings',     icon: Building2 },
  { key: 'working_hours', label: 'Working Hours',       icon: Clock },
  { key: 'portal',        label: 'Customer Portal',     icon: Globe },
]

export function SettingsPage() {
  const user = useAuthStore(s => s.user)
  const branchId = user?.role === 'super_admin' ? null : (user?.branch_id ?? null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('rules')

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: '#0E0E0E', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: '1px solid #2A2A2A',
        display: 'flex', flexDirection: 'column', padding: '20px 0',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 20px 12px' }}>Settings</p>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400,
              color: activeTab === t.key ? '#F0F0F0' : '#A0A0A0',
              backgroundColor: activeTab === t.key ? '#161616' : 'transparent',
              borderLeft: activeTab === t.key ? '2px solid #F15A22' : '2px solid transparent',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <t.icon size={15} color={activeTab === t.key ? '#F15A22' : '#666'} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {activeTab === 'rules'         && <WorkshopRulesSection branchId={branchId} tenantId={user?.tenant_id ?? null} />}
        {activeTab === 'job_types'     && <JobTypesSection branchId={branchId} tenantId={user?.tenant_id ?? null} />}
        {activeTab === 'wa_templates'  && <WATemplatesSection tenantId={user?.tenant_id ?? null} branchId={branchId} />}
        {activeTab === 'status_colors' && <StatusColorsSection tenantId={user?.tenant_id ?? null} />}
        {activeTab === 'branch'        && <BranchSettingsSection branchId={branchId} />}
        {activeTab === 'working_hours' && <WorkingHoursSection branchId={branchId} />}
        {activeTab === 'portal'        && <CustomerPortalSection tenantId={user?.tenant_id ?? null} />}
      </div>
    </div>
  )
}
