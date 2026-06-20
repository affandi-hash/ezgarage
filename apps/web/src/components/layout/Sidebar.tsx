import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', roles: ['ceo', 'branch_manager', 'operation_manager', 'hr_manager', 'staff'] },
  { to: '/jobs', label: 'Job Orders', roles: ['ceo', 'branch_manager', 'operation_manager', 'staff'] },
  { to: '/customers', label: 'Customers', roles: ['ceo', 'branch_manager', 'operation_manager'] },
  { to: '/inventory', label: 'Inventory', roles: ['ceo', 'branch_manager', 'operation_manager'] },
  { to: '/appointments', label: 'Appointments', roles: ['ceo', 'branch_manager', 'operation_manager'] },
  { to: '/invoices', label: 'Invoices', roles: ['ceo', 'branch_manager', 'operation_manager'] },
  { to: '/staff', label: 'Staff', roles: ['ceo', 'branch_manager', 'hr_manager'] },
  { to: '/reports', label: 'Reports', roles: ['ceo'] },
]

export function Sidebar() {
  const user = useAuthStore((s) => s.user)
  if (!user) return null

  const visible = navItems.filter((item) => item.roles.includes(user.role))

  return (
    <aside className="w-60 bg-gray-900 text-white flex flex-col min-h-screen">
      <div className="px-6 py-5 border-b border-gray-700">
        <h1 className="text-lg font-bold text-white">Motoverse</h1>
        <p className="text-xs text-gray-400 mt-0.5 capitalize">{user.role.replace('_', ' ')}</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-gray-700">
        <p className="text-xs text-gray-400 truncate">{user.full_name}</p>
      </div>
    </aside>
  )
}
