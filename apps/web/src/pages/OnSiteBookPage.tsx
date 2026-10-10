import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, Loader2, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { makeOptionsFor, modelOptionsFor, OTHER } from '@/lib/vehicleMakes'
import { clearDraft, draftStr, fmtDate, loadDraft, normStaffId, osError, rm, rmShort, saveDraft, staffIdOk, type BbDay } from '@/lib/onsite'
import { BbDayPicker, Button, C, Card, ContactLine, Field, inputStyle, Notice, Page, PAYMENT_METHODS, startPayment, usePageMeta, usePublicContact } from '@/components/onsite/OsUi'

interface Pkg { id: string; name: string; description: string | null; duration_min: number; grades: { id: string; name: string }[]; tiers: string[] }
interface BbPkg { id: string; name: string; description: string | null; price: number | null }
interface BbConfig { packages: BbPkg[]; capacity_per_day: number; hq_address: string | null; pickup_note: string | null; window_days: number }
interface Config {
  error?: string
  tenant_name: string
  settings: { deposit_pct: number; cancel_cutoff_hours: number; refund_due_hours: number; max_reschedules: number; hold_minutes: number }
  packages: Pkg[]
  zones: { name: string; surcharge: number }[]
  makes: { type: string; make: string; model: string | null; tier: string }[]
  bb?: BbConfig | null
}
interface Quote { error: string | null; tier: string | null; base: number | null; zone_name: string | null; zone_surcharge: number; total: number | null; deposit: number | null }
interface Day { date: string; slots: { slot_id: string; label: string; available: boolean }[] }

const STEPS = ['Vehicle', 'Package', 'Address', 'Time', 'Confirm']
const BB_STEPS = ['Details', 'Car', 'Day', 'Confirm']
const VAN_DRAFT = 'os_draft_v1_van'
const BB_DRAFT = 'os_draft_v1_bb'
const META_DESCRIPTION = 'Book Motoverse Garage ON-SITE service, or BB Staff Car Care Day pickup and return.'
const mobileOk = (phone: string) => /^01\d{8,9}$/.test(phone.replace(/\D/g, '').replace(/^60/, '0'))

