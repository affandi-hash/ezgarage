import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Kanban,
  CalendarCheck,
  Car,
  Users,
  Package,
  FileText,
  BarChart3,
  HardHat,
  Clock,
  Truck,
  UserCog,
  Settings,
  FileSearch,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Wrench,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS } from '@/types'
import type { Role } from '@/types'

interface NavItem {
  to: string
  label: string
  icon: React.ElementType
  roles: Role[]
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin', 'ops_manager', 'front_desk', 'foreman', 'mechanic', 'parts_admin', 'finance', 'fleet_admin'] },
      { to: '/bookings', label: 'Bookings', icon: CalendarCheck, roles: ['super_admin', 'ops_manager', 'front_desk', 'foreman'] },
      { to: '/workshop', label: 'Workshop Board', icon: Kanban, roles: ['super_admin', 'ops_manager', 'front_desk', 'foreman', 'mechanic'] },
    ],
  },
  {
    label: 'Customers & Vehicles',
    items: [
      { to: '/customers', label: 'Customers', icon: Users, roles: ['super_admin', 'ops_manager', 'front_desk', 'foreman'] },
      { to: '/vehicles', label: 'Vehicles', icon: Car, roles: ['super_admin', 'ops_manager', 'front_desk', 'foreman'] },
    ],
  },
  {
    label: 'Workshop',
    items: [
      { to: '/quotations', label: 'Quotations', icon: ClipboardList, roles: ['super_admin', 'ops_manager', 'front_desk', 'foreman'] },
      { to: '/parts', label: 'Parts', icon: Package, roles: ['super_admin', 'ops_manager', 'parts_admin', 'foreman', 'mechanic'] },
      { to: '/invoices?tab=labour', label: 'Labour Charges', icon: Wrench, roles: ['super_admin', 'ops_manager'] },
      { to: '/invoices', label: 'Invoices', icon: FileText, roles: ['super_admin', 'ops_manager', 'front_desk', 'finance', 'foreman'] },
      { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['super_admin', 'ops_manager', 'finance', 'foreman'] },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/staff', label: 'Staff', icon: HardHat, roles: ['super_admin', 'ops_manager'] },
      { to: '/attendance', label: 'Attendance', icon: Clock, roles: ['super_admin', 'ops_manager', 'foreman', 'mechanic', 'front_desk', 'parts_admin', 'finance', 'fleet_admin', 'hr_manager'] },
      { to: '/fleet', label: 'Fleet', icon: Truck, roles: ['super_admin', 'ops_manager', 'fleet_admin', 'driver'] },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/users', label: 'Users', icon: UserCog, roles: ['super_admin', 'ops_manager'] },
      { to: '/settings', label: 'Settings', icon: Settings, roles: ['super_admin', 'ops_manager'] },
      { to: '/audit', label: 'Audit Log', icon: FileSearch, roles: ['super_admin', 'ops_manager'] },
    ],
  },
]

function EZGarageLogo({ collapsed, branchLogoUrl }: { collapsed: boolean; branchLogoUrl?: string | null }) {
  const logoSrc = branchLogoUrl || '/logo.png'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: collapsed ? '12px 8px' : '16px 16px 12px', borderBottom: '1px solid #2A2A2A' }}>
      <img src={logoSrc} alt="Logo" style={{ width: collapsed ? 40 : 160, height: collapsed ? 40 : 56, objectFit: 'contain' }} />
    </div>
  )
}

export function Sidebar() {
  const { user, signOut } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)
  const [logoutHover, setLogoutHover] = useState(false)
  const [branchLogoUrl, setBranchLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.branch_id) return
    supabase.from('branches').select('logo_url').eq('id', user.branch_id).single()
      .then(({ data }) => { if (data?.logo_url) setBranchLogoUrl(data.logo_url) })
  }, [user?.branch_id])

  if (!user) return null

  const initials = user.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()

  const visibleGroups = NAV_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => item.roles.includes(user.role)) }))
    .filter(group => group.items.length > 0)

  return (
    <aside style={{
      width: collapsed ? 64 : 240,
      minWidth: collapsed ? 64 : 240,
      backgroundColor: '#161616',
      borderRight: '1px solid #2A2A2A',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      position: 'relative',
      transition: 'width 0.2s ease',
    }}>
      {/* Logo */}
      <EZGarageLogo collapsed={collapsed} branchLogoUrl={branchLogoUrl} />

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          position: 'absolute', right: -12, top: 56, zIndex: 10,
          width: 24, height: 24, borderRadius: '50%',
          backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A',
          color: '#A0A0A0', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', padding: 0,
        }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>


      {/* Nav groups */}
      <nav style={{ flex: 1, padding: '8px', overflowY: 'auto' }}>
        {visibleGroups.map((group, gi) => (
          <div key={group.label} style={{ marginBottom: gi < visibleGroups.length - 1 ? 8 : 0 }}>
            {/* Section label */}
            {!collapsed ? (
              <div style={{ padding: '10px 10px 5px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#4A4A4A', userSelect: 'none' as const }}>
                {group.label}
              </div>
            ) : gi > 0 ? (
              <div style={{ height: 1, background: '#2A2A2A', margin: '6px 8px' }} />
            ) : null}

            {/* Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: collapsed ? 0 : 10,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      padding: collapsed ? '10px 0' : '9px 10px 9px 10px',
                      borderRadius: 8,
                      textDecoration: 'none',
                      fontSize: 13,
                      fontWeight: 500,
                      color: isActive ? '#F15A22' : '#A0A0A0',
                      backgroundColor: isActive ? 'rgba(241,90,34,0.1)' : 'transparent',
                      borderLeft: collapsed ? 'none' : `3px solid ${isActive ? '#F15A22' : 'transparent'}`,
                      transition: 'background 0.15s, color 0.15s',
                    })}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={16} color={isActive ? '#F15A22' : '#6A6A6A'} style={{ flexShrink: 0 }} />
                        {!collapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Logout */}
      <div style={{ padding: 8, borderTop: '1px solid #2A2A2A' }}>
        <button
          onClick={signOut}
          title={collapsed ? 'Sign Out' : undefined}
          onMouseEnter={() => setLogoutHover(true)}
          onMouseLeave={() => setLogoutHover(false)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10, justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px 0' : '9px 12px',
            borderRadius: 8, border: 'none', cursor: 'pointer',
            backgroundColor: logoutHover ? 'rgba(239,68,68,0.08)' : 'transparent',
            color: logoutHover ? '#EF4444' : '#A0A0A0',
            fontSize: 13, fontWeight: 500,
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          <LogOut size={16} color={logoutHover ? '#EF4444' : '#6A6A6A'} style={{ flexShrink: 0 }} />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  )
}
