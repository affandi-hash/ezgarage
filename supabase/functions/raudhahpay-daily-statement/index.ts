// Generates a PDF reconciliation statement of the previous day's RaudhahPay
// transactions across every tenant, and emails it to Chip In Sdn Bhd so
// they know what to disburse (T+1) and to which underlying business.
// Triggered by pg_cron nightly at 00:00 MYT (16:00 UTC); can also be
// invoked manually (with an optional { date } override) from the
// Platform Settings "Send Now" button.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function yesterdayInMYT(): string {
  const nowUtc = new Date()
  const myt = new Date(nowUtc.getTime() + 8 * 3600 * 1000)
  myt.setUTCDate(myt.getUTCDate() - 1)
  return myt.toISOString().slice(0, 10)
}

interface ReceiptRow {
  amount: number
  payment_method: string
  payment_date: string
  gateway_ref: string | null
  created_at: string
  invoices: { invoice_number: string; tenant_id: string } | null
}

interface TenantInfo {
  id: string
  name: string
  legal_business_name: string | null
  ssm_registration_number: string | null
  settlement_bank_name: string | null
  settlement_bank_account_number: string | null
  settlement_bank_account_name: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // This aggregates every tenant's financial data in one call — restrict
    // it to the trusted cron job (calling with the service role key
    // directly) or a real platform admin. Gated on is_platform_admin
    // specifically, NOT the tenant-scoped `role` column — a tenant's own
    // super_admin has no legitimate reason to see every other tenant's
    // revenue, and coupling this to `role` would silently grant it to
    // them the moment anyone ever holds that role in a second tenant.
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
    const targetDate: string = body.date || yesterdayInMYT()

    const { data: settings } = await supabase.from('platform_settings').select('raudhahpay_pic_email, daily_statement_enabled').single()