export function OnSiteBookPage() {
  const { tenantSlug } = useParams()
  const slug = tenantSlug ?? null
  const [cfg, setCfg] = useState<Config | null>(null)
  const [loadErr, setLoadErr] = useState('')
  // which service the customer picked; only asked when BB Staff Car Care Day is on (cfg.bb)
  const [flow, setFlow] = useState<null | 'van' | 'bb'>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [draft] = useState(() => loadDraft(VAN_DRAFT))
  const contact = usePublicContact(slug)
  usePageMeta(flow === 'bb' ? 'BB Staff Car Care Day | Motoverse' : 'Book a service | Motoverse ON-SITE', META_DESCRIPTION)

  const [vType, setVType] = useState<'car' | 'bike'>(draft.vType === 'bike' ? 'bike' : 'car')
  const [make, setMake] = useState(draftStr(draft, 'make'))
  const [makeOther, setMakeOther] = useState(draftStr(draft, 'makeOther'))
  const [model, setModel] = useState(draftStr(draft, 'model'))
  const [modelOther, setModelOther] = useState(draftStr(draft, 'modelOther'))
  const [plate, setPlate] = useState(draftStr(draft, 'plate'))
  const [pkgId, setPkgId] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [address, setAddress] = useState(draftStr(draft, 'address'))
  const [postcode, setPostcode] = useState(draftStr(draft, 'postcode'))
  const [access, setAccess] = useState(draftStr(draft, 'access'))
  const [quote, setQuote] = useState<Quote | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [date, setDate] = useState('')
  const [slotId, setSlotId] = useState('')
  const [name, setName] = useState(draftStr(draft, 'name'))
  const [phone, setPhone] = useState(draftStr(draft, 'phone'))
  const [email, setEmail] = useState(draftStr(draft, 'email'))
  const [method, setMethod] = useState('fpx')
  const [requestMode, setRequestMode] = useState<null | { reason: string }>(null)
  const [requestNote, setRequestNote] = useState(draftStr(draft, 'requestNote'))
  const draftDone = useRef(false)

  // keep what the customer typed (never the payment method) so a refresh does not lose it
  useEffect(() => {
    if (draftDone.current) return
    saveDraft(VAN_DRAFT, { vType, make, makeOther, model, modelOther, plate, address, postcode, access, name, phone, email, requestNote })
  }, [vType, make, makeOther, model, modelOther, plate, address, postcode, access, name, phone, email, requestNote])

  useEffect(() => {
    supabase.rpc('os_get_public_config', { p_tenant_slug: slug }).then(({ data, error }) => {
      if (error || !data || data.error) setLoadErr(osError(data?.error))
      else setCfg(data as Config)
    })
  }, [slug])

  const makeValue = make === OTHER ? makeOther.trim() : make
  const modelValue = model === OTHER ? modelOther.trim() : model

  // tier from the settings table; a model rule beats a make rule
  const tier = useMemo(() => {
    if (!cfg || !makeValue) return null
    const rules = cfg.makes.filter(r => r.type === vType && r.make.toLowerCase() === makeValue.toLowerCase())
    const byModel = rules.find(r => r.model && r.model.toLowerCase() === modelValue.toLowerCase())
    return (byModel ?? rules.find(r => !r.model))?.tier ?? null
  }, [cfg, makeValue, modelValue, vType])

  const pkg = cfg?.packages.find(p => p.id === pkgId)
  const offered = useMemo(() => (cfg?.packages ?? []).filter(p => !tier || tier === 'hub_only' ? true : p.tiers.includes(tier)), [cfg, tier])
  // one package on offer: choose it for the customer (they were left staring at a greyed Continue)
  useEffect(() => {
    if (flow === 'bb' || step !== 1 || pkgId || offered.length !== 1) return
    setPkgId(offered[0].id)
    if (offered[0].grades.length === 1) setGradeId(offered[0].grades[0].id)
  }, [flow, step, pkgId, offered])
  // a Malaysian mobile (01x xxx xxxx, with or without +60). The payment gateway rejects other numbers
  // with an unhelpful error, so catch them here.
  const phoneOk = mobileOk(phone)
  const phoneHint = phone.trim() !== '' && !phoneOk ? 'Enter a Malaysian mobile number, e.g. 012 345 6789.' : undefined
  const vehicleOk = !!makeValue && !!modelValue && plate.trim().length >= 2

  function reset(msg = '') { setErr(msg); setBusy(false) }

  async function fetchQuote() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('os_quote', {
      p_tenant_slug: slug, p_type: vType, p_make: makeValue, p_model: modelValue,
      p_package: pkgId, p_grade: gradeId || null, p_postcode: postcode,
    })
    setBusy(false)
    if (error || !data) { setErr('Could not check your address. Please try again.'); return }
    const q = data as Quote
    setQuote(q)
    if (q.error === 'outside_zone') { setRequestMode({ reason: `Waitlist: outside zone (postcode ${postcode})` }); return }
    if (q.error === 'unknown_vehicle' || q.error === 'package_unavailable') { setRequestMode({ reason: q.error === 'unknown_vehicle' ? 'Vehicle not in list' : 'No price set for this vehicle tier' }); return }
    if (q.error) { setErr(osError(q.error)); return }
    setRequestMode(null)
    const { data: slots } = await supabase.rpc('os_available_slots', { p_tenant_slug: slug })
    setDays((slots as Day[]) ?? [])
    setDate(''); setSlotId('')
    setStep(3)
  }

  async function submit() {
    setBusy(true); setErr('')
    const special = requestMode?.reason
    const reason = special
      ? [special, `${vType} ${makeValue} ${modelValue}`, requestNote.trim() && `Note: ${requestNote.trim()}`].filter(Boolean).join(' | ')
      : null
    const { data, error } = await supabase.rpc('os_create_booking', {
      p_tenant_slug: slug, p_name: name, p_phone: phone, p_email: email, p_type: vType, p_make: makeValue, p_model: modelValue, p_plate: plate,
      p_package: pkgId, p_grade: gradeId || null, p_address: address, p_postcode: postcode, p_access_notes: access || null,
      p_slot: special ? null : slotId, p_date: special ? null : date, p_special_reason: reason,
    })
    if (error || !data) return reset('Something went wrong. Please try again.')
    if (data.error) {
      if (data.error === 'slot_taken' || data.error === 'too_soon') { setStep(3); setDate(''); setSlotId('') }
      return reset(osError(data.error))
    }
    draftDone.current = true
    clearDraft(VAN_DRAFT)
    if (special) { window.location.href = `/on-site/status/${data.token}`; return }
    const pay = await startPayment(data.invoice_id, data.token, method)
    if (pay.error || !pay.url) { window.location.href = `/on-site/status/${data.token}`; return }
    window.location.href = pay.url
  }

  if (loadErr) return <Page><Notice tone="error">{loadErr}</Notice><ContactLine number={contact} inline /></Page>
  if (!cfg) return <Page><div style={{ textAlign: 'center', padding: 60 }}><Loader2 className="animate-spin" color={C.orange} /></div></Page>

  const bb = cfg.bb ?? null
  if (bb && flow === null) {
    const prices = bb.packages.map(p => p.price).filter((n): n is number => n != null)
    const from = prices.length ? Math.min(...prices) : null
    return (
      <Page>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Truck color={C.orange} />
          <div style={{ fontWeight: 800, fontSize: 20 }}>Motoverse ON-SITE</div>
        </div>
        <p style={{ color: C.muted, margin: '0 0 18px', fontSize: 14 }}>How would you like to book?</p>
        <ChoiceCard title="Service at my location (van)" onClick={() => setFlow('van')}>
          We come to you. Engine and gearbox lube at your home or office.
        </ChoiceCard>
        <ChoiceCard title="BB Staff Car Care Day" onClick={() => setFlow('bb')}>
          For BrainyBunch staff. We collect your car at BB HQ, service and wash it, and return it before the end of the day.
          {from != null && <span style={{ display: 'block', marginTop: 6, color: C.orange, fontWeight: 700 }}>From {rmShort(from)}. Pay when your car is returned.</span>}
        </ChoiceCard>
        <ContactLine number={contact} />
      </Page>
    )
  }
  if (bb && flow === 'bb') return <Page><BbFlow slug={slug} bb={bb} onChoice={() => setFlow(null)} /><ContactLine number={contact} /></Page>

  const selectedDay = days.find(d => d.date === date)
  const back = () => {
    setErr(''); setRequestMode(null)
    // the request form lives on the Address step: Back goes to the address fields, not the Package step
    if (step === 2 && requestMode) return
    setStep(s => Math.max(0, s - 1))
  }

  return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Truck color={C.orange} />
        <div style={{ fontWeight: 800, fontSize: 20 }}>Motoverse ON-SITE</div>
      </div>
      <p style={{ color: C.muted, margin: '0 0 18px', fontSize: 14 }}>We come to you. Engine and gearbox lube at your home or office.</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 4, borderRadius: 2, background: i <= step ? C.orange : C.border }} />
            <div style={{ fontSize: 11, marginTop: 4, color: i === step ? C.text : C.muted, fontWeight: i === step ? 700 : 500 }}>{s}</div>
          </div>
        ))}
      </div>

      {err && <Notice tone="error">{err}</Notice>}

      {step === 0 && (
        <Card>
          <Field label="Vehicle type">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['car', 'bike'] as const).map(t => (
                <button key={t} onClick={() => { setVType(t); setMake(''); setModel('') }}
                  style={{ flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${vType === t ? C.orange : C.border}`, background: vType === t ? `${C.orange}22` : '#111', color: C.text, fontSize: 15, fontWeight: 700 }}>
                  {t === 'car' ? 'Car' : 'Motorcycle'}
                </button>
              ))}
            </div>
          </Field>
          <MakeModelFields vType={vType} make={make} setMake={setMake} makeOther={makeOther} setMakeOther={setMakeOther}
            model={model} setModel={setModel} modelOther={modelOther} setModelOther={setModelOther} />
          <Field label="Plate number">
            <input style={{ ...inputStyle, textTransform: 'uppercase' }} placeholder="e.g. VAB 1234" value={plate} onChange={e => setPlate(e.target.value)} />
          </Field>
          {tier === 'hub_only' && <Notice tone="warn">This vehicle is serviced at our workshop, not by the van. Please contact Motoverse Garage to book.<ContactLine number={contact} inline /></Notice>}
          {!vehicleOk && tier !== 'hub_only' && <div style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>{!makeValue ? 'Choose your make.' : !modelValue ? 'Choose your model.' : 'Enter your plate number.'}</div>}
          <Button disabled={!vehicleOk || tier === 'hub_only'} onClick={() => { setErr(''); setStep(1) }}>Continue</Button>
        </Card>
      )}
      {step === 0 && bb && (
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" onClick={() => { setErr(''); setFlow(null) }}><ChevronLeft size={18} /> Choose a different service</Button>
        </div>
      )}

      {step === 1 && (
        <>
          {offered.length === 0 && <Notice tone="warn">No package is available for this vehicle yet.</Notice>}
          {offered.length > 0 && !pkg && <div style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>Tap a service to choose it.</div>}
          {offered.map(p => (
            <Card key={p.id} style={{ marginBottom: 12, borderColor: pkgId === p.id ? C.orange : C.border, cursor: 'pointer' }}>
              <div role="radio" aria-checked={pkgId === p.id} tabIndex={0} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
                onClick={() => { setPkgId(p.id); setGradeId(p.grades.length === 1 ? p.grades[0].id : '') }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPkgId(p.id); setGradeId(p.grades.length === 1 ? p.grades[0].id : '') } }}>
                <span aria-hidden style={{ flexShrink: 0, marginTop: 3, width: 20, height: 20, borderRadius: 10, border: `2px solid ${pkgId === p.id ? C.orange : C.muted}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {pkgId === p.id && <span style={{ width: 10, height: 10, borderRadius: 5, background: C.orange }} />}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{p.name}</div>
                  {p.description && <div style={{ color: C.muted, fontSize: 14, margin: '4px 0' }}>{p.description}</div>}
                  <div style={{ color: C.muted, fontSize: 13 }}>About {p.duration_min} minutes at your location</div>
                </div>
              </div>
              {pkgId === p.id && p.grades.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Field label="Oil grade">
                    <select style={inputStyle} value={gradeId} onChange={e => setGradeId(e.target.value)}>
                      <option value="">Select grade</option>
                      {p.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </Card>
          ))}
          <BackNext onBack={back} nextDisabled={!pkg || (pkg.grades.length > 0 && !gradeId)} hint={!pkg ? 'Tap a service above to choose it.' : 'Choose an oil grade to continue.'} onNext={() => { setErr(''); setStep(2) }} />
        </>
      )}

      {step === 2 && !requestMode && (
        <>
        <Card>
          <Field label="Service address">
            <textarea style={{ ...inputStyle, minHeight: 80 }} placeholder="House / building, street, area" value={address} onChange={e => setAddress(e.target.value)} />
          </Field>
          <Field label="Postcode" hint="We check that the van covers your area.">
            <input style={inputStyle} inputMode="numeric" maxLength={5} placeholder="e.g. 47100" value={postcode} onChange={e => setPostcode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Access notes (optional)" hint="Gate code, guard house, parking spot.">
            <input style={inputStyle} value={access} onChange={e => setAccess(e.target.value)} />
          </Field>
        </Card>
          <BackNext onBack={back} busy={busy} nextDisabled={address.trim().length < 5 || postcode.length < 5} hint={address.trim().length < 5 ? 'Enter your service address.' : 'Enter your 5-digit postcode.'} nextLabel="Check and see times" onNext={fetchQuote} />
        </>
      )}

      {step === 2 && requestMode && (
        <RequestForm
          reason={requestMode.reason} quote={quote} note={requestNote} setNote={setRequestNote}
          name={name} setName={setName} phone={phone} setPhone={setPhone} email={email} setEmail={setEmail}
          phoneOk={phoneOk} busy={busy} onBack={back} onSubmit={submit}
        />
      )}

      {step === 3 && quote && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <PriceLines quote={quote} pkgName={pkg?.name} gradeName={pkg?.grades.find(g => g.id === gradeId)?.name} depositPct={cfg.settings.deposit_pct} />
          </Card>
          <Card>
            <Field label="Pick a day">
              {days.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>No times are open right now. Please check back soon.</div>}
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                {days.map(d => {
                  const free = d.slots.some(s => s.available)
                  const dt = new Date(d.date + 'T00:00:00')
                  return (
                    <button key={d.date} disabled={!free} onClick={() => { setDate(d.date); setSlotId('') }}
                      style={{ minWidth: 64, padding: '10px 6px', borderRadius: 10, border: `1px solid ${date === d.date ? C.orange : C.border}`, background: date === d.date ? `${C.orange}22` : '#111',
                        color: free ? C.text : '#555', opacity: free ? 1 : 0.5, flexShrink: 0 }}>
                      <div style={{ fontSize: 11 }}>{dt.toLocaleDateString('en-MY', { weekday: 'short' })}</div>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{dt.getDate()}</div>
                      <div style={{ fontSize: 11 }}>{dt.toLocaleDateString('en-MY', { month: 'short' })}</div>
                    </button>
                  )
                })}
              </div>
            </Field>
            {selectedDay && (
              <Field label="Pick a time">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selectedDay.slots.map(s => (
                    <button key={s.slot_id} disabled={!s.available} onClick={() => setSlotId(s.slot_id)}
                      style={{ flex: '1 1 40%', padding: 12, borderRadius: 10, border: `1px solid ${slotId === s.slot_id ? C.orange : C.border}`, background: slotId === s.slot_id ? `${C.orange}22` : '#111',
                        color: s.available ? C.text : '#555', fontWeight: 700, textDecoration: s.available ? 'none' : 'line-through' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <div style={{ marginTop: 6, fontSize: 13, color: C.muted }}>
              Need another time or more than one car? <button onClick={() => { setRequestMode({ reason: 'Special request (other time / more cars)' }); setStep(2) }} style={{ background: 'none', border: 'none', color: C.orange, textDecoration: 'underline', fontSize: 13, padding: 0 }}>Send us a request</button>
            </div>
          </Card>
          <BackNext onBack={back} nextDisabled={!slotId} hint={!date ? 'Pick a day, then a time.' : 'Pick a time to continue.'} onNext={() => { setErr(''); setStep(4) }} />
        </>
      )}

      {step === 4 && quote && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Your booking</div>
            <Row k="Vehicle" v={`${makeValue} ${modelValue} · ${plate.toUpperCase()}`} />
            <Row k="Service" v={`${pkg?.name}${gradeId ? ` (${pkg?.grades.find(g => g.id === gradeId)?.name})` : ''}`} />
            <Row k="Where" v={address} />
            <Row k="When" v={`${fmtDate(date)}, ${selectedDay?.slots.find(s => s.slot_id === slotId)?.label}`} />
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '10px 0' }} />
            <PriceLines quote={quote} depositPct={cfg.settings.deposit_pct} compact />
          </Card>
          <Card>
            <Field label="Your name"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Mobile number" hint={phoneHint}><input style={inputStyle} inputMode="tel" placeholder="e.g. 012 345 6789" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
            <Field label="Email" hint="We send your confirmation and updates here."><input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
            <Field label="Pay deposit with">
              <div style={{ display: 'grid', gap: 8 }}>
                {PAYMENT_METHODS.map(m => (
                  <label key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12, borderRadius: 10, border: `1px solid ${method === m.id ? C.orange : C.border}`, background: '#111' }}>
                    <input type="radio" checked={method === m.id} onChange={() => setMethod(m.id)} /> {m.label}
                  </label>
                ))}
              </div>
            </Field>
            <Policy cfg={cfg} />
            <Button busy={busy} disabled={!name.trim() || !phoneOk || !email.includes('@')} onClick={submit}>Pay deposit {rm(quote.deposit)}</Button>
          </Card>
          <div style={{ marginTop: 12 }}><Button variant="ghost" onClick={back}>Back</Button></div>
        </>
      )}
      <ContactLine number={contact} />
    </Page>
  )
}

function ChoiceCard({ title, children, onClick }: { title: string; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 12, color: C.text, cursor: 'pointer' }}>
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>{title}</div>
      <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5 }}>{children}</div>
    </button>
  )
}

