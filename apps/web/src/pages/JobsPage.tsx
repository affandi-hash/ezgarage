import { Header } from '@/components/layout/Header'

export function JobsPage() {
  const title = 'JobsPage'.replace('Page', '').replace(/([A-Z])/g, ' $1').trim()
  return (
    <>
      <Header title={title} />
      <div className="p-6">
        <p className="text-gray-500 text-sm">{title} module — coming soon.</p>
      </div>
    </>
  )
}
