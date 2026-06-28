import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: newPassword })
      if (authError) {
        setError(authError.message)
        setLoading(false)
        return
      }

      // Clear the must_change_password flag
      await supabase.from('users').update({ must_change_password: false }).eq('id', user!.id)

      // Update local state so the guard doesn't redirect again
      if (user) setUser({ ...user, must_change_password: false })

      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const strength = newPassword.length === 0 ? 0 : newPassword.length < 8 ? 1 : newPassword.length < 12 ? 2 : 3
  const strengthLabel = ['', 'Weak', 'Good', 'Strong'][strength]
  const strengthColor = ['', '#EF4444', '#F59E0B', '#22C55E'][strength]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0E0E0E' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#161616',
          border: '1px solid #2A2A2A',
          borderRadius: 16,
          padding: '40px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'rgba(241,90,34,0.15)',
              border: '1px solid rgba(241,90,34,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <KeyRound size={26} color="#F15A22" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#F0F0F0', marginBottom: 4 }}>Set Your Password</div>
            <div style={{ fontSize: 13, color: '#A0A0A0', lineHeight: 1.5 }}>
              This is your first login. Please set a new password before continuing.
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* New password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#A0A0A0' }}>New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
                placeholder="Min. 8 characters"
                style={{
                  width: '100%',
                  background: '#0E0E0E',
                  border: '1px solid #2A2A2A',
                  borderRadius: 8,
                  padding: '13px 44px 13px 14px',
                  color: '#F0F0F0',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.target.style.borderColor = '#2A2A2A')}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: 0 }}
              >
                {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {/* Strength bar */}
            {newPassword.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#2A2A2A', overflow: 'hidden' }}>
                  <div style={{ width: `${(strength / 3) * 100}%`, height: '100%', background: strengthColor, borderRadius: 2, transition: 'width 0.2s, background 0.2s' }} />
                </div>
                <span style={{ fontSize: 11, color: strengthColor, fontWeight: 600, minWidth: 40 }}>{strengthLabel}</span>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#A0A0A0' }}>Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder="Repeat new password"
                style={{
                  width: '100%',
                  background: '#0E0E0E',
                  border: `1px solid ${confirm && confirm !== newPassword ? '#EF4444' : '#2A2A2A'}`,
                  borderRadius: 8,
                  padding: '13px 44px 13px 14px',
                  color: '#F0F0F0',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#F15A22')}
                onBlur={(e) => (e.target.style.borderColor = confirm && confirm !== newPassword ? '#EF4444' : '#2A2A2A')}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: 0 }}
              >
                {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {confirm && confirm !== newPassword && (
              <span style={{ fontSize: 11, color: '#EF4444' }}>Passwords do not match</span>
            )}
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#EF4444' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: '#F15A22',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '12px',
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            <ShieldCheck size={16} />
            {loading ? 'Saving...' : 'Set Password & Continue'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#4B5563' }}>
          EZGarage OS · Your password is encrypted and never stored in plain text.
        </div>
      </div>
    </div>
  )
}
