import { useState, useRef, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Check, ChevronRight, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

const MALAYSIAN_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan',
  'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah',
  'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Step 1 state
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [state, setState] = useState('')
  const [postcode, setPostcode] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 2 state
  const [branchName, setBranchName] = useState('Main Branch')
  const [branchAddress, setBranchAddress] = useState('')
  const [branchPhone, setBranchPhone] = useState('')
  const [openTime, setOpenTime] = useState('08:00')
  const [closeTime, setCloseTime] = useState('18:00')

  const workshopName = user?.full_name ?? 'Your Workshop'

  function handleLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function getInitials(name: string) {
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
  }

  async function handleStep1Next() {
    setError('')
    setLoading(true)
    try {
      // Update tenant with address + state
      const { data: userData } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user?.id ?? '')
        .single()

      if (userData?.tenant_id) {
        const { error: updateError } = await supabase
          .from('tenants')
          .update({ address, state, postcode })
          .eq('id', userData.tenant_id)
        if (updateError) throw new Error(updateError.message)
      }
      setStep(2)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleStep2Next() {
    setError('')
    setLoading(true)
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user?.id ?? '')
        .single()

      if (userData?.tenant_id) {
        const { error: branchError } = await supabase
          .from('branches')
          .update({
            name: branchName,
            address: branchAddress,
            phone: branchPhone,
            work_start_time: openTime,
            work_end_time: closeTime,
          })
          .eq('tenant_id', userData.tenant_id)
        if (branchError) throw new Error(branchError.message)
      }
      setStep(3)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.')
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
    padding: '10px 14px',
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

  const fieldStyle: React.CSSProperties = { marginBottom: '16px' }

  // Step indicator
  function StepIndicator() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '32px' }}>
        {[1, 2, 3].map((n, i) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Circle */}
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                transition: 'all 0.2s',
                backgroundColor: n < step ? '#F15A22' : n === step ? '#F15A22' : '#2A2A2A',
                color: n <= step ? '#fff' : '#A0A0A0',
                border: n === step ? '2px solid #F15A22' : n < step ? '2px solid #F15A22' : '2px solid #2A2A2A',
                boxShadow: n === step ? '0 0 0 4px rgba(241,90,34,0.15)' : 'none',
              }}
            >
              {n < step ? <Check size={14} /> : n}
            </div>
            {/* Connector line */}
            {i < 2 && (
              <div
                style={{
                  width: '64px',
                  height: '2px',
                  backgroundColor: n < step ? '#F15A22' : '#2A2A2A',
                  transition: 'background-color 0.3s',
                }}
              />
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0E0E0E',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '600px',
          backgroundColor: '#161616',
          border: '1px solid #2A2A2A',
          borderRadius: '16px',
          padding: '40px',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <p style={{ fontSize: '12px', color: '#A0A0A0', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            Step {step} of 3
          </p>
        </div>

        <StepIndicator />

        {/* ─── STEP 1 ─── */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#F0F0F0', marginBottom: '6px' }}>
              Tell us about your workshop
            </h2>
            <p style={{ fontSize: '13px', color: '#A0A0A0', marginBottom: '28px' }}>
              Personalise your MGOD workspace
            </p>

            {/* Logo upload */}
            <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  backgroundColor: '#1E1E1E',
                  border: '2px dashed #2A2A2A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  overflow: 'hidden',
                  transition: 'border-color 0.15s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onMouseOut={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '20px', fontWeight: 700, color: '#F15A22' }}>
                    {getInitials(workshopName)}
                  </span>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: 'transparent',
                    border: '1px solid #2A2A2A',
                    color: '#A0A0A0',
                    borderRadius: '7px',
                    padding: '7px 14px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = '#F15A22'; e.currentTarget.style.color = '#F15A22' }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = '#2A2A2A'; e.currentTarget.style.color = '#A0A0A0' }}
                >
                  <Upload size={14} />
                  Upload logo
                </button>
                <p style={{ fontSize: '11px', color: '#4B5563', marginTop: '4px' }}>PNG or JPG, max 2MB (optional)</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                style={{ display: 'none' }}
              />
            </div>

            {/* Address */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Workshop Address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="No. 12, Jalan Industri 3, Taman Perindustrian..."
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
            </div>

            {/* State + Postcode */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>
                  <MapPin size={11} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  State
                </label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                >
                  <option value="" style={{ backgroundColor: '#1E1E1E' }}>Select state</option>
                  {MALAYSIAN_STATES.map((s) => (
                    <option key={s} value={s} style={{ backgroundColor: '#1E1E1E' }}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Postcode</label>
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="50000"
                  maxLength={5}
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                />
              </div>
            </div>

            {error && <ErrorBox message={error} />}

            <NextButton onClick={handleStep1Next} loading={loading} />
          </div>
        )}

        {/* ─── STEP 2 ─── */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#F0F0F0', marginBottom: '6px' }}>
              Set up your first branch
            </h2>
            <p style={{ fontSize: '13px', color: '#A0A0A0', marginBottom: '28px' }}>
              You can add more branches later from Settings
            </p>

            <div style={fieldStyle}>
              <label style={labelStyle}>Branch Name</label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="Main Branch"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Branch Address</label>
              <textarea
                value={branchAddress}
                onChange={(e) => setBranchAddress(e.target.value)}
                placeholder="Full address of this branch..."
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Branch Phone</label>
              <input
                type="tel"
                value={branchPhone}
                onChange={(e) => setBranchPhone(e.target.value)}
                placeholder="03-XXXX XXXX"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Operating Hours</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '10px', alignItems: 'center' }}>
                <input
                  type="time"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                />
                <span style={{ color: '#A0A0A0', fontSize: '13px', textAlign: 'center' }}>to</span>
                <input
                  type="time"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F15A22')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
                />
              </div>
            </div>

            {error && <ErrorBox message={error} />}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  border: '1px solid #2A2A2A',
                  color: '#A0A0A0',
                  borderRadius: '8px',
                  padding: '11px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.borderColor = '#A0A0A0')}
                onMouseOut={(e) => (e.currentTarget.style.borderColor = '#2A2A2A')}
              >
                Back
              </button>
              <div style={{ flex: 2 }}>
                <NextButton onClick={handleStep2Next} loading={loading} />
              </div>
            </div>
          </div>
        )}

        {/* ─── STEP 3 ─── */}
        {step === 3 && (
          <div style={{ textAlign: 'center' }}>
            {/* Animated checkmark */}
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: 'rgba(34,197,94,0.12)',
                border: '3px solid #22C55E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                animation: 'popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
              }}
            >
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 18L15 25L28 12"
                  stroke="#22C55E"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ animation: 'drawCheck 0.4s ease 0.2s both', strokeDasharray: 30, strokeDashoffset: 0 }}
                />
              </svg>
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#F0F0F0', marginBottom: '8px' }}>
              Welcome to MGOD, {workshopName}!
            </h2>
            <p style={{ fontSize: '14px', color: '#A0A0A0', marginBottom: '32px' }}>
              Your workspace is ready. Here's how to get started:
            </p>

            {/* Quick-start cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '32px' }}>
              {[
                { label: 'Add your first customer', href: '/customers', emoji: '👤' },
                { label: 'Create a booking', href: '/bookings', emoji: '📅' },
                { label: 'Set up your workshop', href: '/settings', emoji: '⚙️' },
              ].map((card) => (
                <a
                  key={card.href}
                  href={card.href}
                  style={{
                    display: 'block',
                    backgroundColor: '#1E1E1E',
                    border: '1px solid #2A2A2A',
                    borderRadius: '10px',
                    padding: '16px 12px',
                    textDecoration: 'none',
                    transition: 'border-color 0.15s, transform 0.15s',
                    cursor: 'pointer',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = '#F15A22'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = '#2A2A2A'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}
                >
                  <div style={{ fontSize: '22px', marginBottom: '8px' }}>{card.emoji}</div>
                  <p style={{ fontSize: '12px', color: '#A0A0A0', lineHeight: '1.4', margin: 0 }}>{card.label}</p>
                  <ChevronRight size={14} style={{ color: '#F15A22', marginTop: '6px' }} />
                </a>
              ))}
            </div>

            {/* Dashboard button */}
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              style={{
                width: '100%',
                backgroundColor: '#F15A22',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '13px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'opacity 0.15s',
                letterSpacing: '0.3px',
              }}
              onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes popIn {
          from { transform: scale(0.4); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function NextButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        transition: 'opacity 0.15s',
      }}
    >
      {loading ? (
        <>
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
          Saving...
        </>
      ) : (
        <>
          Continue
          <ChevronRight size={16} />
        </>
      )}
    </button>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
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
      {message}
    </div>
  )
}
