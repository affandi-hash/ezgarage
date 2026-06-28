import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import type { Role } from '@/types'

interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles?: Role[]
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#0E0E0E',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '2px solid #2A2A2A',
              borderTopColor: '#F15A22',
              animation: 'spin 0.75s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <span style={{ color: '#A0A0A0', fontSize: '0.875rem' }}>Loading...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.must_change_password) {
    return <Navigate to="/change-password" replace />
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#0E0E0E',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '40px 32px',
            borderRadius: '16px',
            border: '1px solid #2A2A2A',
            backgroundColor: '#161616',
            maxWidth: '360px',
            width: '100%',
            margin: '0 16px',
          }}
        >
          <div style={{ fontSize: '3rem', fontWeight: 700, marginBottom: '8px', color: '#F15A22' }}>
            403
          </div>
          <div style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '8px', color: '#F0F0F0' }}>
            Access Denied
          </div>
          <p style={{ fontSize: '0.875rem', marginBottom: '24px', color: '#A0A0A0', lineHeight: '1.5' }}>
            You don't have permission to view this page. Contact your administrator if you believe
            this is an error.
          </p>
          <button
            onClick={() => window.history.back()}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 500,
              backgroundColor: '#F15A22',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              opacity: 1,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
