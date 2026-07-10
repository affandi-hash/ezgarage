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

  // RaudhahPay signs webhooks with a dedicated webhook secret, not the API
  // key — confirmed against a real live delivery's signature.
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

  const REFUND_EVENTS = new Set(['payment.refunded', 'payment.partial_refunded'])

  // These never created a receipt in the first place (the checkout never
  // completed), so there's nothing in the ledger to reconcile — just ack
  // with a clear, distinguishable log line per event type.
  if (['payment.failed', 'payment.expired', 'payment.rejected', 'payment.cancelled'].includes(event.event)) {
    const invoiceId = (data.order_no as string) || (data.metadata as { invoice_id?: string })?.invoice_id
    console.log(`RaudhahPay ${event.event}: bill ${data?.bill_id}, invoice ${invoiceId} — no receipt was recorded, no action needed`)
    return new Response('ok', { status: 200 })
  }

  if (!REFUND_EVENTS.has(event.event) && event.event !== 'payment.success') {
    console.log(`Ignoring unrecognized event ${event.event} for bill ${data?.bill_id}`)
    return new Response('ok', { status: 200 })
  }

  try {
    const invoiceId = (data.order_no as string) || (data.metadata as { invoice_id?: string })?.invoice_id
    const amount = Number(data.amount)
    const billId = data.bill_id as string

    if (!invoiceId || !amount || !billId) {
      console.error(`${event.event} webhook missing invoice_id/amount/bill_id`, data)
      return new Response('ok', { status: 200 })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('id, tenant_id, branch_id, total_amount, amount_paid')
      .eq('id', invoiceId)
      .single()

    if (invErr || !invoice) {
      console.error(`${event.event} webhook: invoice ${invoiceId} not found`, invErr)
      return new Response('ok', { status: 200 })
    }

    const isRefund = REFUND_EVENTS.has(event.event)
    // Refunds reverse a prior payment.success receipt, so they need a
    // gateway_ref distinct from the original charge (which already owns
    // `billId`). A single bill can be partially refunded more than once, so
    // `billId` alone isn't unique enough either — key off the per-delivery
    // X-Webhook-Id instead, which RaudhahPay keeps stable across retries of
    // the *same* refund event but distinct across separate refund events.
    const webhookId = req.headers.get('x-webhook-id')
    const signedAmount = isRefund ? -amount : amount
    const gatewayRef = isRefund ? `refund:${webhookId || billId}` : billId
    const notes = isRefund
      ? `RaudhahPay refund (${event.event}) for bill ${billId}`
      : `RaudhahPay online payment (${data.payment_method})`

    const { error: receiptErr } = await supabase.from('receipts').insert({
      tenant_id: invoice.tenant_id,
      branch_id: invoice.branch_id,
      invoice_id: invoice.id,
      amount: signedAmount,
      payment_method: data.payment_method as string,
      payment_date: new Date().toISOString().slice(0, 10),
      reference_number: data.reference_number as string,
      gateway_ref: gatewayRef,
      notes,
    })

    if (receiptErr) {
      // Unique violation on gateway_ref = this bill/refund was already
      // processed (retried delivery). Idempotent no-op either way — don't
      // double-credit or double-reverse the invoice.
      if (receiptErr.code === '23505') {
        return new Response('ok', { status: 200 })
      }
      throw receiptErr
    }

    const newPaid = isRefund
      ? Math.max(0, Number(invoice.amount_paid) - amount)
      : Number(invoice.amount_paid) + amount
    const newStatus = newPaid >= Number(invoice.total_amount) ? 'paid' : 'sent'

    // ReceiptsPage/PrintReceiptPage read payment_method/payment_date/
    // payment_reference off the invoice row itself (not the receipts
    // ledger), same as the staff "Record Payment" flow — without setting
    // these here, online payments showed up with a blank method and the
    // print template's null-fallback literally printed "CASH", which is
    // wrong and useless for finance reconciling against RaudhahPay.
    //
    // invoices.payment_method is a Postgres ENUM (cash/card/online_transfer/
    // cheque/other/qr/bank_transfer) — RaudhahPay's own method names
    // (duitnow/credit_card/fpx) aren't valid values for it, and since this
    // is a single UPDATE statement, an invalid enum value would fail the
    // *whole* update, including amount_paid. Map to the closest existing
    // enum label used by staff's own "Record Payment" flow instead.
    const INVOICE_PAYMENT_METHOD_MAP: Record<string, string> = {
      duitnow: 'qr',
      credit_card: 'card',
      fpx: 'bank_transfer',
    }
    const invoiceUpdate: Record<string, unknown> = { amount_paid: newPaid, status: newStatus }
    if (!isRefund) {
      invoiceUpdate.payment_method = INVOICE_PAYMENT_METHOD_MAP[data.payment_method as string] ?? 'other'
      invoiceUpdate.payment_date = new Date().toISOString().slice(0, 10)
      invoiceUpdate.payment_reference = billId
    }
    const { error: invoiceUpdateErr } = await supabase.from('invoices').update(invoiceUpdate).eq('id', invoice.id)
    if (invoiceUpdateErr) {
      // The receipts row above already recorded the payment — this is a
      // secondary denormalization step, so log loudly but don't fail the
      // whole webhook (would cause RaudhahPay to retry and double-insert
      // a receipt, were it not for the gateway_ref unique index).
      console.error(`Failed to update invoice ${invoice.id} after ${event.event}`, invoiceUpdateErr)
    }

    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error(`Error processing ${event.event} webhook`, e)
    // 500 so RaudhahPay retries — this path only hits on unexpected DB errors.
    return new Response('error', { status: 500 })
  }
})
