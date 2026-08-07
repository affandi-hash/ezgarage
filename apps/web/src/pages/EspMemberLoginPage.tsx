import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Wrench, Loader2, AlertCircle, CheckCircle, Lock, LogOut, MessageCircle, Car, Bike, Plus, FileText, RefreshCw, CalendarPlus, Wrench as WrenchIcon, X, UserCog, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { OTHER, makeOptionsFor, modelOptionsFor } from '@/lib/vehicleMakes'

const RAUDHAHPAY_CREATE_PAYMENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/raudhahpay-create-payment`
const ESP_RECEIPT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/esp-receipt`

// Same public-page color convention as EspRegistrationPage.tsx / CustomerPortalPage.tsx.
const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  surface2: '#1C1C1C',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
  green: '#22C55E',
  blue: '#3B82F6',
  red: '#EF4444',
}

interface TenantConfig {
  name: string
  logo_url: string | null
  whatsapp_number: string | null
}

interface Discounts {
  car_full_pct: number
  car_selected_pct: number
  bike_full_pct: number
  bike_selected_pct: number
}

interface Vehicle {
  id: string
  plate_number: string
  make: string | null
  model: string | null
  vehicle_type: 'car' | 'bike'
}

interface ServiceRecord {
  job_number: string
  service_type: string
  status: string
  checked_in_at: string
  final_amount: number | null
  plate_number: string
}

interface ReceiptMeta {
  receipt_id: string
  amount: number
  payment_date: string
  payment_method: string
  invoice_number: string
}

interface Membership {
  membership_number: string
  status: string
  valid_until: string | null
  community_name: string
  community_slug: string
  discounts: Discounts
  vehicles: Vehicle[]
  service_history: ServiceRecord[]
  receipts: ReceiptMeta[]
}

interface Session {
  phone: string
  password: string
  fullName: string
  email: string
  icNumber: string
  fullAddress: string
  memberships: Membership[]
}

const sessionKey = 'esp_member_login'
const pendingRenewalKey = 'esp_pending_renewal'

function inputStyle(): React.CSSProperties {
  return { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPrimary, padding: '10px 14px', fontSize: 14, boxSizing: 'border-box', outline: 'none' }
}
function labelStyle(): React.CSSProperties {
  return { display: 'block', fontSize: 11, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }
}
function sectionLabelStyle(): React.CSSProperties {
  return { fontSize: 11, color: C.textSecondary, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }
}
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

// ─── Add Vehicle ────────────────────────────────────────────────────────────

