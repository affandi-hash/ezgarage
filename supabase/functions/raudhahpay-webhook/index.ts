// Receives payment status webhooks from RaudhahPay. Verifies the HMAC
// signature, then records successful payments into the same `receipts`
// ledger used by staff-recorded payments (Invoices "Record Payment" and
// Accounts Receivable "Add Payment"), so all three sources stay consistent.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_CLOCK_SKEW_SECONDS = 300

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text()

  // TEMPORARY DIAGNOSTIC — remove once signature verification is confirmed working.
  try {
    const debugClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await debugClient.from('webhook_debug_log').insert({
      headers: Object.fromEntries(req.headers.entries()),
      raw_body: rawBody,
    })
  } catch (e) {
    console.error('debug log insert failed', e)
  }

  // TEMPORARY, SANDBOX-ONLY: RaudhahPay's real checkout-completion webhooks
  // don't match the secret shown in their dashboard (confirmed via multiple
  // byte-exact self-tests — our implementation matches their documented spec;
  // this looks like a bug on their side). Bypassing verification here so we
  // can keep building against the rest of the flow. MUST be removed / set to
  // "false" before any live/production RaudhahPay key is used.
  const skipVerification = Deno.env.get('RAUDHAHPAY_SKIP_SIGNATURE_CHECK') === 'true'

  if (!skipVerification) {
    const timestamp = req.headers.get('x-webhook-timestamp') ?? ''
    const signature = req.headers.get('x-webhook-signature') ?? ''

    if (!timestamp || !signature) return new Response('Missing signature headers', { status: 401 })
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
      return new Response('Timestamp too old', { status: 401 })
    }

    const expected = await hmacSha256Hex(Deno.env.get('RAUDHAHPAY_WEBHOOK_SECRET')!, `${timestamp}.${rawBody}`)
    if (!constantTimeEqual(expected, signature)) {
      return new Response('Invalid signature', { status: 401 })
    }
  } else {
    console.warn('RAUDHAHPAY_SKIP_SIGNATURE_CHECK is enabled — webhook signature was NOT verified')
  }

  let event: { event: string; data?: Record<string, unknown>; [key: string]: unknown }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // The documented payload nests fields under `data`, but real deliveries
  // (confirmed via the dashboard's "Test" button) send them flat on the
  // top-level event object instead. Support both shapes defensively.
  const data = event.data ?? event

  // Always ack quickly — RaudhahPay retries non-2xx responses for hours.
  if (event.event !== 'payment.success') {
    console.log(`Ignoring event ${event.event} for bill ${data?.bill_id}`)
    return new Response('ok', { status: 200 })
  }

  try {
    const invoiceId = (data.order_no as string) || (data.metadata as { invoice_id?: string })?.invoice_id
    const amount = Number(data.amount)
    const billId = data.bill_id as string

    if (!invoiceId || !amount || !billId) {
      console.error('payment.success webhook missing invoice_id/amount/bill_id', data)
      return new Response('ok', { status: 200 })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('id, tenant_id, branch_id, total_amount, amount_paid')
      .eq('id', invoiceId)
      .single()

    if (invErr || !invoice) {
      console.error(`payment.success webhook: invoice ${invoiceId} not found`, invErr)
      return new Response('ok', { status: 200 })
    }

    const { error: receiptErr } = await supabase.from('receipts').insert({
      tenant_id: invoice.tenant_id,
      branch_id: invoice.branch_id,
      invoice_id: invoice.id,
      amount,
      payment_method: data.payment_method as string,
      payment_date: new Date().toISOString().slice(0, 10),
      reference_number: data.reference_number as string,
      gateway_ref: billId,
      notes: `RaudhahPay online payment (${data.payment_method})`,
    })

    if (receiptErr) {
      // Unique violation on gateway_ref = this bill was already processed
      // (retried delivery). Idempotent no-op — don't double-credit the invoice.
      if (receiptErr.code === '23505') {
        return new Response('ok', { status: 200 })
      }
      throw receiptErr
    }

    const newPaid = Number(invoice.amount_paid) + amount
    const newStatus = newPaid >= Number(invoice.total_amount) ? 'paid' : 'sent'
    await supabase.from('invoices').update({ amount_paid: newPaid, status: newStatus }).eq('id', invoice.id)

    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('Error processing payment.success webhook', e)
    // 500 so RaudhahPay retries — this path only hits on unexpected DB errors.
    return new Response('error', { status: 500 })
  }
})
