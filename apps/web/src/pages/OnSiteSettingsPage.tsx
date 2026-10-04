import { useState, useEffect, useCallback, useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Loader2, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Save, AlertTriangle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import { ISO_DAYS, rm, ymd } from '@/lib/onsite'
import { CAR_MAKES, BIKE_MAKES, makeOptionsFor, modelOptionsFor } from '@/lib/vehicleMakes'

// Settings for the ON-SITE van business. Every tab writes straight to the
// os_* tables (RLS limits writes to super_admin / ops_manager of the tenant).

type Tab = 'packages' | 'tiers' | 'slots' | 'zones' | 'rules'
const TABS: { id: Tab; label: string }[] = [
  { id: 'packages', label: 'Packages & prices' },
  { id: 'tiers', label: 'Vehicle tiers' },
  { id: 'slots', label: 'Time slots' },
  { id: 'zones', label: 'Zones' },
  { id: 'rules', label: 'Rules & payments' },
]

// ── shared styles and small components ──────────────────────────────────
const C = { bg: '#0E0E0E', s1: '#161616', s2: '#1E1E1E', orange: '#F15A22', border: '#2A2A2A', text: '#F0F0F0', mute: '#A0A0A0', dim: '#6B6B6B', green: '#22C55E', amber: '#F59E0B', red: '#EF4444', blue: '#3B82F6' }

const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.s2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, padding: '9px 12px', outline: 'none', colorScheme: 'dark' }
const card: CSSProperties = { background: C.s1, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }
const h3: CSSProperties = { color: C.text, fontSize: 14, fontWeight: 700, margin: '0 0 10px' }
const helper: CSSProperties = { color: C.mute, fontSize: 12, lineHeight: 1.6, margin: '8px 0 0' }

function Spinner() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={28} style={{ color: C.orange }} className="animate-spin" /></div>
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ ...card, color: C.mute, fontSize: 13, textAlign: 'center', padding: 28 }}>{children}</div>
}

function Field({ label, children, grow = 140 }: { label: string; children: ReactNode; grow?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: `1 1 ${grow}px`, minWidth: 0 }}>
      <span style={{ color: C.mute, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      {children}
    </label>
  )
}

function Btn({ children, onClick, kind = 'primary', disabled, title }: { children: ReactNode; onClick: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; title?: string }) {
  const styles: Record<string, CSSProperties> = {
    primary: { background: C.orange, color: '#fff', border: `1px solid ${C.orange}` },
    ghost: { background: 'transparent', color: C.text, border: `1px solid ${C.border}` },
    danger: { background: 'transparent', color: C.red, border: `1px solid ${C.red}55` },
  }
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      style={{ ...styles[kind], borderRadius: 8, fontSize: 13, fontWeight: 600, padding: '9px 14px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 40, height: 22, borderRadius: 11, border: 'none', padding: 2, background: on ? C.green : '#3A3A3A', cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: disabled ? 0.6 : 1 }}>
      <span style={{ display: 'block', width: 18, height: 18, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(18px)' : 'translateX(0)', transition: 'transform 0.15s' }} />
    </button>
  )
}

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return <span style={{ background: color + '22', color, borderRadius: 6, fontSize: 11, fontWeight: 700, padding: '2px 8px', whiteSpace: 'nowrap' }}>{children}</span>
}

function IconBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: danger ? C.red : C.mute, padding: 7, cursor: 'pointer', display: 'inline-flex' }}>
      {children}
    </button>
  )
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: C.amber + '14', border: `1px solid ${C.amber}55`, borderRadius: 10, padding: '10px 12px', color: C.amber, fontSize: 12, lineHeight: 1.6 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /><span>{children}</span>
    </div>
  )
}

