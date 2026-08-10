// Signs short-lived URLs for a job invoice's payment receipts, for the
// customer portal. Mirrors esp-receipt's pattern (re-verify identity
// server-side, then use the service role to sign the file) but for
// ordinary job invoices instead of ESP membership fees -- those never had
// an equivalent, so a customer paying online via RaudhahPay had no way to
// see or download proof of their own payment.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SIGNED_URL_TTL_SECONDS = 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { invoice_id, plate, phone, ic_first6 } = await req.json()
    if (!invoice_id || !plate || !phone || !ic_first6) {
      return new Response(JSON.stringify({ error: 'invoice_id, plate, phone, and ic_first6 are required' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: verified, error: verifyErr } = await supabase.rpc('portal_verify_invoice_access', {
      p_invoice_id: invoice_id, p_plate: plate, p_phone: phone, p_ic_first6: ic_first6,
    })
    if (verifyErr || !verified) {
      return new Response(JSON.stringify({ error: 'Could not verify your identity for this invoice' }), { status: 403, headers: corsHeaders })
    }

    // Refunds never get a proof_url (see raudhahpay-webhook), so this
    // naturally excludes them without an extra amount/sign check.
    const { data: receipts, error: receiptsErr } = await supabase
      .from('receipts')
      .select('id, amount, payment_method, payment_date, gateway_ref, proof_url, proof_bucket')
      .eq('invoice_id', invoice_id)
      .not('proof_url', 'is', null)
      .order('payment_date', { ascending: false })

    if (receiptsErr) {
      return new Response(JSON.stringify({ error: receiptsErr.message }), { status: 500, headers: corsHeaders })
    }

    const signed = await Promise.all((receipts ?? []).map(async (r) => {
      const { data } = await supabase.storage.from(r.proof_bucket).createSignedUrl(r.proof_url, SIGNED_URL_TTL_SECONDS)
      return {
        id: r.id, amount: r.amount, payment_method: r.payment_method,
        payment_date: r.payment_date, gateway_ref: r.gateway_ref, url: data?.signedUrl ?? null,
      }
    }))

    return new Response(JSON.stringify({ receipts: signed.filter(r => r.url) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
