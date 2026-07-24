import { useState, useEffect } from 'react'
import { Building2, Loader2, Plus, Power, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'

const inputStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0',
  borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#A0A0A0' }
const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }

interface Community {
  id: string
  tenant_id: string
  home_branch_id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  membership_fee: number
  validity_years: number
  car_full_package_discount_pct: number
  car_selected_item_discount_pct: number
  bike_full_package_discount_pct: number
  bike_selected_item_discount_pct: number
}

type CommunityForm = Omit<Community, 'id' | 'tenant_id' | 'is_active'>

function emptyForm(defaultBranchId: string): CommunityForm {
  return {
    home_branch_id: defaultBranchId, name: '', slug: '', description: '',
    membership_fee: 0, validity_years: 3,
    car_full_package_discount_pct: 0, car_selected_item_discount_pct: 0,
    bike_full_package_discount_pct: 0, bike_selected_item_discount_pct: 0,
  }
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function CommunityModal({ initial, branches, onClose, onSaved }: {
  initial: Community | null
  branches: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuthStore()
  const [form, setForm] = useState<CommunityForm>(initial ?? emptyForm(branches[0]?.id ?? ''))
  const [slugTouched, setSlugTouched] = useState(!!initial)
  const [saving, setSaving] = useState(false)

  function set<K extends keyof CommunityForm>(key: K, value: CommunityForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function submit() {
    if (!form.name.trim() || !form.slug.trim() || !form.home_branch_id) {
      toast.error('Name, slug, and home branch are required')
      return
    }
    setSaving(true)
    const payload = { ...form, slug: slugify(form.slug) }

    const { error } = initial
      ? await supabase.from('esp_communities').update(payload).eq('id', initial.id)
      : await supabase.from('esp_communities').insert({ ...payload, tenant_id: user?.tenant_id, created_by: user?.id })

    setSaving(false)
    if (error) {
      // 23505 = unique_violation -- slug is globally unique across all tenants.
      if (error.code === '23505') { toast.error('That slug is already taken -- pick another.'); return }
      toast.error(error.message)
      return
    }
    toast.success(initial ? 'Community updated' : 'Community created')
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>{initial ? 'Edit ESP Community' : 'New ESP Community'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Community Name *</label>
            <input style={inputStyle} value={form.name} onChange={e => {
              set('name', e.target.value)
              if (!slugTouched) set('slug', slugify(e.target.value))
            }} placeholder="e.g. Sportster Malaysia" />
          </div>
          <div>
            <label style={labelStyle}>Public Link Slug * -- used as ezgarage.app/esp/{'<slug>'}</label>
            <input style={inputStyle} value={form.slug} onChange={e => { setSlugTouched(true); set('slug', e.target.value) }} placeholder="sportster-malaysia" />
            <p style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>Must be unique across every workshop on the platform, not just yours.</p>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <input style={inputStyle} value={form.description ?? ''} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Home Branch * -- where membership fee invoices are recorded</label>
            <select style={inputStyle} value={form.home_branch_id} onChange={e => set('home_branch_id', e.target.value)} disabled={!!initial}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {initial && <p style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>Fixed at creation -- changing it would affect where future fee invoices land.</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Membership Fee (RM)</label>
              <input style={inputStyle} type="number" min={0} step={0.01} value={form.membership_fee} onChange={e => set('membership_fee', Number(e.target.value))} />
            </div>
            <div>
              <label style={labelStyle}>Validity (years)</label>
              <input style={inputStyle} type="number" min={1} step={1} value={form.validity_years} onChange={e => set('validity_years', Number(e.target.value))} />
            </div>
          </div>
          <div style={{ borderTop: '1px solid #2A2A2A', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#A0A0A0', marginBottom: 10 }}>Discount Tiers -- staff apply these manually on quotations/invoices</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Bike -- Full Package (%)</label>
                <input style={inputStyle} type="number" min={0} max={100} step={0.01} value={form.bike_full_package_discount_pct} onChange={e => set('bike_full_package_discount_pct', Number(e.target.value))} />
              </div>
              <div>
                <label style={labelStyle}>Bike -- Selected Item (%)</label>
                <input style={inputStyle} type="number" min={0} max={100} step={0.01} value={form.bike_selected_item_discount_pct} onChange={e => set('bike_selected_item_discount_pct', Number(e.target.value))} />
              </div>
              <div>
                <label style={labelStyle}>Car -- Full Package (%)</label>
                <input style={inputStyle} type="number" min={0} max={100} step={0.01} value={form.car_full_package_discount_pct} onChange={e => set('car_full_package_discount_pct', Number(e.target.value))} />
              </div>
              <div>
                <label style={labelStyle}>Car -- Selected Item (%)</label>
                <input style={inputStyle} type="number" min={0} max={100} step={0.01} value={form.car_selected_item_discount_pct} onChange={e => set('car_selected_item_discount_pct', Number(e.target.value))} />
              </div>
            </div>
          </div>
          <button onClick={submit} disabled={saving} style={{ padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Community'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EspCommunitySettingsPage() {
  const { user } = useAuthStore()
  const [communities, setCommunities] = useState<Community[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [modalFor, setModalFor] = useState<Community | 'new' | null>(null)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    Promise.all([
      supabase.from('esp_communities').select('*').eq('tenant_id', user.tenant_id).order('created_at', { ascending: false }),
      supabase.from('branches').select('id, name').eq('tenant_id', user.tenant_id),
    ]).then(([c, b]) => {
      if (c.error) toast.error(c.error.message)
      setCommunities((c.data ?? []) as Community[])
      setBranches(b.data ?? [])
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [user?.tenant_id])

  async function toggleActive(c: Community) {
    const { error } = await supabase.from('esp_communities').update({ is_active: !c.is_active }).eq('id', c.id)
    if (error) { toast.error(error.message); return }
    toast.success(c.is_active ? `${c.name} retired` : `${c.name} reactivated`)
    load()
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0' }}>ESP Communities</h1>
        <button onClick={() => setModalFor('new')} disabled={branches.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={14} /> New Community
        </button>
      </div>

      <div style={cardStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={16} color="#F15A22" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Exclusive Service Partner Programmes</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666' }}><Loader2 className="animate-spin" size={20} /></div>
        ) : communities.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No ESP communities yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Community', 'Link', 'Fee', 'Validity', 'Bike Tiers', 'Car Tiers', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {communities.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>/esp/{c.slug}</td>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0' }}>RM {Number(c.membership_fee).toFixed(2)}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{c.validity_years}y</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{c.bike_full_package_discount_pct}% / {c.bike_selected_item_discount_pct}%</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{c.car_full_package_discount_pct}% / {c.car_selected_item_discount_pct}%</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: c.is_active ? '#22C55E' : '#EF4444', background: c.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' }}>
                        {c.is_active ? 'ACTIVE' : 'RETIRED'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setModalFor(c)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => toggleActive(c)} title={c.is_active ? 'Retire' : 'Reactivate'}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: c.is_active ? '#EF4444' : '#22C55E', cursor: 'pointer' }}>
                          <Power size={12} /> {c.is_active ? 'Retire' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalFor && (
        <CommunityModal
          initial={modalFor === 'new' ? null : modalFor}
          branches={branches}
          onClose={() => setModalFor(null)}
          onSaved={() => { setModalFor(null); load() }}
        />
      )}
    </div>
  )
}