// Make and model selects (with "Other" free text), shared by the van and BB flows.
function MakeModelFields(p: {
  vType: 'car' | 'bike'; make: string; setMake: (v: string) => void; makeOther: string; setMakeOther: (v: string) => void
  model: string; setModel: (v: string) => void; modelOther: string; setModelOther: (v: string) => void
}) {
  const { vType, make, model } = p
  return (
    <>
      <Field label="Make">
        <select style={inputStyle} value={make} onChange={e => { p.setMake(e.target.value); p.setModel('') }}>
          <option value="">Select make</option>
          {makeOptionsFor(vType).map(m => <option key={m} value={m}>{m}</option>)}
          <option value={OTHER}>Other</option>
        </select>
        {make === OTHER && <input style={{ ...inputStyle, marginTop: 8 }} placeholder="Type the make" value={p.makeOther} onChange={e => p.setMakeOther(e.target.value)} />}
      </Field>
      <Field label="Model">
        {make && make !== OTHER && modelOptionsFor(vType, make).length > 0 ? (
          <>
            <select style={inputStyle} value={model} onChange={e => p.setModel(e.target.value)}>
              <option value="">Select model</option>
              {modelOptionsFor(vType, make).map(m => <option key={m} value={m}>{m}</option>)}
              <option value={OTHER}>Other</option>
            </select>
            {model === OTHER && <input style={{ ...inputStyle, marginTop: 8 }} placeholder="Type the model" value={p.modelOther} onChange={e => p.setModelOther(e.target.value)} />}
          </>
        ) : (
          <input style={inputStyle} placeholder="e.g. Vios" value={model === OTHER ? p.modelOther : model} onChange={e => { p.setModel(e.target.value); p.setModelOther(e.target.value) }} />
        )}
      </Field>
    </>
  )
}

