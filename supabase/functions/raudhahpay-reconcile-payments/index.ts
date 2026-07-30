// Backstops raudhahpay-webhook: finds invoices whose RaudhahPay bill is
// still showing as pending locally well past when FPX/DuitNow/card
// normally resolve, asks RaudhahPay directly whether it actually
// succeeded, and — if so — replays a correctly-signed synthetic webhook
// through the existing raudhahpay-webhook handler rather than duplicating
// its receipt-writing/PDF/invoice-update logic here. Triggered by pg_cron
// every 15 minutes; can also be invoked manually with an optional
// { minAgeMinutes, maxAgeDays } override from the Platform Settings page.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Same live merchant API used by raudhahpay-create-payment.
const RAUDHAHPAY_BASE_URL = 'https://jwfrkqnfjrorrygqhdbs.supabase.co/functions/v1/merchant-api'

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Candidate {
  id: string
  raudhahpay_bill_id: string
  raudhahpay_payment_session_id: string | null
  raudhahpay_reference_number: string | null
  raudhahpay_payment_method: string | null
  tenants: { raudhahpay_api_key: string | null; raudhahpay_webhook_secret: string | null } | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Same trust boundary as raudhahpay-daily-statement: this reads across
    // every tenant's invoices and can trigger real receipt writes, so it's
    // gated to the cron job (service role) or a platform admin, never a
    // tenant-scoped user.
    const authHeader = req.headers.get('Authorization') ?? ''
    const providedToken = authHeader.replace('Bearer ', '')
    let isServiceRole = false
    try {
      const payload = JSON.parse(atob(providedToken.split('.')[1] ?? ''))
      isServiceRole = payload?.role === 'service_role'
    } catch { /* not a decodable JWT — treated as not service role */ }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (!isServiceRole) {
      const anonClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: { user } } = await anonClient.auth.getUser()
      if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
      const { data: profile } = await supabase.from('users').select('is_platform_admin').eq('id', user.id).single()
      if (!profile?.is_platform_admin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders })
      }
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const minAgeMinutes = Number(body.minAgeMinutes) || 10
    const maxAgeDays = Number(body.maxAgeDays) || 3
    const minAgeCutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000).toISOString()
    const maxAgeCutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()

    // Candidates: has a bill on file, still shows a balance, old enough
    // that RaudhahPay should have resolved it one way or another by now,
    // not so old it's almost certainly abandoned/expired.
    const { data: candidates, error: candErr } = await supabase
      .from('invoices')
      .select('id, raudhahpay_bill_id, raudhahpay_payment_session_id, raudhahpay_reference_number, raudhahpay_payment_method, tenants(raudhahpay_api_key, raudhahpay_webhook_secret)')
      .not('raudhahpay_bill_id', 'is', null)
      .gt('balance_due', 0)
      .neq('status', 'void')
      .lt('raudhahpay_bill_created_at', minAgeCutoff)
      .gt('raudhahpay_bill_created_at', maxAgeCutoff)

    if (candErr) throw candErr

    const rows = (candidates ?? []) as unknown as Candidate[]
    let checked = 0
    let reconciled = 0
    const errors: Array<{ invoice_id: string; error: string }> = []

    for (const inv of rows) {
      checked++
      try {
        const apiKey = inv.tenants?.raudhahpay_api_key || Deno.env.get('RAUDHAHPAY_API_KEY')!
        const webhookSecret = inv.tenants?.raudhahpay_webhook_secret || Deno.env.get('RAUDHAHPAY_WEBHOOK_SECRET')!

        const queryPayload = inv.raudhahpay_payment_session_id
          ? { action: 'get-payment', payment_session_id: inv.raudhahpay_payment_session_id }
          : { action: 'get-payment-by-reference', reference_number: inv.raudhahpay_reference_number }

        const statusRes = await fetch(RAUDHAHPAY_BASE_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(queryPayload),
        })
        if (!statusRes.ok) {
          errors.push({ invoice_id: inv.id, error: `status query failed: ${statusRes.status}` })
          continue
        }
        const statusData = await statusRes.json()
        if (statusData.status !== 'success') continue // still pending, or genuinely failed/expired -- nothing to reconcile

        // Replay through the real webhook handler rather than duplicating
        // its receipt-writing/PDF/invoice-update logic here. Sign it
        // exactly as a genuine delivery would be, using the same secret
        // this invoice's tenant already dictates -- if that fails
        // signature verification on the other end, that mismatch is itself
        // a signal worth seeing in webhook_debug_log.
        const syntheticPayload = {
          event: 'payment.success',
          bill_id: inv.raudhahpay_bill_id,
          amount: statusData.amount,
          payment_method: statusData.payment_method || inv.raudhahpay_payment_method || 'fpx',
          reference_number: statusData.reference_number ?? inv.raudhahpay_reference_number,
          order_no: inv.id,
          metadata: { invoice_id: inv.id },
        }
        const rawBody = JSON.stringify(syntheticPayload)
        const timestamp = Math.floor(Date.now() / 1000).toString()
        const signature = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`)

        const replayRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/raudhahpay-webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-timestamp': timestamp,
            'x-webhook-signature': signature,
            'x-webhook-id': `reconcile:${inv.raudhahpay_bill_id}`,
          },
          body: rawBody,
        })
        if (!replayRes.ok) {
          errors.push({ invoice_id: inv.id, error: `webhook replay failed: ${replayRes.status}` })
          continue
        }
        reconciled++
      } catch (e) {
        errors.push({ invoice_id: inv.id, error: e instanceof Error ? e.message : 'Unknown error' })
      }
    }

    if (errors.length > 0) console.error('raudhahpay-reconcile-payments errors', errors)

    return new Response(JSON.stringify({ checked, reconciled, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('raudhahpay-reconcile-payments error', e)
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
