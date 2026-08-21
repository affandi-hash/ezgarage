import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, Plus, Loader2, X, Check, Trash2, ChevronLeft, ChevronDown, Sparkles, Wallet, CalendarRange, Upload, FileClock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import { BusinessAnalysisPanel } from '@/components/sales-marketing/BusinessAnalysisPanel'

const HISTORY_UPLOADS_BUCKET = 'sales-marketing-uploads'
const ACCEPTED_HISTORY_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
const HISTORICAL_METRIC_LABELS: Record<string, string> = {
  revenue: 'Revenue (RM)', net_profit: 'Net Profit/Loss (RM)', reach: 'Reach',
  leads: 'Leads', prospects: 'Prospects', google_reviews_count: 'Google Reviews (count)',
  google_reviews_rating: 'Google Rating', spend: 'Spend (RM)',
}
const HISTORICAL_METRIC_KEYS = Object.keys(HISTORICAL_METRIC_LABELS)

interface ExtractedEntry { period_month: string; metric_key: string; value: number }

interface Plan {
  id: string
  title: string
  period_start: string
  period_end: string
  theme: string | null
  target_segment_names: string[] | null
  budget_allocated_myr: number | null
  status: 'draft' | 'active' | 'completed' | 'archived'
  ai_rationale: string | null
  created_at: string
  generation_tokens: number | null
}

interface Initiative {
  id: string
  plan_id: string
  description: string
  summary: string | null
  category: 'sales' | 'fixing' | 'other' | null
  channel: string | null
  owner_text: string | null
  due_date: string | null
  status: 'todo' | 'in_progress' | 'done'
  priority_rank: number | null
}

const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }
const inputStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0',
  borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const smallInputStyle: React.CSSProperties = { ...inputStyle, padding: '7px 10px', fontSize: 12 }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 5, color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }
const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
  backgroundColor: `${color}22`, color, textTransform: 'uppercase' as const, letterSpacing: '0.03em',
})

const STATUS_COLORS: Record<Plan['status'], string> = { draft: '#6A6A6A', active: '#F15A22', completed: '#7FB88F', archived: '#5A5A5A' }
const INITIATIVE_STATUS_CYCLE: Initiative['status'][] = ['todo', 'in_progress', 'done']
const INITIATIVE_STATUS_LABEL: Record<Initiative['status'], string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' }
const INITIATIVE_STATUS_COLOR: Record<Initiative['status'], string> = { todo: '#6A6A6A', in_progress: '#F59E0B', done: '#7FB88F' }

type Category = 'sales' | 'fixing' | 'other'
const CATEGORY_LABEL: Record<Category, string> = { sales: 'Sales', fixing: 'Fixing', other: 'Other' }
const CATEGORY_COLOR: Record<Category, string> = { sales: '#4F9DDE', fixing: '#F15A22', other: '#8A8A8A' }
const categoryOf = (item: Initiative): Category => item.category ?? 'other'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function GenerateForm({ onGenerate, onCancel, generating }: {
  onGenerate: (input: { title: string; period_start: string; period_end: string; focus_notes: string }) => void
  onCancel: () => void
  generating: boolean
}) {
  const [title, setTitle] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [focusNotes, setFocusNotes] = useState('')

  const canSubmit = title.trim() && periodStart && periodEnd && !generating

  return (
    <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={15} color="#F15A22" />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Generate a new plan</div>
      </div>
      <p style={{ fontSize: 12, color: '#6A6A6A', margin: 0, lineHeight: 1.5 }}>
        Izzy will draft this plan from your real job and revenue history for the same period, plus everything on file in your Business Profile.
      </p>
      <div>
        <label style={labelStyle}>Title</label>
        <input style={inputStyle} placeholder="e.g. March 2026 Plan" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Period start</label>
          <input type="date" style={inputStyle} value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Period end</label>
          <input type="date" style={inputStyle} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Focus notes (optional)</label>
        <textarea style={{ ...inputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }} rows={2}
          placeholder="Anything specific you want this plan to prioritize"
          value={focusNotes} onChange={e => setFocusNotes(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={generating}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 14px', borderRadius: 8, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer' }}>
          <X size={12} /> Cancel
        </button>
        <button onClick={() => canSubmit && onGenerate({ title, period_start: periodStart, period_end: periodEnd, focus_notes: focusNotes })}
          disabled={!canSubmit}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 12, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.5 }}>
          {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {generating ? 'Izzy is drafting...' : 'Generate plan'}
        </button>
      </div>
    </div>
  )
}

