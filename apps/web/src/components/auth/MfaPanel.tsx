import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// The authenticator-app step (a six-digit code that changes every 30 seconds). Used on the Security page and as the gate
// shown to a Branch Admin / super admin when the company requires it. Enrols the phone the first time, then asks for the code.
const C = { surface: '#1C1C1C', border: '#2A2A2A', orange: '#F15A22', text: '#F0F0F0', muted: '#A0A0A0', green: '#22C55E', red: '#F87171' }

type Level = { current: string; next: string }

export function MfaPanel({ onVerified }: { onVerified?: () => void }) {
  const [loading, setLoading] = useState(true)
  const [factorId, setFactorId] = useState<string | null>(null)       // a verified authenticator, if there is one
  const [level, setLevel] = useState<Level>({ current: 'aal1', next: 'aal1' })
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [f, a] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()])
    setFactorId(f.data?.totp?.[0]?.id ?? null)
    setLevel({ current: a.data?.currentLevel ?? 'aal1', next: a.data?.nextLevel ?? 'aal1' })
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function startEnrol() {
    setBusy(true); setError(null)
    // clear out any half-finished set-up from an earlier try
    const all = await supabase.auth.mfa.listFactors()
    for (const f of all.data?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `EZWerkFlo ${new Date().toISOString().slice(0, 10)}` })
    setBusy(false)
    if (e || !data) { setError(e?.message ?? 'Could not start the set-up'); return }
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  async function submit(id: string) {
    setBusy(true); setError(null)
    const ch = await supabase.auth.mfa.challenge({ factorId: id })
    if (ch.error || !ch.data) { setBusy(false); setError(ch.error?.message ?? 'Could not start the check'); return }
    const v = await supabase.auth.mfa.verify({ factorId: id, challengeId: ch.data.id, code: code.trim() })
    setBusy(false)
    if (v.error) { setError('That code was not accepted. Check the code on your phone and try again.'); return }
    setCode(''); setEnrol(null)
    await supabase.auth.refreshSession()
    await load()
    onVerified?.()
  }

  const box: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, maxWidth: 440, width: '100%' }
  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0E0E0E', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '12px 14px', fontSize: 22, letterSpacing: 6, textAlign: 'center', outline: 'none' }
  const btn: React.CSSProperties = { background: C.orange, border: 'none', borderRadius: 8, color: '#fff', padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }

  if (loading) return <div style={{ ...box, color: C.muted }}><Loader2 size={16} /> Loading…</div>

  const verified = level.current === 'aal2'
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <ShieldCheck size={20} color={verified ? C.green : C.orange} />
        <span style={{ color: C.text, fontWeight: 700, fontSize: 16 }}>Authenticator code</span>
        {verified && <span style={{ color: C.green, fontSize: 12, fontWeight: 700 }}>VERIFIED THIS SESSION</span>}
      </div>

      {factorId && verified && <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: 0 }}>Your authenticator is set up and you have entered your code in this session. The money powers are unlocked until you sign out.</p>}

      {factorId && !verified && (
        <>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: '0 0 14px' }}>Open your authenticator app and enter the six-digit code for EZWerkFlo.</p>
          <input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={input} placeholder="000000"
            onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) submit(factorId) }} />
          <div style={{ marginTop: 14 }}><button disabled={busy || code.length !== 6} onClick={() => submit(factorId)} style={{ ...btn, opacity: busy || code.length !== 6 ? 0.5 : 1 }}>{busy && <Loader2 size={14} />} Verify</button></div>
        </>
      )}

      {!factorId && !enrol && (
        <>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: '0 0 14px' }}>Set up an authenticator app (Google Authenticator, Microsoft Authenticator or Authy) on your own phone. After this, the money powers need the code from your phone, so a stolen password is not enough.</p>
          <button disabled={busy} onClick={startEnrol} style={btn}>{busy && <Loader2 size={14} />} Set up authenticator</button>
        </>
      )}

      {!factorId && enrol && (
        <>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: '0 0 12px' }}>1. Scan this with your authenticator app, or type the key in by hand.<br />2. Enter the six-digit code the app shows.</p>
          <div style={{ background: '#fff', borderRadius: 8, padding: 10, width: 180, margin: '0 auto 10px' }}><img src={enrol.qr} alt="QR code" style={{ width: '100%', display: 'block' }} /></div>
          <div style={{ color: C.muted, fontSize: 11, textAlign: 'center', wordBreak: 'break-all', marginBottom: 14 }}>Key: <span style={{ color: C.text, fontFamily: 'monospace' }}>{enrol.secret}</span></div>
          <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={input} placeholder="000000"
            onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) submit(enrol.id) }} />
          <div style={{ marginTop: 14 }}><button disabled={busy || code.length !== 6} onClick={() => submit(enrol.id)} style={{ ...btn, opacity: busy || code.length !== 6 ? 0.5 : 1 }}>{busy && <Loader2 size={14} />} Confirm and turn on</button></div>
        </>
      )}

      {error && <p style={{ color: C.red, fontSize: 13, margin: '12px 0 0' }}>{error}</p>}
    </div>
  )
}
