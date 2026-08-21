import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone, Trash2, Copy, Check, ChevronLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'

// Minimal version of the Campaign execution layer: campaigns are only
// created by "promoting" a Sales activity from the Marketing Plan (see
// sales-marketing-campaign-generator) -- there is deliberately no
// standalone "New Campaign" form here yet, and no Designer/Analyst output
// (image generation, ROI tracking) in this first version.

interface Campaign {
  id: string
  title: string
  channel: string | null
  target_audience: string | null
  timing: string | null
  success_metric: string | null
  copy: string | null
  alt_copy: string | null
  status: 'draft' | 'active' | 'completed' | 'archived'
  generation_tokens: number | null
  created_at: string
}

const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12 }
const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
  backgroundColor: `${color}22`, color, textTransform: 'uppercase' as const, letterSpacing: '0.03em',
})
const STATUS_CYCLE: Campaign['status'][] = ['draft', 'active', 'completed', 'archived']
const STATUS_COLOR: Record<Campaign['status'], string> = { draft: '#6A6A6A', active: '#F15A22', completed: '#7FB88F', archived: '#5A5A5A' }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid #2A2A2A', borderRadius: 6, color: copied ? '#7FB88F' : '#A0A0A0', fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer' }}>
      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function CampaignsPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    supabase.from('sales_marketing_campaigns').select('*').eq('tenant_id', user.tenant_id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setCampaigns((data ?? []) as Campaign[])
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [user?.tenant_id])

  async function updateStatus(campaign: Campaign) {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(campaign.status) + 1) % STATUS_CYCLE.length]
    const { data, error } = await supabase.from('sales_marketing_campaigns').update({ status: next }).eq('id', campaign.id).select('*').single()
    if (error) { toast.error(error.message); return }
    setCampaigns(prev => prev.map(c => c.id === campaign.id ? (data as Campaign) : c))
  }

  async function deleteCampaign(id: string) {
    const { error } = await supabase.from('sales_marketing_campaigns').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setCampaigns(prev => prev.filter(c => c.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const selected = campaigns.find(c => c.id === selectedId) ?? null

  if (loading) return <div style={{ padding: 24, color: '#6A6A6A', fontSize: 13 }}>Loading...</div>

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(241,90,34,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Megaphone size={18} color="#F15A22" />
        </div>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0', margin: 0 }}>Campaigns</h1>
          <p style={{ fontSize: 12, color: '#6A6A6A', margin: 0 }}>Sales activities turned into real, ready-to-run content</p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div style={{ ...cardStyle, padding: 32, textAlign: 'center' as const }}>
          <p style={{ fontSize: 13, color: '#5A5A5A', margin: 0 }}>
            No campaigns yet. Open a plan in <Link to="/sales-marketing/plan" style={{ color: '#F15A22' }}>Marketing Plan</Link> and click "Turn into Campaign" on a Sales initiative.
          </p>
        </div>
      ) : selected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={() => setSelectedId(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', background: 'none', border: 'none', color: '#8A8A8A', fontSize: 12, cursor: 'pointer', padding: 0 }}>
            <ChevronLeft size={14} /> All campaigns
          </button>
          <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>{selected.title}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                  <button onClick={() => updateStatus(selected)} style={{ ...badgeStyle(STATUS_COLOR[selected.status]), border: 'none', cursor: 'pointer' }}>{selected.status}</button>
                  {selected.channel && <span style={{ fontSize: 11, color: '#6A6A6A' }}>{selected.channel}</span>}
                </div>
              </div>
              <button onClick={() => deleteCampaign(selected.id)} style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 4 }}>
                <Trash2 size={14} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 12 }}>
              <div>
                <div style={{ color: '#6A6A6A', marginBottom: 3, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>Audience</div>
                <div style={{ color: '#C0C0C0' }}>{selected.target_audience ?? '—'}</div>
              </div>
              <div>
                <div style={{ color: '#6A6A6A', marginBottom: 3, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>Timing</div>
                <div style={{ color: '#C0C0C0' }}>{selected.timing ?? '—'}</div>
              </div>
              <div>
                <div style={{ color: '#6A6A6A', marginBottom: 3, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>Success looks like</div>
                <div style={{ color: '#C0C0C0' }}>{selected.success_metric ?? '—'}</div>
              </div>
            </div>

            {selected.copy && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>Copy</div>
                  <CopyButton text={selected.copy} />
                </div>
                <div style={{ padding: 12, borderRadius: 8, backgroundColor: '#1E1E1E', fontSize: 13, color: '#F0F0F0', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const }}>
                  {selected.copy}
                </div>
              </div>
            )}

            {selected.alt_copy && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>Alternate / shorter version</div>
                  <CopyButton text={selected.alt_copy} />
                </div>
                <div style={{ padding: 12, borderRadius: 8, backgroundColor: '#1E1E1E', fontSize: 13, color: '#C0C0C0', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const }}>
                  {selected.alt_copy}
                </div>
              </div>
            )}

            {selected.generation_tokens != null && (
              <div style={{ fontSize: 10, color: '#5A5A5A' }}>{selected.generation_tokens.toLocaleString()} tokens to generate</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {campaigns.map(c => (
            <button key={c.id} onClick={() => setSelectedId(c.id)}
              style={{ ...cardStyle, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left' as const, width: '100%' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F0F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{c.title}</div>
                <div style={{ fontSize: 11, color: '#6A6A6A', marginTop: 2 }}>{c.channel ?? 'No channel set'}</div>
              </div>
              <span style={badgeStyle(STATUS_COLOR[c.status])}>{c.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
