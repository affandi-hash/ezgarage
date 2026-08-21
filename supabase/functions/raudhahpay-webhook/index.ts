// Receives payment status webhooks from RaudhahPay. Verifies the HMAC
// signature, then records successful payments into the same `receipts`
// ledger used by staff-recorded payments (Invoices "Record Payment" and
// Accounts Receivable "Add Payment"), so all three sources stay consistent.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

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

// Auto-generated proof of payment for a RaudhahPay charge — replaces the
// screenshot-then-staff-upload dance for online payments. The customer
// already gets RaudhahPay's own receipt, so this is purely for staff to
// have something on file without asking the customer for anything.
interface ReceiptPdfInput {
  invoiceNumber: string
  customerName: string | null
  amount: number
  paymentMethod: string
  paymentDate: string
  gatewayRef: string
  branch: { name: string; address: string | null; phone: string | null } | null
}

async function buildReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pageWidth = 420, pageHeight = 560, margin = 36
  const page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  function text(str: string, x: number, size: number, bold = false, color = rgb(0, 0, 0)) {
    page.drawText(str, { x, y, size, font: bold ? fontBold : font, color })
  }

  text(input.branch?.name || 'EZGarage', margin, 16, true)
  y -= 18
  if (input.branch?.address) { text(input.branch.address, margin, 9, false, rgb(0.4, 0.4, 0.4)); y -= 12 }
  if (input.branch?.phone) { text(`Tel: ${input.branch.phone}`, margin, 9, false, rgb(0.4, 0.4, 0.4)); y -= 12 }
  y -= 12
  text('PAYMENT RECEIPT', margin, 14, true)
  y -= 24

  const row = (label: string, value: string) => {
    text(label, margin, 10, false, rgb(0.4, 0.4, 0.4))
    text(value, margin + 140, 10, true)
    y -= 18
  }
  row('Invoice No.', input.invoiceNumber)
  row('Customer', input.customerName || '—')
  row('Payment Method', input.paymentMethod.replace('_', ' ').toUpperCase())
  row('Payment Date', input.paymentDate)
  row('Gateway Ref', input.gatewayRef)
  y -= 8
  text(`Amount Paid: RM ${input.amount.toFixed(2)}`, margin, 13, true)
  y -= 28
  text('Paid online via RaudhahPay.', margin, 9, false, rgb(0.4, 0.4, 0.4))

  return pdf.save()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text()

  // Logs every incoming POST before any verification, for diagnostic
  // visibility (this is how the 2026-08-03/08-06 stale-secret incidents
  // were actually diagnosed) -- but that means it also logs genuinely
  // unauthenticated/forged requests. signature_valid is set explicitly
  // below on every exit path so reconcile_missed_raudhahpay_webhooks()
  // (121) has a real, code-enforced way to tell "RaudhahPay actually said
  // this succeeded" apart from "someone POSTed a payload that merely
  // claims to" -- treating an unverified row as trustworthy would let
  // anyone mark any invoice paid for free by POSTing straight to this
  // public URL.
  const debugClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let debugLogId: string | null = null
  try {
    const { data: logRow } = await debugClient.from('webhook_debug_log').insert({
      headers: Object.fromEntries(req.headers.entries()),
      raw_body: rawBody,
    }).select('id').single()
    debugLogId = logRow?.id ?? null
  } catch (e) {
    console.error('debug log insert failed', e)
  }

  async function markVerification(valid: boolean, secretSource: string, resolvedInvoiceId: string | null) {
    if (!debugLogId) return
    try {
      await debugClient.from('webhook_debug_log')
        .update({ signature_valid: valid, secret_source: secretSource, resolved_invoice_id: resolvedInvoiceId })
        .eq('id', debugLogId)
    } catch (e) {
      console.error('debug log verification update failed', e)
    }
  }

  // RaudhahPay signs webhooks with a dedicated webhook secret, not the API
  // key — confirmed against a real live delivery's signature.
  const timestamp = req.headers.get('x-webhook-timestamp') ?? ''
  const signature = req.headers.get('x-webhook-signature') ?? ''

  if (!timestamp || !signature) {
    await markVerification(false, 'n/a', null)
    return new Response('Missing signature headers', { status: 401 })
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    await markVerification(false, 'n/a', null)
    return new Response('Timestamp too old', { status: 401 })
  }

  let event: { event: string; data?: Record<string, unknown>; [key: string]: unknown }
  try {
    event = JSON.parse(rawBody)
  } catch {
    await markVerification(false, 'n/a', null)
    return new Response('Invalid JSON', { status: 400 })
  }

  // The documented payload nests fields under `data`, but real deliveries
  // (confirmed via the dashboard's "Test" button) send them flat on the
  // top-level event object instead. Support both shapes defensively.
  const data = event.data ?? event

  // Each tenant can have their own RaudhahPay merchant account (and
  // therefore their own webhook secret) — look up which one this delivery
  // belongs to via the invoice referenced in the payload BEFORE trusting
  // anything in it, then verify the signature with that tenant's secret
  // (falling back to the project-wide default for tenants without their
  // own). This can only be done after parsing the body, so the signature
  // check happens here instead of before parsing, unlike a single-secret
  // setup would allow.
  const supabaseForLookup = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const lookupInvoiceId = (data.order_no as string) || (data.metadata as { invoice_id?: string })?.invoice_id
  let webhookSecret = Deno.env.get('RAUDHAHPAY_WEBHOOK_SECRET')!
  let secretSource = 'project_default'
  if (lookupInvoiceId) {
    const { data: invoiceForSecret } = await supabaseForLookup
      .from('invoices')
      .select('tenant_id, tenants(raudhahpay_webhook_secret)')
      .eq('id', lookupInvoiceId)
      .single()
    const tenantSecret = (invoiceForSecret as { tenants?: { raudhahpay_webhook_secret?: string | null } } | null)?.tenants?.raudhahpay_webhook_secret
    if (tenantSecret) { webhookSecret = tenantSecret; secretSource = 'tenant_override' }
  }

  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`)
  if (!constantTimeEqual(expected, signature)) {
    await markVerification(false, secretSource, lookupInvoiceId ?? null)
    return new Response('Invalid signature', { status: 401 })
  }
  await markVerification(true, secretSource, lookupInvoiceId ?? null)

  const REFUND_EVENTS = new Set(['payment.refunded', 'payment.partial_refunded'])

  // These never created a receipt in the first place (the checkout never
  // completed) -- but the reason WHY is worth keeping around for staff to
  // see without filing a support ticket, so persist it instead of only
  // console.log'ing it. webhook_debug_log isn't a substitute for this: it's
  // a temporary diagnostic table, documented as safe to drop once its
  // original purpose (a signature-verification bug) was resolved.
  if (['payment.failed', 'payment.expired', 'payment.rejected', 'payment.cancelled'].includes(event.event)) {
    const invoiceId = (data.order_no as string) || (data.metadata as { invoice_id?: string })?.invoice_id
    if (invoiceId) {
      const supabaseForFailure = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: invoiceForFailure } = await supabaseForFailure.from('invoices').select('tenant_id').eq('id', invoiceId).single()
      if (invoiceForFailure) {
        await supabaseForFailure.from('invoice_payment_failures').insert({
          tenant_id: invoiceForFailure.tenant_id,
          invoice_id: invoiceId,
          bill_id: (data.bill_id as string) ?? null,
          event: event.event,
          failure_code: (data.failure_code as string) ?? null,
          failure_reason: (data.failure_reason as string) ?? null,
          gateway_status: (data.gateway_status as string) ?? null,
          reference_number: (data.reference_number as string) ?? null,
        }).then(({ error }) => { if (error) console.error('invoice_payment_failures insert failed:', error.message) })
      }
    }
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
      .select('id, tenant_id, branch_id, total_amount, amount_paid, invoice_number, customer_name')
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
    const paymentDate = new Date().toISOString().slice(0, 10)

    // Generate the proof-of-payment PDF up front (only for actual charges,
    // not refunds) and pick the receipt's id ourselves so the upload path
    // and the receipts insert can both use it — one atomic insert with
    // proof_url already set, instead of insert-then-update-with-the-url
    // (the same two-step pattern that silently left staff-recorded
    // payments without their proof before 092 fixed that flow).
    const receiptId = crypto.randomUUID()
    let proofUrl: string | null = null
    if (!isRefund) {
      try {
        const { data: branch } = await supabase
          .from('branches')
          .select('name, address, phone')
          .eq('id', invoice.branch_id)
          .single()
        const pdfBytes = await buildReceiptPdf({
          invoiceNumber: invoice.invoice_number,
          customerName: invoice.customer_name,
          amount,
          paymentMethod: data.payment_method as string,
          paymentDate,
          gatewayRef,
          branch: branch ?? null,
        })
        const path = `${receiptId}/${Date.now()}.pdf`
        const { error: uploadErr } = await supabase.storage.from('payment-proofs').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: false })
        if (uploadErr) throw uploadErr
        proofUrl = path
      } catch (e) {
        // Don't let a PDF/storage hiccup block recording the payment itself
        // — staff can always attach proof manually as a fallback.
        console.error(`Failed to generate/upload receipt PDF for invoice ${invoice.id}`, e)
      }
    }

    const { error: receiptErr } = await supabase.from('receipts').insert({
      id: receiptId,
      tenant_id: invoice.tenant_id,
      branch_id: invoice.branch_id,
      invoice_id: invoice.id,
      amount: signedAmount,
      payment_method: data.payment_method as string,
      payment_date: paymentDate,
      reference_number: data.reference_number as string,
      gateway_ref: gatewayRef,
      notes,
      proof_url: proofUrl,
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
      invoiceUpdate.payment_date = paymentDate
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
