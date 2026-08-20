import { useState, useEffect, useRef } from 'react'
import { Building, Sparkles, Send, Pencil, Check, X, Loader2, Gauge, Paperclip, ImageOff, Trash2, Plus, Target, Users, Calendar, Swords } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'

interface BusinessProfile {
  id: string
  tenant_id: string
  tagline: string | null
  website_url: string | null
  instagram_handle: string | null
  tiktok_handle: string | null
  facebook_handle: string | null
  whatsapp_number: string | null
  pricing_position: 'budget' | 'mid_market' | 'premium' | null
  monthly_budget_myr: number | null
  execution_capacity: string | null
  brand_voice: string | null
  unique_selling_points: string | null
  guardrails: string | null
  conversation: ConversationTurn[]
  updated_at: string
}

interface Competitor {
  id: string
  name: string
  competitor_type: 'direct' | 'indirect' | null
  notes: string | null
  threat_level: 'low' | 'medium' | 'high' | null
  our_counter: string | null
}

interface AudienceSegment {
  id: string
  name: string
  description: string | null
  messaging_angle: string | null
  priority: 'primary' | 'secondary' | null
}

interface Goal {
  id: string
  description: string
  metric: string | null
  target_value: number | null
  current_value: number | null
  deadline: string | null
  priority_rank: number | null
  status: 'active' | 'achieved' | 'dropped'
}

interface SeasonalEvent {
  id: string
  period_label: string
  theme: string | null
  focus_notes: string | null
  priority: 'low' | 'medium' | 'high' | null
}

interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string; path?: string }>
  meta?: { at: string; tokens?: number }
}

function fmtMeta(meta?: { at: string; tokens?: number }) {
  if (!meta) return null
  const time = new Date(meta.at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return meta.tokens != null ? `${meta.tokens.toLocaleString()} tokens · ${time}` : time
}

const UPLOADS_BUCKET = 'sales-marketing-uploads'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

const QUICK_FIELDS: { key: keyof BusinessProfile; label: string; placeholder: string }[] = [
  { key: 'tagline', label: 'Tagline', placeholder: 'e.g. We Check First - We Explain First - You Decide' },
  { key: 'website_url', label: 'Website', placeholder: 'https://...' },
  { key: 'instagram_handle', label: 'Instagram', placeholder: '@yourshop' },
  { key: 'tiktok_handle', label: 'TikTok', placeholder: '@yourshop' },
  { key: 'facebook_handle', label: 'Facebook', placeholder: 'facebook.com/yourshop' },
  { key: 'whatsapp_number', label: 'WhatsApp', placeholder: '+60...' },
  { key: 'execution_capacity', label: 'Who executes marketing', placeholder: 'e.g. Just the owner, front desk helps part-time' },
]

const NARRATIVE_FIELDS: { key: keyof BusinessProfile; label: string; hint: string }[] = [
  { key: 'brand_voice', label: 'Brand Voice', hint: 'How you sound to customers' },
  { key: 'unique_selling_points', label: 'Unique Selling Points', hint: 'What makes you different' },
  { key: 'guardrails', label: 'Guardrails', hint: 'Things to always or never do' },
]

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

function extractText(content: ConversationTurn['content']): string {
  if (typeof content === 'string') return content
  return content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n')
}

function extractImagePath(content: ConversationTurn['content']): string | null {
  if (typeof content === 'string') return null
  return content.find(b => b.type === 'image_ref')?.path ?? null
}

function ChatImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.storage.from(UPLOADS_BUCKET).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) { setFailed(true); return }
      setUrl(data.signedUrl)
    })
    return () => { cancelled = true }
  }, [path])

  if (failed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, backgroundColor: '#1E1E1E', color: '#6A6A6A', fontSize: 11 }}>
        <ImageOff size={12} /> Image unavailable
      </div>
    )
  }
  if (!url) return <div style={{ width: 160, height: 100, borderRadius: 8, backgroundColor: '#1E1E1E' }} />
  return <img src={url} alt="Attachment" style={{ maxWidth: 220, maxHeight: 160, borderRadius: 8, display: 'block', objectFit: 'cover' as const }} />
}

