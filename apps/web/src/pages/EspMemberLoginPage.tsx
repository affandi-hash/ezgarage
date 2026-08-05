import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Wrench, Loader2, AlertCircle, CheckCircle, Lock, LogOut, MessageCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

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
  red: '#EF4444',
}

interface TenantConfig {
  name: string
  logo_url: string | null
  whatsapp_number: string | null
}

interface Membership {
  membership_number: string
  status: string
  valid_until: string | null
  community_name: string
}

interface Session {
  phone: string
  password: string
  fullName: string
  memberships: Membership[]
}

const sessionKey = 'esp_member_login'

function inputStyle(): React.CSSProperties {
  return { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPrimary, padding: '10px 14px', fontSize: 14, boxSizing: 'border-box', outline: 'none' }
}
function labelStyle(): React.CSSProperties {
  return { display: 'block', fontSize: 11, color: C.textSecondary, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }
}

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
    const s: Session = { phone, password, fullName: data.full_name, memberships: data.memberships }
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
    setSession(null)
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
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
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

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 24px 60px' }}>
        {session ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Hi, {session.fullName}</div>
                <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>Your ESP membership{session.memberships.length > 1 ? 's' : ''}</div>
              </div>
              <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSecondary, fontSize: 12, padding: '7px 12px', cursor: 'pointer' }}>
                <LogOut size={13} /> Log Out
              </button>
            </div>

            {session.memberships.length === 0 ? (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
                No ESP memberships found on this account.
              </div>
            ) : (
              session.memberships.map(m => (
                <div key={m.membership_number} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, color: C.textSecondary }}>{m.community_name}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>#{m.membership_number}</div>
                    </div>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5, background: m.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)', color: m.status === 'active' ? C.green : '#F59E0B' }}>
                      {m.status === 'active' && <CheckCircle size={11} />}
                      {m.status.replace('_', ' ')}
                    </span>
                  </div>
                  {m.valid_until && (
                    <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 10 }}>Valid until {m.valid_until}</div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : mode === 'login' ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
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
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
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
    </div>
  )
}
