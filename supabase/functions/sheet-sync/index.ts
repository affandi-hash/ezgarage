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

  const inv: { issue_date: string; total_amount: number; line_items: { item_type?: string; qty?: number; cost_price?: number | null }[] | null }[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from('invoices').select('issue_date, total_amount, line_items')
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

  const res = await fetch(cfg.webapp_url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: cfg.secret, gid: cfg.gid, dryRun: !!opts.dryRun, action: opts.action, rows }),
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