// errors that mean "this day will not work": go back to the Day step and reload the list
const BB_DAY_ERRORS = ['day_full', 'too_soon', 'date_blocked', 'day_not_served', 'outside_window', 'date_required']
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// BB Staff Car Care Day: pickup and return, no deposit, no payment step.
function BbFlow({ slug, bb, onChoice }: { slug: string | null; bb: BbConfig; onChoice: () => void }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [draft] = useState(() => loadDraft(BB_DRAFT))
  const [name, setName] = useState(draftStr(draft, 'name'))
  const [phone, setPhone] = useState(draftStr(draft, 'phone'))
  const [email, setEmail] = useState(draftStr(draft, 'email'))
  const [staffId, setStaffId] = useState(draftStr(draft, 'staffId'))
  const [make, setMake] = useState(draftStr(draft, 'make'))
  const [makeOther, setMakeOther] = useState(draftStr(draft, 'makeOther'))
  const [model, setModel] = useState(draftStr(draft, 'model'))
  const [modelOther, setModelOther] = useState(draftStr(draft, 'modelOther'))
  const [plate, setPlate] = useState(draftStr(draft, 'plate'))
  const [pkgId, setPkgId] = useState('')
  const [days, setDays] = useState<BbDay[] | null>(null)
  const [daysFailed, setDaysFailed] = useState(false)
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState(draftStr(draft, 'notes'))
  const draftDone = useRef(false)

  // keep what the customer typed so a refresh does not lose it
  useEffect(() => {
    if (draftDone.current) return
    saveDraft(BB_DRAFT, { name, phone, email, staffId, make, makeOther, model, modelOther, plate, notes })
  }, [name, phone, email, staffId, make, makeOther, model, modelOther, plate, notes])

  // one package on offer: choose it for the customer
  useEffect(() => {
    if (!pkgId && bb.packages.length === 1) setPkgId(bb.packages[0].id)
  }, [bb.packages, pkgId])

  const makeValue = make === OTHER ? makeOther.trim() : make
  const modelValue = model === OTHER ? modelOther.trim() : model
  const pkg = bb.packages.find(p => p.id === pkgId)
  const phoneOk = mobileOk(phone)
  const emailOk = email.trim() === '' || EMAIL_RE.test(email.trim())
  const staffOk = staffIdOk(staffId)
  const detailsOk = name.trim() !== '' && phoneOk && emailOk && staffOk
  const carOk = !!makeValue && !!modelValue && plate.trim().length >= 2 && !!pkg
  const hq = bb.hq_address?.trim() || 'BB HQ'
  const selectedDay = days?.find(d => d.date === date)
  const anyOpen = !!days?.some(d => d.available)

  async function loadDays() {
    setDays(null); setDaysFailed(false); setDate('')
    const { data, error } = await supabase.rpc('os_bb_available_days', { p_tenant_slug: slug })
    if (error || !Array.isArray(data)) { setDays([]); setDaysFailed(true); return }
    setDays(data as BbDay[])
  }

  const back = () => { setErr(''); if (step === 0) onChoice(); else setStep(s => s - 1) }

  async function submit() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('os_create_bb_booking', {
      p_tenant_slug: slug, p_name: name.trim(), p_phone: phone, p_email: email.trim(), p_staff_id: normStaffId(staffId),
      p_make: makeValue, p_model: modelValue, p_plate: plate, p_package: pkgId, p_date: date, p_notes: notes.trim() || null,
    })
    if (error || !data) { setBusy(false); setErr('Something went wrong. Please try again.'); return }
    if (data.error) {
      const code = String(data.error)
      if (BB_DAY_ERRORS.includes(code)) { setStep(2); loadDays() }
      else if (code === 'package_unavailable') setStep(1)
      else if (['invalid_staff_id', 'invalid_details', 'invalid_email'].includes(code)) setStep(0)
      setBusy(false); setErr(osError(code)); return
    }
    draftDone.current = true
    clearDraft(BB_DRAFT)
    window.location.href = `/on-site/status/${data.token}`
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Truck color={C.orange} />
        <div style={{ fontWeight: 800, fontSize: 20 }}>BB Staff Car Care Day</div>
      </div>
      <p style={{ color: C.muted, margin: '0 0 18px', fontSize: 14 }}>We collect your car at BB HQ, service and wash it, and return it before the end of the day.</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {BB_STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 4, borderRadius: 2, background: i <= step ? C.orange : C.border }} />
            <div style={{ fontSize: 11, marginTop: 4, color: i === step ? C.text : C.muted, fontWeight: i === step ? 700 : 500 }}>{s}</div>
          </div>
        ))}
      </div>

      {err && <Notice tone="error">{err}</Notice>}

      {step === 0 && (
        <>
          <Card>
            <Field label="Your name"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Mobile number" hint={phone.trim() !== '' && !phoneOk ? 'Enter a Malaysian mobile number, e.g. 012 345 6789.' : undefined}>
              <input style={inputStyle} inputMode="tel" placeholder="e.g. 012 345 6789" value={phone} onChange={e => setPhone(e.target.value)} />
            </Field>
            <Field label="Email (optional)" hint={email.trim() !== '' && !emailOk ? 'That email address does not look right.' : 'We send your booking updates here.'}>
              <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            <Field label="BB staff ID" hint={staffOk ? undefined : 'Your staff ID: BB1234, or just the 4 digits.'}>
              <input style={{ ...inputStyle, textTransform: 'uppercase' }} placeholder="BB1234" autoCapitalize="characters" autoComplete="off" maxLength={12}
                value={staffId} onChange={e => setStaffId(e.target.value.toUpperCase())} />
            </Field>
          </Card>
          <BackNext onBack={back} nextDisabled={!detailsOk}
            hint={name.trim() === '' ? 'Enter your name.' : !phoneOk ? 'Enter a Malaysian mobile number.' : !emailOk ? 'Check your email address, or leave it empty.' : 'Enter your BB staff ID: BB1234, or just the 4 digits.'}
            onNext={() => { setErr(''); setStep(1) }} />
        </>
      )}

      {step === 1 && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <MakeModelFields vType="car" make={make} setMake={setMake} makeOther={makeOther} setMakeOther={setMakeOther}
              model={model} setModel={setModel} modelOther={modelOther} setModelOther={setModelOther} />
            <Field label="Plate number">
              <input style={{ ...inputStyle, textTransform: 'uppercase' }} placeholder="e.g. VAB 1234" value={plate} onChange={e => setPlate(e.target.value)} />
            </Field>
          </Card>
          {bb.packages.length > 1 && !pkg && <div style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>Tap a package to choose it.</div>}
          {bb.packages.map(p => (
            <Card key={p.id} style={{ marginBottom: 12, borderColor: pkgId === p.id ? C.orange : C.border, cursor: 'pointer' }}>
              <div role="radio" aria-checked={pkgId === p.id} tabIndex={0} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
                onClick={() => setPkgId(p.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPkgId(p.id) } }}>
                <span aria-hidden style={{ flexShrink: 0, marginTop: 3, width: 20, height: 20, borderRadius: 10, border: `2px solid ${pkgId === p.id ? C.orange : C.muted}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {pkgId === p.id && <span style={{ width: 10, height: 10, borderRadius: 5, background: C.orange }} />}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 17 }}>{p.name}</div>
                    {p.price != null && <div style={{ fontWeight: 800, fontSize: 17, color: C.orange, whiteSpace: 'nowrap' }}>{rmShort(p.price)}</div>}
                  </div>
                  {p.description && <div style={{ color: C.muted, fontSize: 14, margin: '4px 0' }}>{p.description}</div>}
                </div>
              </div>
            </Card>
          ))}
          <BackNext onBack={back} nextDisabled={!carOk}
            hint={!makeValue ? 'Choose your make.' : !modelValue ? 'Choose your model.' : plate.trim().length < 2 ? 'Enter your plate number.' : 'Tap a package above to choose it.'}
            onNext={() => { setErr(''); setStep(2); loadDays() }} />
        </>
      )}

      {step === 2 && (
        <>
          <Card>
            <Field label="Pick a day">
              {days === null && <div style={{ textAlign: 'center', padding: 16 }}><Loader2 className="animate-spin" color={C.orange} /></div>}
              {days !== null && daysFailed && (
                <div style={{ color: C.muted, fontSize: 14 }}>
                  We could not load the days. <button onClick={loadDays} style={{ background: 'none', border: 'none', color: C.orange, textDecoration: 'underline', fontSize: 14, padding: 0 }}>Try again</button>
                </div>
              )}
              {days !== null && !daysFailed && !anyOpen && <div style={{ color: C.muted, fontSize: 14 }}>No days are open right now. Please check back soon.</div>}
              {days !== null && days.length > 0 && <BbDayPicker days={days} value={date} onChange={setDate} />}
            </Field>
            {bb.pickup_note && <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5 }}>{bb.pickup_note}</div>}
            {bb.hq_address?.trim() && <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>We collect from {bb.hq_address.trim()}.</div>}
          </Card>
          <BackNext onBack={back} nextDisabled={!date || !selectedDay?.available}
            hint={days === null ? 'Loading the days…' : !anyOpen ? 'No days are open right now. Please check back soon.' : 'Pick a day to continue.'}
            onNext={() => { setErr(''); setStep(3) }} />
        </>
      )}

      {step === 3 && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Your booking</div>
            <Row k="Name" v={name.trim()} />
            <Row k="Staff ID" v={normStaffId(staffId)} />
            <Row k="Car" v={`${makeValue} ${modelValue} · ${plate.toUpperCase()}`} />
            <Row k="Package" v={`${pkg?.name ?? ''}${pkg?.price != null ? ` (${rmShort(pkg.price)})` : ''}`} />
            <Row k="Day" v={fmtDate(date)} />
            <Row k="Collect from" v={hq} />
            {bb.pickup_note && <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>{bb.pickup_note}</div>}
          </Card>
          <Notice tone="info">No payment now. You pay when your car is returned.</Notice>
          <Card>
            <Field label="Notes (optional)" hint="For example, your preferred pickup time or where the car is parked at HQ.">
              <textarea style={{ ...inputStyle, minHeight: 70 }} value={notes} onChange={e => setNotes(e.target.value)} />
            </Field>
          </Card>
          <BackNext onBack={back} busy={busy} nextDisabled={!pkg || !date || !detailsOk} hint="Go back and check your details, package and day." nextLabel="Confirm booking" onNext={submit} />
        </>
      )}
    </>
  )
}

function BackNext({ onBack, onNext, nextDisabled, busy, hint, nextLabel = 'Continue' }: { onBack: () => void; onNext: () => void; nextDisabled?: boolean; busy?: boolean; hint?: string; nextLabel?: string }) {
  return (
    <div style={{ marginTop: 14 }}>
      {nextDisabled && hint && <div style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>{hint}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="ghost" onClick={onBack} style={{ width: 'auto', padding: '14px 16px' }}><ChevronLeft size={18} /></Button>
        <Button onClick={onNext} disabled={nextDisabled} busy={busy}>{nextLabel}</Button>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '3px 0' }}><span style={{ color: C.muted }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span></div>
}

function PriceLines({ quote, pkgName, gradeName, depositPct, compact }: { quote: Quote; pkgName?: string; gradeName?: string; depositPct: number; compact?: boolean }) {
  return (
    <div>
      {!compact && <div style={{ color: C.muted, fontSize: 12, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Your price</div>}
      {!compact && <Row k={`${pkgName ?? ''}${gradeName ? ` (${gradeName})` : ''}`} v={rm(quote.base)} />}
      {quote.zone_surcharge > 0 && <Row k={`Travel (${quote.zone_name})`} v={rm(quote.zone_surcharge)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18, marginTop: 6 }}><span>Total</span><span>{rm(quote.total)}</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.orange, fontWeight: 700, marginTop: 4 }}><span>Deposit today ({depositPct}%)</span><span>{rm(quote.deposit)}</span></div>
    </div>
  )
}

function Policy({ cfg }: { cfg: Config }) {
  const s = cfg.settings
  return (
    <Notice tone="info">
      Cancel or reschedule at least {s.cancel_cutoff_hours} hours before and you get a refund (within {s.refund_due_hours} hours) or can move the booking.
      Later than that, or if we cannot find you, the deposit is kept. You can reschedule up to {s.max_reschedules} times.
    </Notice>
  )
}

function RequestForm(p: {
  reason: string; quote: Quote | null; note: string; setNote: (v: string) => void
  name: string; setName: (v: string) => void; phone: string; setPhone: (v: string) => void; email: string; setEmail: (v: string) => void
  phoneOk: boolean; busy: boolean; onBack: () => void; onSubmit: () => void
}) {
  const outside = p.reason.startsWith('Waitlist')
  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}><CheckCircle2 color={C.amber} size={20} /><b>{outside ? 'We do not cover your area yet' : 'Send us a request'}</b></div>
      <p style={{ color: C.muted, fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
        {outside
          ? 'Leave your details and we will tell you when the van starts coming to you.'
          : 'Our team will review this and reply with a price and time. You pay a deposit only after we approve.'}
      </p>
      <Field label="Anything we should know? (optional)"><textarea style={{ ...inputStyle, minHeight: 70 }} placeholder={outside ? '' : 'Preferred date and time, number of cars, etc.'} value={p.note} onChange={e => p.setNote(e.target.value)} /></Field>
      <Field label="Your name"><input style={inputStyle} value={p.name} onChange={e => p.setName(e.target.value)} /></Field>
      <Field label="Mobile number" hint={p.phone.trim() !== '' && !p.phoneOk ? 'Enter a Malaysian mobile number, e.g. 012 345 6789.' : undefined}><input style={inputStyle} inputMode="tel" placeholder="e.g. 012 345 6789" value={p.phone} onChange={e => p.setPhone(e.target.value)} /></Field>
      <Field label="Email"><input style={inputStyle} type="email" value={p.email} onChange={e => p.setEmail(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="ghost" onClick={p.onBack} style={{ width: 'auto', padding: '14px 16px' }}><ChevronLeft size={18} /></Button>
        <Button busy={p.busy} disabled={!p.name.trim() || !p.phoneOk || !p.email.includes('@')} onClick={p.onSubmit}>{outside ? 'Join the waitlist' : 'Send request'}</Button>
      </div>
    </Card>
  )
}
