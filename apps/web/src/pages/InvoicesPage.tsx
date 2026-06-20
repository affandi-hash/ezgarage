import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useAuthStore } from '@/store/authStore'
import { useInvoicesStore } from '@/hooks/useInvoices'
import { InvoiceDetail } from '@/components/invoices/InvoiceDetail'
import { CreateInvoiceModal } from '@/components/invoices/CreateInvoiceModal'
import type { PaymentStatus } from '@/types/invoice'

type TabFilter = 'all' | PaymentStatus

const TABS: { id: TabFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unpaid', label: 'Unpaid' },
  { id: 'partial', label: 'Partial' },
  { id: 'paid', label: 'Paid' },
]

const STATUS_STYLES: Record<PaymentStatus, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
}

function formatMYR(amount: number) {
  return `RM ${amount.toFixed(2)}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function InvoicesPage() {
  const user = useAuthStore((s) => s.user)
  const { invoices, loading, fetchInvoices } = useInvoicesStore()

  const [tab, setTab] = useState<TabFilter>('all')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const canCreate = user?.role && ['ceo', 'branch_manager', 'operation_manager'].includes(user.role)

  useEffect(() => {
    if (user?.branch_id) {
      fetchInvoices(user.branch_id, tab !== 'all' ? tab : undefined)
    }
  }, [user?.branch_id, tab])

  const filtered = tab === 'all' ? invoices : invoices.filter((inv) => inv.payment_status === tab)

  if (selectedInvoiceId) {
    return (
      <>
        <Header title="Invoices" />
        <InvoiceDetail invoiceId={selectedInvoiceId} onBack={() => setSelectedInvoiceId(null)} />
      </>
    )
  }

  return (
    <>
      <Header title="Invoices" />
      <div className="p-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
            >
              + New Invoice
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">No invoices found.</p>
              {canCreate && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 text-orange-500 hover:text-orange-700 text-sm font-medium"
                >
                  Create your first invoice
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Invoice No.</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Customer</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Vehicle</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Job Ref.</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedInvoiceId(inv.id)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-orange-600">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-800">{inv.customer?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {inv.job_order?.vehicle?.plate_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {inv.job_order?.job_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatMYR(inv.total_amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[inv.payment_status]}`}>
                          {inv.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(inv.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && (
          <p className="text-xs text-gray-400 mt-3">
            {filtered.length} invoice{filtered.length !== 1 ? 's' : ''} shown
          </p>
        )}
      </div>

      {showCreate && (
        <CreateInvoiceModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            if (user?.branch_id) fetchInvoices(user.branch_id, tab !== 'all' ? tab : undefined)
          }}
        />
      )}
    </>
  )
}
