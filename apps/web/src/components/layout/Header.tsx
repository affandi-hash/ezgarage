import { useAuthStore } from '@/store/authStore'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const { user, signOut } = useAuthStore()

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <h2 className="text-base font-semibold text-gray-800">{title}</h2>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500">{user?.full_name}</span>
        <button
          onClick={signOut}
          className="text-sm text-gray-500 hover:text-red-500 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
