import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import { OTHER, makeOptionsFor, modelOptionsFor } from '@/lib/vehicleMakes'

const inputStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0',
  borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#A0A0A0' }
const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }

interface Community { id: string; name: string; slug: string; membership_fee: number }

interface Member {
  id: string
  community_id: string
  customer_id: string
  membership_number: string
  status: 'pending_payment' | 'active' | 'expired' | 'cancelled'
  valid_until: string | null
  fee_invoice_id: string | null
  registered_at: string
  customers: { full_name: string; phone: string } | null
  vehicles: { plate_number: string; vehicle_type: string }[]
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: '#F59E0B', active: '#22C55E', expired: '#6B7280', cancelled: '#EF4444',
}

function RegisterMemberModal({ communities, onClose, onSaved }: { communities: Community[]; onClose: () => void; onSaved: () => void }) {
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? '')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [icNumber, setIcNumber] = useState('')
  const [plate, setPlate] = useState('')
  const [vehicleType, setVehicleType] = useState<'car' | 'bike'>('bike')
  const [make, setMake] = useState('')
  const [makeOther, setMakeOther] = useState(false)
  const [model, setModel] = useState('')
  const [modelOther, setModelOther] = useState(false)
  const [saving, setSaving] = useState(false)

  function changeVehicleType(t: 'car' | 'bike') {
    if (t === vehicleType) return
    setVehicleType(t)
    setMake(''); setMakeOther(false); setModel(''); setModelOther(false)
  }

  async function submit() {
    const community = communities.find(c => c.id === communityId)
    if (!community || !fullName.trim() || !phone.trim() || !plate.trim()) {
      toast.error('Community, name, phone, and plate number are required')
      return
    }
    setSaving(true)
    const { data, error } = await supabase.rpc('esp_public_register', {
      p_community_slug: community.slug,
      p_full_name: fullName.trim(),
      p_phone: phone.trim(),
      p_email: email.trim() || null,
      p_ic_number: icNumber.trim() || null,
      p_vehicles: [{ plate_number: plate.trim(), vehicle_type: vehicleType, make: make.trim() || null, model: model.trim() || null }],
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    if (data?.error) { toast.error(data.error.replace(/_/g, ' ')); return }
    toast.success(`Registered -- membership #${data.membership_number}`)
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Register Walk-in Member</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Community *</label>
            <select style={inputStyle} value={communityId} onChange={e => setCommunityId(e.target.value)}>
              {communities.map(c => <option key={c.id} value={c.id}>{c.name} (RM {Number(c.membership_fee).toFixed(2)})</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Full Name *</label>
            <input style={inputStyle} value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Phone *</label>
              <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>IC Number</label>
            <input style={inputStyle} value={icNumber} onChange={e => setIcNumber(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Plate Number *</label>
              <input style={inputStyle} value={plate} onChange={e => setPlate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={vehicleType} onChange={e => changeVehicleType(e.target.value as 'car' | 'bike')}>
                <option value="bike">Bike</option>
                <option value="car">Car</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Make</label>
              {makeOther ? (
                <div>
                  <input style={inputStyle} value={make} autoFocus onChange={e => setMake(e.target.value)} />
                  <button type="button" onClick={() => { setMake(''); setMakeOther(false); setModel(''); setModelOther(false) }}
                    style={{ background: 'none', border: 'none', color: '#A0A0A0', fontSize: 11, padding: '3px 0', cursor: 'pointer', textDecoration: 'underline' }}>
                    Choose from list
                  </button>
                </div>
              ) : (
                <select style={inputStyle} value={make} onChange={e => {
                  const val = e.target.value
                  if (val === OTHER) { setMake(''); setMakeOther(true); setModel(''); setModelOther(false) }
                  else { setMake(val); setModel(''); setModelOther(false) }
                }}>
                  <option value="">Select Make</option>
                  {makeOptionsFor(vehicleType).map(m => <option key={m} value={m}>{m}</option>)}
                  <option value={OTHER}>Other</option>
                </select>
              )}
            </div>
            <div>
              <label style={labelStyle}>Model</label>
              {makeOther || modelOther ? (
                <div>
                  <input style={inputStyle} value={model} onChange={e => setModel(e.target.value)} />
                  {!makeOther && (
                    <button type="button" onClick={() => { setModel(''); setModelOther(false) }}
                      style={{ background: 'none', border: 'none', color: '#A0A0A0', fontSize: 11, padding: '3px 0', cursor: 'pointer', textDecoration: 'underline' }}>
                      Choose from list
                    </button>
                  )}
                </div>
              ) : (
                <select style={inputStyle} value={model} disabled={!make} onChange={e => {
                  const val = e.target.value
                  if (val === OTHER) { setModel(''); setModelOther(true) }
                  else setModel(val)
                }}>
                  <option value="">{make ? 'Select Model' : 'Select Make first'}</option>
                  {modelOptionsFor(vehicleType, make).map(m => <option key={m} value={m}>{m}</option>)}
                  {make && <option value={OTHER}>Other</option>}
                </select>
              )}
            </div>
          </div>
          <button onClick={submit} disabled={saving} style={{ marginTop: 6, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Registering…' : 'Register Member'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EspMembersPage() {
  const { user } = useAuthStore()
  const [communities, setCommunities] = useState<Community[]>([])
  const [communityFilter, setCommunityFilter] = useState<string>('all')
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [showRegister, setShowRegister] = useState(false)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    // ESP is locked to branch like Invoices/Jobs -- only super_admin sees
    // across every branch of the tenant.
    let communitiesQuery = supabase.from('esp_communities').select('id, name, slug, membership_fee').eq('tenant_id', user.tenant_id)
    if (user.role !== 'super_admin' && user.branch_id) communitiesQuery = communitiesQuery.eq('home_branch_id', user.branch_id)
    communitiesQuery.then(({ data }) => {
      setCommunities(data ?? [])
    })

    let query = supabase.from('esp_members')
      .select('id, community_id, customer_id, membership_number, status, valid_until, fee_invoice_id, registered_at, customers(full_name, phone)')
      .eq('tenant_id', user.tenant_id)
      .order('registered_at', { ascending: false })
    if (user.role !== 'super_admin' && user.branch_id) query = query.eq('branch_id', user.branch_id)
    if (communityFilter !== 'all') query = query.eq('community_id', communityFilter)

    query.then(async ({ data, error }) => {
      if (error) { toast.error(error.message); setLoading(false); return }
      const rows = (data ?? []) as unknown as Member[]
      const memberIds = rows.map(r => r.id)
      if (memberIds.length > 0) {
        const { data: vehicles } = await supabase.from('vehicles').select('plate_number, vehicle_type, esp_member_id').in('esp_member_id', memberIds)
        rows.forEach(r => { r.vehicles = (vehicles ?? []).filter(v => (v as unknown as { esp_member_id: string }).esp_member_id === r.id) })
      }
      setMembers(rows)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [user?.tenant_id, communityFilter])

  async function renew(m: Member) {
    const { data, error } = await supabase.rpc('esp_renew_member', { p_member_id: m.id })
    if (error) { toast.error(error.message); return }
    if (data?.error) { toast.error(data.error.replace(/_/g, ' ')); return }
    toast.success(`Renewal invoice ${data.invoice_number} created (RM ${Number(data.amount).toFixed(2)}) -- collect payment via Invoices`)
    load()
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0' }}>ESP Members</h1>
        <button onClick={() => setShowRegister(true)} disabled={communities.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={14} /> Register Walk-in Member
        </button>
      </div>

      <div>
        <select style={{ ...inputStyle, width: 260 }} value={communityFilter} onChange={e => setCommunityFilter(e.target.value)}>
          <option value="all">All Communities</option>
          {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={cardStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={16} color="#F15A22" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Members</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666' }}><Loader2 className="animate-spin" size={20} /></div>
        ) : members.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No members yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Membership #', 'Customer', 'Phone', 'Vehicles', 'Status', 'Valid Until', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{m.membership_number}</td>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0' }}>{m.customers?.full_name ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{m.customers?.phone ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>{m.vehicles?.map(v => v.plate_number).join(', ') || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: STATUS_COLORS[m.status], background: `${STATUS_COLORS[m.status]}20` }}>
                        {m.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{m.valid_until ?? '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {m.status === 'pending_payment' && (
                          <Link to="/invoices" style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F59E0B', textDecoration: 'none' }}>
                            Collect Payment
                          </Link>
                        )}
                        {(m.status === 'active' || m.status === 'expired') && (
                          <button onClick={() => renew(m)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', cursor: 'pointer' }}>
                            <RefreshCw size={12} /> Renew
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showRegister && (
        <RegisterMemberModal communities={communities} onClose={() => setShowRegister(false)} onSaved={() => { setShowRegister(false); load() }} />
      )}
    </div>
  )
}
