import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { AddItemModal } from '@/components/inventory/AddItemModal'
import { TransferRequestModal } from '@/components/inventory/TransferRequestModal'
import { useInventoryStore } from '@/hooks/useInventory'
import { useAuthStore } from '@/store/authStore'
import type { ItemCategory, TransferRequest } from '@/types/inventory'

type Tab = 'stock' | 'transfers'

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  engine: 'Engine',
  brakes: 'Brakes',
  electrical: 'Electrical',
  body: 'Body',
  tyres: 'Tyres',
  fluids: 'Fluids',
  filters: 'Filters',
  suspension: 'Suspension',
  accessories: 'Accessories',
  other: 'Other',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved_sender: 'bg-blue-100 text-blue-700',
  approved_both: 'bg-indigo-100 text-indigo-700',
  in_transit: 'bg-purple-100 text-purple-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved_sender: 'Approved (Sender)',
  approved_both: 'Approved (Both)',
  in_transit: 'In Transit',
  received: 'Received',
  cancelled: 'Cancelled',
}

export function InventoryPage() {
  const user = useAuthStore((s) => s.user)
  const {
    items,
    transferRequests,
    loading,
    fetchInventory,
    fetchTransferRequests,
    getLowStockItems,
    approveTransfer,
    rejectTransfer,
    confirmReceived,
  } = useInventoryStore()

  const [tab, setTab] = useState<Tab>('stock')
  const [categoryFilter, setCategoryFilter] = useState<ItemCategory | ''>('')
  const [showAddItem, setShowAddItem] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const branchId = user?.branch_id ?? ''
  const isManager = user?.role === 'branch_manager' || user?.role === 'ceo' || user?.role === 'operation_manager'

  useEffect(() => {
    if (!branchId) return
    fetchInventory(branchId)
    fetchTransferRequests(branchId)
  }, [branchId, fetchInventory, fetchTransferRequests])

  const lowStockItems = getLowStockItems(branchId)

  const filteredItems = categoryFilter
    ? items.filter((i) => i.category === categoryFilter)
    : items

  const handleApprove = async (transfer: TransferRequest) => {
    setActionLoading(transfer.id)
    const isFromBranch = transfer.from_branch_id === branchId
    const role = isFromBranch ? 'sender' : 'receiver'

    let result: { error: string | null }
    if (transfer.status === 'in_transit' && !isFromBranch) {
      result = await confirmReceived(transfer.id)
    } else {
      result = await approveTransfer(transfer.id, role)
    }

    if (result.error) alert(result.error)
    setActionLoading(null)
  }

  const handleReject = async (id: string) => {
    if (!confirm('Cancel this transfer request?')) return
    setActionLoading(id)
    const { error } = await rejectTransfer(id)
    if (error) alert(error)
    setActionLoading(null)
  }

  const getApproveLabel = (transfer: TransferRequest): string | null => {
    const isFrom = transfer.from_branch_id === branchId
    const isTo = transfer.to_branch_id === branchId
    if (transfer.status === 'pending' && isFrom) return 'Approve (Send)'
    if (transfer.status === 'approved_sender' && isTo) return 'Approve (Receive)'
    if (transfer.status === 'approved_both' && isFrom) return 'Mark In Transit'
    if (transfer.status === 'in_transit' && isTo) return 'Confirm Received'
    return null
  }

  return (
    <>
      <Header title="Inventory" />
      <div className="p-6 space-y-4">

        {/* Low stock alert */}
        {lowStockItems.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-red-500 text-lg leading-none mt-0.5">⚠</span>
            <div>
              <p className="text-sm font-semibold text-red-700">Low Stock Alert</p>
              <p className="text-xs text-red-600 mt-0.5">
                {lowStockItems.length} item{lowStockItems.length > 1 ? 's' : ''} below threshold:{' '}
                {lowStockItems.map((i) => i.name).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {(['stock', 'transfers'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'stock' ? 'Stock' : 'Transfers'}
                {t === 'transfers' && transferRequests.filter((r) => r.status === 'pending').length > 0 && (
                  <span className="ml-1.5 bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {transferRequests.filter((r) => r.status === 'pending').length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {tab === 'stock' && (
              <button
                onClick={() => setShowTransfer(true)}
                className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                Transfer Stock
              </button>
            )}
            {tab === 'stock' && (
              <button
                onClick={() => setShowAddItem(true)}
                className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium"
              >
                + Add Item
              </button>
            )}
          </div>
        </div>

        {/* Stock Tab */}
        {tab === 'stock' && (
          <>
            {/* Category filter */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setCategoryFilter('')}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  categoryFilter === '' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                All
              </button>
              {(Object.keys(CATEGORY_LABELS) as ItemCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    categoryFilter === cat ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            {/* Stock table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Threshold</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cost (RM)</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Price (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-gray-400 text-sm">Loading...</td>
                      </tr>
                    )}
                    {!loading && filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-gray-400 text-sm">No items found.</td>
                      </tr>
                    )}
                    {filteredItems.map((item) => {
                      const isLow = item.quantity < item.low_stock_threshold
                      return (
                        <tr
                          key={item.id}
                          className={`border-b border-gray-50 last:border-0 ${isLow ? 'bg-red-50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">{item.name}</p>
                            {item.supplier && (
                              <p className="text-xs text-gray-400">{item.supplier.name}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.sku}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                              {CATEGORY_LABELS[item.category] ?? item.category}
                            </span>
                          </td>
                          <td className={`px-4 py-3 text-right font-semibold ${isLow ? 'text-red-600' : 'text-gray-800'}`}>
                            {item.quantity}
                            <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}</span>
                            {isLow && <span className="ml-1 text-xs text-red-500">⚠</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500">{item.low_stock_threshold}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{item.unit_cost.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{item.selling_price.toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Transfers Tab */}
        {tab === 'transfers' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">From</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">To</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                    {isManager && (
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-400 text-sm">Loading...</td>
                    </tr>
                  )}
                  {!loading && transferRequests.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-400 text-sm">No transfer requests.</td>
                    </tr>
                  )}
                  {transferRequests.map((t) => {
                    const approveLabel = getApproveLabel(t)
                    const canAct = isManager && approveLabel !== null && t.status !== 'received' && t.status !== 'cancelled'
                    const canCancel = isManager && t.status !== 'received' && t.status !== 'cancelled'

                    return (
                      <tr key={t.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{t.item?.name ?? '—'}</p>
                          <p className="text-xs text-gray-400 font-mono">{t.item?.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{t.from_branch?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{t.to_branch?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800">{t.quantity}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_LABELS[t.status] ?? t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{t.notes ?? '—'}</td>
                        {isManager && (
                          <td className="px-4 py-3">
                            <div className="flex gap-2 justify-end">
                              {canAct && (
                                <button
                                  disabled={actionLoading === t.id}
                                  onClick={() => handleApprove(t)}
                                  className="px-3 py-1 text-xs bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                                >
                                  {actionLoading === t.id ? '...' : approveLabel}
                                </button>
                              )}
                              {canCancel && (
                                <button
                                  disabled={actionLoading === t.id}
                                  onClick={() => handleReject(t.id)}
                                  className="px-3 py-1 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showAddItem && (
        <AddItemModal
          onClose={() => setShowAddItem(false)}
          onSuccess={() => branchId && fetchInventory(branchId)}
        />
      )}
      {showTransfer && (
        <TransferRequestModal
          onClose={() => setShowTransfer(false)}
          onSuccess={() => branchId && fetchTransferRequests(branchId)}
        />
      )}
    </>
  )
}
