import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Wrench, Loader2, AlertCircle, CheckCircle, Plus, Trash2, CreditCard, QrCode, Landmark, Car, Bike } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const RAUDHAHPAY_CREATE_PAYMENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/raudhahpay-create-payment`

// Disabled -- same stale-webhook-secret risk that disabled FPX in
// CustomerPortalPage.tsx (see MVG-INV-2026-0075 investigation). Turned off
// until that's confirmed fixed against the merchant dashboard's current secret.
const FPX_ENABLED = false

// Same color convention as CustomerPortalPage.tsx / OnlineBookingPage.tsx --
// there's no shared public-page shell in this codebase, so this is a
// deliberate copy of the existing pattern for visual consistency.
const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  surface2: '#1C1C1C',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
  green: '#22C55E',
  red: '#EF4444',
}

interface CommunityConfig {
  id: string
  name: string
  slug: string
  description: string | null
  membership_fee: number
  validity_years: number
  car_full_package_discount_pct: number
  car_selected_item_discount_pct: number
  bike_full_package_discount_pct: number
  bike_selected_item_discount_pct: number
  tenant_name: string
  tenant_logo_url: string | null
  tenant_phone: string | null
}

interface VehicleRow {
  plate_number: string
  vehicle_type: 'car' | 'bike'
  make: string
  model: string
  year: string
  // UI-only -- true once the rider has chosen "Other" and is typing a make/
  // model we don't have in the lists below. Never sent to the backend (the
  // submit payload picks fields individually), just controls which control
  // renders for that row.
  makeOther: boolean
  modelOther: boolean
}

// No make/model catalogue exists anywhere else in this codebase (every other
// Make/Model field across the app, e.g. VehiclesPage.tsx, is plain free
// text) -- this is a new, self-contained reference list scoped to this
// public registration form. Keeps an "Other" escape hatch on both Make and
// Model so a rider whose brand isn't listed is never blocked from
// registering.
const OTHER = '__other__'

const BIKE_MAKES: Record<string, string[]> = {
  'Honda': ['CBR500R', 'CB500X', 'Africa Twin', 'Rebel 500', 'Gold Wing', 'CB650R', 'Forza 350', 'EX5', 'RS150R'],
  'Yamaha': ['YZF-R15', 'YZF-R25', 'MT-15', 'MT-25', 'NMAX', 'XMAX', 'Y15ZR', 'Lagenda', 'Tenere 700'],
  'Kawasaki': ['Ninja 250', 'Ninja 400', 'Ninja 650', 'Z650', 'Versys 650', 'Vulcan S'],
  'Suzuki': ['GSX-R150', 'GSX-S150', 'V-Strom 250', 'Burgman'],
  'Harley-Davidson': ['Sportster S', 'Iron 883', 'Forty-Eight', 'Seventy-Two', 'Nightster', 'Street Bob', 'Fat Bob', 'Low Rider', 'Low Rider S', 'Breakout', 'Fat Boy', 'Road King', 'Street Glide', 'Road Glide', 'Ultra Limited', 'Pan America'],
  'Ducati': ['Monster', 'Scrambler', 'Panigale V2', 'Panigale V4', 'Multistrada', 'Diavel'],
  'BMW Motorrad': ['G 310 R', 'G 310 GS', 'F 850 GS', 'R 1250 GS', 'S 1000 RR'],
  'Royal Enfield': ['Classic 350', 'Meteor 350', 'Himalayan', 'Interceptor 650', 'Continental GT 650'],
  'Triumph': ['Street Triple', 'Speed Triple', 'Bonneville T100', 'Tiger 900', 'Trident 660'],
  'KTM': ['Duke 200', 'Duke 250', 'Duke 390', 'RC 390', 'Adventure 390'],
  'Modenas': ['Pulsar NS200', 'V15', 'Dominar 400', 'Kriss'],
  'SYM': ['VF3', 'Jet 14', 'Cruisym'],
  'Vespa': ['Primavera', 'Sprint', 'GTS'],
  'Benelli': ['Leoncino 500', 'TRK 502'],
  'CFMoto': ['300NK', '450NK', '700CL-X'],
}

const CAR_MAKES: Record<string, string[]> = {
  'Perodua': ['Axia', 'Bezza', 'Myvi', 'Alza', 'Aruz', 'Ativa'],
  'Proton': ['Saga', 'Persona', 'Iriz', 'Exora', 'X50', 'X70', 'X90', 'S70'],
  'Toyota': ['Vios', 'Yaris', 'Corolla Altis', 'Camry', 'Innova', 'Fortuner', 'Hilux', 'Alphard', 'Avanza', 'RAV4'],
  'Honda': ['City', 'Civic', 'Accord', 'HR-V', 'CR-V', 'BR-V', 'Jazz'],
  'Nissan': ['Almera', 'X-Trail', 'Navara', 'Serena'],
  'Mazda': ['Mazda 2', 'Mazda 3', 'CX-3', 'CX-5', 'CX-8'],
  'Mitsubishi': ['Attrage', 'Triton', 'Xpander', 'ASX', 'Outlander'],
  'Hyundai': ['Elantra', 'Tucson', 'Santa Fe', 'Ioniq 5'],
  'Kia': ['Picanto', 'Sportage', 'Sorento', 'Carnival'],
  'BMW': ['1 Series', '3 Series', '5 Series', 'X1', 'X3', 'X5'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'E-Class', 'GLA', 'GLC'],
  'Volkswagen': ['Vento', 'Golf', 'Passat', 'Tiguan'],
  'Ford': ['Ranger', 'Everest', 'Territory'],
  'Suzuki': ['Swift', 'Ertiga'],
  'Isuzu': ['D-Max', 'MU-X'],
  'MINI': ['Cooper', 'Countryman'],
  'Volvo': ['XC40', 'XC60', 'XC90', 'S60'],
}

function makeOptionsFor(type: 'car' | 'bike'): string[] {
  return Object.keys(type === 'bike' ? BIKE_MAKES : CAR_MAKES)
}
function modelOptionsFor(type: 'car' | 'bike', make: string): string[] {
  return (type === 'bike' ? BIKE_MAKES : CAR_MAKES)[make] ?? []
}

interface RegistrationSession {
  memberId: string
  membershipNumber: string
  invoiceId: string
  amount: number
  phone: string
  icFirst6: string
}

function emptyVehicle(): VehicleRow {
  return { plate_number: '', vehicle_type: 'bike', make: '', model: '', year: '', makeOther: false, modelOther: false }
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%', padding: '10px 12px', borderRadius: 8, background: C.surface2,
    border: `1px solid ${C.border}`, color: C.textPrimary, fontSize: 13,
  }
}

function labelStyle(): React.CSSProperties {
  return { fontSize: 12, color: C.textSecondary, marginBottom: 6, display: 'block' }
}

export function EspRegistrationPage() {
  const { communitySlug } = useParams<{ communitySlug: string }>()

  const [config, setConfig] = useState<CommunityConfig | null>(null)
  const [configError, setConfigError] = useState('')
  const [configLoading, setConfigLoading] = useState(true)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [icNumber, setIcNumber] = useState('')
  const [vehicles, setVehicles] = useState<VehicleRow[]>([emptyVehicle()])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [session, setSession] = useState<RegistrationSession | null>(null)
  const [statusText, setStatusText] = useState<{ status: string; validUntil: string | null } | null>(null)
  const [payLoading, setPayLoading] = useState<'fpx' | 'duitnow' | 'credit_card' | null>(null)
  const [payError, setPayError] = useState('')

  const sessionKey = `esp_registration_${communitySlug}`

  useEffect(() => {
    if (!communitySlug) return
    setConfigLoading(true)
    supabase.rpc('get_esp_community_public', { p_community_slug: communitySlug }).then(({ data, error }) => {
      setConfigLoading(false)
      if (error || !data || data.error) {
        setConfigError('This ESP registration link is invalid or no longer active.')
        return
      }
      setConfig(data as CommunityConfig)
    })
  }, [communitySlug])

  // Restore state after returning from an external FPX/DuitNow/card redirect.
  // Kept in sessionStorage, not the URL -- RaudhahPay's own redirect back has
  // been observed appending its callback params with a second "?" instead of
  // "&", which would corrupt anything read from window.location.search.
  useEffect(() => {
    const cached = sessionStorage.getItem(sessionKey)
    if (!cached) return
    try {
      const parsed = JSON.parse(cached) as RegistrationSession
      setSession(parsed)
      checkStatus(parsed)
    } catch { /* ignore malformed cache */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communitySlug])

  async function checkStatus(s: RegistrationSession) {
    const { data } = await supabase.rpc('esp_check_status', {
      p_membership_number: s.membershipNumber, p_phone: s.phone,
    })
    if (data?.success) setStatusText({ status: data.status, validUntil: data.valid_until })
  }

  function addVehicle() {
    setVehicles(v => [...v, emptyVehicle()])
  }
  function removeVehicle(idx: number) {
    setVehicles(v => v.length > 1 ? v.filter((_, i) => i !== idx) : v)
  }
  function updateVehicle(idx: number, patch: Partial<VehicleRow>) {
    setVehicles(v => v.map((row, i) => i === idx ? { ...row, ...patch } : row))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !phone.trim()) return
    if (vehicles.some(v => !v.plate_number.trim())) {
      setSubmitError('Every vehicle needs a plate number.')
      return
    }
    setSubmitting(true)
    setSubmitError('')

    const { data, error } = await supabase.rpc('esp_public_register', {
      p_community_slug: communitySlug,
      p_full_name: fullName.trim(),
      p_phone: phone.trim(),
      p_email: email.trim() || null,
      p_ic_number: icNumber.trim() || null,
      p_vehicles: vehicles.map(v => ({
        plate_number: v.plate_number.trim(),
        vehicle_type: v.vehicle_type,
        make: v.make.trim() || null,
        model: v.model.trim() || null,
        year: v.year.trim() || null,
      })),
    })

    setSubmitting(false)

    if (error) {
      setSubmitError('Something went wrong. Please try again.')
      return
    }
    if (data?.error) {
      const msgs: Record<string, string> = {
        community_not_found: 'This ESP registration link is invalid or no longer active.',
        full_name_required: 'Please enter your full name.',
        phone_required: 'Please enter a valid phone number.',
        at_least_one_vehicle_required: 'Please add at least one vehicle.',
        plate_number_required: 'Every vehicle needs a plate number.',
        invalid_vehicle_type: 'Please select a valid vehicle type.',
        plate_already_registered_to_another_customer: `Plate ${data.plate ?? ''} is already registered to a different customer. Please contact the workshop directly.`,
        already_active_member: `You're already an active member -- #${data.membership_number}, valid until ${data.valid_until}.`,
      }
      setSubmitError(msgs[data.error] ?? 'Registration failed. Please contact the workshop.')
      if (data.error === 'already_active_member') {
        setStatusText({ status: 'active', validUntil: data.valid_until })
      }
      return
    }

    // Use the customer's ACTUAL stored phone/IC from the response, never
    // what was just typed -- resubmitting this form with different details
    // than a previous attempt does not overwrite an existing customer's
    // phone/IC (only backfills empty fields), so trusting local form state
    // here caused a real "Could not verify your identity" failure at
    // payment time once the two diverged.
    const s: RegistrationSession = {
      memberId: data.member_id, membershipNumber: data.membership_number,
      invoiceId: data.invoice_id, amount: data.amount,
      phone: data.customer_phone, icFirst6: data.customer_ic_first6,
    }
    sessionStorage.setItem(sessionKey, JSON.stringify(s))
    setSession(s)
  }

  async function startPayment(method: 'fpx' | 'duitnow' | 'credit_card') {
    if (!session) return
    setPayLoading(method); setPayError('')
    try {
      const res = await fetch(RAUDHAHPAY_CREATE_PAYMENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({
          invoice_id: session.invoiceId, payment_method: method, redirect_url: window.location.href,
          phone: session.phone, ic_first6: session.icFirst6,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setPayError(data.error || 'Failed to start payment. Please try again.'); setPayLoading(null); return }
      window.location.href = data.payment_url
    } catch {
      setPayError('Network error. Please check your connection and try again.')
      setPayLoading(null)
    }
  }

  if (configLoading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} color={C.textSecondary} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (configError || !config) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <AlertCircle size={32} color={C.red} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{configError}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>

      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {config.tenant_logo_url ? (
            <img src={config.tenant_logo_url} alt={config.tenant_name} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'contain', background: '#fff' }} />
          ) : (
            <div style={{ width: 34, height: 34, background: C.orange, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wrench size={17} color="#fff" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{config.tenant_name}</div>
            <div style={{ fontSize: 11, color: C.textSecondary }}>Exclusive Service Partner Programme</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 24px 60px' }}>
        {/* Community pitch */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{config.name}</div>
          {config.description && <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 6 }}>{config.description}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
            <div style={{ background: C.surface2, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Bike size={12} /> Bike Division</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.orange, marginTop: 4 }}>{config.bike_full_package_discount_pct}% off Full Service Package</div>
              <div style={{ fontSize: 11, color: C.textSecondary }}>{config.bike_selected_item_discount_pct}% off Selected Item/Services</div>
            </div>
            <div style={{ background: C.surface2, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Car size={12} /> Car Division</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.orange, marginTop: 4 }}>{config.car_full_package_discount_pct}% off Full Service Package</div>
              <div style={{ fontSize: 11, color: C.textSecondary }}>{config.car_selected_item_discount_pct}% off Selected Item/Services</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 12 }}>
            Membership fee: <strong style={{ color: C.textPrimary }}>RM {config.membership_fee.toFixed(2)}</strong> · Valid for <strong style={{ color: C.textPrimary }}>{config.validity_years} year{config.validity_years > 1 ? 's' : ''}</strong>
          </div>
        </div>

        {statusText ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
            <CheckCircle size={32} color={statusText.status === 'active' ? C.green : C.textSecondary} style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {statusText.status === 'active' ? 'Membership Active' : 'Payment Pending'}
            </div>
            {session && <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>Membership #{session.membershipNumber}</div>}
            {statusText.validUntil && <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>Valid until {statusText.validUntil}</div>}
            {statusText.status === 'pending_payment' && session && (
              <div style={{ marginTop: 16 }}>
                <PaymentButtons loading={payLoading} error={payError} onPay={startPayment} />
              </div>
            )}
          </div>
        ) : session ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Almost done -- pay your membership fee</div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>Membership #{session.membershipNumber} · RM {session.amount.toFixed(2)}</div>
            <div style={{ marginTop: 16 }}>
              <PaymentButtons loading={payLoading} error={payError} onPay={startPayment} />
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Your Details</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={labelStyle()}>Full Name *</label>
                  <input style={inputStyle()} value={fullName} onChange={e => setFullName(e.target.value)} required />
                </div>
                <div>
                  <label style={labelStyle()}>Phone Number *</label>
                  <input style={inputStyle()} value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 012-3456789" required />
                </div>
                <div>
                  <label style={labelStyle()}>Email</label>
                  <input style={inputStyle()} type="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle()}>IC Number</label>
                  <input style={inputStyle()} value={icNumber} onChange={e => setIcNumber(e.target.value)} placeholder="e.g. 900101-01-1234" />
                </div>
              </div>
            </div>

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Your Vehicle(s)</div>
                <button type="button" onClick={addVehicle} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: `1px solid ${C.border}`, color: C.textPrimary, borderRadius: 6, padding: '5px 9px', fontSize: 12, cursor: 'pointer' }}>
                  <Plus size={13} /> Add Vehicle
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {vehicles.map((v, idx) => (
                  <div key={idx} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(['bike', 'car'] as const).map(t => (
                          <button key={t} type="button" onClick={() => {
                            if (t === v.vehicle_type) return
                            updateVehicle(idx, { vehicle_type: t, make: '', model: '', makeOther: false, modelOther: false })
                          }}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: `1px solid ${v.vehicle_type === t ? C.orange : C.border}`, background: v.vehicle_type === t ? C.orange : 'transparent', color: v.vehicle_type === t ? '#fff' : C.textSecondary }}>
                            {t === 'bike' ? <Bike size={12} /> : <Car size={12} />} {t === 'bike' ? 'Bike' : 'Car'}
                          </button>
                        ))}
                      </div>
                      {vehicles.length > 1 && (
                        <button type="button" onClick={() => removeVehicle(idx)} style={{ background: 'transparent', border: 'none', color: C.red, cursor: 'pointer' }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input style={inputStyle()} placeholder="Plate Number *" value={v.plate_number} onChange={e => updateVehicle(idx, { plate_number: e.target.value })} required />
                      <input style={inputStyle()} placeholder="Year" value={v.year} onChange={e => updateVehicle(idx, { year: e.target.value })} />

                      {v.makeOther ? (
                        <div>
                          <input style={inputStyle()} placeholder="Make" value={v.make} autoFocus onChange={e => updateVehicle(idx, { make: e.target.value })} />
                          <button type="button" onClick={() => updateVehicle(idx, { make: '', makeOther: false, model: '', modelOther: false })}
                            style={{ background: 'transparent', border: 'none', color: C.textSecondary, fontSize: 11, padding: '3px 0', cursor: 'pointer', textDecoration: 'underline' }}>
                            Choose from list
                          </button>
                        </div>
                      ) : (
                        <select style={inputStyle()} value={v.make} onChange={e => {
                          const val = e.target.value
                          if (val === OTHER) updateVehicle(idx, { make: '', makeOther: true, model: '', modelOther: false })
                          else updateVehicle(idx, { make: val, model: '', modelOther: false })
                        }}>
                          <option value="">Select Make</option>
                          {makeOptionsFor(v.vehicle_type).map(m => <option key={m} value={m}>{m}</option>)}
                          <option value={OTHER}>Other</option>
                        </select>
                      )}

                      {v.makeOther || v.modelOther ? (
                        <div>
                          <input style={inputStyle()} placeholder="Model" value={v.model} onChange={e => updateVehicle(idx, { model: e.target.value })} />
                          {!v.makeOther && (
                            <button type="button" onClick={() => updateVehicle(idx, { model: '', modelOther: false })}
                              style={{ background: 'transparent', border: 'none', color: C.textSecondary, fontSize: 11, padding: '3px 0', cursor: 'pointer', textDecoration: 'underline' }}>
                              Choose from list
                            </button>
                          )}
                        </div>
                      ) : (
                        <select style={inputStyle()} value={v.model} disabled={!v.make} onChange={e => {
                          const val = e.target.value
                          if (val === OTHER) updateVehicle(idx, { model: '', modelOther: true })
                          else updateVehicle(idx, { model: val })
                        }}>
                          <option value="">{v.make ? 'Select Model' : 'Select Make first'}</option>
                          {modelOptionsFor(v.vehicle_type, v.make).map(m => <option key={m} value={m}>{m}</option>)}
                          {v.make && <option value={OTHER}>Other</option>}
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {submitError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.red, fontSize: 13 }}>
                <AlertCircle size={14} /> {submitError}
              </div>
            )}

            <button type="submit" disabled={submitting} style={{ padding: '12px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Registering…' : `Register -- RM ${config.membership_fee.toFixed(2)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function PaymentButtons({ loading, error, onPay }: { loading: 'fpx' | 'duitnow' | 'credit_card' | null; error: string; onPay: (m: 'fpx' | 'duitnow' | 'credit_card') => void }) {
  return (
    <div>
      {error && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FPX_ENABLED ? (
          <button onClick={() => onPay('fpx')} disabled={loading !== null}
            style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textPrimary, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading && loading !== 'fpx' ? 0.6 : 1 }}>
            {loading === 'fpx' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Landmark size={14} />} FPX
          </button>
        ) : (
          <div title="FPX is currently unavailable — please use QR or Card instead."
            style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textSecondary, fontSize: 13, fontWeight: 700, opacity: 0.5, cursor: 'not-allowed' }}>
            <Landmark size={14} /> FPX Unavailable
          </div>
        )}
        <button onClick={() => onPay('duitnow')} disabled={loading !== null}
          style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: C.orange, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading && loading !== 'duitnow' ? 0.6 : 1 }}>
          {loading === 'duitnow' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <QrCode size={14} />} Pay via QR
        </button>
        <button onClick={() => onPay('credit_card')} disabled={loading !== null}
          style={{ flex: 1, minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textPrimary, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading && loading !== 'credit_card' ? 0.6 : 1 }}>
          {loading === 'credit_card' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CreditCard size={14} />} Card
        </button>
      </div>
    </div>
  )
}
