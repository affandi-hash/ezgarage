// Creates a RaudhahPay payment session for an outstanding invoice and returns
// the checkout URL. Called from the customer portal — keeps the RaudhahPay
// API key server-side, never exposed to the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// LIVE endpoint — real payments, real money. Sandbox testing is complete;
// see raudhahpay-webhook/index.ts for the known sandbox signature-verification
// bug that prompted the move to live directly.
const RAUDHAHPAY_BASE_URL = 'https://jwfrkqnfjrorrygqhdbs.supabase.co/functions/v1/merchant-api'

function toE164(phone: string | null): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('60')) return `+${digits}`
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`
  return `+${digits}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { invoice_id, payment_method, amount: requestedAmount, redirect_url, plate, phone: requestPhone, ic_first6 } = await req.json()

    if (!invoice_id || !['fpx', 'duitnow', 'credit_card'].includes(payment_method)) {
      return new Response(JSON.stringify({ error: 'invoice_id and payment_method ("fpx", "duitnow", or "credit_card") are required' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('id, invoice_number, tenant_id, branch_id, customer_name, customer_email, customer_phone, total_amount, amount_paid, balance_due, status, esp_member_id')
      .eq('id', invoice_id)
      .single()

    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404, headers: corsHeaders })
    }

    // Re-verify identity before creating a real payment session -- a bare
    // invoice_id was previously enough. ESP membership-fee invoices have
    // job_id = NULL, so they can never satisfy portal_verify_invoice_access's
    // hard invoices->jobs->vehicles join; use the ESP-specific sibling
    // (phone + first-6-IC-digits against esp_members->customers, no
    // plate/vehicle involved) instead. Ordinary job invoices are unaffected.
    const verifyRpc = invoice.esp_member_id ? 'esp_verify_invoice_access' : 'portal_verify_invoice_access'
    const verifyArgs = invoice.esp_member_id
      ? { p_invoice_id: invoice_id, p_phone: requestPhone, p_ic_first6: ic_first6 }
      : { p_invoice_id: invoice_id, p_plate: plate, p_phone: requestPhone, p_ic_first6: ic_first6 }
    const { data: verified, error: verifyErr } = await supabase.rpc(verifyRpc, verifyArgs)
    if (verifyErr || !verified) {
      return new Response(JSON.stringify({ error: 'Could not verify your identity for this invoice' }), { status: 403, headers: corsHeaders })
    }

    // Each tenant can plug in their own RaudhahPay merchant account so their
    // customers' payments settle to them, not to Motoverse's own account.
    // Falls back to the project-wide key for tenants who haven't set one.
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('raudhahpay_api_key')
      .eq('id', invoice.tenant_id)
      .single()
    const raudhahpayApiKey = tenantRow?.raudhahpay_api_key || Deno.env.get('RAUDHAHPAY_API_KEY')
    if (invoice.status === 'void') {
      return new Response(JSON.stringify({ error: 'Invoice has been voided' }), { status: 400, headers: corsHeaders })
    }
    if (invoice.balance_due <= 0) {
      return new Response(JSON.stringify({ error: 'Invoice is already fully paid' }), { status: 400, headers: corsHeaders })
    }

    const amount = requestedAmount ? Number(requestedAmount) : Number(invoice.balance_due)
    if (!amount || amount <= 0 || amount > invoice.balance_due + 0.01) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), { status: 400, headers: corsHeaders })
    }

    const email = invoice.customer_email?.trim() || `invoice-${invoice.id}@no-email.motoverse.local`
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/raudhahpay-webhook`

    const payload: Record<string, unknown> = {
      action: 'create-bill',
      title: `Invoice ${invoice.invoice_number}`,
      amount,
      payment_method,
      customer_name: invoice.customer_name || 'Customer',
      customer_email: email,
      callback_url: webhookUrl,
      order_no: invoice.id,
      metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number },
    }
    const phone = toE164(invoice.customer_phone)
    if (phone) payload.customer_phone = phone
    if (redirect_url) payload.redirect_url = redirect_url

    const rpRes = await fetch(RAUDHAHPAY_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${raudhahpayApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    })

    const rpData = await rpRes.json()
    if (!rpRes.ok) {
      return new Response(JSON.stringify({ error: rpData?.message || rpData?.error || 'RaudhahPay request failed' }), { status: rpRes.status, headers: corsHeaders })
    }

    return new Response(JSON.stringify({
      payment_url: rpData.payment_url,
      qr: rpData.qr ?? null,
      bill_id: rpData.bill_id,
      expires_at: rpData.expires_at,
      amount: rpData.amount,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
