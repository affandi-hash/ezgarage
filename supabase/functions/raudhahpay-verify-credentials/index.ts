// Tests a candidate RaudhahPay API key against the live merchant API before
// it's saved in Settings, so a bad paste is caught on the spot instead of
// on the tenant's first real customer payment. Proxies the call server-side
// (same reason raudhahpay-create-payment does) since the merchant API isn't
// meant to be called from a browser origin.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RAUDHAHPAY_BASE_URL = 'https://jwfrkqnfjrorrygqhdbs.supabase.co/functions/v1/merchant-api'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Doesn't read or write any tenant data -- it only proxies a key the
    // caller already has to RaudhahPay -- but still requires a logged-in
    // app user so this can't be used as a public "test any key" oracle.
    const authHeader = req.headers.get('Authorization') ?? ''
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { api_key } = await req.json()
    if (!api_key || typeof api_key !== 'string') {
      return new Response(JSON.stringify({ error: 'api_key is required' }), { status: 400, headers: corsHeaders })
    }

    // list-payments is a read action -- lightweight, no side effects, and
    // (per RaudhahPay's docs) ignores Idempotency-Key entirely, so it's a
    // clean way to confirm a key authenticates without creating anything.
    const rpRes = await fetch(RAUDHAHPAY_BASE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list-payments', limit: 1 }),
    })

    if (rpRes.ok) {
      return new Response(JSON.stringify({ valid: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const errData = await rpRes.json().catch(() => ({}))
    const message = rpRes.status === 401 || rpRes.status === 403
      ? 'RaudhahPay rejected this key — check it was copied in full and matches the correct environment (live vs. sandbox).'
      : (errData?.message || errData?.error || `RaudhahPay returned an unexpected error (HTTP ${rpRes.status}).`)
    return new Response(JSON.stringify({ valid: false, error: message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
