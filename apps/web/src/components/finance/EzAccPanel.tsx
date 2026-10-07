import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// "Needs review (ezAcc)": supplier payments made in ezAcc that the feed could
// not safely match to a supplier invoice. See migration 162.

const FEED_START = '2026-07-01'

interface UnmatchedAlloc {
  ezacc_payment_id: string
  idx: number
  bill_number: string | null
  supplier_name: string | null
  amount: number
  note: string | null
  payment_date: string | null
  reference: string | null
  state: 'unmatched' | 'void_review'
  suggested_invoice_id: string | null
  supplier_invoice_id: string | null
}

interface InvoiceLite {
  invoice_number: string | null
  total_amount: number
  amount_paid: number
  supplier: string | null
}

interface PickerInvoice {
  id: string
  invoice_number: string | null
  total_amount: number
  amount_paid: number
  suppliers: { name: string } | null
}

function rm(n: number): string {
  return 'RM ' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Same idea as ezacc_name_like() in the database: plausibly the same business.
function sameSupplier(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  return x.slice(0, 4) === y.slice(0, 4) || x.includes(y) || y.includes(x)
}

const btn: React.CSSProperties = {
  background: '#1E1E1E',
  border: '1px solid #2A2A2A',
  color: '#F0F0F0',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '6px 12px',
  minHeight: 32,
  whiteSpace: 'nowrap',
}

interface Props {
  tenantId: string
  role: string
  // called after a successful match/ignore/sync so the page can reload its invoices
  onChanged: () => void
}

export function EzAccPanel({ tenantId, role, onChanged }: Props) {
  const allowed = ['super_admin', 'ops_manager', 'finance'].includes(role)
  const canRemove = ['super_admin', 'ops_manager'].includes(role)

  const [rows, setRows] = useState<UnmatchedAlloc[]>([])
  const [invInfo, setInvInfo] = useState<Record<string, InvoiceLite>>({})
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [confirmPayee, setConfirmPayee] = useState<string | null>(null)
  const [autoIgnored, setAutoIgnored] = useState(0)
  const [payees, setPayees] = useState<{ payee_key: string; payee_name: string | null }[]>([])
  const [payeesOpen, setPayeesOpen] = useState(false)
  const [payeeBusy, setPayeeBusy] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // picker
  const [pickFor, setPickFor] = useState<UnmatchedAlloc | null>(null)
  const [pickInvoices, setPickInvoices] = useState<PickerInvoice[] | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [pickSearch, setPickSearch] = useState('')
  const [pickAll, setPickAll] = useState(false)

  const load = useCallback(async () => {
    if (!allowed || !tenantId) return
    const cols = 'ezacc_payment_id, idx, bill_number, supplier_name, amount, note, state, suggested_invoice_id, supplier_invoice_id'
    const [um, vr, ai, pe] = await Promise.all([
      supabase
        .from('ezacc_allocations')
        .select(`${cols}, ezacc_payments!inner(payment_date, status, reference)`)
        .eq('tenant_id', tenantId)
        .eq('state', 'unmatched')
        .eq('user_ignored', false)
        .eq('ezacc_payments.status', 'posted')
        .gte('ezacc_payments.payment_date', FEED_START),
      // cancelled/deleted in ezAcc: parent is voided/deleted and may have no date, so no parent filters
      supabase
        .from('ezacc_allocations')
        .select(`${cols}, ezacc_payments(payment_date, status, reference)`)
        .eq('tenant_id', tenantId)
        .eq('state', 'void_review')
        .eq('user_ignored', false),
      supabase
        .from('ezacc_allocations')
        .select('ezacc_payment_id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('state', 'ignored')
        .like('note', 'bill dated before%'),
      supabase.from('ezacc_ignored_payees').select('payee_key, payee_name').eq('tenant_id', tenantId).order('payee_name'),
    ])
    // footer info is best-effort: a failure here must not hide the review list
    setAutoIgnored(ai.error ? 0 : ai.count ?? 0)
    setPayees(pe.error ? [] : ((pe.data as { payee_key: string; payee_name: string | null }[]) ?? []))
    const error = um.error ?? vr.error
    if (error) {
      setLoadError(error.message)
      setLoaded(true)
      return
    }
    setLoadError(null)
    const mapped: UnmatchedAlloc[] = [...((um.data as unknown[]) ?? []), ...((vr.data as unknown[]) ?? [])].map((r) => {
      const row = r as Record<string, unknown>
      const p = (Array.isArray(row.ezacc_payments) ? row.ezacc_payments[0] : row.ezacc_payments) as
        | { payment_date: string | null; reference: string | null }
        | null
      return {
        ezacc_payment_id: row.ezacc_payment_id as string,
        idx: row.idx as number,
        bill_number: (row.bill_number as string | null) ?? null,
        supplier_name: (row.supplier_name as string | null) ?? null,
        amount: Number(row.amount),
        note: (row.note as string | null) ?? null,
        payment_date: p?.payment_date ?? null,
        reference: p?.reference ?? null,
        state: row.state as 'unmatched' | 'void_review',
        suggested_invoice_id: (row.suggested_invoice_id as string | null) ?? null,
        supplier_invoice_id: (row.supplier_invoice_id as string | null) ?? null,
      }
    })
    mapped.sort((a, b) => (b.payment_date ?? '').localeCompare(a.payment_date ?? ''))

    // invoices to display: the suggestion (unmatched) or the one the cancelled payment sat on (void_review)
    const ids = Array.from(new Set(mapped.map((m) => (m.state === 'unmatched' ? m.suggested_invoice_id : m.supplier_invoice_id)).filter((x): x is string => !!x)))
    const info: Record<string, InvoiceLite> = {}
    if (ids.length) {
      const { data: invs } = await supabase
        .from('supplier_invoices')
        .select('id, invoice_number, total_amount, amount_paid, suppliers(name)')
        .in('id', ids)
      for (const r of (invs as unknown[]) ?? []) {
        const row = r as Record<string, unknown>
        const sup = (Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers) as { name: string } | null
        info[row.id as string] = {
          invoice_number: (row.invoice_number as string | null) ?? null,
          total_amount: Number(row.total_amount),
          amount_paid: Number(row.amount_paid),
          supplier: sup?.name ?? null,
        }
      }
    }
    setInvInfo(info)
    setRows(mapped)
    setLoaded(true)
  }, [allowed, tenantId])

  useEffect(() => {
    load()
  }, [load])

  async function resolve(a: UnmatchedAlloc, action: 'ignore' | 'match' | 'keep' | 'remove_manual', invoiceId?: string): Promise<boolean> {
    const key = `${a.ezacc_payment_id}:${a.idx}`
    setBusyKey(key)
    setActionError(null)
    try {
      const { data, error } = await supabase.rpc('ezacc_resolve', {
        p_payment: a.ezacc_payment_id,
        p_idx: a.idx,
        p_action: action,
        p_invoice: invoiceId ?? null,
      })
      if (error) throw error
      const res = data as { ok?: boolean; error?: string } | null
      if (res?.error) throw new Error(res.error)
      setConfirmRemove(null)
      await load()
      onChanged()
      return true
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  async function payeeRpc(busy: string, fn: 'ezacc_set_payee_ignored' | 'ezacc_restore_payee', args: Record<string, unknown>) {
    setPayeeBusy(busy)
    setActionError(null)
    try {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      const res = data as { ok?: boolean; error?: string } | null
      if (res?.error) throw new Error(res.error)
      setConfirmPayee(null)
      await load()
      onChanged()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setPayeeBusy(null)
    }
  }

  async function handleIgnore(a: UnmatchedAlloc) {
    if (!window.confirm(`Ignore this ezAcc payment of ${rm(a.amount)}${a.bill_number ? ` (bill ${a.bill_number})` : ''}? It will not be applied to any invoice.`)) return
    await resolve(a, 'ignore')
  }

  async function openPicker(a: UnmatchedAlloc) {
    setPickFor(a)
    setPickSearch('')
    setPickAll(false)
    setPickError(null)
    setActionError(null)
    if (pickInvoices) return
    const { data, error } = await supabase
      .from('supplier_invoices')
      .select('id, invoice_number, total_amount, amount_paid, suppliers(name)')
      .eq('tenant_id', tenantId)
      .is('voided_at', null)
      .order('created_at', { ascending: false })
    if (error) {
      setPickError(error.message)
      return
    }
    setPickInvoices(
      ((data as unknown[]) ?? []).map((r) => {
        const row = r as Record<string, unknown>
        const s = Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers
        return {
          id: row.id as string,
          invoice_number: (row.invoice_number as string | null) ?? null,
          total_amount: Number(row.total_amount),
          amount_paid: Number(row.amount_paid),
          suppliers: (s as { name: string } | null) ?? null,
        }
      }),
    )
  }

  async function handlePick(inv: PickerInvoice) {
    if (!pickFor) return
    const ok = await resolve(pickFor, 'match', inv.id)
    if (ok) {
      setPickFor(null)
      // the picker's cached paid amounts are now stale
      setPickInvoices(null)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('ezacc-pull', { body: {} })
      if (error) {
        let msg = error.message
        try {
          const ctx = (error as { context?: Response }).context
          const j = ctx ? await ctx.json() : null
          if (j?.error) msg = String(j.error)
        } catch { /* keep generic message */ }
        throw new Error(msg)
      }
      const results = ((data as { results?: { status: string; seen: number }[] } | null)?.results ?? [])
      const seen = results.reduce((s, r) => s + (r.seen ?? 0), 0)
      const failed = results.find((r) => r.status !== 'pull ok')
      if (failed) setSyncMsg({ text: failed.status, ok: false })
      else setSyncMsg({ text: `${seen} payment${seen === 1 ? '' : 's'} checked`, ok: true })
      await load()
      onChanged()
    } catch (err) {
      setSyncMsg({ text: err instanceof Error ? err.message : 'Sync failed', ok: false })
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(null), 8000)
    }
  }

  const pickList = useMemo(() => {
    if (!pickFor || !pickInvoices) return []
    const q = norm(pickSearch)
    const sameName = !pickAll && !q && !!pickFor.supplier_name
    return pickInvoices
      .filter((i) => {
        if (q) return norm(i.invoice_number).includes(q) || norm(i.suppliers?.name).includes(q)
        if (sameName) return sameSupplier(i.suppliers?.name, pickFor.supplier_name)
        return true
      })
      .slice(0, 50)
  }, [pickFor, pickInvoices, pickSearch, pickAll])

  if (!allowed || !loaded) return null

  const syncButton = (
    <button onClick={handleSync} disabled={syncing} style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: syncing ? 0.6 : 1 }}>
      {syncing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
      Sync now
    </button>
  )
  const syncNote = syncMsg && (
    <span style={{ fontSize: 12, color: syncMsg.ok ? '#22C55E' : '#EF4444' }}>{syncMsg.text}</span>
  )

  const footer = (
    <>
      {autoIgnored > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 11, color: '#6B7280' }}>
          {autoIgnored} {autoIgnored === 1 ? 'bill' : 'bills'} dated before 1 Jul 2026 {autoIgnored === 1 ? 'was' : 'were'} left out automatically.
        </p>
      )}
      {payees.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setPayeesOpen((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: '#A0A0A0' }}
          >
            {payeesOpen ? '▾' : '▸'} Payees left out ({payees.length})
          </button>
          {payeesOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {payees.map((py) => (
                <div
                  key={py.payee_key}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 8, padding: '6px 12px' }}
                >
                  <span style={{ fontSize: 12, color: '#F0F0F0' }}>{py.payee_name || py.payee_key}</span>
                  <button
                    onClick={() => payeeRpc(`restore:${py.payee_key}`, 'ezacc_restore_payee', { p_key: py.payee_key })}
                    disabled={!!payeeBusy}
                    style={{ ...btn, minHeight: 28, padding: '4px 10px', color: '#F15A22' }}
                  >
                    {payeeBusy === `restore:${py.payee_key}` ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )

  // Nothing to review: a quiet one-liner (keeps "Sync now" reachable)
  if (rows.length === 0 && !loadError && !syncMsg && !actionError) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#22C55E' }}>ezAcc feed: all payments matched</span>
          {syncButton}
        </div>
        {footer}
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#161616',
        border: '1px solid rgba(245,158,11,0.4)',
        borderRadius: 12,
        padding: 14,
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: rows.length ? 10 : 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>
          Needs review (ezAcc){rows.length ? ` — ${rows.length}` : ''}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {syncNote}
          {syncButton}
        </div>
      </div>

      {loadError && <p style={{ color: '#EF4444', fontSize: 12, margin: '6px 0 0' }}>{loadError}</p>}
      {actionError && <p style={{ color: '#EF4444', fontSize: 12, margin: '6px 0' }}>{actionError}</p>}

      {[
        { key: 'unmatched', label: null, list: rows.filter((r) => r.state === 'unmatched') },
        { key: 'void_review', label: 'Cancelled in ezAcc, still in ezWF', list: rows.filter((r) => r.state === 'void_review') },
      ].map((group) =>
        group.list.length === 0 ? null : (
          <div key={group.key} style={{ marginTop: group.key === 'void_review' && rows.some((r) => r.state === 'unmatched') ? 14 : 0 }}>
            {group.label && (
              <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{group.label}</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.list.map((a) => {
                const key = `${a.ezacc_payment_id}:${a.idx}`
                const busy = busyKey === key
                const review = a.state === 'void_review'
                const sug = !review && a.suggested_invoice_id ? invInfo[a.suggested_invoice_id] : undefined
                const onInv = review && a.supplier_invoice_id ? invInfo[a.supplier_invoice_id] : undefined
                return (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      background: '#1E1E1E',
                      border: `1px solid ${review ? 'rgba(245,158,11,0.3)' : '#2A2A2A'}`,
                      borderRadius: 8,
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                      <p style={{ margin: 0, fontSize: 13, color: '#F0F0F0' }}>
                        <span style={{ fontWeight: 700 }}>{rm(a.amount)}</span>
                        {' · '}
                        {a.supplier_name ?? '—'}
                        {' · '}
                        <span style={{ fontFamily: 'monospace', color: '#F15A22' }}>{a.bill_number || 'no bill #'}</span>
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#A0A0A0' }}>
                        {fmtDate(a.payment_date)}
                        {a.reference ? ` · ezAcc ref ${a.reference}` : ''}
                        {a.note ? ` · ${a.note}` : ''}
                      </p>
                      {review && (
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#F59E0B' }}>
                          On invoice: {onInv ? `${onInv.invoice_number || 'No Invoice #'}${onInv.supplier ? ` · ${onInv.supplier}` : ''}` : '—'}
                        </p>
                      )}
                      {sug && (
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#22C55E' }}>
                          Suggested: {sug.invoice_number || 'No Invoice #'}
                          {sug.supplier ? ` · ${sug.supplier}` : ''} · {rm(sug.total_amount)} / {rm(sug.total_amount - sug.amount_paid)} due
                        </p>
                      )}
                      {confirmPayee === key && (
                        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#F59E0B' }}>
                          Leave out all payments to {a.supplier_name || 'this payee'}, now and in future?
                          <span style={{ display: 'inline-flex', gap: 8, marginLeft: 10, verticalAlign: 'middle' }}>
                            <button
                              onClick={() => payeeRpc(key, 'ezacc_set_payee_ignored', { p_payment: a.ezacc_payment_id, p_ignored: true })}
                              disabled={!!payeeBusy}
                              style={{ ...btn, minHeight: 28, padding: '4px 10px', background: '#F59E0B', borderColor: '#F59E0B', color: '#0E0E0E' }}
                            >
                              {payeeBusy === key ? 'Working…' : 'Yes, leave out'}
                            </button>
                            <button onClick={() => setConfirmPayee(null)} disabled={!!payeeBusy} style={{ ...btn, minHeight: 28, padding: '4px 10px', color: '#A0A0A0' }}>
                              Cancel
                            </button>
                          </span>
                        </p>
                      )}
                      {confirmRemove === key && (
                        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#EF4444' }}>
                          Delete the {rm(a.amount)} payment from invoice {onInv?.invoice_number || '(no number)'}?
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {busy && <Loader2 size={14} style={{ color: '#F15A22', animation: 'spin 1s linear infinite' }} />}
                      {review ? (
                        confirmRemove === key ? (
                          <>
                            <button onClick={() => resolve(a, 'remove_manual')} disabled={busy} style={{ ...btn, background: '#EF4444', borderColor: '#EF4444', color: '#fff' }}>
                              Yes, delete
                            </button>
                            <button onClick={() => setConfirmRemove(null)} disabled={busy} style={{ ...btn, color: '#A0A0A0' }}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => resolve(a, 'keep')} disabled={busy} style={{ ...btn, color: '#A0A0A0' }}>
                              Keep payment
                            </button>
                            {canRemove && (
                              <button
                                onClick={() => { setActionError(null); setConfirmRemove(key) }}
                                disabled={busy}
                                style={{ ...btn, color: '#EF4444', borderColor: 'rgba(239,68,68,0.4)' }}
                              >
                                Remove payment
                              </button>
                            )}
                          </>
                        )
                      ) : (
                        <>
                          {a.suggested_invoice_id && sug && (
                            <button
                              onClick={() => resolve(a, 'match', a.suggested_invoice_id!)}
                              disabled={busy}
                              style={{ ...btn, background: '#F15A22', borderColor: '#F15A22', color: '#fff' }}
                            >
                              Confirm match
                            </button>
                          )}
                          <button onClick={() => openPicker(a)} disabled={busy} style={{ ...btn, color: '#F15A22' }}>
                            Match to invoice
                          </button>
                          <button onClick={() => handleIgnore(a)} disabled={busy} style={{ ...btn, color: '#A0A0A0' }}>
                            Ignore
                          </button>
                          {confirmPayee !== key && (
                            <button
                              onClick={() => { setActionError(null); setConfirmPayee(key) }}
                              disabled={busy}
                              style={{ ...btn, fontWeight: 500, color: '#6B7280' }}
                            >
                              Not a supplier
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ),
      )}

      {footer}

      {/* Invoice picker */}
      {pickFor && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.75)' }}
          onClick={(e) => e.target === e.currentTarget && setPickFor(null)}
        >
          <div style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#1E1E1E', border: '1px solid #2A2A2A', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#F0F0F0' }}>Match to invoice</p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#A0A0A0' }}>
                  {rm(pickFor.amount)} · {pickFor.supplier_name ?? '—'} · {pickFor.bill_number || 'no bill #'}
                </p>
              </div>
              <button onClick={() => setPickFor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0A0A0', padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '12px 20px 0' }}>
              <input
                type="text"
                autoFocus
                value={pickSearch}
                onChange={(e) => setPickSearch(e.target.value)}
                placeholder="Search invoice number or supplier"
                style={{ background: '#0E0E0E', border: '1px solid #2A2A2A', color: '#F0F0F0', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none' }}
              />
              {pickFor.supplier_name && !pickSearch && (
                <p style={{ margin: '8px 0 0', fontSize: 11, color: '#6B7280' }}>
                  {pickAll ? 'Showing all suppliers. ' : `Showing invoices from a supplier like "${pickFor.supplier_name}". `}
                  <span onClick={() => setPickAll((v) => !v)} style={{ color: '#F15A22', cursor: 'pointer' }}>
                    {pickAll ? 'Filter to this supplier' : 'Show all suppliers'}
                  </span>
                </p>
              )}
            </div>
            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pickError ? (
                <p style={{ color: '#EF4444', fontSize: 12, margin: 0 }}>{pickError}</p>
              ) : !pickInvoices ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                  <Loader2 size={20} style={{ color: '#F15A22', animation: 'spin 1s linear infinite' }} />
                </div>
              ) : pickList.length === 0 ? (
                <p style={{ color: '#4A4A4A', fontSize: 13, textAlign: 'center', margin: 0 }}>No invoices found</p>
              ) : (
                pickList.map((inv) => {
                  const out = inv.total_amount - inv.amount_paid
                  return (
                    <button
                      key={inv.id}
                      onClick={() => handlePick(inv)}
                      disabled={!!busyKey}
                      style={{ textAlign: 'left', background: '#161616', border: '1px solid #2A2A2A', borderRadius: 8, padding: '8px 12px', cursor: busyKey ? 'not-allowed' : 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13, color: '#F0F0F0' }}>
                          <span style={{ fontFamily: 'monospace', color: '#F15A22' }}>{inv.invoice_number || 'No Invoice #'}</span>
                          {' · '}
                          {inv.suppliers?.name ?? '—'}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: out > 0 ? '#F15A22' : '#22C55E', whiteSpace: 'nowrap' }}>{rm(out)} due</span>
                      </div>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#A0A0A0' }}>
                        Total {rm(inv.total_amount)} · Paid {rm(inv.amount_paid)}
                      </p>
                    </button>
                  )
                })
              )}
              {actionError && <p style={{ color: '#EF4444', fontSize: 12, margin: '6px 0 0' }}>{actionError}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
