import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Mail, Lock, ArrowRight } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

const CSS = `
@keyframes ez-spin    { to { transform: rotate(360deg); } }
@keyframes ez-shimmer { 0%{ left:-100%; } 100%{ left:200%; } }
@keyframes ez-appear  { from{ opacity:0; transform:translateY(18px); } to{ opacity:1; transform:translateY(0); } }
#ez-left-panel { display: flex; }
#ez-mobile-logo { display: none; }
@media (max-width: 1023px) {
  #ez-left-panel { display: none !important; }
  #ez-mobile-logo { display: flex !important; }
}
`
if (typeof document !== 'undefined' && !document.getElementById('ez-login-css')) {
  const s = document.createElement('style')
  s.id = 'ez-login-css'
  s.textContent = CSS
  document.head.appendChild(s)
}

export function LoginPage() {
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember,     setRemember]     = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [btnHover,     setBtnHover]     = useState(false)
  const [mounted,      setMounted]      = useState(false)
  const { signIn } = useAuthStore()
  const navigate   = useNavigate()

  useEffect(() => { setTimeout(() => setMounted(true), 60) }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signIn(email, password)
      if (result?.error) {
        setError(typeof result.error === 'string' ? result.error : 'Login failed. Please try again.')
      } else {
        navigate('/dashboard')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: '#111',
    border: '1px solid #2A2A2A',
    borderRadius: 10,
    color: '#F0F0F0',
    fontSize: 14,
    padding: '13px 14px 13px 42px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color .2s',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', backgroundColor: '#0A0A0A', fontFamily: 'system-ui, sans-serif' }}>

      {/* LEFT PANEL — banner image */}
      <div
        id="ez-left-panel"
        style={{ width: '56%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}
      >
        <img
          src="/login-banner.png"
          alt="EZGarage OS"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', display: 'block' }}
        />
      </div>

      {/* RIGHT PANEL — login form */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '48px 32px',
        backgroundColor: '#0A0A0A',
      }}>

        {/* Mobile logo */}
        <div id="ez-mobile-logo" style={{ marginBottom: 32, alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, background: '#F15A22', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontWeight: 900, fontSize: 16 }}>EZ</span>
          </div>
          <div>
            <div style={{ color: '#F0F0F0', fontWeight: 800, fontSize: 16 }}>EZGarage <span style={{ color: '#F15A22' }}>OS</span></div>
            <div style={{ color: '#6B7280', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 } as React.CSSProperties}>Garage Operating System</div>
          </div>
        </div>

        {/* Form card */}
        <div style={{
          width: '100%', maxWidth: 400,
          backgroundColor: '#111',
          border: '1px solid #1E1E1E',
          borderRadius: 20,
          padding: '40px 36px',
          animation: mounted ? 'ez-appear .6s ease .15s both' : 'none',
        }}>

          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', color: '#F0F0F0' }}>
              Welcome <span style={{ color: '#F15A22' }}>Back!</span>
            </h2>
            <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
              Sign in to your EZGarage workspace
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Email */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ color: '#A0A0A0', fontSize: 13, fontWeight: 500 }}>Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} color="#4B5563" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required autoComplete="email" placeholder="you@garage.my"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = '#F15A22')}
                  onBlur={(e)  => (e.target.style.borderColor = '#2A2A2A')}
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ color: '#A0A0A0', fontSize: 13, fontWeight: 500 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} color="#4B5563" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                  type={showPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required autoComplete="current-password" placeholder="••••••••"
                  style={{ ...inputStyle, padding: '13px 44px 13px 42px' }}
                  onFocus={(e) => (e.target.style.borderColor = '#F15A22')}
                  onBlur={(e)  => (e.target.style.borderColor = '#2A2A2A')}
                />
                <button
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 0 }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Remember + Forgot */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div
                  onClick={() => setRemember(!remember)}
                  style={{
                    width: 18, height: 18, borderRadius: 5, border: `2px solid ${remember ? '#F15A22' : '#2A2A2A'}`,
                    backgroundColor: remember ? '#F15A22' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0, transition: 'all .15s',
                  }}
                >
                  {remember && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ color: '#A0A0A0', fontSize: 13 }}>Remember me</span>
              </label>
              <a href="#" style={{ color: '#F15A22', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
                Forgot Password?
              </a>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#F87171', borderRadius: 10, padding: '11px 14px', fontSize: 13,
              }}>
                {String(error)}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit" disabled={loading}
              onMouseEnter={() => setBtnHover(true)}
              onMouseLeave={() => setBtnHover(false)}
              style={{
                background: btnHover && !loading
                  ? 'linear-gradient(135deg, #D94E1A 0%, #B84018 100%)'
                  : 'linear-gradient(135deg, #F15A22 0%, #D94E1A 100%)',
                color: '#fff', border: 'none', borderRadius: 12,
                padding: '14px 0', fontSize: 15, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                width: '100%', marginTop: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background .15s',
                position: 'relative', overflow: 'hidden',
                boxShadow: btnHover ? '0 6px 24px rgba(241,90,34,0.5)' : '0 4px 16px rgba(241,90,34,0.3)',
              }}
            >
              {!loading && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, width: '40%',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
                  animation: 'ez-shimmer 3s ease-in-out infinite',
                  pointerEvents: 'none',
                }} />
              )}
              {loading ? (
                <>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'ez-spin .7s linear infinite', display: 'inline-block' }} />
                  Signing in...
                </>
              ) : (
                <>Sign In <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#6B7280', marginTop: 24, marginBottom: 0 }}>
            New to EZGarage OS?{' '}
            <a href="/signup" style={{ color: '#F15A22', textDecoration: 'none', fontWeight: 600 }}>
              Sign up free →
            </a>
          </p>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#2A2A2A', marginTop: 20 }}>
          EZGarage OS © 2025. All rights reserved.
        </p>
      </div>
    </div>
  )
}
