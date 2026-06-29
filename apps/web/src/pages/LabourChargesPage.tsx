import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Plus, X, Wrench, Edit2, Eye, EyeOff } from 'lucide-react'
import { toast } from '@/components/ui/Toast'

// ─── Interface ─────────────────────────────────────────────────────────────────

interface LabourCharge {
  id: string
  tenant_id?: string
  branch_id?: string
  labour_code: string
  name: string
  description: string
  category: string
  unit_price: number
  unit: string
  standard_duration: number | null
  required_skill_level: string
  bay_required: string
  taxable: boolean
  division: 'car' | 'bike' | 'both'
  is_active: boolean
  created_at: string
}

// ─── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  border: '#2A2A2A',
  orange: '#F15A22',
  text: '#F0F0F0',
  text2: '#A0A0A0',
  green: '#22C55E',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatRM(n: number | null | undefined): string {
  return 'RM ' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ─── Style constants ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  padding: '8px 12px',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const btnOrange: React.CSSProperties = {
  background: C.orange,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const btnOutline: React.CSSProperties = {
  background: 'transparent',
  color: C.text2,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function LabourChargesPage() {
  const { user } = useAuthStore()

  const [labourCharges, setLabourCharges] = useState<LabourCharge[]>([])
  const [labourLoading, setLabourLoading] = useState(false)
  const [labourSaving, setLabourSaving] = useState(false)
  const [showLabourChargeModal, setShowLabourChargeModal] = useState(false)
  const [editingLabourCharge, setEditingLabourCharge] = useState<LabourCharge | null>(null)
  const [labourForm, setLabourForm] = useState({
    labour_code: '',
    name: '',
    description: '',
    category: '',
    unit_price: '',
    unit: 'job',
    standard_duration: '',
    required_skill_level: '',
    bay_required: '',
    taxable: false,
    division: 'both' as 'car' | 'bike' | 'both',
    is_active: true,
  })

  // ─── Load ───────────────────────────────────────────────────────────────────

  const loadLabourCharges = useCallback(async () => {
    setLabourLoading(true)
    let q = supabase.from('labour_charges').select('*').order('category').order('name')
    if (user?.role !== 'super_admin' && user?.branch_id)
      q = q.or(`branch_id.is.null,branch_id.eq.${user.branch_id}`)
    const { data } = await q
    setLabourCharges((data as LabourCharge[]) ?? [])
    setLabourLoading(false)
  }, [user])

  useEffect(() => { loadLabourCharges() }, [loadLabourCharges])

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  function openAddLabourCharge() {
    setEditingLabourCharge(null)
    setLabourForm({
      labour_code: '', name: '', description: '', category: '',
      unit_price: '', unit: 'job', standard_duration: '',
      required_skill_level: '', bay_required: '',
      taxable: false, division: 'both', is_active: true,
    })
    setShowLabourChargeModal(true)
  }

  function openEditLabourCharge(lc: LabourCharge) {
    setEditingLabourCharge(lc)
    setLabourForm({
      labour_code: lc.labour_code ?? '',
      name: lc.name,
      description: lc.description ?? '',
      category: lc.category ?? '',
      unit_price: String(lc.unit_price),
      unit: lc.unit,
      standard_duration: lc.standard_duration != null ? String(lc.standard_duration) : '',
      required_skill_level: lc.required_skill_level ?? '',
      bay_required: lc.bay_required ?? '',
      taxable: lc.taxable ?? false,
      division: lc.division ?? 'both',
      is_active: lc.is_active,
    })
    setShowLabourChargeModal(true)
  }

  async function saveLabourCharge() {
    if (!labourForm.name || !labourForm.unit_price) return
    setLabourSaving(true)
    const payload = {
      labour_code: labourForm.labour_code || null,
      name: labourForm.name,
      description: labourForm.description || null,
      category: labourForm.category || null,
      unit_price: parseFloat(labourForm.unit_price),
      unit: labourForm.unit,
      standard_duration: labourForm.standard_duration ? parseInt(labourForm.standard_duration) : null,
      required_skill_level: labourForm.required_skill_level || null,
      bay_required: labourForm.bay_required || null,
      taxable: labourForm.taxable,
      division: labourForm.division,
      is_active: labourForm.is_active,
      tenant_id: user?.tenant_id,
      branch_id: user?.branch_id,
    }
    try {
      if (editingLabourCharge) {
        await supabase.from('labour_charges').update(payload).eq('id', editingLabourCharge.id)
        toast.success('Labour charge updated')
      } else {
        await supabase.from('labour_charges').insert(payload)
        toast.success('Labour charge added')
      }
      await loadLabourCharges()
      setShowLabourChargeModal(false)
    } catch (e: any) {
      toast.error('Save failed: ' + e.message)
    } finally {
      setLabourSaving(false)
    }
  }

  async function toggleLabourActive(lc: LabourCharge) {
    await supabase.from('labour_charges').update({ is_active: !lc.is_active }).eq('id', lc.id)
    setLabourCharges(prev => prev.map(l => l.id === lc.id ? { ...l, is_active: !l.is_active } : l))
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100vh', background: C.bg, color: C.text, fontFamily: 'Inter, sans-serif', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Labour Charges</h2>
              <div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>Price list for labour — pick these when generating invoices</div>
            </div>
            <button style={btnOrange} onClick={openAddLabourCharge}><Plus size={15} /> Add Labour Charge</button>
          </div>

          {/* Table */}
          {labourLoading ? (
            <div style={{ textAlign: 'center', color: C.text2, padding: 40 }}>Loading...</div>
          ) : labourCharges.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.text2, padding: 60 }}>
              <Wrench size={48} color={C.border} />
              <div style={{ marginTop: 12, fontSize: 15 }}>No labour charges yet</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Add services like "Engine Oil Change", "Tyre Rotation", etc.</div>
            </div>
          ) : (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.bg }}>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 120 }}>Code</th>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 140 }}>Category</th>
                    <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 90 }}>Division</th>
                    <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 80 }}>Duration</th>
                    <th style={{ textAlign: 'right', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 110 }}>Charge (RM)</th>
                    <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 70 }}>Tax</th>
                    <th style={{ textAlign: 'center', padding: '10px 16px', fontSize: 12, color: C.text2, fontWeight: 700, textTransform: 'uppercase' as const, width: 70 }}>Active</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {labourCharges.map(lc => (
                    <tr key={lc.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: lc.is_active ? 1 : 0.45 }}>
                      <td style={{ padding: '12px 16px', fontSize: 12, fontFamily: 'monospace', color: C.text2 }}>{lc.labour_code || '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{lc.name}</div>
                        {lc.description && <div style={{ fontSize: 12, color: C.text2, marginTop: 2 }}>{lc.description}</div>}
                        {lc.required_skill_level && <div style={{ fontSize: 11, color: C.text2 }}>{lc.required_skill_level}{lc.bay_required ? ` · ${lc.bay_required}` : ''}</div>}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: C.text2 }}>{lc.category || '—'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' as const, background: lc.division === 'car' ? '#1E3A5F' : lc.division === 'bike' ? '#3A1E1E' : '#2A2A2A', color: lc.division === 'car' ? '#60A5FA' : lc.division === 'bike' ? '#F87171' : C.text2 }}>
                          {lc.division ?? 'both'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center', color: C.text2 }}>{lc.standard_duration ? `${lc.standard_duration}m` : '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{formatRM(lc.unit_price)}<div style={{ fontSize: 11, color: C.text2, fontWeight: 400 }}>per {lc.unit}</div></td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12 }}>{lc.taxable ? <span style={{ color: C.orange }}>Yes</span> : <span style={{ color: C.text2 }}>No</span>}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <button onClick={() => toggleLabourActive(lc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: lc.is_active ? C.green : C.text2 }}>
                          {lc.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <button onClick={() => openEditLabourCharge(lc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><Edit2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── ADD / EDIT MODAL ─────────────────────────────────────────────────────── */}
      {showLabourChargeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, width: '92%', maxWidth: 640, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingLabourCharge ? 'Edit Labour Charge' : 'Add Labour Charge'}</h3>
              <button onClick={() => setShowLabourChargeModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2 }}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: 'calc(85vh - 80px)' }}>

              {/* Row 1: Code + Name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Labour Code</label>
                  <input style={inputStyle} value={labourForm.labour_code} onChange={e => setLabourForm({ ...labourForm, labour_code: e.target.value })} placeholder="LAB-ENG-001" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Labour Name *</label>
                  <input style={inputStyle} value={labourForm.name} onChange={e => setLabourForm({ ...labourForm, name: e.target.value })} placeholder="e.g. Engine Oil Service" />
                </div>
              </div>

              {/* Row 2: Category + Duration */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Category</label>
                  <select style={inputStyle} value={labourForm.category} onChange={e => setLabourForm({ ...labourForm, category: e.target.value })}>
                    <option value="">— Select —</option>
                    <option value="Routine Maintenance">Routine Maintenance</option>
                    <option value="Diagnostics">Diagnostics</option>
                    <option value="Inspection">Inspection</option>
                    <option value="Brake System">Brake System</option>
                    <option value="Suspension">Suspension</option>
                    <option value="Steering">Steering</option>
                    <option value="Tyres">Tyres</option>
                    <option value="Alignment">Alignment</option>
                    <option value="Air Conditioning">Air Conditioning</option>
                    <option value="Engine">Engine</option>
                    <option value="Transmission">Transmission</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Final Drive">Final Drive</option>
                    <option value="Harley Upgrade">Harley Upgrade</option>
                    <option value="Performance">Performance</option>
                    <option value="Detailing">Detailing</option>
                    <option value="Mobile Service">Mobile Service</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Standard Duration (mins)</label>
                  <input type="number" style={inputStyle} value={labourForm.standard_duration} onChange={e => setLabourForm({ ...labourForm, standard_duration: e.target.value })} placeholder="e.g. 60" />
                </div>
              </div>

              {/* Row 3: Description */}
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Description</label>
                <input style={inputStyle} value={labourForm.description} onChange={e => setLabourForm({ ...labourForm, description: e.target.value })} placeholder="Optional details" />
              </div>

              {/* Row 4: Skill Level + Bay */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Required Skill Level</label>
                  <select style={inputStyle} value={labourForm.required_skill_level} onChange={e => setLabourForm({ ...labourForm, required_skill_level: e.target.value })}>
                    <option value="">— Any —</option>
                    <option value="Junior Mechanic">Junior Mechanic</option>
                    <option value="Mechanic">Mechanic</option>
                    <option value="Senior Mechanic">Senior Mechanic</option>
                    <option value="Master Technician">Master Technician</option>
                    <option value="Diagnostic Technician">Diagnostic Technician</option>
                    <option value="Electrical Technician">Electrical Technician</option>
                    <option value="AC Specialist">AC Specialist</option>
                    <option value="Suspension Specialist">Suspension Specialist</option>
                    <option value="Tyre Technician">Tyre Technician</option>
                    <option value="Alignment Technician">Alignment Technician</option>
                    <option value="Harley Specialist">Harley Specialist</option>
                    <option value="Harley Master Technician">Harley Master Technician</option>
                    <option value="Detailer">Detailer</option>
                    <option value="Senior Detailer">Senior Detailer</option>
                    <option value="Master Detailer">Master Detailer</option>
                    <option value="Foreman">Foreman</option>
                    <option value="Driver">Driver</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Bay Required</label>
                  <select style={inputStyle} value={labourForm.bay_required} onChange={e => setLabourForm({ ...labourForm, bay_required: e.target.value })}>
                    <option value="">— Any Bay —</option>
                    <option value="General Service Bay">General Service Bay</option>
                    <option value="Bike Service Bay">Bike Service Bay</option>
                    <option value="Premium Bike Bay">Premium Bike Bay</option>
                    <option value="Harley Bay">Harley Bay</option>
                    <option value="Dyno/Harley Bay">Dyno/Harley Bay</option>
                    <option value="Diagnostic Bay">Diagnostic Bay</option>
                    <option value="Brake Bay">Brake Bay</option>
                    <option value="Suspension Bay">Suspension Bay</option>
                    <option value="Alignment Bay">Alignment Bay</option>
                    <option value="Tyre Bay">Tyre Bay</option>
                    <option value="AC Bay">AC Bay</option>
                    <option value="Engine Bay">Engine Bay</option>
                    <option value="Transmission Bay">Transmission Bay</option>
                    <option value="Electrical Bay">Electrical Bay</option>
                    <option value="Detailing Bay">Detailing Bay</option>
                    <option value="Wash Bay">Wash Bay</option>
                    <option value="Coating Bay">Coating Bay</option>
                    <option value="Inspection Bay">Inspection Bay</option>
                    <option value="Road Test">Road Test</option>
                    <option value="Mobile Service">Mobile Service</option>
                    <option value="Transport">Transport</option>
                  </select>
                </div>
              </div>

              {/* Row 5: Division */}
              <div>
                <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 8 }}>Division</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['car', 'Car'], ['bike', 'Bike'], ['both', 'Both']] as const).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setLabourForm({ ...labourForm, division: val })} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${labourForm.division === val ? (val === 'car' ? '#3B82F6' : val === 'bike' ? '#EF4444' : C.orange) : C.border}`, background: labourForm.division === val ? (val === 'car' ? '#1E3A5F' : val === 'bike' ? '#3A1E1E' : '#3A1E0A') : C.bg, color: labourForm.division === val ? '#fff' : C.text2, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 6: Charge + Unit + Taxable */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Labour Charge (RM) *</label>
                  <input type="number" style={inputStyle} value={labourForm.unit_price} onChange={e => setLabourForm({ ...labourForm, unit_price: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Per Unit</label>
                  <select style={inputStyle} value={labourForm.unit} onChange={e => setLabourForm({ ...labourForm, unit: e.target.value })}>
                    <option value="job">job</option>
                    <option value="hr">hr</option>
                    <option value="unit">unit</option>
                    <option value="set">set</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.text2, fontWeight: 600, display: 'block', marginBottom: 6 }}>Taxable</label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                    {[['Yes', true], ['No', false]].map(([label, val]) => (
                      <button key={String(label)} type="button" onClick={() => setLabourForm({ ...labourForm, taxable: val as boolean })} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${labourForm.taxable === val ? C.orange : C.border}`, background: labourForm.taxable === val ? '#3A1E0A' : C.bg, color: labourForm.taxable === val ? C.orange : C.text2, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        {label as string}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button style={btnOutline} onClick={() => setShowLabourChargeModal(false)}>Cancel</button>
                <button style={btnOrange} onClick={saveLabourCharge} disabled={labourSaving || !labourForm.name || !labourForm.unit_price}>
                  {labourSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
