import { useState, useEffect } from 'react'
import { Megaphone, Loader2, Plus, X, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'

const inputStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0',
  borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#A0A0A0' }
const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }

interface Announcement {
  id: string
  title: string
  body: string
  is_active: boolean
  created_at: string
  community_id: string | null
  community_name: string | null
}

function NewAnnouncementModal({ communities, onClose, onSaved }: {
  communities: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuthStore()
  const [scope, setScope] = useState<'general' | string>('general')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim() || !body.trim()) { toast.error('Title and message are both required'); return }
    setSaving(true)
    const { error } = await supabase.from('esp_announcements').insert({
      tenant_id: user?.tenant_id,
      community_id: scope === 'general' ? null : scope,
      title: title.trim(), body: body.trim(), created_by: user?.id,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Announcement posted')
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>New Announcement</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Audience</label>
            <select style={inputStyle} value={scope} onChange={e => setScope(e.target.value)}>
              <option value="general">General — every ESP member, all communities</option>
              {communities.map(c => <option key={c.id} value={c.id}>{c.name} only</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Workshop closed for Raya" />
          </div>
          <div>
            <label style={labelStyle}>Message *</label>
            <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={body} onChange={e => setBody(e.target.value)} />
          </div>
          <button onClick={submit} disabled={saving} style={{ padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Posting…' : 'Post Announcement'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EspAnnouncementsPage() {
  const { user } = useAuthStore()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [communities, setCommunities] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    Promise.all([
      supabase.from('esp_announcements').select('id, title, body, is_active, created_at, community_id, esp_communities(name)').eq('tenant_id', user.tenant_id).order('created_at', { ascending: false }),
      supabase.from('esp_communities').select('id, name').eq('tenant_id', user.tenant_id).eq('is_active', true).order('name'),
    ]).then(([a, c]) => {
      if (a.error) toast.error(a.error.message)
      setAnnouncements(((a.data ?? []) as unknown[]).map((r) => {
        const row = r as { id: string; title: string; body: string; is_active: boolean; created_at: string; community_id: string | null; esp_communities: { name: string } | { name: string }[] | null }
        const community = Array.isArray(row.esp_communities) ? row.esp_communities[0] : row.esp_communities
        return { id: row.id, title: row.title, body: row.body, is_active: row.is_active, created_at: row.created_at, community_id: row.community_id, community_name: community?.name ?? null }
      }))
      setCommunities(c.data ?? [])
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [user?.tenant_id])

  async function retire(a: Announcement) {
    const { error } = await supabase.from('esp_announcements').update({ is_active: false }).eq('id', a.id)
    if (error) { toast.error(error.message); return }
    toast.success('Announcement removed')
    load()
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0' }}>ESP Announcements</h1>
        <button onClick={() => setShowNew(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={14} /> New Announcement
        </button>
      </div>

      <div style={cardStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Megaphone size={16} color="#F15A22" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Community &amp; General Announcements</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666' }}><Loader2 className="animate-spin" size={20} /></div>
        ) : announcements.filter(a => a.is_active).length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No announcements yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {announcements.filter(a => a.is_active).map(a => (
              <div key={a.id} style={{ padding: '14px 20px', borderBottom: '1px solid #1E1E1E', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{a.title}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: a.community_id ? 'rgba(241,90,34,0.12)' : 'rgba(59,130,246,0.12)', color: a.community_id ? '#F15A22' : '#3B82F6' }}>
                      {a.community_id ? a.community_name : 'GENERAL'}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: '#A0A0A0', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{a.body}</p>
                  <p style={{ fontSize: 11, color: '#666', margin: '6px 0 0' }}>{new Date(a.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
                <button onClick={() => retire(a)} title="Remove"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#EF4444', cursor: 'pointer', flexShrink: 0 }}>
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewAnnouncementModal communities={communities} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />
      )}
    </div>
  )
}
