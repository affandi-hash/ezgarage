import { useState, useEffect, useRef } from 'react'
import { Building, Sparkles, Send, Pencil, Check, X, Loader2 } from 'lucide-react'
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
  target_audience: string | null
  unique_selling_points: string | null
  competitors: string | null
  goals: string | null
  guardrails: string | null
  seasonal_notes: string | null
  conversation: ConversationTurn[]
  updated_at: string
}

interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string }>
}

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
  { key: 'target_audience', label: 'Target Audience', hint: 'Who your customers are' },
  { key: 'unique_selling_points', label: 'Unique Selling Points', hint: 'What makes you different' },
  { key: 'brand_voice', label: 'Brand Voice', hint: 'How you sound to customers' },
  { key: 'competitors', label: 'Competitors', hint: 'Who you compete with, and how' },
  { key: 'goals', label: 'Goals & Priorities', hint: 'What you want more of right now' },
  { key: 'guardrails', label: 'Guardrails', hint: 'Things to always or never do' },
  { key: 'seasonal_notes', label: 'Seasonal Context', hint: 'Known slow/peak periods and why' },
]

const ALL_FIELDS = [...QUICK_FIELDS, ...NARRATIVE_FIELDS, { key: 'pricing_position' as const }, { key: 'monthly_budget_myr' as const }]

const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }
const inputStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0',
  borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 5, color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }

function extractText(content: ConversationTurn['content']): string {
  if (typeof content === 'string') return content
  return content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n')
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
          {value || 'Not yet known -- ask your CSMO, or fill it in yourself.'}
        </p>
      )}
    </div>
  )
}

export function BusinessProfilePage() {
  const { user } = useAuthStore()
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [quickDraft, setQuickDraft] = useState<Partial<BusinessProfile>>({})
  const [savingQuick, setSavingQuick] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    supabase.from('sales_marketing_business_profile').select('*').eq('tenant_id', user.tenant_id).maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setProfile(data as BusinessProfile | null)
        if (data) setQuickDraft(data)
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [user?.tenant_id])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [profile?.conversation])

  async function callAssistant(message: string) {
    const { data, error } = await supabase.functions.invoke('sales-marketing-assistant', { body: { message } })
    if (error) { toast.error('The assistant is unavailable right now'); return null }
    if (data?.error) { toast.error(data.error); return null }
    return data as { reply: string; profile: BusinessProfile }
  }

  async function startInterview() {
    setStarting(true)
    const result = await callAssistant('__START_INTERVIEW__')
    setStarting(false)
    if (result) { setProfile(result.profile); setQuickDraft(result.profile) }
  }

  async function sendMessage() {
    const message = chatInput.trim()
    if (!message || sending) return
    setChatInput('')
    setSending(true)
    const result = await callAssistant(message)
    setSending(false)
    if (result) setProfile(result.profile)
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

  const completeness = profile
    ? Math.round((ALL_FIELDS.filter(f => profile[f.key] !== null && profile[f.key] !== undefined && profile[f.key] !== '').length / ALL_FIELDS.length) * 100)
    : 0

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
            <p style={{ fontSize: 12, color: '#6A6A6A', margin: '2px 0 0' }}>The briefing your AI Sales & Marketing assistant reads before doing anything else</p>
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
              Your CSMO will ask a few questions -- target audience, positioning, goals -- and fill in the profile as you talk. Takes about 5 minutes.
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
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', height: 560 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="#F15A22" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>Ask Your CSMO</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleTurns.map((turn, i) => (
                <div key={i} style={{
                  alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%', padding: '9px 13px', borderRadius: 12,
                  backgroundColor: turn.role === 'user' ? '#F15A22' : '#1E1E1E',
                  color: turn.role === 'user' ? '#fff' : '#E0E0E0',
                  fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const,
                }}>
                  {extractText(turn.content)}
                </div>
              ))}
              {sending && (
                <div style={{ alignSelf: 'flex-start', color: '#6A6A6A', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={12} className="animate-spin" /> thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: 12, borderTop: '1px solid #2A2A2A', display: 'flex', gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Type your answer..." style={{ ...inputStyle, flex: 1 }} disabled={sending} />
              <button onClick={sendMessage} disabled={sending || !chatInput.trim()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', cursor: 'pointer', opacity: sending || !chatInput.trim() ? 0.5 : 1 }}>
                <Send size={14} />
              </button>
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

            {NARRATIVE_FIELDS.map(f => (
              <NarrativeCard key={f.key} field={f} value={profile[f.key] as string | null}
                onSave={value => saveNarrativeField(f.key, value)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