function NarrativeCard({ field, value, onSave }: { field: { key: keyof BusinessProfile; label: string; hint: string }; value: string | null; onSave: (value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await onSave(draft.trim())
    setSaving(false)
    setEditing(false)
  }

  return (
    <div style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{field.label}</div>
          <div style={{ fontSize: 11, color: '#6A6A6A' }}>{field.hint}</div>
        </div>
        {!editing && (
          <button onClick={() => { setDraft(value ?? ''); setEditing(true) }}
            style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 4 }}>
            <Pencil size={13} />
          </button>
        )}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3}
            style={{ ...inputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }} autoFocus />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditing(false)} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer' }}>
              <X size={12} /> Cancel
            </button>
            <button onClick={save} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: 'none', background: '#F15A22', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: value ? '#C0C0C0' : '#5A5A5A', lineHeight: 1.5, margin: 0, fontStyle: value ? 'normal' : 'italic' }}>
          {value || 'Not yet known -- ask Izzy, or fill it in yourself.'}
        </p>
      )}
    </div>
  )
}

// Shared shell for the four structured-list cards (competitors, audience
// segments, goals, seasonal events). Each item is its own database row --
// deleting or adding one never touches the others, unlike the old
// single-text-field design.
function ListCard<T extends { id: string }>({ icon: Icon, title, hint, items, renderRow, onDelete, addForm }: {
  icon: React.ElementType
  title: string
  hint: string
  items: T[]
  renderRow: (item: T) => React.ReactNode
  onDelete: (id: string) => void
  addForm: (close: () => void) => React.ReactNode
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={13} color="#F15A22" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{title}</div>
            <div style={{ fontSize: 11, color: '#6A6A6A' }}>{hint}</div>
          </div>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} title="Add manually"
            style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 4 }}>
            <Plus size={14} />
          </button>
        )}
      </div>

      {items.length === 0 && !adding && (
        <p style={{ fontSize: 13, color: '#5A5A5A', fontStyle: 'italic', margin: 0 }}>Not yet known -- ask Izzy, or add one yourself.</p>
      )}

      {items.map(item => (
        <div key={item.id} style={{ padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{renderRow(item)}</div>
          <button onClick={() => onDelete(item.id)} style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}

      {adding && addForm(() => setAdding(false))}
    </div>
  )
}

export function BusinessProfilePage() {
  const { user } = useAuthStore()
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [audienceSegments, setAudienceSegments] = useState<AudienceSegment[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [seasonalEvents, setSeasonalEvents] = useState<SeasonalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [quickDraft, setQuickDraft] = useState<Partial<BusinessProfile>>({})
  const [savingQuick, setSavingQuick] = useState(false)
  const [lastTurnTokens, setLastTurnTokens] = useState<number | null>(null)
  const [totalTokens, setTotalTokens] = useState<number | null>(null)
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    supabase.from('sales_marketing_business_profile').select('*').eq('tenant_id', user.tenant_id).maybeSingle()
      .then(async ({ data, error }) => {
        if (error) toast.error(error.message)
        setProfile(data as BusinessProfile | null)
        if (data) {
          setQuickDraft(data)
          const [c, a, g, s] = await Promise.all([
            supabase.from('sales_marketing_competitors').select('*').eq('business_profile_id', data.id).order('created_at'),
            supabase.from('sales_marketing_audience_segments').select('*').eq('business_profile_id', data.id).order('created_at'),
            supabase.from('sales_marketing_goals').select('*').eq('business_profile_id', data.id).order('priority_rank', { nullsFirst: false }),
            supabase.from('sales_marketing_seasonal_events').select('*').eq('business_profile_id', data.id).order('created_at'),
          ])
          setCompetitors(c.data ?? [])
          setAudienceSegments(a.data ?? [])
          setGoals(g.data ?? [])
          setSeasonalEvents(s.data ?? [])
        }
        setLoading(false)
      })
  }

  function loadTotalTokens() {
    if (!user?.tenant_id) return
    supabase.from('ai_token_usage').select('input_tokens, output_tokens')
      .eq('tenant_id', user.tenant_id).eq('feature', 'business_profile_assistant')
      .then(({ data, error }) => {
        if (error) return
        setTotalTokens((data ?? []).reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0))
      })
  }

  useEffect(() => { load(); loadTotalTokens() }, [user?.tenant_id])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [profile?.conversation])

  type AssistantResult = {
    reply: string
    profile: BusinessProfile
    competitors: Competitor[]
    audienceSegments: AudienceSegment[]
    goals: Goal[]
    seasonalEvents: SeasonalEvent[]
    usage?: { total_tokens: number }
  }

  async function callAssistant(message: string, imagePath?: string) {
    const { data, error } = await supabase.functions.invoke('sales-marketing-assistant', { body: { message, imagePath } })
    if (error) { toast.error('The assistant is unavailable right now'); return null }
    if (data?.error) { toast.error(data.error); return null }
    return data as AssistantResult
  }

  function applyResult(result: AssistantResult) {
    setProfile(result.profile)
    setCompetitors(result.competitors)
    setAudienceSegments(result.audienceSegments)
    setGoals(result.goals)
    setSeasonalEvents(result.seasonalEvents)
    if (result.usage) {
      setLastTurnTokens(result.usage.total_tokens)
      setTotalTokens(prev => (prev ?? 0) + result.usage!.total_tokens)
    }
  }

  async function startInterview() {
    setStarting(true)
    const result = await callAssistant('__START_INTERVIEW__')
    setStarting(false)
    if (result) { setQuickDraft(result.profile); applyResult(result) }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { toast.error('Only JPEG, PNG, or WebP images are supported'); return }
    if (file.size > MAX_IMAGE_BYTES) { toast.error('Image must be under 10MB'); return }
    setAttachedFile(file)
    setAttachedPreview(URL.createObjectURL(file))
  }

  function clearAttachment() {
    if (attachedPreview) URL.revokeObjectURL(attachedPreview)
    setAttachedFile(null)
    setAttachedPreview(null)
  }

  async function sendMessage() {
    const message = chatInput.trim() || (attachedFile ? 'Here is an image.' : '')
    if (!message || sending || uploadingImage) return
    setChatInput('')
    const fileToSend = attachedFile
    clearAttachment()

    let imagePath: string | undefined
    if (fileToSend && profile) {
      setUploadingImage(true)
      const ext = fileToSend.name.split('.').pop() || 'jpg'
      const path = `${profile.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage.from(UPLOADS_BUCKET).upload(path, fileToSend, { contentType: fileToSend.type })
      setUploadingImage(false)
      if (uploadErr) { toast.error('Could not upload the image'); return }
      imagePath = path
    }

    setSending(true)
    const result = await callAssistant(message, imagePath)
    setSending(false)
    if (result) applyResult(result)
  }

  async function saveNarrativeField(key: keyof BusinessProfile, value: string) {
    if (!profile) return
    const { data, error } = await supabase.from('sales_marketing_business_profile')
      .update({ [key]: value || null, updated_by: user?.id }).eq('id', profile.id).select('*').single()
    if (error) { toast.error(error.message); return }
    setProfile(data as BusinessProfile)
  }

  async function saveQuickFields() {
    if (!profile) return
    setSavingQuick(true)
    const payload: Record<string, unknown> = {}
    for (const f of QUICK_FIELDS) payload[f.key] = (quickDraft[f.key] as string)?.trim() || null
    payload.pricing_position = quickDraft.pricing_position || null
    payload.monthly_budget_myr = quickDraft.monthly_budget_myr ? Number(quickDraft.monthly_budget_myr) : null
    payload.updated_by = user?.id
    const { data, error } = await supabase.from('sales_marketing_business_profile')
      .update(payload).eq('id', profile.id).select('*').single()
    setSavingQuick(false)
    if (error) { toast.error(error.message); return }
    setProfile(data as BusinessProfile)
    setQuickDraft(data as BusinessProfile)
    toast.success('Business Profile updated')
  }

  async function addCompetitor(input: Partial<Competitor>, close: () => void) {
    if (!profile || !input.name?.trim()) return
    const { data, error } = await supabase.from('sales_marketing_competitors')
      .upsert({ ...input, name: input.name.trim(), tenant_id: user?.tenant_id, business_profile_id: profile.id }, { onConflict: 'business_profile_id,name' })
      .select('*').single()
    if (error) { toast.error(error.message); return }
    setCompetitors(prev => [...prev.filter(c => c.id !== data.id), data])
    close()
  }
  async function deleteCompetitor(id: string) {
    const { error } = await supabase.from('sales_marketing_competitors').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setCompetitors(prev => prev.filter(c => c.id !== id))
  }

  async function addSegment(input: Partial<AudienceSegment>, close: () => void) {
    if (!profile || !input.name?.trim()) return
    const { data, error } = await supabase.from('sales_marketing_audience_segments')
      .upsert({ ...input, name: input.name.trim(), tenant_id: user?.tenant_id, business_profile_id: profile.id }, { onConflict: 'business_profile_id,name' })
      .select('*').single()
    if (error) { toast.error(error.message); return }
    setAudienceSegments(prev => [...prev.filter(s => s.id !== data.id), data])
    close()
  }
  async function deleteSegment(id: string) {
    const { error } = await supabase.from('sales_marketing_audience_segments').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setAudienceSegments(prev => prev.filter(s => s.id !== id))
  }

  async function addGoal(input: Partial<Goal>, close: () => void) {
    if (!profile || !input.description?.trim()) return
    const { data, error } = await supabase.from('sales_marketing_goals')
      .upsert({ ...input, description: input.description.trim(), tenant_id: user?.tenant_id, business_profile_id: profile.id }, { onConflict: 'business_profile_id,description' })
      .select('*').single()
    if (error) { toast.error(error.message); return }
    setGoals(prev => [...prev.filter(g => g.id !== data.id), data])
    close()
  }
  async function deleteGoal(id: string) {
    const { error } = await supabase.from('sales_marketing_goals').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setGoals(prev => prev.filter(g => g.id !== id))
  }

  async function addEvent(input: Partial<SeasonalEvent>, close: () => void) {
    if (!profile || !input.period_label?.trim()) return
    const { data, error } = await supabase.from('sales_marketing_seasonal_events')
      .upsert({ ...input, period_label: input.period_label.trim(), tenant_id: user?.tenant_id, business_profile_id: profile.id }, { onConflict: 'business_profile_id,period_label' })
      .select('*').single()
    if (error) { toast.error(error.message); return }
    setSeasonalEvents(prev => [...prev.filter(e => e.id !== data.id), data])
    close()
  }
  async function deleteEvent(id: string) {
    const { error } = await supabase.from('sales_marketing_seasonal_events').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setSeasonalEvents(prev => prev.filter(e => e.id !== id))
  }

  const totalCriteria = QUICK_FIELDS.length + NARRATIVE_FIELDS.length + 2 + 4
  const filledCriteria = profile ? (
    QUICK_FIELDS.filter(f => profile[f.key]).length +
    NARRATIVE_FIELDS.filter(f => profile[f.key]).length +
    (profile.pricing_position ? 1 : 0) +
    (profile.monthly_budget_myr ? 1 : 0) +
    (competitors.length > 0 ? 1 : 0) +
    (audienceSegments.length > 0 ? 1 : 0) +
    (goals.length > 0 ? 1 : 0) +
    (seasonalEvents.length > 0 ? 1 : 0)
  ) : 0
  const completeness = profile ? Math.round((filledCriteria / totalCriteria) * 100) : 0

  const visibleTurns = (profile?.conversation ?? []).filter(turn => {
    if (typeof turn.content === 'string') return turn.content !== '__START_INTERVIEW__'
    const text = extractText(turn.content)
    return text.trim().length > 0
  })

  if (loading) {
    return <div style={{ padding: 24, color: '#6A6A6A', fontSize: 13 }}>Loading...</div>
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(241,90,34,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Building size={18} color="#F15A22" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Business Profile</h1>
            <p style={{ fontSize: 12, color: '#6A6A6A', margin: '2px 0 0' }}>The briefing Izzy reads before doing anything else</p>
          </div>
        </div>
        {profile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 90, height: 6, borderRadius: 999, backgroundColor: '#2A2A2A', overflow: 'hidden' }}>
              <div style={{ width: `${completeness}%`, height: '100%', backgroundColor: '#F15A22', transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#A0A0A0' }}>{completeness}% complete</span>
          </div>
        )}
      </div>

      {!profile ? (
        <div style={{ ...cardStyle, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' as const }}>
          <Sparkles size={28} color="#F15A22" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>Let's build your Business Profile</div>
            <p style={{ fontSize: 13, color: '#A0A0A0', maxWidth: 420, margin: '6px 0 0' }}>
              Izzy will ask a few questions -- target audience, positioning, goals -- and fill in the profile as you talk. Takes about 5 minutes.
            </p>
          </div>
          <button onClick={startInterview} disabled={starting}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {starting ? 'Getting started...' : 'Start the interview'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', height: 560, position: 'sticky' as const, top: 16 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="#F15A22" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Ask Izzy</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleTurns.map((turn, i) => {
                const imagePath = extractImagePath(turn.content)
                return (
                  <div key={i} style={{
                    alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%', display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    {imagePath && <ChatImage path={imagePath} />}
                    <div style={{
                      padding: '9px 13px', borderRadius: 12,
                      backgroundColor: turn.role === 'user' ? '#F15A22' : '#1E1E1E',
                      color: turn.role === 'user' ? '#fff' : '#E0E0E0',
                      fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const,
                    }}>
                      {extractText(turn.content)}
                    </div>
                    {turn.meta && (
                      <div style={{ fontSize: 10, color: '#5A5A5A', textAlign: turn.role === 'user' ? 'right' as const : 'left' as const, padding: '0 3px' }}>
                        {fmtMeta(turn.meta)}
                      </div>
                    )}
                  </div>
                )
              })}
              {sending && (
                <div style={{ alignSelf: 'flex-start', color: '#6A6A6A', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={12} className="animate-spin" /> thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            {attachedPreview && (
              <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={attachedPreview} alt="Attachment preview" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' as const }} />
                <span style={{ fontSize: 11, color: '#A0A0A0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{attachedFile?.name}</span>
                <button onClick={clearAttachment} style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 2 }}>
                  <X size={13} />
                </button>
              </div>
            )}
            <div style={{ padding: '12px 12px 8px', borderTop: '1px solid #2A2A2A', display: 'flex', gap: 8 }}>
              <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={handleFileSelect} style={{ display: 'none' }} />
              <button onClick={() => fileInputRef.current?.click()} disabled={sending || uploadingImage}
                title="Attach an image"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, borderRadius: 8, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', cursor: 'pointer' }}>
                <Paperclip size={14} />
              </button>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Type your answer..." style={{ ...inputStyle, flex: 1 }} disabled={sending} />
              <button onClick={sendMessage} disabled={sending || uploadingImage || (!chatInput.trim() && !attachedFile)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', cursor: 'pointer', opacity: sending || uploadingImage || (!chatInput.trim() && !attachedFile) ? 0.5 : 1 }}>
                {uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
            <div style={{ padding: '0 12px 10px', display: 'flex', alignItems: 'center', gap: 5, color: '#5A5A5A', fontSize: 11 }}>
              <Gauge size={11} />
              {lastTurnTokens !== null && <span>Last message: {lastTurnTokens.toLocaleString()} tokens</span>}
              {lastTurnTokens !== null && totalTokens !== null && <span>·</span>}
              {totalTokens !== null && <span>Total: {totalTokens.toLocaleString()} tokens</span>}
              {lastTurnTokens === null && totalTokens === null && <span>No token usage recorded yet</span>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Quick Facts</div>
              {QUICK_FIELDS.map(f => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  <input style={inputStyle} placeholder={f.placeholder}
                    value={(quickDraft[f.key] as string) ?? ''}
                    onChange={e => setQuickDraft(d => ({ ...d, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Pricing Position</label>
                <select style={inputStyle} value={quickDraft.pricing_position ?? ''}
                  onChange={e => setQuickDraft(d => ({ ...d, pricing_position: (e.target.value || null) as BusinessProfile['pricing_position'] }))}>
                  <option value="">-- Select --</option>
                  <option value="budget">Budget</option>
                  <option value="mid_market">Mid-market</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Monthly Marketing Budget (RM)</label>
                <input type="number" style={inputStyle} placeholder="0"
                  value={quickDraft.monthly_budget_myr ?? ''}
                  onChange={e => setQuickDraft(d => ({ ...d, monthly_budget_myr: e.target.value ? Number(e.target.value) : null }))} />
              </div>
              <button onClick={saveQuickFields} disabled={savingQuick}
                style={{ marginTop: 4, padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' }}>
                {savingQuick ? 'Saving...' : 'Save Quick Facts'}
              </button>
            </div>

            <NarrativeCard field={NARRATIVE_FIELDS[0]} value={profile.brand_voice} onSave={v => saveNarrativeField('brand_voice', v)} />
            <NarrativeCard field={NARRATIVE_FIELDS[1]} value={profile.unique_selling_points} onSave={v => saveNarrativeField('unique_selling_points', v)} />

            <ListCard icon={Swords} title="Competitors" hint="Who you compete with, and how" items={competitors} onDelete={deleteCompetitor}
              renderRow={c => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{c.name}</span>
                    {c.competitor_type && <span style={badgeStyle('#A0A0A0')}>{c.competitor_type}</span>}
                    {c.threat_level && <span style={badgeStyle(c.threat_level === 'high' ? '#EF4444' : c.threat_level === 'medium' ? '#F59E0B' : '#6A6A6A')}>{c.threat_level} threat</span>}
                  </div>
                  {c.notes && <p style={{ fontSize: 12, color: '#A0A0A0', margin: 0, lineHeight: 1.4 }}>{c.notes}</p>}
                  {c.our_counter && <p style={{ fontSize: 12, color: '#7FB88F', margin: 0, lineHeight: 1.4 }}>Counter: {c.our_counter}</p>}
                </div>
              )}
              addForm={close => <CompetitorForm onSave={input => addCompetitor(input, close)} onCancel={close} />}
            />

            <ListCard icon={Users} title="Audience Segments" hint="Who your customers are, one segment at a time" items={audienceSegments} onDelete={deleteSegment}
              renderRow={s => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{s.name}</span>
                    {s.priority && <span style={badgeStyle(s.priority === 'primary' ? '#F15A22' : '#6A6A6A')}>{s.priority}</span>}
                  </div>
                  {s.description && <p style={{ fontSize: 12, color: '#A0A0A0', margin: 0, lineHeight: 1.4 }}>{s.description}</p>}
                  {s.messaging_angle && <p style={{ fontSize: 12, color: '#7FB8D8', margin: 0, lineHeight: 1.4 }}>Angle: {s.messaging_angle}</p>}
                </div>
              )}
              addForm={close => <SegmentForm onSave={input => addSegment(input, close)} onCancel={close} />}
            />

            <ListCard icon={Target} title="Goals & Priorities" hint="Tracked over time, ranked" items={goals} onDelete={deleteGoal}
              renderRow={g => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{g.description}</span>
                    {g.status !== 'active' && <span style={badgeStyle(g.status === 'achieved' ? '#7FB88F' : '#6A6A6A')}>{g.status}</span>}
                  </div>
                  {(g.target_value != null || g.current_value != null) && (
                    <p style={{ fontSize: 12, color: '#A0A0A0', margin: 0 }}>
                      {g.metric ?? 'Progress'}: {g.current_value ?? '?'} → {g.target_value ?? '?'}
                    </p>
                  )}
                  {g.deadline && <p style={{ fontSize: 12, color: '#6A6A6A', margin: 0 }}>By {g.deadline}</p>}
                </div>
              )}
              addForm={close => <GoalForm onSave={input => addGoal(input, close)} onCancel={close} />}
            />

            <ListCard icon={Calendar} title="Seasonal Context" hint="Calendar of periods that shift your marketing" items={seasonalEvents} onDelete={deleteEvent}
              renderRow={e => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{e.period_label}</span>
                    {e.priority && <span style={badgeStyle(e.priority === 'high' ? '#F15A22' : e.priority === 'medium' ? '#F59E0B' : '#6A6A6A')}>{e.priority}</span>}
                  </div>
                  {e.theme && <p style={{ fontSize: 12, color: '#A0A0A0', margin: 0 }}>{e.theme}</p>}
                  {e.focus_notes && <p style={{ fontSize: 12, color: '#6A6A6A', margin: 0, lineHeight: 1.4 }}>{e.focus_notes}</p>}
                </div>
              )}
              addForm={close => <SeasonalEventForm onSave={input => addEvent(input, close)} onCancel={close} />}
            />

            <NarrativeCard field={NARRATIVE_FIELDS[2]} value={profile.guardrails} onSave={v => saveNarrativeField('guardrails', v)} />
          </div>
        </div>
      )}
    </div>
  )
}

function FormActions({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <button onClick={onCancel} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A2A', background: 'none', color: '#A0A0A0', fontSize: 12, cursor: 'pointer' }}>
        <X size={12} /> Cancel
      </button>
      <button onClick={onSave} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: 'none', background: '#F15A22', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        <Check size={12} /> Save
      </button>
    </div>
  )
}

function CompetitorForm({ onSave, onCancel }: { onSave: (input: Partial<Competitor>) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'direct' | 'indirect' | ''>('')
  const [threat, setThreat] = useState<'low' | 'medium' | 'high' | ''>('')
  const [notes, setNotes] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E' }}>
      <input style={smallInputStyle} placeholder="Competitor name" value={name} onChange={e => setName(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 6 }}>
        <select style={smallInputStyle} value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="">Type</option><option value="direct">Direct</option><option value="indirect">Indirect</option>
        </select>
        <select style={smallInputStyle} value={threat} onChange={e => setThreat(e.target.value as typeof threat)}>
          <option value="">Threat</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
      </div>
      <textarea style={{ ...smallInputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }} rows={2} placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <FormActions onCancel={onCancel} onSave={() => onSave({ name, competitor_type: type || null, threat_level: threat || null, notes: notes || null })} />
    </div>
  )
}

function SegmentForm({ onSave, onCancel }: { onSave: (input: Partial<AudienceSegment>) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [priority, setPriority] = useState<'primary' | 'secondary' | ''>('')
  const [description, setDescription] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E' }}>
      <input style={smallInputStyle} placeholder="Segment name" value={name} onChange={e => setName(e.target.value)} autoFocus />
      <select style={smallInputStyle} value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
        <option value="">Priority</option><option value="primary">Primary</option><option value="secondary">Secondary</option>
      </select>
      <textarea style={{ ...smallInputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }} rows={2} placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
      <FormActions onCancel={onCancel} onSave={() => onSave({ name, priority: priority || null, description: description || null })} />
    </div>
  )
}

function GoalForm({ onSave, onCancel }: { onSave: (input: Partial<Goal>) => void; onCancel: () => void }) {
  const [description, setDescription] = useState('')
  const [metric, setMetric] = useState('')
  const [target, setTarget] = useState('')
  const [current, setCurrent] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E' }}>
      <input style={smallInputStyle} placeholder="Goal description" value={description} onChange={e => setDescription(e.target.value)} autoFocus />
      <input style={smallInputStyle} placeholder="Metric (optional), e.g. Monthly revenue (RM)" value={metric} onChange={e => setMetric(e.target.value)} />
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={smallInputStyle} type="number" placeholder="Current value" value={current} onChange={e => setCurrent(e.target.value)} />
        <input style={smallInputStyle} type="number" placeholder="Target value" value={target} onChange={e => setTarget(e.target.value)} />
      </div>
      <FormActions onCancel={onCancel} onSave={() => onSave({
        description, metric: metric || null,
        current_value: current ? Number(current) : null,
        target_value: target ? Number(target) : null,
      })} />
    </div>
  )
}

function SeasonalEventForm({ onSave, onCancel }: { onSave: (input: Partial<SeasonalEvent>) => void; onCancel: () => void }) {
  const [periodLabel, setPeriodLabel] = useState('')
  const [theme, setTheme] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | ''>('')
  const [focusNotes, setFocusNotes] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#1E1E1E' }}>
      <input style={smallInputStyle} placeholder="Period, e.g. Ramadan / Hari Raya" value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={smallInputStyle} placeholder="Theme" value={theme} onChange={e => setTheme(e.target.value)} />
        <select style={smallInputStyle} value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
          <option value="">Priority</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
      </div>
      <textarea style={{ ...smallInputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }} rows={2} placeholder="What to focus on" value={focusNotes} onChange={e => setFocusNotes(e.target.value)} />
      <FormActions onCancel={onCancel} onSave={() => onSave({ period_label: periodLabel, theme: theme || null, priority: priority || null, focus_notes: focusNotes || null })} />
    </div>
  )
}
