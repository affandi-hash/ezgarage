// Signs short-lived URLs for ESP payment receipts. Both possible storage
// buckets (payment-proofs, portal-uploads -- see receipts.proof_bucket) are
// authenticated-only, so this mirrors portal-job-photos: re-verify identity
// server-side before using the service role to sign the file's URL.
//
// Two modes, since two different callers need this:
// - { membership_number, phone } -- EspRegistrationPage.tsx right after a
//   payment succeeds (no password exists yet at that point). Single most
//   recent receipt, via esp_get_receipt (116).
// - { phone, password } -- EspMemberLoginPage.tsx's portal, once a password
//   is set. Every receipt across every membership, via
//   esp_get_receipt_paths (120).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SIGNED_URL_TTL_SECONDS = 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { membership_number, phone, password } = await req.json()
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (password) {
      if (!phone) {
        return new Response(JSON.stringify({ error: 'phone and password are required' }), { status: 400, headers: corsHeaders })
      }

      const { data: result, error: rpcErr } = await supabase.rpc('esp_get_receipt_paths', { p_phone: phone, p_password: password })
      if (rpcErr || result?.error) {
        return new Response(JSON.stringify({ error: result?.error ?? 'Could not verify identity' }), { status: 403, headers: corsHeaders })
      }

      const receipts = result.receipts as { receipt_id: string; proof_bucket: string; proof_url: string; amount: number; payment_date: string; payment_method: string; invoice_number: string }[]
      const signed = await Promise.all(receipts.map(async (r) => {
        const { data } = await supabase.storage.from(r.proof_bucket).createSignedUrl(r.proof_url, SIGNED_URL_TTL_SECONDS)
        return { ...r, url: data?.signedUrl ?? null }
      }))

      return new Response(JSON.stringify({ receipts: signed.filter(r => r.url) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!membership_number || !phone) {
      return new Response(JSON.stringify({ error: 'membership_number and phone are required' }), { status: 400, headers: corsHeaders })
    }

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
