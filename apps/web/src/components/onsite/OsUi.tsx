import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { contactLink, formatContact, osError, type BbDay } from '@/lib/onsite'

// Shared look for the customer-facing ON-SITE pages (booking + status).
export const C = {
  bg: '#0E0E0E', surface: '#161616', surface2: '#1E1E1E', border: '#2A2A2A',
  orange: '#F15A22', text: '#F0F0F0', muted: '#A0A0A0', green: '#22C55E', red: '#EF4444', amber: '#F59E0B',
}

export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#111', border: `1px solid ${C.border}`, borderRadius: 10,
  color: C.text, padding: '13px 14px', fontSize: 16, outline: 'none',
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* a clear keyboard focus ring (the inputs set outline: none inline, so this needs !important) */}
      <style>{`button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[role=radio]:focus-visible{outline:2px solid ${C.orange} !important;outline-offset:2px}`}</style>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 60px' }}>{children}</div>
    </div>
  )
}

// Page title and link preview tags (WhatsApp, search). Restored when the page is left.
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title
    const undo: (() => void)[] = []
    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      const found = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
      if (found) {
        const prev = found.getAttribute('content')
        found.setAttribute('content', content)
        undo.push(() => { if (prev === null) found.removeAttribute('content'); else found.setAttribute('content', prev) })
      } else {
        const made = document.createElement('meta')
        made.setAttribute(attr, key)
        made.setAttribute('content', content)
        document.head.appendChild(made)
        undo.push(() => made.remove())
      }
    }
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    return () => { document.title = prevTitle; undo.forEach(f => f()) }
  }, [title, description])
}

// The workshop's WhatsApp number for the public pages (null until loaded, or when none is set).
export function usePublicContact(slug: string | null, enabled = true): string | null {
  const [number, setNumber] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    supabase.rpc('os_public_contact', { p_tenant_slug: slug }).then(({ data, error }) => {
      if (alive && !error && typeof data === 'string') setNumber(data)
    })
    return () => { alive = false }
  }, [slug, enabled])
  return number
}

// "Questions? WhatsApp us on 011-7593 1383". Renders nothing without a number.
export function ContactLine({ number, inline }: { number?: string | null; inline?: boolean }) {
  const href = contactLink(number)
  if (!href) return null
  return (
    <div style={inline ? { marginTop: 8, fontSize: 13 } : { textAlign: 'center', marginTop: 16, fontSize: 13 }}>
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: C.muted, textDecoration: 'underline' }}>
        Questions? WhatsApp us on {formatContact(number)}
      </a>
    </div>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, ...style }}>{children}</div>
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 5 }}>{hint}</span>}
    </label>
  )
}

export function Button({ children, onClick, disabled, busy, variant = 'primary', style }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; variant?: 'primary' | 'ghost' | 'danger'; style?: CSSProperties
}) {
  const bg = variant === 'primary' ? C.orange : variant === 'danger' ? 'transparent' : C.surface2
  const border = variant === 'danger' ? C.red : variant === 'ghost' ? C.border : C.orange
  const color = variant === 'danger' ? C.red : '#fff'
  return (
    <button onClick={onClick} disabled={disabled || busy}
      style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: `1px solid ${border}`, background: bg, color, fontSize: 16, fontWeight: 700,
        cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style }}>
      {busy && <Loader2 size={18} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const col = tone === 'error' ? C.red : tone === 'warn' ? C.amber : tone === 'ok' ? C.green : '#3B82F6'
  return <div style={{ border: `1px solid ${col}55`, background: `${col}14`, color: C.text, borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>{children}</div>
}

// Day buttons for the BB Staff Car Care Day (booking page and reschedule). Shows how many cars
// are left; a full or closed day is disabled. `currentDate` is the booking's own day (not pickable).
export function BbDayPicker({ days, value, onChange, currentDate }: { days: BbDay[]; value: string; onChange: (date: string) => void; currentDate?: string | null }) {
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
      {days.map(d => {
        const dt = new Date(d.date + 'T00:00:00')
        const isCurrent = d.date === currentDate
        const ok = d.available && !isCurrent
        const sel = value === d.date
        const sub = isCurrent ? 'Booked' : !d.available ? (d.left <= 0 ? 'Full' : 'Closed') : `${d.left} left`
        const subColor = !ok ? '#777' : d.left <= 2 ? C.amber : C.muted
        return (
          <button key={d.date} type="button" disabled={!ok} aria-pressed={sel} onClick={() => onChange(d.date)}
            style={{ minWidth: 72, padding: '10px 6px', borderRadius: 10, border: `1px solid ${sel ? C.orange : C.border}`, background: sel ? `${C.orange}22` : '#111',
              color: ok ? C.text : '#555', opacity: ok ? 1 : 0.55, flexShrink: 0, cursor: ok ? 'pointer' : 'not-allowed' }}>
            <div style={{ fontSize: 11 }}>{dt.toLocaleDateString('en-MY', { weekday: 'short' })}</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{dt.getDate()}</div>
            <div style={{ fontSize: 11 }}>{dt.toLocaleDateString('en-MY', { month: 'short' })}</div>
            <div style={{ fontSize: 11, marginTop: 4, fontWeight: 700, color: subColor }}>{sub}</div>
          </button>
        )
      })}
    </div>
  )
}

export const PAYMENT_METHODS = [
  { id: 'fpx', label: 'Online banking (FPX)' },
  { id: 'duitnow', label: 'DuitNow QR' },
  { id: 'credit_card', label: 'Card' },
]

// Calls the payment function with the booking token; returns the checkout URL.
export async function startPayment(invoiceId: string, token: string, method: string): Promise<{ url?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('raudhahpay-create-payment', {
    body: { invoice_id: invoiceId, payment_method: method, os_token: token },
  })
  if (error) {
    let msg = ''
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? '' } catch { /* ignore */ }
    return { error: msg || 'Could not start the payment. Try another payment method, or check that your mobile number is correct.' }
  }
  if (!data?.payment_url) return { error: 'Could not start the payment. Please try again.' }
  return { url: data.payment_url as string }
}

export { osError }