function AddInitiativeForm({ onSave, onCancel }: { onSave: (input: Partial<Initiative>) => void; onCancel: () => void }) {
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<Category>('other')
  const [channel, setChannel] = useState('')
  const [ownerText, setOwnerText] = useState('')
  const [dueDate, setDueDate] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E' }}>
      <input style={smallInputStyle} placeholder="Short summary, e.g. Chase unpaid invoices from July" value={summary} onChange={e => setSummary(e.target.value)} autoFocus />
      <textarea style={{ ...smallInputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }} rows={2}
        placeholder="Fuller detail (optional) -- why this matters, what done looks like" value={description} onChange={e => setDescription(e.target.value)} />
      <div style={{ display: 'flex', gap: 6 }}>
        <select style={smallInputStyle} value={category} onChange={e => setCategory(e.target.value as Category)}>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <input style={smallInputStyle} placeholder="Channel, e.g. instagram" value={channel} onChange={e => setChannel(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={smallInputStyle} placeholder="Owner" value={ownerText} onChange={e => setOwnerText(e.target.value)} />
        <input style={smallInputStyle} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer' }}>
          <X size={12} /> Cancel
        </button>
        <button onClick={() => summary.trim() && onSave({
          summary: summary.trim(), description: description.trim() || summary.trim(), category,
          channel: channel || null, owner_text: ownerText || null, due_date: dueDate || null,
        })}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: 'none', background: '#F15A22', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <Check size={12} /> Add
        </button>
      </div>
    </div>
  )
}

function HistoricalImportSection({ businessProfileId, tenantId, userId }: {
  businessProfileId: string
  tenantId: string
  userId: string
}) {
  const [uploading, setUploading] = useState(false)
  const [entries, setEntries] = useState<ExtractedEntry[] | null>(null)
  const [notes, setNotes] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED_HISTORY_TYPES.includes(file.type)) { toast.error('Only JPEG, PNG, WebP, or PDF files are supported'); return }
    if (file.size > 10 * 1024 * 1024) { toast.error('File must be under 10MB'); return }

    setUploading(true)
    setEntries(null)
    setNotes('')
    try {
      const ext = file.name.split('.').pop() || 'bin'
      const path = `${businessProfileId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage.from(HISTORY_UPLOADS_BUCKET).upload(path, file, { contentType: file.type })
      if (uploadErr) { toast.error('Upload failed: ' + uploadErr.message); return }

      const { data, error } = await supabase.functions.invoke('sales-marketing-historical-import', { body: { filePath: path } })
      if (error) { toast.error('Could not read this file right now'); return }
      if (data?.error) { toast.error(data.error); return }

      setEntries((data.entries ?? []) as ExtractedEntry[])
      setNotes(data.notes ?? '')
      setFilePath(path)
      setFileName(file.name)
    } finally {
      setUploading(false)
    }
  }

  function updateEntry(i: number, patch: Partial<ExtractedEntry>) {
    setEntries(prev => prev ? prev.map((e, idx) => idx === i ? { ...e, ...patch } : e) : prev)
  }
  function removeEntry(i: number) {
    setEntries(prev => prev ? prev.filter((_, idx) => idx !== i) : prev)
  }
  function addEntry() {
    setEntries(prev => [...(prev ?? []), { period_month: '', metric_key: 'revenue', value: 0 }])
  }

  async function handleSave() {
    if (!entries || entries.length === 0) return
    const valid = entries.filter(e => /^\d{4}-\d{2}-01$/.test(e.period_month) && HISTORICAL_METRIC_KEYS.includes(e.metric_key))
    if (valid.length === 0) { toast.error('No valid rows to save -- period must be YYYY-MM-01'); return }

    setSaving(true)
    const { error } = await supabase.from('sales_marketing_period_metrics').insert(
      valid.map(e => ({
        tenant_id: tenantId, branch_id: null, period_month: e.period_month, channel: null,
        metric_key: e.metric_key, value: e.value, source: 'ai_extracted_historical',
        source_file_url: filePath, updated_by: userId,
      }))
    )
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Saved ${valid.length} historical entr${valid.length === 1 ? 'y' : 'ies'}`)
    setEntries(null)
    setNotes('')
    setFilePath(null)
  }

  return (
    <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileClock size={15} color="#F15A22" />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Import historical data</div>
      </div>
      <p style={{ fontSize: 12, color: '#6A6A6A', margin: 0, lineHeight: 1.5 }}>
        Upload an old report (a chart screenshot, a dashboard export, a PDF) from before you started using this system.
        Izzy will read it and pull out monthly figures for you to review -- nothing is saved until you confirm.
      </p>

      <input ref={fileInputRef} type="file" accept={ACCEPTED_HISTORY_TYPES.join(',')} onChange={handleFileSelect} style={{ display: 'none' }} />
      {!entries && (
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8, border: '1px dashed #2A2A2A', background: 'none', color: '#A0A0A0', fontSize: 12, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', alignSelf: 'flex-start' }}>
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? 'Reading file...' : 'Upload a file'}
        </button>
      )}

      {entries && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#8A8A8A' }}>From <strong style={{ color: '#C0C0C0' }}>{fileName}</strong> -- review before saving:</div>
          {notes && (
            <div style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 12, color: '#D9A441' }}>
              {notes}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map((entry, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="month" style={{ ...smallInputStyle, flex: 1 }}
                  value={entry.period_month ? entry.period_month.slice(0, 7) : ''}
                  onChange={e => updateEntry(i, { period_month: e.target.value ? `${e.target.value}-01` : '' })} />
                <select style={{ ...smallInputStyle, flex: 1.3 }} value={entry.metric_key} onChange={e => updateEntry(i, { metric_key: e.target.value })}>
                  {HISTORICAL_METRIC_KEYS.map(k => <option key={k} value={k}>{HISTORICAL_METRIC_LABELS[k]}</option>)}
                </select>
                <input type="number" style={{ ...smallInputStyle, flex: 1 }} value={entry.value}
                  onChange={e => updateEntry(i, { value: Number(e.target.value) })} />
                <button onClick={() => removeEntry(i)} style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <button onClick={addEntry} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#F15A22', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 4 }}>
              <Plus size={12} /> Add row
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setEntries(null); setNotes(''); setFilePath(null) }} disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 14px', borderRadius: 8, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer' }}>
                <X size={12} /> Discard
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {saving ? 'Saving...' : `Save ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function MarketingPlanPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)
  const [businessProfileId, setBusinessProfileId] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [initiatives, setInitiatives] = useState<Initiative[]>([])
  const [loadingInitiatives, setLoadingInitiatives] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category>('all')
  const [sortBy, setSortBy] = useState<'priority' | 'due_date'>('priority')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showGenerateForm, setShowGenerateForm] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [addingInitiative, setAddingInitiative] = useState(false)
  const [lastReply, setLastReply] = useState<string | null>(null)
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    supabase.from('sales_marketing_business_profile').select('id').eq('tenant_id', user.tenant_id).maybeSingle()
      .then(async ({ data: profile, error }) => {
        if (error) { toast.error(error.message); setLoading(false); return }
        setHasProfile(!!profile)
        setBusinessProfileId(profile?.id ?? null)
        if (!profile) { setLoading(false); return }
        const { data: planRows, error: plansErr } = await supabase.from('sales_marketing_plans')
          .select('*').eq('business_profile_id', profile.id).order('period_start', { ascending: false })
        if (plansErr) toast.error(plansErr.message)
        setPlans(planRows ?? [])
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [user?.tenant_id])

  function loadInitiatives(planId: string) {
    setLoadingInitiatives(true)
    supabase.from('sales_marketing_plan_initiatives').select('*').eq('plan_id', planId)
      .order('priority_rank', { nullsFirst: false }).order('created_at')
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setInitiatives(data ?? [])
        setLoadingInitiatives(false)
      })
  }

  function openPlan(planId: string) {
    setSelectedPlanId(planId)
    setLastReply(null)
    loadInitiatives(planId)
  }

  async function handleGenerate(input: { title: string; period_start: string; period_end: string; focus_notes: string }) {
    setGenerating(true)
    const { data, error } = await supabase.functions.invoke('sales-marketing-plan-generator', { body: input })
    setGenerating(false)
    if (error) { toast.error('Izzy could not generate the plan right now'); return }
    if (data?.error) { toast.error(data.error); return }
    setPlans(prev => [data.plan as Plan, ...prev])
    setInitiatives((data.initiatives ?? []) as Initiative[])
    setSelectedPlanId(data.plan.id)
    setLastReply(data.reply ?? null)
    setShowGenerateForm(false)
    toast.success('Plan generated')
  }

  async function addInitiative(input: Partial<Initiative>) {
    if (!selectedPlanId) return
    const { data, error } = await supabase.from('sales_marketing_plan_initiatives')
      .insert({ ...input, tenant_id: user?.tenant_id, plan_id: selectedPlanId })
      .select('*').single()
    if (error) { toast.error(error.message); return }
    setInitiatives(prev => [...prev, data as Initiative])
    setAddingInitiative(false)
  }

  async function cycleInitiativeStatus(item: Initiative) {
    const next = INITIATIVE_STATUS_CYCLE[(INITIATIVE_STATUS_CYCLE.indexOf(item.status) + 1) % INITIATIVE_STATUS_CYCLE.length]
    const { data, error } = await supabase.from('sales_marketing_plan_initiatives')
      .update({ status: next }).eq('id', item.id).select('*').single()
    if (error) { toast.error(error.message); return }
    setInitiatives(prev => prev.map(i => i.id === item.id ? (data as Initiative) : i))
  }

  async function deleteInitiative(id: string) {
    const { error } = await supabase.from('sales_marketing_plan_initiatives').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setInitiatives(prev => prev.filter(i => i.id !== id))
  }

  async function updatePlanStatus(status: Plan['status']) {
    if (!selectedPlanId) return
    const { data, error } = await supabase.from('sales_marketing_plans').update({ status }).eq('id', selectedPlanId).select('*').single()
    if (error) { toast.error(error.message); return }
    setPlans(prev => prev.map(p => p.id === selectedPlanId ? (data as Plan) : p))
  }

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const visibleInitiatives = initiatives
    .filter(item => categoryFilter === 'all' || categoryOf(item) === categoryFilter)
    .slice()
    .sort((a, b) => {
      if (sortBy === 'due_date') {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      }
      return (a.priority_rank ?? 999) - (b.priority_rank ?? 999)
    })

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null

  if (loading) {
    return <div style={{ padding: 24, color: '#6A6A6A', fontSize: 13 }}>Loading...</div>
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(241,90,34,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Target size={18} color="#F15A22" />
        </div>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Marketing Plan</h1>
          <p style={{ fontSize: 12, color: '#6A6A6A', margin: '2px 0 0' }}>Plans grounded in your real job and revenue history, drafted by Izzy</p>
        </div>
      </div>

      {hasProfile === false ? (
        <div style={{ ...cardStyle, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' as const }}>
          <Sparkles size={26} color="#F15A22" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>Fill in your Business Profile first</div>
            <p style={{ fontSize: 13, color: '#A0A0A0', maxWidth: 380, margin: '6px 0 0' }}>
              Izzy needs your positioning, audience, and goals on file before it can write a grounded plan.
            </p>
          </div>
          <button onClick={() => navigate('/sales-marketing/profile')}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Go to Business Profile
          </button>
        </div>
      ) : selectedPlan ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button onClick={() => setSelectedPlanId(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', background: 'none', border: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer', padding: 0 }}>
            <ChevronLeft size={14} /> All plans
          </button>

          <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F0' }}>{selectedPlan.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6A6A6A', marginTop: 3 }}>
                  <CalendarRange size={12} /> {fmtDate(selectedPlan.period_start)} – {fmtDate(selectedPlan.period_end)}
                </div>
              </div>
              <select value={selectedPlan.status} onChange={e => updatePlanStatus(e.target.value as Plan['status'])}
                style={{ ...smallInputStyle, width: 'auto', color: STATUS_COLORS[selectedPlan.status], fontWeight: 700 }}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            {selectedPlan.theme && (
              <p style={{ fontSize: 13, color: '#C0C0C0', lineHeight: 1.6, margin: 0 }}>{selectedPlan.theme}</p>
            )}

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
              {selectedPlan.budget_allocated_myr != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#A0A0A0' }}>
                  <Wallet size={12} /> RM{selectedPlan.budget_allocated_myr.toLocaleString()} budget
                </div>
              )}
              {selectedPlan.target_segment_names && selectedPlan.target_segment_names.length > 0 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                  {selectedPlan.target_segment_names.map(s => <span key={s} style={badgeStyle('#7FB8D8')}>{s}</span>)}
                </div>
              )}
            </div>

            {lastReply && (
              <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E', fontSize: 12, color: '#C0C0C0', lineHeight: 1.5, display: 'flex', gap: 8 }}>
                <Sparkles size={13} color="#F15A22" style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{lastReply}</span>
              </div>
            )}

            {selectedPlan.ai_rationale && (
              <div style={{ padding: 12, borderRadius: 8, border: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>Why this plan</div>
                <p style={{ fontSize: 12, color: '#A0A0A0', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' as const }}>{selectedPlan.ai_rationale}</p>
                <div style={{ fontSize: 10, color: '#5A5A5A', marginTop: 2 }}>
                  {selectedPlan.generation_tokens != null && `${selectedPlan.generation_tokens.toLocaleString()} tokens · `}
                  Generated {fmtDateTime(selectedPlan.created_at)}
                </div>
              </div>
            )}
          </div>

          <div style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Initiatives</div>
              {!addingInitiative && (
                <button onClick={() => setAddingInitiative(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#F15A22', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 4 }}>
                  <Plus size={13} /> Add
                </button>
              )}
            </div>

            {initiatives.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                  {(['all', 'sales', 'fixing', 'other'] as const).map(c => (
                    <button key={c} onClick={() => setCategoryFilter(c)}
                      style={{
                        ...badgeStyle(c === 'all' ? '#A0A0A0' : CATEGORY_COLOR[c]),
                        border: categoryFilter === c ? `1px solid ${c === 'all' ? '#A0A0A0' : CATEGORY_COLOR[c]}` : '1px solid transparent',
                        cursor: 'pointer', opacity: categoryFilter === c ? 1 : 0.55,
                      }}>
                      {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
                    </button>
                  ))}
                </div>
                <select value={sortBy} onChange={e => setSortBy(e.target.value as 'priority' | 'due_date')}
                  style={{ ...smallInputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }}>
                  <option value="priority">Sort: Priority</option>
                  <option value="due_date">Sort: Due date</option>
                </select>
              </div>
            )}

            {loadingInitiatives ? (
              <div style={{ fontSize: 12, color: '#6A6A6A' }}>Loading...</div>
            ) : initiatives.length === 0 && !addingInitiative ? (
              <p style={{ fontSize: 13, color: '#5A5A5A', fontStyle: 'italic', margin: 0 }}>No initiatives yet.</p>
            ) : visibleInitiatives.length === 0 ? (
              <p style={{ fontSize: 13, color: '#5A5A5A', fontStyle: 'italic', margin: 0 }}>No {categoryFilter} initiatives in this plan.</p>
            ) : (
              visibleInitiatives.map(item => {
                const expanded = expandedIds.has(item.id)
                const hasMore = !!item.summary && item.description && item.description !== item.summary
                const category = categoryOf(item)
                return (
                  <div key={item.id} style={{ padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <button onClick={() => cycleInitiativeStatus(item)} title="Click to change status"
                      style={{ ...badgeStyle(INITIATIVE_STATUS_COLOR[item.status]), border: 'none', cursor: 'pointer', flexShrink: 0, marginTop: 2 }}>
                      {INITIATIVE_STATUS_LABEL[item.status]}
                    </button>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                        <span style={badgeStyle(CATEGORY_COLOR[category])}>{CATEGORY_LABEL[category]}</span>
                        <span style={{ fontSize: 13, color: '#F0F0F0', textDecoration: item.status === 'done' ? 'line-through' : 'none', opacity: item.status === 'done' ? 0.6 : 1 }}>
                          {item.summary || item.description}
                        </span>
                      </div>
                      {hasMore && expanded && (
                        <p style={{ fontSize: 12, color: '#A0A0A0', margin: '2px 0 0', lineHeight: 1.5 }}>{item.description}</p>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, fontSize: 11, color: '#6A6A6A', alignItems: 'center' }}>
                        {item.channel && <span>{item.channel}</span>}
                        {item.owner_text && <span>· {item.owner_text}</span>}
                        {item.due_date && <span>· by {fmtDate(item.due_date)}</span>}
                        {hasMore && (
                          <button onClick={() => toggleExpanded(item.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#F15A22', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                            {expanded ? 'Collapse' : 'Expand'}
                            <ChevronDown size={11} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                          </button>
                        )}
                      </div>
                    </div>
                    <button onClick={() => deleteInitiative(item.id)} style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })
            )}

            {addingInitiative && <AddInitiativeForm onSave={addInitiative} onCancel={() => setAddingInitiative(false)} />}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {businessProfileId && user?.tenant_id && (
            <HistoricalImportSection businessProfileId={businessProfileId} tenantId={user.tenant_id} userId={user.id} />
          )}

          {!showGenerateForm && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
              <button onClick={() => setShowAnalysisPanel(true)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 10, border: '1px solid #2A2A2A', background: 'none', color: '#C0C0C0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <Sparkles size={15} color="#F15A22" /> Business Analysis
              </button>
              <button onClick={() => setShowGenerateForm(true)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 10, border: '1px dashed #F15A22', background: 'rgba(241,90,34,0.06)', color: '#F15A22', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <Plus size={15} /> Generate new plan
              </button>
            </div>
          )}

          {showGenerateForm && (
            <GenerateForm onGenerate={handleGenerate} onCancel={() => setShowGenerateForm(false)} generating={generating} />
          )}

          {plans.length === 0 ? (
            <div style={{ ...cardStyle, padding: 32, textAlign: 'center' as const }}>
              <p style={{ fontSize: 13, color: '#5A5A5A', margin: 0 }}>No plans yet. Generate your first one above.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {plans.map(plan => (
                <button key={plan.id} onClick={() => openPlan(plan.id)}
                  style={{ ...cardStyle, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' as const, width: '100%' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{plan.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6A6A6A', marginTop: 2 }}>
                      <CalendarRange size={11} /> {fmtDate(plan.period_start)} – {fmtDate(plan.period_end)}
                    </div>
                  </div>
                  <span style={badgeStyle(STATUS_COLORS[plan.status])}>{plan.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {user?.tenant_id && (
        <BusinessAnalysisPanel open={showAnalysisPanel} onClose={() => setShowAnalysisPanel(false)} tenantId={user.tenant_id} />
      )}
    </div>
  )
}