function AddVehicleForm({ membershipNumber, phone, password, tenantSlug, onAdded }: { membershipNumber: string; phone: string; password: string; tenantSlug?: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [plate, setPlate] = useState('')
  const [vehicleType, setVehicleType] = useState<'car' | 'bike'>('bike')
  const [make, setMake] = useState('')
  const [makeOther, setMakeOther] = useState(false)
  const [model, setModel] = useState('')
  const [modelOther, setModelOther] = useState(false)
  const [year, setYear] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function changeVehicleType(t: 'car' | 'bike') {
    if (t === vehicleType) return
    setVehicleType(t)
    setMake(''); setMakeOther(false); setModel(''); setModelOther(false)
  }

  async function submit() {
    if (!plate.trim()) return
    setSaving(true); setErr('')
    const { data, error } = await supabase.rpc('esp_member_add_vehicle', {
      p_phone: phone, p_password: password, p_membership_number: membershipNumber,
      p_plate_number: plate.trim(), p_vehicle_type: vehicleType,
      p_make: make.trim() || null, p_model: model.trim() || null, p_year: year.trim() || null,
      p_tenant_slug: tenantSlug || null,
    })
    setSaving(false)
    if (error) { setErr('Something went wrong.'); return }
    if (data?.error) {
      const msgs: Record<string, string> = { plate_already_registered_to_another_customer: 'That plate is already registered to someone else.' }
      setErr(msgs[data.error] ?? 'Could not add vehicle.')
      return
    }
    setPlate(''); setMake(''); setModel(''); setYear(''); setMakeOther(false); setModelOther(false); setOpen(false)
    onAdded()
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 8, color: C.textSecondary, fontSize: 12, padding: '7px 12px', cursor: 'pointer' }}>
        <Plus size={13} /> Add Vehicle
      </button>
    )
  }
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...inputStyle(), flex: 2 }} value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="Plate Number" />
        <select style={{ ...inputStyle(), flex: 1 }} value={vehicleType} onChange={e => changeVehicleType(e.target.value as 'car' | 'bike')}>
          <option value="bike">Bike</option>
          <option value="car">Car</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {makeOther ? (
          <div>
            <input style={inputStyle()} value={make} autoFocus onChange={e => setMake(e.target.value)} placeholder="Make" />
            <button type="button" onClick={() => { setMake(''); setMakeOther(false); setModel(''); setModelOther(false) }}
              style={{ background: 'none', border: 'none', color: C.textSecondary, fontSize: 11, padding: '3px 0', cursor: 'pointer', textDecoration: 'underline' }}>
              Choose from list
            </button>
          </div>
        ) : (
          <select style={inputStyle()} value={make} onChange={e => {
            const val = e.target.value
            if (val === OTHER) { setMake(''); setMakeOther(true); setModel(''); setModelOther(false) }
            else { setMake(val); setModel(''); setModelOther(false) }
          }}>
            <option value="">Select Make</option>
            {makeOptionsFor(vehicleType).map(m => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>Other</option>
          </select>
        )}

        {makeOther || modelOther ? (
          <div>
            <input style={inputStyle()} value={model} onChange={e => setModel(e.target.value)} placeholder="Model" />
            {!makeOther && (
              <button type="button" onClick={() => { setModel(''); setModelOther(false) }}
                style={{ background: 'none', border: 'none', color: C.textSecondary, fontSize: 11, padding: '3px 0', cursor: 'pointer', textDecoration: 'underline' }}>
                Choose from list
              </button>
            )}
          </div>
        ) : (
          <select style={inputStyle()} value={model} disabled={!make} onChange={e => {
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
      <input style={inputStyle()} type="number" value={year} onChange={e => setYear(e.target.value)} placeholder="Year (optional)" min={1900} max={2100} />
      {err && <div style={{ fontSize: 12, color: C.red }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={submit} disabled={saving} style={{ flex: 1, padding: '8px 0', borderRadius: 6, background: C.orange, border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Adding…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 14px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.textSecondary, fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Membership Card ────────────────────────────────────────────────────────

function MembershipCard({ m, phone, password, tenantSlug, onChanged, onViewVehicle }: { m: Membership; phone: string; password: string; tenantSlug?: string; onChanged: () => void; onViewVehicle: (vehicleId: string, plateNumber: string) => void }) {
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string> | null>(null)
  const [receiptsLoading, setReceiptsLoading] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [renewError, setRenewError] = useState('')

  const daysLeft = daysUntil(m.valid_until)
  const expiringSoon = m.status === 'active' && daysLeft !== null && daysLeft <= 30
  const expired = m.status === 'expired'
  const lastService = m.service_history[0]
  const daysSinceService = lastService ? Math.floor((Date.now() - new Date(lastService.checked_in_at).getTime()) / (1000 * 60 * 60 * 24)) : null
  const dueForCheckup = daysSinceService !== null && daysSinceService > 90

  async function loadReceipts() {
    if (receiptUrls || receiptsLoading || m.receipts.length === 0) return
    setReceiptsLoading(true)
    try {
      const res = await fetch(ESP_RECEIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ phone, password }),
      })
      const data = await res.json()
      if (res.ok && data.receipts) {
        const map: Record<string, string> = {}
        for (const r of data.receipts) map[r.receipt_id] = r.url
        setReceiptUrls(map)
      }
    } finally {
      setReceiptsLoading(false)
    }
  }

  async function renew() {
    setRenewing(true); setRenewError('')
    const { data, error } = await supabase.rpc('esp_member_renew', {
      p_phone: phone, p_password: password, p_membership_number: m.membership_number, p_tenant_slug: tenantSlug || null,
    })
    if (error || data?.error) {
      setRenewing(false)
      setRenewError(data?.error === 'community_inactive' ? 'This community is no longer accepting renewals.' : 'Could not create renewal invoice.')
      return
    }
    try {
      const res = await fetch(RAUDHAHPAY_CREATE_PAYMENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ invoice_id: data.invoice_id, payment_method: 'duitnow', redirect_url: window.location.href, phone, password }),
      })
      const payData = await res.json()
      if (!res.ok) { setRenewing(false); setRenewError(payData.error || 'Could not start payment.'); return }
      // So the page knows, on the redirect back, exactly which invoice to
      // actively confirm -- renewals don't flip esp_members.status the way
      // a first-time registration does (the member's already active), so
      // there's no status field alone that means "waiting on this renewal".
      sessionStorage.setItem(pendingRenewalKey, JSON.stringify({ invoiceId: data.invoice_id, membershipNumber: m.membership_number }))
      window.location.href = payData.payment_url
    } catch {
      setRenewing(false)
      setRenewError('Network error starting payment.')
    }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      {/* Membership card header */}
      <div style={{ padding: 20, background: `linear-gradient(135deg, ${C.orange}22, transparent)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, color: C.textSecondary }}>{m.community_name}</div>
            <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, letterSpacing: 0.5 }}>#{m.membership_number}</div>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5, background: m.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)', color: m.status === 'active' ? C.green : '#F59E0B' }}>
            {m.status === 'active' && <CheckCircle size={11} />}
            {m.status.replace('_', ' ')}
          </span>
        </div>
        {m.valid_until && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 10 }}>Valid until {formatDate(m.valid_until)}</div>}
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Expiry / maintenance banner */}
        {(expiringSoon || expired || dueForCheckup) && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F59E0B' }}>
            {expired ? 'Your membership has expired -- renew to keep enjoying your discounts.'
              : expiringSoon ? `Your membership expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} -- renew below to avoid a gap.`
              : `It's been ${daysSinceService} days since your last service -- might be due for a checkup.`}
          </div>
        )}

        {/* Discounts */}
        <div>
          <div style={sectionLabelStyle()}>Your Discounts</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: C.surface2, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Bike size={12} /> Bike</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.orange, marginTop: 4 }}>{m.discounts.bike_full_pct}% off Full Service</div>
              <div style={{ fontSize: 11, color: C.textSecondary }}>{m.discounts.bike_selected_pct}% off Selected Items</div>
            </div>
            <div style={{ background: C.surface2, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Car size={12} /> Car</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.orange, marginTop: 4 }}>{m.discounts.car_full_pct}% off Full Service</div>
              <div style={{ fontSize: 11, color: C.textSecondary }}>{m.discounts.car_selected_pct}% off Selected Items</div>
            </div>
          </div>
        </div>

        {/* Vehicles */}
        <div>
          <div style={sectionLabelStyle()}>Your Vehicles</div>
          {m.vehicles.length > 0 && (
            <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 8 }}>Tap a vehicle for its full service history, photos, and maintenance status.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {m.vehicles.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textSecondary }}>No vehicles on file yet.</div>
            ) : m.vehicles.map(v => (
              <button key={v.id} onClick={() => onViewVehicle(v.id, v.plate_number)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface2, border: 'none', borderRadius: 8, padding: '8px 12px', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                {v.vehicle_type === 'bike' ? <Bike size={13} color={C.textSecondary} /> : <Car size={13} color={C.textSecondary} />}
                <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{v.plate_number}</span>
                {(v.make || v.model) && <span style={{ fontSize: 12, color: C.textSecondary }}>{v.make} {v.model}</span>}
                <ChevronRight size={13} color={C.textSecondary} style={{ marginLeft: 'auto' }} />
              </button>
            ))}
          </div>
          <AddVehicleForm membershipNumber={m.membership_number} phone={phone} password={password} tenantSlug={tenantSlug} onAdded={onChanged} />
        </div>

        {/* Service history */}
        <div>
          <div style={sectionLabelStyle()}><WrenchIcon size={12} /> Service History</div>
          {m.service_history.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textSecondary }}>No service records yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {m.service_history.map(j => {
                const vehicle = m.vehicles.find(v => v.plate_number === j.plate_number)
                return (
                  <button key={j.job_number} type="button" disabled={!vehicle}
                    onClick={() => vehicle && onViewVehicle(vehicle.id, vehicle.plate_number)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface2, border: 'none', borderRadius: 8, padding: '8px 12px', width: '100%', textAlign: 'left', cursor: vehicle ? 'pointer' : 'default', font: 'inherit', color: 'inherit' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{j.plate_number} · {j.service_type}</div>
                      <div style={{ fontSize: 11, color: C.textSecondary }}>{formatDate(j.checked_in_at)} · {j.job_number}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {j.final_amount != null && <span style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>RM {j.final_amount.toFixed(2)}</span>}
                      {vehicle && <ChevronRight size={13} color={C.textSecondary} />}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Receipts */}
        <div>
          <div style={sectionLabelStyle()}><FileText size={12} /> Receipts</div>
          {m.receipts.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textSecondary }}>No receipts yet.</div>
          ) : receiptUrls === null ? (
            <button type="button" onClick={loadReceipts} disabled={receiptsLoading} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSecondary, fontSize: 12, padding: '8px 12px', cursor: 'pointer' }}>
              {receiptsLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={13} />}
              {receiptsLoading ? 'Loading…' : `View ${m.receipts.length} receipt${m.receipts.length > 1 ? 's' : ''}`}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {m.receipts.map(r => (
                <a key={r.receipt_id} href={receiptUrls[r.receipt_id]} target="_blank" rel="noreferrer"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface2, borderRadius: 8, padding: '8px 12px', textDecoration: 'none', color: 'inherit' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.invoice_number}</div>
                    <div style={{ fontSize: 11, color: C.textSecondary }}>{formatDate(r.payment_date)} · {r.payment_method}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.orange }}>RM {r.amount.toFixed(2)}</div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Actions: renew + book */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(expiringSoon || expired) && (
            <button type="button" onClick={renew} disabled={renewing} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: renewing ? 'not-allowed' : 'pointer', opacity: renewing ? 0.7 : 1 }}>
              <RefreshCw size={14} /> {renewing ? 'Starting payment…' : 'Renew Membership'}
            </button>
          )}
          {renewError && <div style={{ fontSize: 12, color: C.red }}>{renewError}</div>}
          <a href={`/book/${tenantSlug ?? ''}?esp=${encodeURIComponent(m.membership_number)}&phone=${encodeURIComponent(phone)}${m.vehicles[0] ? `&plate=${encodeURIComponent(m.vehicles[0].plate_number)}` : ''}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${C.blue}`, color: C.blue, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
            <CalendarPlus size={14} /> Book Appointment (Priority)
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Personal Details ───────────────────────────────────────────────────────

function PersonalDetailsModal({ session, tenantSlug, onClose, onSaved }: { session: Session; tenantSlug?: string; onClose: () => void; onSaved: (s: { fullName: string; phone: string; email: string; icNumber: string; fullAddress: string }) => void }) {
  const [fullName, setFullName] = useState(session.fullName)
  const [phone, setPhone] = useState(session.phone)
  const [email, setEmail] = useState(session.email)
  const [icNumber, setIcNumber] = useState(session.icNumber)
  const [fullAddress, setFullAddress] = useState(session.fullAddress)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!fullName.trim() || !phone.trim()) { setErr('Name and phone number are required.'); return }
    setSaving(true); setErr('')
    const { data, error } = await supabase.rpc('esp_member_update_profile', {
      p_phone: session.phone, p_password: session.password,
      p_full_name: fullName.trim(), p_new_phone: phone.trim(),
      p_email: email.trim() || null, p_ic_number: icNumber.trim() || null, p_full_address: fullAddress.trim() || null,
      p_tenant_slug: tenantSlug || null,
    })
    setSaving(false)
    if (error) { setErr('Something went wrong. Please try again.'); return }
    if (data?.error) {
      const msgs: Record<string, string> = {
        phone_already_in_use: 'That phone number is already used by another account.',
        full_name_required: 'Name is required.',
        phone_required: 'Phone number is required.',
        invalid_credentials: 'Session expired -- please log in again.',
      }
      setErr(msgs[data.error] ?? 'Could not save changes.')
      return
    }
    onSaved({ fullName: fullName.trim(), phone: phone.trim(), email: email.trim(), icNumber: icNumber.trim(), fullAddress: fullAddress.trim() })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Personal Details</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textSecondary, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle()}>Full Name *</label>
            <input style={inputStyle()} value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle()}>Phone Number *</label>
            <input style={inputStyle()} value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle()}>Email</label>
            <input style={inputStyle()} type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle()}>IC Number</label>
            <input style={inputStyle()} value={icNumber} onChange={e => setIcNumber(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle()}>Address</label>
            <textarea style={{ ...inputStyle(), minHeight: 64, resize: 'vertical' }} value={fullAddress} onChange={e => setFullAddress(e.target.value)} />
          </div>
          {err && <div style={{ fontSize: 12, color: C.red }}>{err}</div>}
          <button onClick={submit} disabled={saving} style={{ padding: '11px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vehicle Log ────────────────────────────────────────────────────────────

interface VehicleLogJob {
  job_id: string
  job_number: string
  service_type: string
  status: string
  checked_in_at: string
  customer_complaint: string | null
  diagnosis_summary: string | null
  final_amount: number | null
  photo_count: number
}

interface VehicleMaintenanceItem {
  item_id: string; name: string
  next_due_at: string | null; next_due_mileage: number | null
  status: 'ok' | 'due_soon' | 'overdue'
}

function maintenanceStatusColor(status: string) {
  if (status === 'overdue') return '#EF4444'
  if (status === 'due_soon') return '#EAB308'
  return '#22C55E'
}

function VehicleLogModal({ vehicleId, plateNumber, phone, password, tenantSlug, onClose }: { vehicleId: string; plateNumber: string; phone: string; password: string; tenantSlug?: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState<VehicleLogJob[]>([])
  const [vehicleInfo, setVehicleInfo] = useState<{ make: string | null; model: string | null; year: number | null; current_mileage: number | null } | null>(null)
  const [openPhotosJobId, setOpenPhotosJobId] = useState<string | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<string, { url: string; caption: string | null }[]>>({})
  const [photosLoading, setPhotosLoading] = useState(false)
  const [maintenance, setMaintenance] = useState<VehicleMaintenanceItem[]>([])

  useEffect(() => {
    supabase.rpc('esp_get_vehicle_log', { p_phone: phone, p_password: password, p_vehicle_id: vehicleId, p_tenant_slug: tenantSlug || null })
      .then(({ data, error: rpcErr }) => {
        setLoading(false)
        if (rpcErr || data?.error) { setError('Could not load vehicle history.'); return }
        setJobs(data.jobs ?? [])
        setVehicleInfo(data.vehicle)
      })
    supabase.rpc('esp_get_vehicle_maintenance', { p_phone: phone, p_password: password, p_vehicle_id: vehicleId, p_tenant_slug: tenantSlug || null })
      .then(({ data }) => { if (data?.success) setMaintenance(data.items ?? []) })
  }, [vehicleId, phone, password, tenantSlug])

  async function togglePhotos(jobId: string) {
    if (openPhotosJobId === jobId) { setOpenPhotosJobId(null); return }
    setOpenPhotosJobId(jobId)
    if (photoUrls[jobId]) return
    setPhotosLoading(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/esp-vehicle-photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ phone, password, job_id: jobId }),
      })
      const data = await res.json()
      if (res.ok && data.photos) setPhotoUrls(prev => ({ ...prev, [jobId]: data.photos }))
    } finally {
      setPhotosLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{plateNumber}</div>
            {vehicleInfo && (vehicleInfo.make || vehicleInfo.model) && (
              <div style={{ fontSize: 12, color: C.textSecondary }}>{vehicleInfo.make} {vehicleInfo.model} {vehicleInfo.year ?? ''}</div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textSecondary, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20 }}>
          {maintenance.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: '0.05em', marginBottom: 8 }}>MAINTENANCE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {maintenance.map(m => (
                  <div key={m.item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: maintenanceStatusColor(m.status), flexShrink: 0 }} />
                    <span style={{ fontSize: 12, flex: 1 }}>{m.name}</span>
                    <span style={{ fontSize: 11, color: C.textSecondary }}>
                      {m.status === 'overdue' ? 'Overdue' : m.status === 'due_soon' ? 'Due soon' : 'OK'}
                      {m.next_due_mileage != null ? ` · ${m.next_due_mileage.toLocaleString()} km` : ''}
                      {m.next_due_at ? ` · ${formatDate(m.next_due_at)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} color={C.textSecondary} /></div>
          ) : error ? (
            <div style={{ fontSize: 13, color: C.red }}>{error}</div>
          ) : jobs.length === 0 ? (
            <div style={{ fontSize: 13, color: C.textSecondary, textAlign: 'center' }}>No service history yet for this vehicle.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {jobs.map(j => (
                <div key={j.job_id} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{j.service_type} · {j.job_number}</div>
                      <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>{formatDate(j.checked_in_at)} · {j.status.replace('_', ' ')}</div>
                    </div>
                    {j.final_amount != null && <div style={{ fontSize: 13, fontWeight: 700 }}>RM {j.final_amount.toFixed(2)}</div>}
                  </div>
                  {j.customer_complaint && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 8 }}><strong style={{ color: C.textPrimary }}>Complaint:</strong> {j.customer_complaint}</div>}
                  {j.diagnosis_summary && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}><strong style={{ color: C.textPrimary }}>Diagnosis:</strong> {j.diagnosis_summary}</div>}
                  {j.photo_count > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => togglePhotos(j.job_id)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSecondary, fontSize: 11, padding: '5px 10px', cursor: 'pointer' }}>
                        <FileText size={11} /> {openPhotosJobId === j.job_id ? 'Hide' : 'View'} {j.photo_count} photo{j.photo_count > 1 ? 's' : ''}
                      </button>
                      {openPhotosJobId === j.job_id && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {photosLoading ? (
                            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} color={C.textSecondary} />
                          ) : (
                            (photoUrls[j.job_id] ?? []).map((p, i) => (
                              <a key={i} href={p.url} target="_blank" rel="noreferrer" style={{ width: 64, height: 64, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                                <img src={p.url} alt={p.caption ?? 'Job photo'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              </a>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export function EspMemberLoginPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>()

  const [config, setConfig] = useState<TenantConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)

  const [session, setSession] = useState<Session | null>(null)
  const [mode, setMode] = useState<'login' | 'setup'>('login')

  // Login form
  const [loginPhone, setLoginPhone] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  // First-time setup form
  const [setupMembershipNumber, setSetupMembershipNumber] = useState('')
  const [setupPhone, setSetupPhone] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirm, setSetupConfirm] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [setupDone, setSetupDone] = useState(false)

  useEffect(() => {
    supabase.rpc('get_portal_config', { p_tenant_slug: tenantSlug || null }).then(({ data }) => {
      setConfigLoading(false)
      if (data) setConfig(data as TenantConfig)
    })
  }, [tenantSlug])

  useEffect(() => {
    const cached = sessionStorage.getItem(sessionKey)
    if (!cached) return
    try {
      const parsed = JSON.parse(cached) as Session
      doLogin(parsed.phone, parsed.password, true)
    } catch { /* ignore malformed cache */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug])

  // Renewals don't flip esp_members.status the way a first-time
  // registration does (the member's already active before renewing), so
  // there's no status field alone that means "waiting on this specific
  // renewal payment" -- pendingRenewal (stashed in sessionStorage right
  // before the RaudhahPay redirect) is what the "Confirming your renewal"
  // banner keys off, independent of membership status. Actively triggers
  // reconcile_invoice_now() each tick rather than passively waiting on the
  // cron backstop, same reasoning as EspRegistrationPage.tsx.
  const [showPersonalDetails, setShowPersonalDetails] = useState(false)
  const [viewingVehicle, setViewingVehicle] = useState<{ id: string; plateNumber: string } | null>(null)

  const [pendingRenewal, setPendingRenewal] = useState<{ invoiceId: string; membershipNumber: string } | null>(null)
  const [renewalPollAttempts, setRenewalPollAttempts] = useState(0)
  const [renewalConfirmed, setRenewalConfirmed] = useState(false)

  useEffect(() => {
    const cached = sessionStorage.getItem(pendingRenewalKey)
    if (!cached) return
    try { setPendingRenewal(JSON.parse(cached)) } catch { sessionStorage.removeItem(pendingRenewalKey) }
  }, [])

  useEffect(() => {
    if (!pendingRenewal || !session) return
    setRenewalPollAttempts(0)
    let attempts = 0
    const interval = setInterval(async () => {
      attempts += 1
      setRenewalPollAttempts(attempts)
      const { data } = await supabase.rpc('reconcile_invoice_now', { p_invoice_id: pendingRenewal.invoiceId })
      if (data?.status === 'paid') {
        clearInterval(interval)
        sessionStorage.removeItem(pendingRenewalKey)
        setRenewalConfirmed(true)
        await doLogin(session.phone, session.password, true)
        setTimeout(() => { setPendingRenewal(null); setRenewalConfirmed(false) }, 4000)
        return
      }
      if (attempts > 40) clearInterval(interval)
    }, 3000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRenewal, session])

  async function doLogin(phone: string, password: string, silent = false) {
    if (!silent) { setLoginLoading(true); setLoginError('') }
    const { data, error } = await supabase.rpc('esp_login', {
      p_phone: phone, p_password: password, p_tenant_slug: tenantSlug || null,
    })
    if (!silent) setLoginLoading(false)
    if (error || data?.error) {
      if (!silent) setLoginError('Phone number or password is incorrect.')
      else sessionStorage.removeItem(sessionKey)
      return
    }
    const s: Session = {
      phone, password, fullName: data.full_name,
      email: data.email ?? '', icNumber: data.ic_number ?? '', fullAddress: data.full_address ?? '',
      memberships: data.memberships,
    }
    sessionStorage.setItem(sessionKey, JSON.stringify(s))
    setSession(s)
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!loginPhone.trim() || !loginPassword) return
    await doLogin(loginPhone.trim(), loginPassword)
  }

  async function handleSetupSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSetupError('')
    if (setupPassword.length < 6) { setSetupError('Password must be at least 6 characters.'); return }
    if (setupPassword !== setupConfirm) { setSetupError('Passwords do not match.'); return }
    setSetupLoading(true)
    const { data, error } = await supabase.rpc('esp_set_password', {
      p_membership_number: setupMembershipNumber.trim(),
      p_phone: setupPhone.trim(),
      p_new_password: setupPassword,
      p_tenant_slug: tenantSlug || null,
    })
    setSetupLoading(false)
    if (error) { setSetupError('Something went wrong. Please try again.'); return }
    if (data?.error) {
      const msgs: Record<string, string> = {
        not_found: 'Membership number not found.',
        phone_mismatch: 'Phone number does not match our records for this membership.',
        password_already_set: 'This membership already has a password set. Use Log In instead, or contact us below if you forgot it.',
        password_too_short: 'Password must be at least 6 characters.',
      }
      setSetupError(msgs[data.error] ?? 'Could not set password. Please contact the workshop.')
      return
    }
    setSetupDone(true)
  }

  function logout() {
    sessionStorage.removeItem(sessionKey)
    sessionStorage.removeItem(pendingRenewalKey)
    setSession(null)
    setPendingRenewal(null)
    setLoginPhone(''); setLoginPassword('')
  }

  if (configLoading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} color={C.textSecondary} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>

      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {config?.logo_url ? (
            <img src={config.logo_url} alt={config.name} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'contain', background: '#fff' }} />
          ) : (
            <div style={{ width: 34, height: 34, background: C.orange, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wrench size={17} color="#fff" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{config?.name ?? 'ESP Members'}</div>
            <div style={{ fontSize: 11, color: C.textSecondary }}>Member Login</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 24px 60px' }}>
        {session ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Hi, {session.fullName}</div>
                <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>Your ESP membership{session.memberships.length > 1 ? 's' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowPersonalDetails(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSecondary, fontSize: 12, padding: '7px 12px', cursor: 'pointer' }}>
                  <UserCog size={13} /> Details
                </button>
                <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSecondary, fontSize: 12, padding: '7px 12px', cursor: 'pointer' }}>
                  <LogOut size={13} /> Log Out
                </button>
              </div>
            </div>

            {pendingRenewal && (
              <div style={{ background: renewalConfirmed ? 'rgba(34,197,94,0.08)' : 'rgba(241,90,34,0.08)', border: `1px solid ${renewalConfirmed ? 'rgba(34,197,94,0.25)' : 'rgba(241,90,34,0.25)'}`, borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {renewalConfirmed ? <CheckCircle size={16} color={C.green} /> : <Loader2 size={16} color={C.orange} style={{ animation: 'spin 1s linear infinite' }} />}
                  <div style={{ fontSize: 12, color: renewalConfirmed ? C.green : C.textPrimary }}>
                    {renewalConfirmed
                      ? 'Renewal confirmed!'
                      : renewalPollAttempts < 20
                        ? "Confirming your renewal payment — if you've already paid, this usually only takes a few seconds."
                        : "Still confirming — if your bank or e-wallet already showed success, you're covered, this is just taking a little longer than usual."}
                  </div>
                </div>
                {!renewalConfirmed && renewalPollAttempts >= 20 && config?.whatsapp_number && (
                  <a href={`https://wa.me/${config.whatsapp_number}?text=${encodeURIComponent(`Hi, I already paid for my ESP membership renewal (#${pendingRenewal.membershipNumber}) but it still shows Pending on my end.`)}`}
                    target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSecondary, textDecoration: 'none', marginLeft: 26 }}>
                    <MessageCircle size={13} /> Already paid? Contact us on WhatsApp
                  </a>
                )}
              </div>
            )}

            {session.memberships.length === 0 ? (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
                No ESP memberships found on this account.
              </div>
            ) : (
              session.memberships.map(m => (
                <MembershipCard key={m.membership_number} m={m} phone={session.phone} password={session.password} tenantSlug={tenantSlug} onChanged={() => doLogin(session.phone, session.password, true)} onViewVehicle={(id, plateNumber) => setViewingVehicle({ id, plateNumber })} />
              ))
            )}
          </div>
        ) : mode === 'login' ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <Lock size={18} color={C.orange} />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Member Log In</div>
            </div>
            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle()}>Phone Number</label>
                <input style={inputStyle()} value={loginPhone} onChange={e => setLoginPhone(e.target.value)} placeholder="e.g. 012-3456789" required />
              </div>
              <div>
                <label style={labelStyle()}>Password</label>
                <input style={inputStyle()} type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required />
              </div>
              {loginError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.red, fontSize: 12 }}>
                  <AlertCircle size={13} /> {loginError}
                </div>
              )}
              <button type="submit" disabled={loginLoading} style={{ padding: '11px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loginLoading ? 'not-allowed' : 'pointer', opacity: loginLoading ? 0.7 : 1 }}>
                {loginLoading ? 'Logging in…' : 'Log In'}
              </button>
            </form>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={() => { setMode('setup'); setSetupError(''); setSetupDone(false) }} style={{ background: 'transparent', border: 'none', color: C.textSecondary, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
                First time logging in? Set up your password
              </button>
              {config?.whatsapp_number && (
                <a href={`https://wa.me/${config.whatsapp_number}?text=${encodeURIComponent('Hi, I forgot my ESP member portal password.')}`} target="_blank" rel="noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSecondary, textDecoration: 'none' }}>
                  <MessageCircle size={13} /> Forgot password? Contact us on WhatsApp
                </a>
              )}
            </div>
          </div>
        ) : (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Set Up Your Password</div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 18 }}>Enter your membership number and the phone number you registered with, then choose a password.</div>
            {setupDone ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                <CheckCircle size={28} color={C.green} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>Password set!</div>
                <button type="button" onClick={() => { setMode('login'); setLoginPhone(setupPhone) }} style={{ marginTop: 6, padding: '9px 18px', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Go to Log In
                </button>
              </div>
            ) : (
              <form onSubmit={handleSetupSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle()}>Membership Number</label>
                  <input style={inputStyle()} value={setupMembershipNumber} onChange={e => setSetupMembershipNumber(e.target.value.toUpperCase())} placeholder="e.g. SMXMG-2026-0001" required />
                </div>
                <div>
                  <label style={labelStyle()}>Phone Number</label>
                  <input style={inputStyle()} value={setupPhone} onChange={e => setSetupPhone(e.target.value)} placeholder="The number you registered with" required />
                </div>
                <div>
                  <label style={labelStyle()}>New Password</label>
                  <input style={inputStyle()} type="password" value={setupPassword} onChange={e => setSetupPassword(e.target.value)} required />
                </div>
                <div>
                  <label style={labelStyle()}>Confirm Password</label>
                  <input style={inputStyle()} type="password" value={setupConfirm} onChange={e => setSetupConfirm(e.target.value)} required />
                </div>
                {setupError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.red, fontSize: 12 }}>
                    <AlertCircle size={13} /> {setupError}
                  </div>
                )}
                <button type="submit" disabled={setupLoading} style={{ padding: '11px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: setupLoading ? 'not-allowed' : 'pointer', opacity: setupLoading ? 0.7 : 1 }}>
                  {setupLoading ? 'Setting up…' : 'Set Password'}
                </button>
                <button type="button" onClick={() => setMode('login')} style={{ background: 'transparent', border: 'none', color: C.textSecondary, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
                  Back to Log In
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {session && showPersonalDetails && (
        <PersonalDetailsModal
          session={session}
          tenantSlug={tenantSlug}
          onClose={() => setShowPersonalDetails(false)}
          onSaved={(updated) => {
            const next: Session = { ...session, fullName: updated.fullName, phone: updated.phone, email: updated.email, icNumber: updated.icNumber, fullAddress: updated.fullAddress }
            sessionStorage.setItem(sessionKey, JSON.stringify(next))
            setSession(next)
            setShowPersonalDetails(false)
          }}
        />
      )}

      {session && viewingVehicle && (
        <VehicleLogModal
          vehicleId={viewingVehicle.id}
          plateNumber={viewingVehicle.plateNumber}
          phone={session.phone}
          password={session.password}
          tenantSlug={tenantSlug}
          onClose={() => setViewingVehicle(null)}
        />
      )}
    </div>
  )
}