const fail = (error: { message: string }) => toast(error.message, 'error')
const hhmm = (t: string) => (t ?? '').slice(0, 5)
const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function parseMoney(s: string): number | null {
  const n = Number(s.trim())
  return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function parseInt0(s: string, min: number, max?: number): number | null {
  const n = Number(s.trim())
  if (s.trim() === '' || !Number.isInteger(n) || n < min || (max != null && n > max)) return null
  return n
}

// ── page ────────────────────────────────────────────────────────────────
export function OnSiteSettingsPage() {
  const tenantId = useAuthStore(s => s.user?.tenant_id) ?? ''
  const [tab, setTab] = useState<Tab>('packages')

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto', color: C.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>ON-SITE settings</h1>
      <p style={{ color: C.mute, fontSize: 13, margin: '4px 0 16px' }}>Packages, prices, slots and rules for the mobile van. Changes save as soon as you press Save.</p>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{ background: tab === t.id ? C.orange : C.s1, color: tab === t.id ? '#fff' : C.mute, border: `1px solid ${tab === t.id ? C.orange : C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {!tenantId ? <Spinner /> : (
        <>
          {tab === 'packages' && <PackagesTab tenantId={tenantId} />}
          {tab === 'tiers' && <VehicleTiersTab tenantId={tenantId} />}
          {tab === 'slots' && <SlotsTab tenantId={tenantId} />}
          {tab === 'zones' && <ZonesTab tenantId={tenantId} />}
          {tab === 'rules' && <RulesTab tenantId={tenantId} />}
        </>
      )}
    </div>
  )
}

// ── 1. packages & prices ────────────────────────────────────────────────
type TierKey = 'tier1' | 'tier2'
const TIER_LABEL: Record<string, string> = { tier1: 'Tier 1', tier2: 'Tier 2', hub_only: 'Hub only' }
const TIER_COLOR: Record<string, string> = { tier1: C.green, tier2: C.blue, hub_only: C.dim }

interface Pkg { id: string; name: string; description: string | null; services: string[]; duration_min: number; sort_order: number; is_active: boolean }
interface Grade { id: string; package_id: string; name: string; sort_order: number; is_active: boolean }
interface Price { id: string; package_id: string; grade_id: string | null; tier: TierKey; price: number; effective_from: string }

// Price in force on `today` (latest effective_from <= today) and the next scheduled change.
function priceFor(prices: Price[], gradeId: string | null, tier: TierKey, today: string) {
  const mine = prices.filter(p => p.grade_id === gradeId && p.tier === tier)
  const current = mine.filter(p => p.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
  const upcoming = mine.filter(p => p.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
  return { current, upcoming }
}

function PackagesTab({ tenantId }: { tenantId: string }) {
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [prices, setPrices] = useState<Price[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const today = ymd(new Date())

  const load = useCallback(async () => {
    const [p, g, pr] = await Promise.all([
      supabase.from('os_packages').select('id, name, description, services, duration_min, sort_order, is_active').eq('tenant_id', tenantId).order('sort_order'),
      supabase.from('os_oil_grades').select('id, package_id, name, sort_order, is_active').eq('tenant_id', tenantId).order('sort_order'),
      supabase.from('os_prices').select('id, package_id, grade_id, tier, price, effective_from').eq('tenant_id', tenantId).order('effective_from', { ascending: false }).limit(5000),
    ])
    const err = p.error ?? g.error ?? pr.error
    if (err) fail(err)
    setPkgs((p.data as Pkg[]) ?? [])
    setGrades((g.data as Grade[]) ?? [])
    setPrices(((pr.data as Price[]) ?? []).map(x => ({ ...x, price: Number(x.price) })))
    setLoading(false)
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function setActive(p: Pkg, is_active: boolean) {
    const { error } = await supabase.from('os_packages').update({ is_active }).eq('id', p.id).eq('tenant_id', tenantId)
    if (error) { fail(error); return }
    toast(is_active ? `${p.name} is now active` : `${p.name} deactivated. It is hidden from customers`)
    load()
  }

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <p style={{ ...helper, margin: 0, flex: '1 1 260px' }}>Packages are never deleted, only deactivated, so old bookings keep their name and price.</p>
        {!creating && <Btn onClick={() => setCreating(true)}><Plus size={15} /> Add package</Btn>}
      </div>

      {creating && (
        <div style={card}>
          <h3 style={h3}>New package</h3>
          <PackageForm tenantId={tenantId} nextSort={Math.max(0, ...pkgs.map(p => p.sort_order)) + 1}
            onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />
        </div>
      )}

      {pkgs.length === 0 && !creating && <Empty>No packages yet. Add your first package to start taking bookings.</Empty>}

      {pkgs.map(p => {
        const open = openId === p.id
        const pPrices = prices.filter(x => x.package_id === p.id)
        const summary = (['tier1', 'tier2'] as TierKey[]).map(t => {
          const cur = priceFor(pPrices, null, t, today).current
          return `${TIER_LABEL[t]} ${cur ? rm(cur.price) : '-'}`
        }).join('  ·  ')
        return (
          <div key={p.id} style={{ ...card, opacity: p.is_active ? 1 : 0.75 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setOpenId(open ? null : p.id)}
                style={{ flex: '1 1 220px', minWidth: 0, background: 'none', border: 'none', color: C.text, textAlign: 'left', cursor: 'pointer', padding: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                {open ? <ChevronDown size={16} color={C.mute} /> : <ChevronRight size={16} color={C.mute} />}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: C.mute, marginTop: 2 }}>{summary} · {p.duration_min} min</span>
                </span>
              </button>
              <Badge color={p.is_active ? C.green : C.dim}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
              <Switch on={p.is_active} onChange={v => setActive(p, v)} label={`${p.name} active`} />
            </div>
            {open && (
              <PackageDetail pkg={p} tenantId={tenantId} today={today}
                grades={grades.filter(g => g.package_id === p.id)} prices={pPrices} reload={load} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function PackageForm({ tenantId, pkg, nextSort, onSaved, onCancel }: { tenantId: string; pkg?: Pkg; nextSort?: number; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(pkg?.name ?? '')
  const [description, setDescription] = useState(pkg?.description ?? '')
  const [services, setServices] = useState((pkg?.services ?? []).join(', '))
  const [duration, setDuration] = useState(String(pkg?.duration_min ?? 60))
  const [sort, setSort] = useState(String(pkg?.sort_order ?? nextSort ?? 0))
  const [saving, setSaving] = useState(false)

  async function save() {
    const dur = parseInt0(duration, 1)
    const so = parseInt0(sort, 0)
    if (!name.trim()) { toast('Package name is required', 'error'); return }
    if (dur == null) { toast('Duration must be a whole number of minutes, at least 1', 'error'); return }
    if (so == null) { toast('Sort order must be a whole number, 0 or more', 'error'); return }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      services: services.split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
      duration_min: dur,
      sort_order: so,
    }
    setSaving(true)
    const { error } = pkg
      ? await supabase.from('os_packages').update(payload).eq('id', pkg.id).eq('tenant_id', tenantId)
      : await supabase.from('os_packages').insert({ ...payload, tenant_id: tenantId, is_active: true })
    setSaving(false)
    if (error) { fail(error); return }
    toast(pkg ? 'Package updated' : 'Package added')
    onSaved()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={row}>
        <Field label="Name" grow={200}><input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Engine lube" /></Field>
        <Field label="Duration (min)" grow={110}><input style={inp} inputMode="numeric" value={duration} onChange={e => setDuration(e.target.value)} /></Field>
        <Field label="Sort order" grow={90}><input style={inp} inputMode="numeric" value={sort} onChange={e => setSort(e.target.value)} /></Field>
      </div>
      <Field label="Description" grow={300}><textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="Services (codes, comma separated)" grow={300}><input style={inp} value={services} onChange={e => setServices(e.target.value)} placeholder="engine_lube, gearbox_lube" /></Field>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving...' : 'Save package'}</Btn>
        <Btn kind="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  )
}

function PackageDetail({ pkg, tenantId, today, grades, prices, reload }: { pkg: Pkg; tenantId: string; today: string; grades: Grade[]; prices: Price[]; reload: () => void }) {
  const [editing, setEditing] = useState(false)
  const [tier, setTier] = useState<TierKey>('tier1')
  const [gradeId, setGradeId] = useState('')
  const [price, setPrice] = useState('')
  const [from, setFrom] = useState(today)
  const [saving, setSaving] = useState(false)
  const user = useAuthStore(s => s.user)

  const gradeName = (id: string | null) => (id ? grades.find(g => g.id === id)?.name ?? 'Unknown grade' : 'Any grade')
  const gridRows: (Grade | null)[] = [null, ...grades.filter(g => g.is_active || prices.some(p => p.grade_id === g.id))]

  function pick(g: string, t: TierKey) {
    setGradeId(g); setTier(t)
    const cur = priceFor(prices, g || null, t, today).current
    setPrice(cur ? String(cur.price) : '')
    setFrom(today)
  }

  async function savePrice() {
    const amount = parseMoney(price)
    if (amount == null) { toast('Enter a valid price (0 or more)', 'error'); return }
    if (!from || from < today) { toast('The effective date must be today or later', 'error'); return }
    setSaving(true)
    // The unique index uses COALESCE(grade_id), so look the row up instead of relying on onConflict.
    let q = supabase.from('os_prices').select('id').eq('tenant_id', tenantId).eq('package_id', pkg.id).eq('tier', tier).eq('effective_from', from)
    q = gradeId ? q.eq('grade_id', gradeId) : q.is('grade_id', null)
    const found = await q.maybeSingle()
    if (found.error) { setSaving(false); fail(found.error); return }
    const { error } = found.data
      ? await supabase.from('os_prices').update({ price: amount }).eq('id', found.data.id).eq('tenant_id', tenantId)
      : await supabase.from('os_prices').insert({ tenant_id: tenantId, package_id: pkg.id, grade_id: gradeId || null, tier, price: amount, effective_from: from, created_by: user?.id ?? null })
    setSaving(false)
    if (error) { fail(error); return }
    toast(`${TIER_LABEL[tier]} price set to ${rm(amount)} from ${fmtDay(from)}`)
    setPrice('')
    reload()
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* details */}
      {editing ? (
        <PackageForm tenantId={tenantId} pkg={pkg} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />
      ) : (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', fontSize: 13, color: C.mute, lineHeight: 1.6 }}>
            {pkg.description || 'No description'}
            <div style={{ marginTop: 4 }}>Services: {pkg.services.length ? pkg.services.join(', ') : 'none'} · Sort {pkg.sort_order}</div>
          </div>
          <div><Btn kind="ghost" onClick={() => setEditing(true)}><Pencil size={14} /> Edit details</Btn></div>
        </div>
      )}

      <GradesSection pkg={pkg} tenantId={tenantId} grades={grades} reload={reload} />

      {/* price grid */}
      <div>
        <h3 style={h3}>Price in force today</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {gridRows.map(g => (
            <div key={g?.id ?? 'any'} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
              <div style={{ flex: '1 1 120px', fontSize: 13, fontWeight: 600, alignSelf: 'center', color: g && !g.is_active ? C.dim : C.text }}>
                {g ? g.name : 'Any grade'}{g && !g.is_active ? ' (inactive)' : ''}
              </div>
              {(['tier1', 'tier2'] as TierKey[]).map(t => {
                const { current, upcoming } = priceFor(prices, g?.id ?? null, t, today)
                return (
                  <button key={t} type="button" onClick={() => pick(g?.id ?? '', t)}
                    style={{ flex: '1 1 130px', background: C.s2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', textAlign: 'left', cursor: 'pointer', color: C.text }}>
                    <span style={{ display: 'block', fontSize: 11, color: C.mute, fontWeight: 700 }}>{TIER_LABEL[t].toUpperCase()}</span>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: current ? C.text : C.dim }}>{current ? rm(current.price) : 'Not set'}</span>
                    {upcoming && <span style={{ display: 'block', fontSize: 11, color: C.amber }}>{rm(upcoming.price)} from {fmtDay(upcoming.effective_from)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <p style={helper}>A grade price replaces the package price for that tier. No price for a tier means the package is not offered to that tier (customers get a request instead). Existing bookings keep the price they were shown.</p>
      </div>

      {/* add / change price */}
      <div>
        <h3 style={h3}>Add / change price</h3>
        <div style={row}>
          <Field label="Tier" grow={110}>
            <select style={inp} value={tier} onChange={e => setTier(e.target.value as TierKey)}>
              <option value="tier1">Tier 1</option><option value="tier2">Tier 2</option>
            </select>
          </Field>
          <Field label="Grade" grow={150}>
            <select style={inp} value={gradeId} onChange={e => setGradeId(e.target.value)}>
              <option value="">Any grade (default)</option>
              {grades.filter(g => g.is_active).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Price (RM)" grow={110}><input style={inp} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="379.00" /></Field>
          <Field label="Effective from" grow={150}><input style={inp} type="date" min={today} value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Btn onClick={savePrice} disabled={saving}><Save size={15} /> {saving ? 'Saving...' : 'Save price'}</Btn>
        </div>
        <p style={helper}>Pick a future date to schedule a price change. Saving on a date that already has a price replaces it.</p>
      </div>

      <PriceHistory prices={prices} today={today} gradeName={gradeName} />
    </div>
  )
}

function PriceHistory({ prices, today, gradeName }: { prices: Price[]; today: string; gradeName: (id: string | null) => string }) {
  const [all, setAll] = useState(false)
  const shown = all ? prices : prices.slice(0, 8)
  return (
    <div>
      <h3 style={h3}>Price history</h3>
      {prices.length === 0 ? <p style={{ ...helper, margin: 0 }}>No prices yet. This package is not offered to any tier.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map(p => {
            const inForce = priceFor(prices, p.grade_id, p.tier, today).current?.id === p.id
            const status = p.effective_from > today ? <Badge color={C.amber}>Scheduled</Badge> : inForce ? <Badge color={C.green}>In force</Badge> : <Badge color={C.dim}>Replaced</Badge>
            return (
              <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', background: C.s2, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                <span style={{ flex: '1 1 140px', color: C.mute }}>{fmtDay(p.effective_from)}</span>
                <span style={{ flex: '1 1 110px' }}>{gradeName(p.grade_id)} · {TIER_LABEL[p.tier]}</span>
                <span style={{ flex: '0 0 auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{rm(p.price)}</span>
                {status}
              </div>
            )
          })}
          {prices.length > 8 && <div><Btn kind="ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${prices.length}`}</Btn></div>}
        </div>
      )}
    </div>
  )
}

