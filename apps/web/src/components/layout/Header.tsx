import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Menu } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS } from '@/types'
import type { Branch } from '@/types'

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/workshop': 'Workshop Board',
  '/vehicles': 'Vehicles',
  '/customers': 'Customers',
  '/bookings': 'Bookings',
  '/quotations': 'Quotations',
  '/parts': 'Parts',
  '/staff': 'Staff',
  '/attendance': 'Attendance',
  '/reports': 'Reports',
  '/fleet': 'Fleet',
  '/settings': 'Settings',
  '/audit': 'Audit Log',
  '/users': 'Users',
  '/invoices': 'Invoices',
}

interface HeaderProps {
  title?: string
  selectedBranchId?: string | null
  onBranchChange?: (branchId: string | null) => void
  onMenuToggle?: () => void
}

export function Header({ title: titleProp, selectedBranchId, onBranchChange, onMenuToggle }: HeaderProps) {
  const { user, signOut } = useAuthStore()
  const location = useLocation()
  const [branches, setBranches] = useState<Branch[]>([])
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const pageTitle = titleProp ?? ROUTE_LABELS[location.pathname] ?? 'EZGarage OS'
  const pathParts = location.pathname.split('/').filter(Boolean)

  const isSuperAdmin = user?.role === 'super_admin'

  useEffect(() => {
    if (isSuperAdmin) {
      supabase
        .from('branches')
        .select('id, name, address, phone')
        .then(({ data }) => {
          if (data) setBranches(data as Branch[])
        })
    }
  }, [isSuperAdmin])

  const initials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?'

  return (
    <header
      style={{
        backgroundColor: '#161616',
        borderBottom: '1px solid #2A2A2A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        height: 56,
        flexShrink: 0,
      }}
    >
      {/* Left: hamburger (mobile) + title + breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            style={{
              display: 'none', // hidden on desktop via CSS below
              width: 36, height: 36, borderRadius: 8,
              alignItems: 'center', justifyContent: 'center',
              border: '1px solid #2A2A2A', backgroundColor: 'transparent',
              color: '#A0A0A0', cursor: 'pointer', flexShrink: 0,
            } as React.CSSProperties}
            className="mobile-menu-btn"
          >
            <Menu size={18} />
          </button>
        )}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
        <h1
          style={{
            color: '#F0F0F0',
            fontSize: 15,
            fontWeight: 600,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {pageTitle}
        </h1>
        {pathParts.length > 0 && (
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: '#A0A0A0',
              lineHeight: 1.5,
            }}
          >
            <span>Home</span>
            {pathParts.map((part, i) => (
              <span
                key={i}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span>/</span>
                <span
                  style={{
                    color: i === pathParts.length - 1 ? '#F15A22' : '#A0A0A0',
                    textTransform: 'capitalize' as const,
                  }}
                >
                  {ROUTE_LABELS[`/${part}`] ?? part}
                </span>
              </span>
            ))}
          </nav>
        )}
      </div>
      </div>

      {/* Right: branch selector + notifications + user menu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Branch selector (super_admin only) */}
        {isSuperAdmin && onBranchChange && (
          <select
            value={selectedBranchId ?? 'all'}
            onChange={(e) => onBranchChange(e.target.value === 'all' ? null : e.target.value)}
            style={{
              backgroundColor: '#1E1E1E',
              border: '1px solid #2A2A2A',
              color: '#F0F0F0',
              fontSize: 14,
              borderRadius: 8,
              padding: '6px 12px',
              outline: 'none',
              cursor: 'pointer',
              lineHeight: 1.5,
            }}
          >
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        {/* Notification bell */}
        <button
          style={{
            position: 'relative',
            width: 36,
            height: 36,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #2A2A2A',
            backgroundColor: 'transparent',
            color: '#A0A0A0',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E1E1E'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
          }}
        >
          <Bell size={16} />
        </button>

        {/* User menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 8,
              padding: '6px 10px',
              border: '1px solid #2A2A2A',
              backgroundColor: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E1E1E'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                backgroundColor: '#F15A22',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: '#F0F0F0',
                lineHeight: 1.5,
              }}
            >
              {user?.full_name?.split(' ')[0]}
            </span>
            <ChevronDown size={13} style={{ color: '#A0A0A0' }} />
          </button>

          {userMenuOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 4px)',
                width: 224,
                borderRadius: 12,
                paddingTop: 4,
                paddingBottom: 4,
                zIndex: 50,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                backgroundColor: '#1E1E1E',
                border: '1px solid #2A2A2A',
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #2A2A2A',
                }}
              >
                <p
                  style={{
                    color: '#F0F0F0',
                    fontSize: 14,
                    fontWeight: 500,
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {user?.full_name}
                </p>
                <p
                  style={{
                    color: '#A0A0A0',
                    fontSize: 12,
                    margin: '4px 0 0',
                    lineHeight: 1.5,
                  }}
                >
                  {user?.email}
                </p>
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: 6,
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor: '#2A2A2A',
                    color: '#F15A22',
                    lineHeight: 1.5,
                  }}
                >
                  {user ? ROLE_LABELS[user.role] : ''}
                </span>
              </div>
              <button
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  fontSize: 14,
                  color: '#A0A0A0',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  lineHeight: 1.5,
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#F87171'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = '#A0A0A0'
                }}
                onClick={() => {
                  setUserMenuOpen(false)
                  signOut()
                }}
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close user menu */}
      {userMenuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
          }}
          onClick={() => setUserMenuOpen(false)}
        />
      )}
    </header>
  )
}