    if (!body.manual && !settings?.daily_statement_enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: 'daily_statement_enabled is off' }), { headers: corsHeaders })
    }
    if (!settings?.raudhahpay_pic_email) {
      return new Response(JSON.stringify({ error: 'RaudhahPay PIC email not configured in Platform Settings' }), { status: 200, headers: corsHeaders })
    }
    // Supports multiple recipients as a comma-separated list in the one
    // settings field, e.g. "ops@chipin.com.my, finance@chipin.com.my".
    const recipients = settings.raudhahpay_pic_email.split(',').map((e: string) => e.trim()).filter(Boolean)

    const { data: receipts, error: receiptsErr } = await supabase
      .from('receipts')
      .select('amount, payment_method, payment_date, gateway_ref, created_at, invoices(invoice_number, tenant_id)')
      .eq('payment_date', targetDate)
      .not('gateway_ref', 'is', null)
      .order('created_at')

    if (receiptsErr) throw receiptsErr

    const rows = (receipts ?? []) as unknown as ReceiptRow[]

    // Group by tenant
    const byTenant = new Map<string, ReceiptRow[]>()
    for (const r of rows) {
      const tenantId = r.invoices?.tenant_id
      if (!tenantId) continue
      if (!byTenant.has(tenantId)) byTenant.set(tenantId, [])
      byTenant.get(tenantId)!.push(r)
    }

    const tenantIds = [...byTenant.keys()]
    let tenants: TenantInfo[] = []
    if (tenantIds.length > 0) {
      const { data } = await supabase
        .from('tenants')
        .select('id, name, legal_business_name, ssm_registration_number, settlement_bank_name, settlement_bank_account_number, settlement_bank_account_name')
        .in('id', tenantIds)
      tenants = data ?? []
    }
    const tenantById = new Map(tenants.map(t => [t.id, t]))

    const grandTotal = rows.reduce((s, r) => s + Number(r.amount), 0)

    // ── Build the PDF ──────────────────────────────────────────────────
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const pageWidth = 595.28, pageHeight = 841.89, margin = 40
    let page = pdf.addPage([pageWidth, pageHeight])
    let y = pageHeight - margin

    function newPageIfNeeded(neededSpace: number) {
      if (y - neededSpace < margin) {
        page = pdf.addPage([pageWidth, pageHeight])
        y = pageHeight - margin
      }
    }
    function text(str: string, x: number, size: number, bold = false, color = rgb(0, 0, 0)) {
      page.drawText(str, { x, y, size, font: bold ? fontBold : font, color })
    }

    text('EZGarage — RaudhahPay Daily Reconciliation Statement', margin, 16, true)
    y -= 22
    text(`Statement date: ${targetDate}`, margin, 11)
    y -= 16
    text(`Generated: ${new Date().toISOString()}`, margin, 9, false, rgb(0.4, 0.4, 0.4))
    y -= 24

    if (byTenant.size === 0) {
      text('No RaudhahPay transactions recorded for this date.', margin, 11)
      y -= 20
    }

    for (const [tenantId, tRows] of byTenant) {
      const t = tenantById.get(tenantId)
      newPageIfNeeded(90)
      text(t?.legal_business_name || t?.name || tenantId, margin, 13, true)
      y -= 16
      if (t?.ssm_registration_number) { text(`SSM: ${t.ssm_registration_number}`, margin, 9, false, rgb(0.4, 0.4, 0.4)); y -= 12 }
      if (t?.settlement_bank_name) {
        text(`Settlement: ${t.settlement_bank_name} · ${t.settlement_bank_account_number ?? '—'} · ${t.settlement_bank_account_name ?? '—'}`, margin, 9, false, rgb(0.4, 0.4, 0.4))
        y -= 12
      }
      y -= 6

      // Table header
      newPageIfNeeded(20)
      text('Invoice #', margin, 9, true)
      text('Gateway Ref', margin + 110, 9, true)
      text('Method', margin + 250, 9, true)
      text('Time', margin + 320, 9, true)
      text('Amount (RM)', margin + 420, 9, true)
      y -= 14

      let tenantTotal = 0
      for (const r of tRows) {
        newPageIfNeeded(14)
        const amount = Number(r.amount)
        tenantTotal += amount
        text(r.invoices?.invoice_number ?? '—', margin, 9)
        text((r.gateway_ref ?? '—').slice(0, 24), margin + 110, 9)
        text(r.payment_method ?? '—', margin + 250, 9)
        text(new Date(r.created_at).toISOString().slice(11, 16), margin + 320, 9)
        text(amount.toFixed(2), margin + 420, 9, false, amount < 0 ? rgb(0.7, 0, 0) : rgb(0, 0, 0))
        y -= 13
      }

      newPageIfNeeded(20)
      y -= 4
      text(`Subtotal: RM ${tenantTotal.toFixed(2)}`, margin + 320, 10, true)
      y -= 26
    }

    newPageIfNeeded(30)
    text(`GRAND TOTAL: RM ${grandTotal.toFixed(2)}`, margin, 13, true)

    const pdfBytes = await pdf.save()
    const pdfBase64 = btoa(String.fromCharCode(...pdfBytes))

    // ── Send email ───────────────────────────────────────────────────────
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'EZGarage <onboarding@resend.dev>',
        to: recipients,
        subject: `EZGarage RaudhahPay Statement — ${targetDate}`,
        html: `<p>Attached is the RaudhahPay reconciliation statement for <strong>${targetDate}</strong>.</p>
               <p>${rows.length} transaction(s) across ${byTenant.size} tenant(s), grand total RM ${grandTotal.toFixed(2)}.</p>`,
        attachments: [{ filename: `raudhahpay-statement-${targetDate}.pdf`, content: pdfBase64 }],
      }),
    })

    const sendOk = resendRes.ok
    const errBody = sendOk ? null : await resendRes.text()
    if (!sendOk) console.error('raudhahpay-daily-statement: Resend send failed', resendRes.status, errBody)

    await supabase.from('raudhahpay_statement_log').upsert({
      statement_date: targetDate,
      recipient_email: settings.raudhahpay_pic_email,
      total_amount: grandTotal,
      transaction_count: rows.length,
      status: sendOk ? 'sent' : 'failed',
      error_message: sendOk ? null : errBody,
      sent_at: new Date().toISOString(),
    }, { onConflict: 'statement_date' })

    if (!sendOk) {
      return new Response(JSON.stringify({ error: 'Failed to send statement email' }), { status: 200, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ success: true, targetDate, transactionCount: rows.length, grandTotal }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('raudhahpay-daily-statement error', e)
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