function GradesSection({ pkg, tenantId, grades, reload }: { pkg: Pkg; tenantId: string; grades: Grade[]; reload: () => void }) {
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  async function add() {
    if (!name.trim()) { toast('Enter a grade name', 'error'); return }
    setAdding(true)
    const { error } = await supabase.from('os_oil_grades').insert({
      tenant_id: tenantId, package_id: pkg.id, name: name.trim(), is_active: true,
      sort_order: Math.max(0, ...grades.map(g => g.sort_order)) + 1,
    })
    setAdding(false)
    if (error) { fail(error); return }
    toast('Oil grade added')
    setName('')
    reload()
  }

  return (
    <div>
      <h3 style={h3}>Oil grades</h3>
      {grades.length === 0 && <p style={{ ...helper, margin: '0 0 8px' }}>No grades. The package uses one price per tier. Add grades (for example 5W-30 synthetic) to price each grade separately.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {grades.map(g => <GradeRow key={g.id} grade={g} tenantId={tenantId} reload={reload} />)}
      </div>
      <div style={row}>
        <Field label="New grade" grow={200}><input style={inp} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="5W-30 fully synthetic" /></Field>
        <Btn onClick={add} disabled={adding}><Plus size={15} /> Add grade</Btn>
      </div>
    </div>
  )
}

function GradeRow({ grade, tenantId, reload }: { grade: Grade; tenantId: string; reload: () => void }) {
  const [name, setName] = useState(grade.name)
  useEffect(() => setName(grade.name), [grade.name])

  async function patch(values: Partial<Grade>, msg: string) {
    const { error } = await supabase.from('os_oil_grades').update(values).eq('id', grade.id).eq('tenant_id', tenantId)
    if (error) { fail(error); return }
    toast(msg)
    reload()
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <input style={{ ...inp, flex: '1 1 160px', width: 'auto', opacity: grade.is_active ? 1 : 0.6 }} value={name} onChange={e => setName(e.target.value)} aria-label="Grade name" />
      {name.trim() !== grade.name && name.trim() !== '' && <Btn onClick={() => patch({ name: name.trim() }, 'Grade renamed')}><Save size={14} /> Rename</Btn>}
      <Switch on={grade.is_active} onChange={v => patch({ is_active: v }, v ? 'Grade reactivated' : 'Grade deactivated')} label={`${grade.name} active`} />
      <span style={{ fontSize: 12, color: C.mute, minWidth: 48 }}>{grade.is_active ? 'Active' : 'Inactive'}</span>
    </div>
  )
}

// ── 2. vehicle tiers ────────────────────────────────────────────────────
type RuleTier = 'tier1' | 'tier2' | 'hub_only'
interface Rule { id: string; vehicle_type: 'car' | 'bike'; make: string; model: string | null; tier: RuleTier }

function VehicleTiersTab({ tenantId }: { tenantId: string }) {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<'car' | 'bike'>('car')
  const [filter, setFilter] = useState<'all' | 'car' | 'bike'>('all')
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [tier, setTier] = useState<RuleTier>('tier1')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('os_vehicle_rules').select('id, vehicle_type, make, model, tier').eq('tenant_id', tenantId).limit(2000)
    if (error) fail(error)
    setRules((data as Rule[]) ?? [])
    setLoading(false)
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules
      .filter(r => (filter === 'all' || r.vehicle_type === filter) && (!q || `${r.make} ${r.model ?? ''}`.toLowerCase().includes(q)))
      .sort((a, b) => a.vehicle_type.localeCompare(b.vehicle_type) || a.make.localeCompare(b.make, undefined, { sensitivity: 'base' }) || (a.model ?? '').localeCompare(b.model ?? ''))
  }, [rules, filter, search])

  const unruledMakes = makeOptionsFor(type).filter(m => !rules.some(r => r.vehicle_type === type && !r.model && r.make.toLowerCase() === m.toLowerCase()))

  function reset() { setEditId(null); setMake(''); setModel(''); setTier('tier1') }

  function edit(r: Rule) {
    setEditId(r.id); setType(r.vehicle_type); setMake(r.make); setModel(r.model ?? ''); setTier(r.tier)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save() {
    if (!make.trim()) { toast('Choose or type a make', 'error'); return }
    const payload = { vehicle_type: type, make: make.trim(), model: model.trim() || null, tier }
    setSaving(true)
    const { error } = editId
      ? await supabase.from('os_vehicle_rules').update(payload).eq('id', editId).eq('tenant_id', tenantId)
      : await supabase.from('os_vehicle_rules').insert({ ...payload, tenant_id: tenantId })
    setSaving(false)
    if (error) {
      toast(error.code === '23505' ? 'A rule for this make and model already exists. Edit it instead.' : error.message, 'error')
      return
    }
    toast(editId ? 'Rule updated' : `${payload.make}${payload.model ? ' ' + payload.model : ''} set to ${TIER_LABEL[tier]}`)
    reset()
    load()
  }

  async function remove(r: Rule) {
    if (!window.confirm(`Delete the rule for ${r.make}${r.model ? ' ' + r.model : ''}? It will go back to "unknown".`)) return
    const { error } = await supabase.from('os_vehicle_rules').delete().eq('id', r.id).eq('tenant_id', tenantId)
    if (error) { fail(error); return }
    toast('Rule deleted')
    if (editId === r.id) reset()
    load()
  }

  if (loading) return <Spinner />

  const makeList = type === 'bike' ? Object.keys(BIKE_MAKES) : Object.keys(CAR_MAKES)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <h3 style={h3}>{editId ? 'Edit rule' : 'Add rule'}</h3>
        <div style={row}>
          <Field label="Type" grow={100}>
            <select style={inp} value={type} onChange={e => { setType(e.target.value as 'car' | 'bike'); setMake(''); setModel('') }}>
              <option value="car">Car</option><option value="bike">Bike</option>
            </select>
          </Field>
          {!editId && (
            <Field label="Quick add make" grow={160}>
              <select style={inp} value="" onChange={e => { if (e.target.value) { setMake(e.target.value); setModel('') } }}>
                <option value="">Pick a make...</option>
                {unruledMakes.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          )}
          <Field label="Make" grow={150}>
            <input style={inp} list={`mk-${type}`} value={make} onChange={e => setMake(e.target.value)} placeholder="Toyota" />
            <datalist id={`mk-${type}`}>{makeList.map(m => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label="Model (optional)" grow={150}>
            <input style={inp} list="mk-models" value={model} onChange={e => setModel(e.target.value)} placeholder="All models" />
            <datalist id="mk-models">{modelOptionsFor(type, make).map(m => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label="Tier" grow={130}>
            <select style={inp} value={tier} onChange={e => setTier(e.target.value as RuleTier)}>
              <option value="tier1">Tier 1</option><option value="tier2">Tier 2</option><option value="hub_only">Hub only</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Btn onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving...' : editId ? 'Save changes' : 'Add rule'}</Btn>
          {editId && <Btn kind="ghost" onClick={reset}>Cancel</Btn>}
        </div>
        <p style={helper}>A model rule overrides the rule for its make. Hub only means the van does not serve that vehicle. Makes with no rule are treated as unknown: the customer sends a request for approval instead of booking directly.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'car', 'bike'] as const).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            style={{ background: filter === f ? C.orange : C.s1, color: filter === f ? '#fff' : C.mute, border: `1px solid ${filter === f ? C.orange : C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '6px 12px', cursor: 'pointer' }}>
            {f === 'all' ? 'All' : f === 'car' ? 'Cars' : 'Bikes'}
          </button>
        ))}
        <input style={{ ...inp, flex: '1 1 160px', width: 'auto' }} placeholder="Search make or model" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {sorted.length === 0 ? <Empty>{rules.length === 0 ? 'No vehicle rules yet. Every vehicle is treated as unknown until you add one.' : 'No rules match.'}</Empty> : (
        <div style={{ ...card, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sorted.map(r => (
            <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 10px', background: editId === r.id ? C.s2 : 'transparent', borderRadius: 8 }}>
              <span style={{ flex: '0 0 48px', fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase' }}>{r.vehicle_type}</span>
              <span style={{ flex: '1 1 160px', fontSize: 13, minWidth: 0 }}>
                <b>{r.make}</b> <span style={{ color: r.model ? C.text : C.dim }}>{r.model ?? 'all models'}</span>
              </span>
              <Badge color={TIER_COLOR[r.tier]}>{TIER_LABEL[r.tier]}</Badge>
              <IconBtn title="Edit" onClick={() => edit(r)}><Pencil size={14} /></IconBtn>
              <IconBtn title="Delete" danger onClick={() => remove(r)}><Trash2 size={14} /></IconBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 3. time slots & blackout dates ──────────────────────────────────────
interface Slot { id: string; label: string; start_time: string; end_time: string; is_open: boolean; days: number[]; sort_order: number }
interface Blackout { id: string; blackout_date: string; reason: string | null }

function SlotsTab({ tenantId }: { tenantId: string }) {
  const [branchId, setBranchId] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [blackouts, setBlackouts] = useState<Blackout[]>([])
  const [loading, setLoading] = useState(true)
  const today = ymd(new Date())

  const load = useCallback(async () => {
    const st = await supabase.from('os_settings').select('default_branch_id').eq('tenant_id', tenantId).maybeSingle()
    if (st.error) fail(st.error)
    const bid: string | null = st.data?.default_branch_id ?? null
    setBranchId(bid)
    if (bid) {
      const [s, b, br] = await Promise.all([
        supabase.from('os_slots').select('id, label, start_time, end_time, is_open, days, sort_order').eq('tenant_id', tenantId).eq('branch_id', bid).order('start_time'),
        supabase.from('os_blackouts').select('id, blackout_date, reason').eq('tenant_id', tenantId).eq('branch_id', bid).gte('blackout_date', today).order('blackout_date'),
        supabase.from('branches').select('name').eq('tenant_id', tenantId).eq('id', bid).maybeSingle(),
      ])
      const err = s.error ?? b.error
      if (err) fail(err)
      setSlots((s.data as Slot[]) ?? [])
      setBlackouts((b.data as Blackout[]) ?? [])
      setBranchName(br.data?.name ?? '')
    }
    setLoading(false)
  }, [tenantId, today])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />
  if (!branchId) return <Empty>Choose the van that receives bookings under Rules &amp; payments first. Slots belong to that van.</Empty>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Warn>Closing a slot or blocking a date does not cancel bookings that already exist. Handle those from the bookings list.</Warn>
      <p style={{ ...helper, margin: 0 }}>Slots for <b style={{ color: C.text }}>{branchName || 'the selected van'}</b>. Customers only see slots that are open on that weekday.</p>

      {slots.length === 0 && <Empty>No slots yet. Add one below.</Empty>}
      {slots.map(s => <SlotEditor key={s.id} slot={s} tenantId={tenantId} branchId={branchId} nextSort={0} onSaved={load} />)}

      <div style={card}>
        <h3 style={h3}>Add slot</h3>
        <SlotEditor tenantId={tenantId} branchId={branchId} nextSort={Math.max(0, ...slots.map(s => s.sort_order)) + 1} onSaved={load} bare />
      </div>

      <BlackoutsSection tenantId={tenantId} branchId={branchId} blackouts={blackouts} today={today} reload={load} />
    </div>
  )
}

function SlotEditor({ slot, tenantId, branchId, nextSort, onSaved, bare }: { slot?: Slot; tenantId: string; branchId: string; nextSort: number; onSaved: () => void; bare?: boolean }) {
  const blank = { label: '', start: '09:00', end: '11:00', open: true, days: [1, 2, 3, 4, 5, 6] }
  const init = slot ? { label: slot.label, start: hhmm(slot.start_time), end: hhmm(slot.end_time), open: slot.is_open, days: [...slot.days].sort() } : blank
  const [d, setD] = useState(init)
  const [saving, setSaving] = useState(false)
  const dirty = !slot || JSON.stringify(d) !== JSON.stringify(init)

  async function save(patch: Partial<typeof d> = {}) {
    const v = { ...d, ...patch }
    if (!v.label.trim()) { toast('Give the slot a label, for example 11am - 1pm', 'error'); return }
    if (!v.start || !v.end || v.end <= v.start) { toast('End time must be after start time', 'error'); return }
    if (v.days.length === 0) { toast('Choose at least one weekday', 'error'); return }
    const payload = { label: v.label.trim(), start_time: v.start, end_time: v.end, is_open: v.open, days: v.days }
    setSaving(true)
    const { error } = slot
      ? await supabase.from('os_slots').update(payload).eq('id', slot.id).eq('tenant_id', tenantId).eq('branch_id', branchId)
      : await supabase.from('os_slots').insert({ ...payload, tenant_id: tenantId, branch_id: branchId, sort_order: nextSort })
    setSaving(false)
    if (error) { fail(error); return }
    toast(slot ? `${payload.label} saved (${payload.is_open ? 'open' : 'closed'})` : 'Slot added')
    if (!slot) setD(blank)
    else setD(v)
    onSaved()
  }

  function toggleDay(n: number) {
    setD(x => ({ ...x, days: x.days.includes(n) ? x.days.filter(y => y !== n) : [...x.days, n].sort() }))
  }

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={row}>
        <Field label="Label" grow={160}><input style={inp} value={d.label} onChange={e => setD({ ...d, label: e.target.value })} placeholder="11am - 1pm" /></Field>
        <Field label="Start" grow={100}><input style={inp} type="time" value={d.start} onChange={e => setD({ ...d, start: e.target.value })} /></Field>
        <Field label="End" grow={100}><input style={inp} type="time" value={d.end} onChange={e => setD({ ...d, end: e.target.value })} /></Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
          <Switch on={d.open} onChange={v => (slot ? save({ open: v }) : setD({ ...d, open: v }))} disabled={saving} label="Open for booking" />
          <span style={{ fontSize: 12, color: d.open ? C.green : C.mute, minWidth: 44 }}>{d.open ? 'Open' : 'Closed'}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ISO_DAYS.map(day => {
          const on = d.days.includes(day.n)
          return (
            <button key={day.n} type="button" onClick={() => toggleDay(day.n)} aria-pressed={on}
              style={{ background: on ? C.orange + '22' : C.s2, color: on ? C.orange : C.mute, border: `1px solid ${on ? C.orange : C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 700, padding: '6px 10px', cursor: 'pointer' }}>
              {day.label}
            </button>
          )
        })}
      </div>
      {dirty && <div><Btn onClick={() => save()} disabled={saving}><Save size={15} /> {saving ? 'Saving...' : slot ? 'Save changes' : 'Add slot'}</Btn></div>}
    </div>
  )
  return bare ? body : <div style={{ ...card, opacity: d.open ? 1 : 0.8 }}>{body}</div>
}

