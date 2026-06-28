import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Building2, User, Mail, Lock, Phone, MapPin, Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export function SignUpPage() {
  const [workshopName, setWorkshopName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!workshopName.trim()) { setError('Workshop name is required.'); return }
    if (!fullName.trim()) { setError('Full name is required.'); return }
    if (!email.trim()) { setError('Email address is required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }

    setLoading(true)

    try {
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })

      if (authError) throw new Error(authError.message)
      if (!authData.user) throw new Error('Sign up failed. Please try again.')

      const authUser = authData.user

      // 2. Build slug from workshop name
      const slug = workshopName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')

      // 3. Call SECURITY DEFINER RPC — bypasses RLS safely for signup
      const { error: rpcError } = await supabase.rpc('create_tenant_signup', {
        p_tenant_name:  workshopName,
        p_tenant_slug:  slug,
        p_tenant_email: email,
        p_tenant_phone: phone,
        p_tenant_city:  city,
        p_user_id:      authUser.id,
        p_user_name:    fullName,
        p_user_email:   email,
        p_branch_name:  workshopName,
      })

      if (rpcError) throw new Error(rpcError.message)

      navigate('/onboarding')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    backgroundColor: '#1E1E1E',
    border: '1px solid #2A2A2A',
    color: '#F0F0F0',
    borderRadius: '8px',
    padding: '13px 16px',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '6px',
    color: '#A0A0A0',
  }

  const fieldStyle: React.CSSProperties = { marginBottom: '20px' }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', backgroundColor: '#0E0E0E' }}>
      {/* Left panel */}
      <div
        id="signup-left-panel"
        style={{
          width: '55%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 72px',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0E0E0E 0%, #1a1008 50%, #0E0E0E 100%)',
          borderRight: '1px solid #2A2A2A',
        }}
      >
        {/* Gear pattern background */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.05, pointerEvents: 'none', overflow: 'hidden' }}>
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="gear-pattern-signup" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
                <circle cx="40" cy="40" r="12" fill="none" stroke="#F15A22" strokeWidth="2" />
                <circle cx="40" cy="40" r="5" fill="#F15A22" />
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
                  const rad = (deg * Math.PI) / 180
                  const x1 = 40 + 14 * Math.cos(rad)
                  const y1 = 40 + 14 * Math.sin(rad)
                  const x2 = 40 + 20 * Math.cos(rad)
                  const y2 = 40 + 20 * Math.sin(rad)
                  return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#F15A22" strokeWidth="4" strokeLinecap="round" />
                })}
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#gear-pattern-signup)" />
          </svg>
        </div>

        {/* Orange glow */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '384px',
            height: '384px',
            borderRadius: '9999px',
            background: 'radial-gradient(circle, rgba(241,90,34,0.15) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Logo + centered brand block */}
        <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '28px', width: '100%', maxWidth: '420px' }}>

          {/* EZGarage OS logo mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: 56, height: 56, background: '#F15A22', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 24px rgba(241,90,34,0.4)' }}>
              <span style={{ color: '#fff', fontWeight: 900, fontSize: 24, fontFamily: 'system-ui', letterSpacing: -1 }}>EZ</span>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: '#F0F0F0', fontWeight: 900, fontSize: 22, fontFamily: 'system-ui', letterSpacing: 1 }}>
                EZGarage <span style={{ color: '#F15A22' }}>OS</span>
              </div>
              <div style={{ color: '#6B7280', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginTop: 2 }}>
                Garage Operating System
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <div style={{ flex: 1, height: 1, background: '#2A2A2A' }} />
            <span style={{ color: '#4B5563', fontSize: 11, letterSpacing: 2 }}>FOR WORKSHOPS</span>
            <div style={{ flex: 1, height: 1, background: '#2A2A2A' }} />
          </div>

          {/* Tagline */}
          <div>
            <h2 style={{ fontSize: '28px', fontWeight: 700, color: '#F0F0F0', marginBottom: '8px', lineHeight: 1.3 }}>
              Power your garage<br />with EZGarage OS
            </h2>
            <p style={{ fontSize: '14px', color: '#A0A0A0' }}>
              The all-in-one garage operating system for modern workshops
            </p>
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
            {['Multi-branch ready', 'WhatsApp integrated', '14-day free trial', 'SaaS solution'].map((f) => (
              <span key={f} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '9999px', backgroundColor: 'rgba(241,90,34,0.1)', color: '#F15A22', border: '1px solid rgba(241,90,34,0.25)' }}>
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: 'absolute', bottom: 24, zIndex: 10 }}>
          <p style={{ fontSize: '12px', color: '#4B5563' }}>
            EZGarage OS &copy; 2025. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right panel: form */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
          overflowY: 'auto',
        }}
      >
        {/* Mobile logo */}
        <div id="signup-mobile-logo" style={{ marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: 40, height: 40, background: '#F15A22', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontWeight: 900, fontSize: 17, fontFamily: 'system-ui', letterSpacing: -1 }}>EZ</span>
          </div>
          <div>
            <div style={{ color: '#F0F0F0', fontWeight: 800, fontSize: 16, fontFamily: 'system-ui' }}>EZGarage <span style={{ color: '#F15A22' }}>OS</span></div>
            <div style={{ color: '#6B7280', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>Garage Operating System</div>
          </div>
        </div>

        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#F0F0F0', marginBottom: '4px' }}>
              Create your account
            </h2>
            <p style={{ fontSize: '13px', color: '#A0A0A0' }}>
              Start your 14-day free trial — no credit card needed
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Workshop Name */}
            <div style={fieldStyle}>
              <label style={labelStyle}>
                <Building2 size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                Workshop Name
              </label>
              <input
                type="text"
                value={workshopName}
                onChange={(e) => setWorkshopName(e.target.value)}
                required
                placeholder="Ahmad Brothers Workshop"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
            </div>

            {/* Full Name */}
            <div style={fieldStyle}>
              <label style={labelStyle}>
                <User size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                Your Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Ahmad bin Abdullah"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
            </div>

            {/* Email */}
            <div style={fieldStyle}>
              <label style={labelStyle}>
                <Mail size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@workshop.my"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
            </div>

            {/* Password */}
            <div style={fieldStyle}>
              <label style={labelStyle}>
                <Lock size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Min. 8 characters"
                  style={{ ...inputStyle, paddingRight: '40px' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#A0A0A0',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Phone + City row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div>
                <label style={labelStyle}>
                  <Phone size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01X-XXXXXXX"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                />
              </div>
              <div>
                <label style={labelStyle}>
                  <MapPin size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Kuala Lumpur"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  backgroundColor: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: '#EF4444',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                backgroundColor: '#F15A22',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '11px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: '#fff',
                      animation: 'spin 0.75s linear infinite',
                      display: 'inline-block',
                    }}
                  />
                  Creating account...
                </span>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: '13px', color: '#A0A0A0', marginTop: '20px' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: '#F15A22', textDecoration: 'none', fontWeight: 500 }}>
              Sign In
            </Link>
          </p>

          <p style={{ textAlign: 'center', fontSize: '12px', color: '#4B5563', marginTop: '24px' }}>
            EZGarage OS &copy; 2025
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 1023px) {
          #signup-left-panel { display: none !important; }
          #signup-mobile-logo { display: flex !important; }
        }
        @media (min-width: 1024px) {
          #signup-mobile-logo { display: none !important; }
        }
      `}</style>
    </div>
  )
}
