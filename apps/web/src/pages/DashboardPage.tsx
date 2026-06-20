import { Header } from '@/components/layout/Header'
import { useAuthStore } from '@/store/authStore'

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)

  return (
    <>
      <Header title="Dashboard" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-800">
            Welcome back, {user?.full_name?.split(' ')[0]}
          </h2>
          <p className="text-sm text-gray-500 mt-1 capitalize">
            {user?.role.replace('_', ' ')}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Active Jobs', value: '—' },
            { label: 'Today\'s Appointments', value: '—' },
            { label: 'Low Stock Items', value: '—' },
            { label: 'Unpaid Invoices', value: '—' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