function BlackoutsSection({ tenantId, branchId, blackouts, today, reload }: { tenantId: string; branchId: string; blackouts: Blackout[]; today: string; reload: () => void }) {
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function add() {
    if (!date || date < today) { toast('Pick a date from today onward', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('os_blackouts')
      .upsert({ tenant_id: tenantId, branch_id: branchId, blackout_date: date, reason: reason.trim() || null }, { onConflict: 'branch_id,blackout_date' })
    setSaving(false)
    if (error) { fail(error); return }
    toast(`${fmtDay(date)} is blocked`)
    setDate(''); setReason('')
    reload()
  }

  async function remove(b: Blackout) {
    const { error } = await supabase.from('os_blackouts').delete().eq('id', b.id).eq('tenant_id', tenantId).eq('branch_id', branchId)
    if (error) { fail(error); return }
    toast(`${fmtDay(b.blackout_date)} is open again`)
    reload()
  }

  return (
    <div style={card}>
      <h3 style={h3}>Blackout dates</h3>
      <div style={row}>
        <Field label="Date" grow={150}><input style={inp} type="date" min={today} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Reason" grow={200}><input style={inp} value={reason} onChange={e => setReason(e.target.value)} placeholder="Public holiday" /></Field>
        <Btn onClick={add} disabled={saving}><Plus size={15} /> Block date</Btn>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {blackouts.length === 0 && <p style={{ ...helper, margin: 0 }}>No upcoming blackout dates.</p>}
        {blackouts.map(b => (
          <div key={b.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', background: C.s2, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
            <span style={{ flex: '1 1 150px', fontWeight: 600 }}>{fmtDay(b.blackout_date)}</span>
            <span style={{ flex: '1 1 150px', color: C.mute }}>{b.reason || 'No reason given'}</span>
            <IconBtn title="Remove blackout" danger onClick={() => remove(b)}><X size={14} /></IconBtn>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 4. zones ────────────────────────────────────────────────────────────
interface Zone { id: string; name: string; postcodes: string[]; surcharge: number; note: string | null; sort_order: number; is_active: boolean }

function ZonesTab({ tenantId }: { tenantId: string }) {
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('os_zones').select('id, name, postcodes, surcharge, note, sort_order, is_active').eq('tenant_id', tenantId).order('sort_order')
    if (error) fail(error)
    setZones(((data as Zone[]) ?? []).map(z => ({ ...z, surcharge: Number(z.surcharge) })))
    setLoading(false)
  }, [tenantId])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ ...helper, margin: 0 }}>A postcode matches a zone when it starts with one of these, e.g. 471 covers 47100–47199. The longest match wins. Postcodes outside every active zone cannot book online.</p>
      {zones.length === 0 && <Empty>No zones yet. Add the areas the van covers.</Empty>}
      {zones.map(z => <ZoneEditor key={z.id} zone={z} tenantId={tenantId} nextSort={0} onSaved={load} />)}
      <div style={card}>
        <h3 style={h3}>Add zone</h3>
        <ZoneEditor tenantId={tenantId} nextSort={Math.max(0, ...zones.map(z => z.sort_order)) + 1} onSaved={load} bare />
      </div>
    </div>
  )
}

function ZoneEditor({ zone, tenantId, nextSort, onSaved, bare }: { zone?: Zone; tenantId: string; nextSort: number; onSaved: () => void; bare?: boolean }) {
  const blank = { name: '', postcodes: '', surcharge: '0', note: '', active: true }
  const init = zone ? { name: zone.name, postcodes: zone.postcodes.join(', '), surcharge: String(zone.surcharge), note: zone.note ?? '', active: zone.is_active } : blank
  const [d, setD] = useState(init)
  const [saving, setSaving] = useState(false)
  const dirty = !zone || JSON.stringify(d) !== JSON.stringify(init)

  async function save(patch: Partial<typeof d> = {}) {
    const v = { ...d, ...patch }
    const codes = Array.from(new Set(v.postcodes.split(/[\s,]+/).filter(Boolean)))
    const sur = parseMoney(v.surcharge)
    if (!v.name.trim()) { toast('Zone name is required', 'error'); return }
    if (codes.length === 0) { toast('Enter at least one postcode prefix', 'error'); return }
    if (codes.some(c => !/^\d{1,5}$/.test(c))) { toast('Postcodes must be 1 to 5 digits, separated by commas or spaces', 'error'); return }
    if (sur == null) { toast('Surcharge must be 0 or more', 'error'); return }
    const payload = { name: v.name.trim(), postcodes: codes, surcharge: sur, note: v.note.trim() || null, is_active: v.active }
    setSaving(true)
    const { error } = zone
      ? await supabase.from('os_zones').update(payload).eq('id', zone.id).eq('tenant_id', tenantId)
      : await supabase.from('os_zones').insert({ ...payload, tenant_id: tenantId, sort_order: nextSort })
    setSaving(false)
    if (error) { fail(error); return }
    toast(zone ? `${payload.name} saved` : 'Zone added')
    if (!zone) setD(blank)
    else setD({ ...v, postcodes: codes.join(', ') })
    onSaved()
  }

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={row}>
        <Field label="Zone name" grow={160}><input style={inp} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="Puchong" /></Field>
        <Field label="Postcode prefixes" grow={200}><input style={inp} value={d.postcodes} onChange={e => setD({ ...d, postcodes: e.target.value })} placeholder="471, 47100" /></Field>
        <Field label="Surcharge (RM)" grow={110}><input style={inp} inputMode="decimal" value={d.surcharge} onChange={e => setD({ ...d, surcharge: e.target.value })} /></Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
          <Switch on={d.active} onChange={v => (zone ? save({ active: v }) : setD({ ...d, active: v }))} disabled={saving} label="Zone active" />
          <span style={{ fontSize: 12, color: d.active ? C.green : C.mute, minWidth: 52 }}>{d.active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>
      <Field label="Note" grow={300}><input style={inp} value={d.note} onChange={e => setD({ ...d, note: e.target.value })} placeholder="Shown to staff only" /></Field>
      {dirty && <div><Btn onClick={() => save()} disabled={saving}><Save size={15} /> {saving ? 'Saving...' : zone ? 'Save changes' : 'Add zone'}</Btn></div>}
    </div>
  )
  return bare ? body : <div style={{ ...card, opacity: d.active ? 1 : 0.8 }}>{body}</div>
}

// ── 5. rules & payments ─────────────────────────────────────────────────
interface BranchOpt { id: string; name: string }
type RulesForm = {
  deposit_pct: string; cancel_cutoff_hours: string; refund_due_hours: string; max_reschedules: string
  booking_window_days: string; booking_cutoff_hours: string; hold_minutes: string
  offhours_enabled: boolean; offhours_surcharge: string; auto_confirm: boolean
  default_branch_id: string; hub_branch_id: string
}

const RULES_DEFAULT: RulesForm = {
  deposit_pct: '50', cancel_cutoff_hours: '24', refund_due_hours: '48', max_reschedules: '2',
  booking_window_days: '14', booking_cutoff_hours: '12', hold_minutes: '30',
  offhours_enabled: true, offhours_surcharge: '', auto_confirm: true, default_branch_id: '', hub_branch_id: '',
}

function RulesTab({ tenantId }: { tenantId: string }) {
  const user = useAuthStore(s => s.user)
  const [f, setF] = useState<RulesForm>(RULES_DEFAULT)
  const [branches, setBranches] = useState<BranchOpt[]>([])
  const [exists, setExists] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [st, br] = await Promise.all([
      supabase.from('os_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('branches').select('id, name').eq('tenant_id', tenantId).order('name'),
    ])
    const err = st.error ?? br.error
    if (err) fail(err)
    setBranches((br.data as BranchOpt[]) ?? [])
    const s = st.data
    setExists(!!s)
    if (s) {
      setF({
        deposit_pct: String(s.deposit_pct), cancel_cutoff_hours: String(s.cancel_cutoff_hours), refund_due_hours: String(s.refund_due_hours),
        max_reschedules: String(s.max_reschedules), booking_window_days: String(s.booking_window_days),
        booking_cutoff_hours: String(s.booking_cutoff_hours), hold_minutes: String(s.hold_minutes),
        offhours_enabled: !!s.offhours_enabled, offhours_surcharge: s.offhours_surcharge == null ? '' : String(s.offhours_surcharge),
        auto_confirm: !!s.auto_confirm, default_branch_id: s.default_branch_id ?? '', hub_branch_id: s.hub_branch_id ?? '',
      })
    }
    setLoading(false)
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const set = (k: keyof RulesForm) => (v: string | boolean) => setF(x => ({ ...x, [k]: v }))

  async function save() {
    const deposit = parseInt0(f.deposit_pct, 0, 100)
    const cutoff = parseInt0(f.cancel_cutoff_hours, 0)
    const refund = parseInt0(f.refund_due_hours, 0)
    const resch = parseInt0(f.max_reschedules, 0)
    const win = parseInt0(f.booking_window_days, 1)
    const bcut = parseInt0(f.booking_cutoff_hours, 0)
    const hold = parseInt0(f.hold_minutes, 1)
    const off = f.offhours_surcharge.trim() === '' ? null : parseMoney(f.offhours_surcharge)
    if (deposit == null) { toast('Deposit must be a whole number from 0 to 100', 'error'); return }
    if (cutoff == null) { toast('Cancel cut-off must be a whole number of hours, 0 or more', 'error'); return }
    if (refund == null) { toast('Refund time must be a whole number of hours, 0 or more', 'error'); return }
    if (resch == null) { toast('Max reschedules must be a whole number, 0 or more', 'error'); return }
    if (win == null) { toast('Booking window must be at least 1 day', 'error'); return }
    if (bcut == null) { toast('Booking cut-off must be a whole number of hours, 0 or more', 'error'); return }
    if (hold == null) { toast('Hold time must be at least 1 minute', 'error'); return }
    if (f.offhours_surcharge.trim() !== '' && off == null) { toast('Off-hours surcharge must be 0 or more', 'error'); return }

    setSaving(true)
    const { error } = await supabase.from('os_settings').upsert({
      tenant_id: tenantId, deposit_pct: deposit, cancel_cutoff_hours: cutoff, refund_due_hours: refund, max_reschedules: resch,
      booking_window_days: win, booking_cutoff_hours: bcut, hold_minutes: hold,
      offhours_enabled: f.offhours_enabled, offhours_surcharge: off, auto_confirm: f.auto_confirm,
      default_branch_id: f.default_branch_id || null, hub_branch_id: f.hub_branch_id || null,
      updated_by: user?.id ?? null,
    }, { onConflict: 'tenant_id' })
    setSaving(false)
    if (error) { fail(error); return }
    setExists(true)
    toast('Rules saved')
  }

  if (loading) return <Spinner />

  const num = (key: keyof RulesForm, label: string, hint?: string) => (
    <Field label={label} grow={170}>
      <input style={inp} inputMode="numeric" value={f[key] as string} onChange={e => set(key)(e.target.value)} />
      {hint && <span style={{ color: C.dim, fontSize: 11 }}>{hint}</span>}
    </Field>
  )

  const c = Number(f.cancel_cutoff_hours), r = Number(f.refund_due_hours), m = Number(f.max_reschedules)
  const policy = [
    `Cancel or reschedule at least ${c} h before the visit: refund within ${r} h${m > 0 ? ` or reschedule (up to ${m} time${m === 1 ? '' : 's'})` : ''}.`,
    `Inside ${c} h or no-show: deposit kept.`,
    `A ${Number(f.deposit_pct)}% deposit secures the slot, held for ${Number(f.hold_minutes)} min while the customer pays.`,
    `Customers can book up to ${Number(f.booking_window_days)} days ahead, until ${Number(f.booking_cutoff_hours)} h before the slot.`,
  ].join(' ')

  const branchSelect = (key: 'default_branch_id' | 'hub_branch_id', label: string) => (
    <Field label={label} grow={220}>
      <select style={inp} value={f[key]} onChange={e => set(key)(e.target.value)}>
        <option value="">Not set</option>
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </Field>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!exists && <Warn>ON-SITE has not been configured for this tenant yet. Saving creates the settings.</Warn>}

      <div style={card}>
        <h3 style={h3}>Payments and bookings</h3>
        <div style={row}>
          {num('deposit_pct', 'Deposit (%)', '0 to 100')}
          {num('hold_minutes', 'Hold time (min)', 'Time to pay the deposit')}
          {num('booking_window_days', 'Booking window (days)', 'How far ahead')}
          {num('booking_cutoff_hours', 'Booking cut-off (h)', 'Before the slot')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <Switch on={f.auto_confirm} onChange={set('auto_confirm')} label="Auto confirm" />
          <span style={{ fontSize: 13 }}>Confirm automatically when the deposit is paid</span>
        </div>
      </div>

      <div style={card}>
        <h3 style={h3}>Cancellation and rescheduling</h3>
        <div style={row}>
          {num('cancel_cutoff_hours', 'Free cancel cut-off (h)', 'Before the visit')}
          {num('refund_due_hours', 'Refund due within (h)')}
          {num('max_reschedules', 'Max reschedules')}
        </div>
        <div style={{ background: C.s2, borderRadius: 8, padding: '10px 12px', marginTop: 14 }}>
          <div style={{ color: C.mute, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Cancellation policy as customers read it</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{policy}</div>
        </div>
      </div>

      <div style={card}>
        <h3 style={h3}>Off-hours</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Switch on={f.offhours_enabled} onChange={set('offhours_enabled')} label="Off-hours enabled" />
          <span style={{ fontSize: 13 }}>Allow off-hours requests</span>
        </div>
        <div style={row}>
          <Field label="Off-hours surcharge (RM)" grow={200}>
            <input style={inp} inputMode="decimal" value={f.offhours_surcharge} onChange={e => set('offhours_surcharge')(e.target.value)} placeholder="None" />
          </Field>
        </div>
      </div>

      <div style={card}>
        <h3 style={h3}>Branches</h3>
        <div style={row}>
          {branchSelect('default_branch_id', 'Van that receives bookings')}
          {branchSelect('hub_branch_id', 'Hub branch for referrals')}
        </div>
        <p style={helper}>Slots and blackout dates belong to the van you pick here. Referrals create a draft quotation at the Hub branch.</p>
      </div>

      <div><Btn onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving...' : 'Save rules'}</Btn></div>
    </div>
  )
}
