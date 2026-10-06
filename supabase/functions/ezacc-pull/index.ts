// Pulls supplier payments from the ezAcc REST API: the nightly safety net after
// ezAcc's own push (pg_cron, migration 162), the first history load, and the
// "Sync now" button on the Accounts Payable page.
//   body {} or {full:true}: full:true forgets the stored cursor and re-reads everything.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(url, serviceKey)

  // who is asking: the cron job (service role) or a signed-in finance user
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  let onlyTenant: string | null = null
  if (token !== serviceKey) {
    let isService = false
    try { isService = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role' } catch { /* not a JWT */ }
    if (!isService) {
      const { data: u } = await db.auth.getUser(token)
      if (!u?.user) return json(401, { error: 'sign in first' })
      const { data: me } = await db.from('users').select('tenant_id, role').eq('id', u.user.id).maybeSingle()
      if (!me || !['super_admin', 'ops_manager', 'finance'].includes(me.role)) return json(403, { error: 'not allowed' })
      onlyTenant = me.tenant_id
    }
  }

  let full = false
  try { full = !!(await req.json())?.full } catch { /* empty body */ }

  let q = db.from('ezacc_feeds').select('*').eq('enabled', true).not('api_key', 'is', null)
  if (onlyTenant) q = q.eq('tenant_id', onlyTenant)
  const { data: feeds, error } = await q
  if (error) return json(500, { error: error.message })

  const results: unknown[] = []
  for (const f of feeds ?? []) {
    let cursor: string | null = full ? null : f.pull_cursor
    let seen = 0, pages = 0, status = 'pull ok'
    try {
      for (; pages < 100; pages++) {
        const u = new URL(`${f.api_base}/payments-made`)
        u.searchParams.set('limit', '200')
        if (cursor) u.searchParams.set('cursor', cursor)
        const r = await fetch(u, { headers: { Authorization: `Bearer ${f.api_key}` } })
        if (!r.ok) { status = `pull failed: HTTP ${r.status} ${(await r.text()).slice(0, 150)}`; break }
        const body = await r.json()
        const rows = Array.isArray(body.data) ? body.data : []
        if (rows.length) {
          const { error: ie } = await db.rpc('ezacc_ingest', { p_tenant: f.tenant_id, p_payments: rows })
          if (ie) { status = `pull failed: ${ie.message}`.slice(0, 300); break }
          seen += rows.length
        }
        // keep the cursor even when the page is empty, but only after the page is stored
        if (body.meta?.next_cursor) {
          cursor = body.meta.next_cursor
          await db.from('ezacc_feeds').update({ pull_cursor: cursor }).eq('tenant_id', f.tenant_id)
        }
        if (!body.meta?.has_more) break
      }
    } catch (e) {
      status = `pull failed: ${(e as Error).message}`.slice(0, 300)
    }
    await db.from('ezacc_feeds').update({
      last_pull_at: new Date().toISOString(),
      last_status: status === 'pull ok' ? `pull ok: ${seen} payment(s)` : status,
    }).eq('tenant_id', f.tenant_id)
    results.push({ tenant_id: f.tenant_id, status, seen, pages: pages + 1 })
  }
  return json(200, { results })
})
