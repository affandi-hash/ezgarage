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

// Status badge styles: [background, color]
const STATUS_BADGE: Record<string, [string, string]> = {
  pending:         ['rgba(234,179,8,0.15)',  '#FACC15'],
  approved_sender: ['rgba(59,130,246,0.15)', '#60A5FA'],
  approved_both:   ['rgba(99,102,241,0.15)', '#818CF8'],
  in_transit:      ['rgba(168,85,247,0.15)', '#C084FC'],
  received:        ['rgba(34,197,94,0.15)',  '#4ADE80'],
  cancelled:       ['rgba(239,68,68,0.15)',  '#F87171'],
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved_sender: 'Approved (Sender)',
  approved_both: 'Approved (Both)',
  in_transit: 'In Transit',
  received: 'Received',
  cancelled: 'Cancelled',
}

// ─── Design tokens ───────────────────────────────────────────────────────────
const C = {
  bg:      '#0E0E0E',
  surface: '#161616',
  border:  '#2A2A2A',
  text:    '#F0F0F0',
  muted:   '#A0A0A0',
  orange:  '#F15A22',
  orangeHover: '#D94E1A',
  green:   '#22C55E',
  greenHover: '#16A34A',
  red:     '#EF4444',
  redHover: '#DC2626',
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

  // Hover states
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [hoveredCat, setHoveredCat] = useState<string | null>(null)
  const [hoveredTransferBtn, setHoveredTransferBtn] = useState(false)
  const [hoveredAddBtn, setHoveredAddBtn] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [hoveredApprove, setHoveredApprove] = useState<string | null>(null)
  const [hoveredCancel, setHoveredCancel] = useState<string | null>(null)

  const branchId = user?.branch_id ?? ''
  const isManager =
    (user?.role as string) === 'branch_manager' ||
    (user?.role as string) === 'ceo' ||
    (user?.role as string) === 'operation_manager' ||
    user?.role === 'ops_manager' ||
    user?.role === 'super_admin'

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

  // ─── Shared style objects ───────────────────────────────────────────────────
  const thStyles = {
    textAlign: 'left' as const,
    padding: '12px 16px',
    fontSize: '11px',
    fontWeight: 600,
    color: C.muted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    borderBottom: `1px solid ${C.border}`,
    background: C.surface,
  }

  const thRightStyles = { ...thStyles, textAlign: 'right' as const }

  const tdStyles = {
    padding: '12px 16px',
    borderBottom: `1px solid ${C.border}`,
    color: C.text,
    fontSize: '14px',
  }

  const tdRightStyles = { ...tdStyles, textAlign: 'right' as const }

  return (
    <>
      <Header title="Inventory" />

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', background: C.bg, minHeight: '100%' }}>

        {/* Low stock alert */}
        {lowStockItems.length > 0 && (
          <div style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '12px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
          }}>
            <span style={{ color: '#F87171', fontSize: '18px', lineHeight: 1, marginTop: '2px' }}>⚠</span>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#F87171', margin: 0 }}>Low Stock Alert</p>
              <p style={{ fontSize: '12px', color: '#FCA5A5', marginTop: '2px', marginBottom: 0 }}>
                {lowStockItems.length} item{lowStockItems.length > 1 ? 's' : ''} below threshold:{' '}
                {lowStockItems.map((i) => i.name).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* Tabs + action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Tab switcher */}
          <div style={{
            display: 'flex',
            gap: '4px',
            background: C.surface,
            borderRadius: '12px',
            padding: '4px',
            border: `1px solid ${C.border}`,
          }}>
            {(['stock', 'transfers'] as Tab[]).map((t) => {
              const isActive = tab === t
              const isHovered = hoveredTab === t
              const pendingCount = transferRequests.filter((r) => r.status === 'pending').length
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  onMouseEnter={() => setHoveredTab(t)}
                  onMouseLeave={() => setHoveredTab(null)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'background 0.15s, color 0.15s',
                    background: isActive ? '#232323' : isHovered ? '#1C1C1C' : 'transparent',
                    color: isActive ? C.text : isHovered ? '#C0C0C0' : C.muted,
                    boxShadow: isActive ? `0 1px 3px rgba(0,0,0,0.4)` : 'none',
                  }}
                >
                  {t === 'stock' ? 'Stock' : 'Transfers'}
                  {t === 'transfers' && pendingCount > 0 && (
                    <span style={{
                      background: C.orange,
                      color: '#fff',
                      fontSize: '11px',
                      borderRadius: '9999px',
                      padding: '1px 6px',
                      fontWeight: 600,
                    }}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {tab === 'stock' && (
              <button
                onClick={() => setShowTransfer(true)}
                onMouseEnter={() => setHoveredTransferBtn(true)}
                onMouseLeave={() => setHoveredTransferBtn(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  border: `1px solid ${C.border}`,
                  color: hoveredTransferBtn ? C.text : C.muted,
                  background: hoveredTransferBtn ? '#1C1C1C' : 'transparent',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                Transfer Stock
              </button>
            )}
            {tab === 'stock' && (
              <button
                onClick={() => setShowAddItem(true)}
                onMouseEnter={() => setHoveredAddBtn(true)}
                onMouseLeave={() => setHoveredAddBtn(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: hoveredAddBtn ? C.orangeHover : C.orange,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                + Add Item
              </button>
            )}
          </div>
        </div>

        {/* ── Stock Tab ───────────────────────────────────────────────────────── */}
        {tab === 'stock' && (
          <>
            {/* Category filter pills */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(['', ...Object.keys(CATEGORY_LABELS)] as (ItemCategory | '')[]).map((cat) => {
                const isActive = categoryFilter === cat
                const isHov = hoveredCat === (cat === '' ? '__all__' : cat)
                const label = cat === '' ? 'All' : CATEGORY_LABELS[cat as ItemCategory]
                const key = cat === '' ? '__all__' : cat
                return (
                  <button
                    key={key}
                    onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
                    onMouseEnter={() => setHoveredCat(key)}
                    onMouseLeave={() => setHoveredCat(null)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '9999px',
                      fontSize: '12px',
                      fontWeight: 500,
                      border: `1px solid ${isActive ? C.orange : C.border}`,
                      background: isActive ? C.orange : isHov ? '#1C1C1C' : 'transparent',
                      color: isActive ? '#fff' : isHov ? C.text : C.muted,
                      cursor: 'pointer',
                      transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Stock table */}
            <div style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              overflow: 'hidden',
            }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr>
                      <th style={thStyles}>Item</th>
                      <th style={thStyles}>SKU</th>
                      <th style={thStyles}>Category</th>
                      <th style={thRightStyles}>Qty</th>
                      <th style={thRightStyles}>Threshold</th>
                      <th style={thRightStyles}>Cost (RM)</th>
                      <th style={thRightStyles}>Price (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={7} style={{ ...tdStyles, textAlign: 'center', padding: '32px 16px', color: C.muted }}>
                          Loading...
                        </td>
                      </tr>
                    )}
                    {!loading && filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ ...tdStyles, textAlign: 'center', padding: '32px 16px', color: C.muted }}>
                          No items found.
                        </td>
                      </tr>
                    )}
                    {filteredItems.map((item) => {
                      const isLow = item.quantity < item.low_stock_threshold
                      const isHov = hoveredRow === item.id
                      return (
                        <tr
                          key={item.id}
                          onMouseEnter={() => !isLow && setHoveredRow(item.id)}
                          onMouseLeave={() => setHoveredRow(null)}
                          style={{
                            background: isLow
                              ? 'rgba(239,68,68,0.06)'
                              : isHov
                              ? '#1A1A1A'
                              : 'transparent',
                            transition: 'background 0.12s',
                          }}
                        >
                          <td style={{ ...tdStyles, borderBottom: `1px solid ${C.border}` }}>
                            <p style={{ fontWeight: 500, color: C.text, margin: 0 }}>{item.name}</p>
                            {item.supplier && (
                              <p style={{ fontSize: '12px', color: C.muted, margin: '2px 0 0' }}>{item.supplier.name}</p>
                            )}
                          </td>
                          <td style={{ ...tdStyles, color: C.muted, fontFamily: 'monospace', fontSize: '12px' }}>
                            {item.sku}
                          </td>
                          <td style={tdStyles}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              background: '#232323',
                              color: C.muted,
                              fontSize: '12px',
                            }}>
                              {CATEGORY_LABELS[item.category] ?? item.category}
                            </span>
                          </td>
                          <td style={{ ...tdRightStyles, fontWeight: 600, color: isLow ? '#F87171' : C.text }}>
                            {item.quantity}
                            <span style={{ fontSize: '11px', fontWeight: 400, color: C.muted, marginLeft: '4px' }}>
                              {item.unit}
                            </span>
                            {isLow && <span style={{ marginLeft: '4px', fontSize: '12px', color: '#F87171' }}>⚠</span>}
                          </td>
                          <td style={{ ...tdRightStyles, color: C.muted }}>{item.low_stock_threshold}</td>
                          <td style={{ ...tdRightStyles, color: '#C0C0C0' }}>{item.unit_cost.toFixed(2)}</td>
                          <td style={{ ...tdRightStyles, color: '#C0C0C0' }}>{item.selling_price.toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Transfers Tab ───────────────────────────────────────────────────── */}
        {tab === 'transfers' && (
          <div style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr>
                    <th style={thStyles}>Item</th>
                    <th style={thStyles}>From</th>
                    <th style={thStyles}>To</th>
                    <th style={thRightStyles}>Qty</th>
                    <th style={thStyles}>Status</th>
                    <th style={thStyles}>Notes</th>
                    {isManager && <th style={thRightStyles}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} style={{ ...tdStyles, textAlign: 'center', padding: '32px 16px', color: C.muted }}>
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!loading && transferRequests.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ ...tdStyles, textAlign: 'center', padding: '32px 16px', color: C.muted }}>
                        No transfer requests.
                      </td>
                    </tr>
                  )}
                  {transferRequests.map((t) => {
                    const approveLabel = getApproveLabel(t)
                    const canAct = isManager && approveLabel !== null && t.status !== 'received' && t.status !== 'cancelled'
                    const canCancel = isManager && t.status !== 'received' && t.status !== 'cancelled'
                    const isHov = hoveredRow === t.id
                    const [badgeBg, badgeColor] = STATUS_BADGE[t.status] ?? ['#232323', C.muted]

                    return (
                      <tr
                        key={t.id}
                        onMouseEnter={() => setHoveredRow(t.id)}
                        onMouseLeave={() => setHoveredRow(null)}
                        style={{
                          background: isHov ? '#1A1A1A' : 'transparent',
                          transition: 'background 0.12s',
                        }}
                      >
                        <td style={tdStyles}>
                          <p style={{ fontWeight: 500, color: C.text, margin: 0 }}>{t.item?.name ?? '—'}</p>
                          <p style={{ fontSize: '12px', color: C.muted, fontFamily: 'monospace', margin: '2px 0 0' }}>{t.item?.sku}</p>
                        </td>
                        <td style={{ ...tdStyles, color: C.muted }}>{t.from_branch?.name ?? '—'}</td>
                        <td style={{ ...tdStyles, color: C.muted }}>{t.to_branch?.name ?? '—'}</td>
                        <td style={{ ...tdRightStyles, fontWeight: 600 }}>{t.quantity}</td>
                        <td style={tdStyles}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            fontSize: '12px',
                            fontWeight: 500,
                            background: badgeBg,
                            color: badgeColor,
                          }}>
                            {STATUS_LABELS[t.status] ?? t.status}
                          </span>
                        </td>
                        <td style={{ ...tdStyles, color: C.muted, fontSize: '12px' }}>{t.notes ?? '—'}</td>
                        {isManager && (
                          <td style={tdStyles}>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                              {canAct && (
                                <button
                                  disabled={actionLoading === t.id}
                                  onClick={() => handleApprove(t)}
                                  onMouseEnter={() => setHoveredApprove(t.id)}
                                  onMouseLeave={() => setHoveredApprove(null)}
                                  style={{
                                    padding: '4px 12px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    background: hoveredApprove === t.id ? C.greenHover : C.green,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: actionLoading === t.id ? 'not-allowed' : 'pointer',
                                    opacity: actionLoading === t.id ? 0.5 : 1,
                                    transition: 'background 0.15s, opacity 0.15s',
                                  }}
                                >
                                  {actionLoading === t.id ? '...' : approveLabel}
                                </button>
                              )}
                              {canCancel && (
                                <button
                                  disabled={actionLoading === t.id}
                                  onClick={() => handleReject(t.id)}
                                  onMouseEnter={() => setHoveredCancel(t.id)}
                                  onMouseLeave={() => setHoveredCancel(null)}
                                  style={{
                                    padding: '4px 12px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    background: hoveredCancel === t.id ? 'rgba(239,68,68,0.12)' : 'transparent',
                                    color: '#F87171',
                                    border: '1px solid rgba(239,68,68,0.35)',
                                    borderRadius: '8px',
                                    cursor: actionLoading === t.id ? 'not-allowed' : 'pointer',
                                    opacity: actionLoading === t.id ? 0.5 : 1,
                                    transition: 'background 0.15s, opacity 0.15s',
                                  }}
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
