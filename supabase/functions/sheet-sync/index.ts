// Pushes daily Sales, COGS (parts cost only) and OPEX (each month's expenses
// spread evenly over its days) for one branch into the Google Sheet through its
// Apps Script web app. Runs nightly from pg_cron (service role) and from the
// "Sync to sheet" button (a signed-in super_admin / ops_manager / finance user).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }
const daysInMonth = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
const kualaLumpurToday = () => ymd(new Date(Date.now() + 8 * 3600 * 1000))
const round2 = (n: number) => Math.round(n * 100) / 100

type Cfg = { tenant_id: string; branch_id: string; outlet_name: string; webapp_url: string; secret: string; gid: number | null; window_days: number }

async function syncTenant(supabase: ReturnType<typeof createClient>, cfg: Cfg, opts: { dryRun?: boolean; from?: string; to?: string; action?: string }) {
  const today = kualaLumpurToday()
  const to = opts.to ?? today
  // re-send the last window_days and the whole current month: invoices can be back-dated
  const monthStart = `${to.slice(0, 7)}-01`
  const back = addDays(to, -(cfg.window_days - 1))
  const from = opts.from ?? (back < monthStart ? back : monthStart)

  const inv: { issue_date: string; total_amount: number; customer_id: string | null; customer_name: string | null; line_items: { item_type?: string; qty?: number; cost_price?: number | null }[] | null }[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from('invoices').select('issue_date, total_amount, customer_id, customer_name, line_items')
      .eq('tenant_id', cfg.tenant_id).eq('branch_id', cfg.branch_id).gte('issue_date', from).lte('issue_date', to)
      .neq('status', 'void').neq('status', 'draft').order('issue_date').range(off, off + 999)
    if (error) throw error
    inv.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const monthsFrom = `${from.slice(0, 7)}-01`
  const { data: exp, error: expErr } = await supabase.from('expenses').select('expense_date, amount')
    .eq('tenant_id', cfg.tenant_id).eq('branch_id', cfg.branch_id).gte('expense_date', monthsFrom).lte('expense_date', to).limit(5000)
  if (expErr) throw expErr
  const monthTotal = new Map<string, number>()
  for (const e of exp ?? []) if (e.amount != null) monthTotal.set(e.expense_date.slice(0, 7), (monthTotal.get(e.expense_date.slice(0, 7)) ?? 0) + Number(e.amount))

  const sales = new Map<string, number>(), cogs = new Map<string, number>()
  for (const i of inv) {
    if (!(Number(i.total_amount) > 0)) continue
    sales.set(i.issue_date, (sales.get(i.issue_date) ?? 0) + Number(i.total_amount))
    let c = 0
    for (const li of i.line_items ?? []) if (li.item_type === 'part' && li.cost_price != null) c += Number(li.cost_price) * (li.qty ?? 1)
    cogs.set(i.issue_date, (cogs.get(i.issue_date) ?? 0) + c)
  }

  const rows: { date: string; outlet: string; sales: number; cogs: number; opex: number }[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = d.slice(0, 7)
    rows.push({ date: d, outlet: cfg.outlet_name, sales: round2(sales.get(d) ?? 0), cogs: round2(cogs.get(d) ?? 0), opex: round2((monthTotal.get(k) ?? 0) / daysInMonth(k)) })
  }

  // Operations tab: one row per trading day
  const perDay = new Map<string, { customers: Set<string>; tx: number; sales: number }>()
  for (const i of inv) {
    if (!(Number(i.total_amount) > 0)) continue
    const d = perDay.get(i.issue_date) ?? { customers: new Set<string>(), tx: 0, sales: 0 }
    d.customers.add(i.customer_id ?? (i.customer_name ?? '').toLowerCase()); d.tx += 1; d.sales += Number(i.total_amount)
    perDay.set(i.issue_date, d)
  }
  const ops = [...perDay.entries()].map(([date, d]) => ({ date, unit: cfg.outlet_name, customers: d.customers.size, transactions: d.tx, sales: round2(d.sales) }))

  // CAPEX AR AP Debt tab: everything still open today
  const payload: Record<string, unknown> = { ops }
  if (opts.action !== 'backfill') {
    type Open = { type: string; date: string; party: string; description: string; amount: number; paid: number; due: string | null; priority: string; status: string }
    const late = (due: string | null) => !!due && due < today
    const { data: arRaw, error: arErr } = await supabase.from('invoices')
      .select('invoice_number, customer_name, issue_date, due_date, total_amount, amount_paid, is_internal_fleet, vehicle_plate')
      .eq('tenant_id', cfg.tenant_id).eq('branch_id', cfg.branch_id).neq('status', 'void').neq('status', 'draft').gt('balance_due', 0).gt('total_amount', 0).limit(2000)
    if (arErr) throw arErr
    const ar: Open[] = (arRaw ?? []).map(i => {
      const paid = Number(i.amount_paid ?? 0), over = late(i.due_date)
      return { type: 'AR', date: i.issue_date, party: i.customer_name ?? '', description: `${i.invoice_number}${i.vehicle_plate ? ` | ${i.vehicle_plate}` : ''}${i.is_internal_fleet ? ' | INTERNAL' : ''}`,
        amount: Number(i.total_amount), paid, due: i.due_date, priority: over ? 'High' : 'Medium', status: over ? 'Overdue' : paid > 0 ? 'Partial' : 'Unpaid' }
    }).sort((a, b) => a.party.toLowerCase().localeCompare(b.party.toLowerCase()) || b.date.localeCompare(a.date) || b.description.localeCompare(a.description))

    const { data: supp } = await supabase.from('suppliers').select('id, name').eq('tenant_id', cfg.tenant_id)
    const names = new Map((supp ?? []).map(x => [x.id, x.name as string]))
    const { data: apRaw, error: apErr } = await supabase.from('supplier_invoices')
      .select('supplier_id, invoice_number, invoice_date, due_date, total_amount, amount_paid')
      .eq('tenant_id', cfg.tenant_id).eq('branch_id', cfg.branch_id).is('voided_at', null).neq('status', 'paid').limit(2000)
    if (apErr) throw apErr
    const ap: Open[] = (apRaw ?? []).filter(i => Number(i.total_amount) - Number(i.amount_paid ?? 0) > 0.009).map(i => {
      const paid = Number(i.amount_paid ?? 0)
      return { type: 'AP', date: i.invoice_date, party: names.get(i.supplier_id) ?? 'Supplier', description: i.invoice_number ?? '', amount: Number(i.total_amount), paid,
        due: i.due_date, priority: late(i.due_date) ? 'High' : 'Medium', status: paid > 0 ? 'Partial' : 'Unpaid' }
    }).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.date.localeCompare(b.date))

    const { data: capRaw, error: capErr } = await supabase.from('expenses')
      .select('expense_date, vendor, category, description, amount, payment_status')
      .eq('tenant_id', cfg.tenant_id).eq('branch_id', cfg.branch_id).eq('type', 'capex').not('amount', 'is', null).order('expense_date').limit(1000)
    if (capErr) throw capErr
    const capex: Open[] = (capRaw ?? []).map(e => {
      const paid = e.payment_status === 'paid' ? Number(e.amount) : 0
      return { type: 'CAPEX', date: e.expense_date, party: e.vendor || e.category || 'CAPEX', description: e.description ?? '', amount: Number(e.amount), paid, due: null, priority: 'Medium', status: paid > 0 ? 'Paid' : 'Unpaid' }
    })
    payload.ar = ar; payload.ap = ap; payload.capex = capex
  }

  const res = await fetch(cfg.webapp_url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: cfg.secret, gid: cfg.gid, dryRun: !!opts.dryRun, action: opts.action, rows, ...payload }),
  })
  const text = await res.text()
  let out: unknown
  try { out = JSON.parse(text) } catch { out = { ok: false, error: `Sheet script answered with non-JSON (${res.status}): ${text.slice(0, 200)}` } }
  return { from, to, sent: rows.length, sheet: out }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = await req.json().catch(() => ({}))
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')

    // who is calling: the cron (service role key) syncs every enabled tenant; a user syncs their own tenant
    let tenantFilter: string | null = null
    // the platform has already verified the JWT's signature; a service_role claim means cron / server-side
    let claimRole = ''
    try { claimRole = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? '' } catch { /* not a JWT */ }
    if (claimRole !== 'service_role' && token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      const { data: u } = await supabase.auth.getUser(token)
      if (!u?.user) return new Response(JSON.stringify({ error: 'unauthorised' }), { status: 401, headers: cors })
      const { data: prof } = await supabase.from('users').select('tenant_id, role, is_active').eq('id', u.user.id).single()
      if (!prof?.is_active || !['super_admin', 'ops_manager', 'finance'].includes(prof.role)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors })
      tenantFilter = prof.tenant_id
    }

    let q = supabase.from('sheet_sync_config').select('*').eq('enabled', true)
    if (tenantFilter) q = q.eq('tenant_id', tenantFilter)
    const { data: cfgs, error } = await q
    if (error) throw error
    if (!cfgs?.length) return new Response(JSON.stringify({ ok: true, message: 'no sheet sync is enabled' }), { headers: { ...cors, 'Content-Type': 'application/json' } })

    const results = []
    for (const cfg of cfgs as Cfg[]) {
      try {
        const r = await syncTenant(supabase, cfg, { dryRun: body.dryRun, from: body.from, to: body.to, action: body.action })
        const ok = (r.sheet as { ok?: boolean }).ok === true
        if (!body.dryRun) await supabase.from('sheet_sync_config').update({ last_run_at: new Date().toISOString(), last_status: ok ? `ok: ${JSON.stringify(r.sheet).slice(0, 300)}` : `error: ${JSON.stringify(r.sheet).slice(0, 300)}` }).eq('tenant_id', cfg.tenant_id)
        results.push({ tenant_id: cfg.tenant_id, ...r })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!body.dryRun) await supabase.from('sheet_sync_config').update({ last_run_at: new Date().toISOString(), last_status: `error: ${msg}` }).eq('tenant_id', cfg.tenant_id)
        results.push({ tenant_id: cfg.tenant_id, error: msg })
      }
    }
    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), { status: 500, headers: cors })
  }
})
