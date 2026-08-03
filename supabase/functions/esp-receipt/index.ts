// Signs a short-lived URL for an ESP member's payment receipt. Both
// possible storage buckets (payment-proofs, portal-uploads -- see
// receipts.proof_bucket) are authenticated-only, so this mirrors
// portal-job-photos: re-verify identity via esp_get_receipt (same
// membership_number + phone check as esp_check_status) before using the
// service role to sign the file's URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SIGNED_URL_TTL_SECONDS = 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { membership_number, phone } = await req.json()

    if (!membership_number || !phone) {
      return new Response(JSON.stringify({ error: 'membership_number and phone are required' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: receipt, error: rpcErr } = await supabase.rpc('esp_get_receipt', {
      p_membership_number: membership_number,
      p_phone: phone,
    })
    if (rpcErr || receipt?.error) {
      const status = receipt?.error === 'phone_mismatch' ? 403 : 404
      return new Response(JSON.stringify({ error: receipt?.error ?? 'Could not find a receipt' }), { status, headers: corsHeaders })
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(receipt.proof_bucket)
      .createSignedUrl(receipt.proof_url, SIGNED_URL_TTL_SECONDS)

    if (signErr) {
      return new Response(JSON.stringify({ error: signErr.message }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({
      url: signed.signedUrl,
      amount: receipt.amount,
      payment_date: receipt.payment_date,
      payment_method: receipt.payment_method,
      invoice_number: receipt.invoice_number,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
