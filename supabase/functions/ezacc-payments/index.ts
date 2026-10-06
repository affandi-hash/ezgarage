// Receives the daily payments feed pushed by ezAcc (Account360).
// Public endpoint: every request is checked against the feed's signing secret
// (HMAC-SHA256 over "<timestamp>.<raw body>"). The batch is stored and applied
// by the ezacc_ingest() database function, then we answer 200.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const enc = new TextEncoder()

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const raw = await req.text() // the exact bytes that were signed
  const ts = req.headers.get('x-account360-timestamp') ?? ''
  const sig = (req.headers.get('x-account360-signature') ?? '').replace(/^sha256=/, '')
  if (!ts || !sig || !Number.isFinite(Number(ts)) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    return json(401, { error: 'bad or stale timestamp' })
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: feeds, error: fe } = await db.from('ezacc_feeds').select('tenant_id, signing_secret').eq('enabled', true)
  if (fe) return json(500, { error: 'feed lookup failed' })

  let tenantId: string | null = null
  for (const f of feeds ?? []) {
    if (safeEqual(sig, await hmacHex(f.signing_secret, `${ts}.${raw}`))) { tenantId = f.tenant_id; break }
  }
  if (!tenantId) return json(401, { error: 'bad signature' })

  let body: { data?: unknown[]; batch?: { index?: number; count?: number }; mode?: string }
  try { body = JSON.parse(raw) } catch { return json(400, { error: 'bad json' }) }
  const payments = Array.isArray(body.data) ? body.data : []

  const { data, error } = await db.rpc('ezacc_ingest', { p_tenant: tenantId, p_payments: payments })
  if (error) {
    await db.from('ezacc_feeds').update({ last_status: `push failed: ${error.message}`.slice(0, 300) }).eq('tenant_id', tenantId)
    return json(500, { error: 'could not store the batch' }) // ezAcc retries in 15 minutes
  }
  await db.from('ezacc_feeds').update({
    last_push_at: new Date().toISOString(),
    last_status: `push ok: ${payments.length} payment(s)${body.mode ? ', ' + body.mode : ''}`,
  }).eq('tenant_id', tenantId)
  return json(200, { ok: true, received: payments.length, ...(data as object) })
})
