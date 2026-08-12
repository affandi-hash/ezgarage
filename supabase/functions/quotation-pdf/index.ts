// Generates a PDF of a quotation and returns a signed URL to it, so a
// "Send via WhatsApp" action has an actual document to link to instead of
// the message being the only record that a quote was ever communicated.
// Mirrors QuotationsPage's own print view content (same fields, same
// branding) but drawn with pdf-lib since this runs server-side with no
// browser to print from.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days -- comfortably past any realistic quote validity window

const ORANGE = rgb(0.945, 0.353, 0.133) // #F15A22
const GREY = rgb(0.4, 0.4, 0.4)
const BLACK = rgb(0.07, 0.07, 0.07)

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtRM(n: number) {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller } } = await anonClient.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: callerProfile } = await anonClient.from('users').select('role, tenant_id').eq('id', caller.id).single()
    if (!callerProfile || !['super_admin', 'ops_manager', 'front_desk', 'foreman'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: corsHeaders })
    }

    const { quotation_id } = await req.json()
    if (!quotation_id) return new Response(JSON.stringify({ error: 'quotation_id is required' }), { status: 400, headers: corsHeaders })

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: quote, error: quoteErr } = await adminClient.from('quotations').select('*').eq('id', quotation_id).eq('tenant_id', callerProfile.tenant_id).single()
    if (quoteErr || !quote) return new Response(JSON.stringify({ error: 'Quotation not found' }), { status: 404, headers: corsHeaders })

    const [{ data: items }, { data: branch }] = await Promise.all([
      adminClient.from('quotation_items').select('*').eq('quotation_id', quotation_id).order('sort_order'),
      adminClient.from('branches').select('name, address, phone, email, logo_url').eq('id', quote.branch_id).single().then(r => ({ data: r.data })),
    ])
    const lineItems = items ?? []

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const pageWidth = 595.28, pageHeight = 841.89, margin = 40
    let page = pdf.addPage([pageWidth, pageHeight])
    let y = pageHeight - margin

    function newPageIfNeeded(space: number) {
      if (y - space < margin) { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin }
    }
    function text(str: string, x: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'right' } = {}) {
      const f = opts.bold ? fontBold : font
      const width = opts.align === 'right' ? f.widthOfTextAtSize(str, size) : 0
      page.drawText(str, { x: opts.align === 'right' ? x - width : x, y, size, font: f, color: opts.color ?? BLACK })
    }
    // Header
    text(branch?.name ?? 'MOTOVERSE GARAGE', margin, 16, { bold: true, color: ORANGE })
    y -= 16
    if (branch?.address) { text(branch.address, margin, 9, { color: GREY }); y -= 12 }
    if (branch?.phone || branch?.email) {
      text([branch?.phone && `Tel: ${branch.phone}`, branch?.email].filter(Boolean).join(' · '), margin, 9, { color: GREY })
      y -= 12
    }
    text('QUOTATION', pageWidth - margin, 16, { bold: true, align: 'right' })
    const headerRightY = y
    y -= 16
    text(`No: ${quote.quote_number}`, pageWidth - margin, 10, { align: 'right' })
    y -= 13
    text(`Date: ${fmtDate(quote.created_at)}`, pageWidth - margin, 10, { align: 'right' })
    y -= 13
    text(`Valid Until: ${fmtDate(quote.valid_until)}`, pageWidth - margin, 10, { align: 'right', color: quote.status === 'expired' ? rgb(0.75, 0.2, 0.2) : BLACK })
    y = Math.min(y, headerRightY - 55)
    y -= 6
    page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: pageWidth - margin, y: y + 4 }, thickness: 1.5, color: ORANGE })
    y -= 16

    // Customer / vehicle
    text('CUSTOMER', margin, 9, { bold: true, color: GREY })
    text('VEHICLE', pageWidth / 2 + 10, 9, { bold: true, color: GREY })
    y -= 13
    text(quote.customer_name || '—', margin, 12, { bold: true })
    text(quote.vehicle_plate || '—', pageWidth / 2 + 10, 12, { bold: true })
    y -= 14
    if (quote.customer_phone) { text(quote.customer_phone, margin, 10, { color: GREY }) }
    const vehicleLine = [quote.vehicle_year, quote.vehicle_make, quote.vehicle_model].filter(Boolean).join(' ')
    if (vehicleLine) text(vehicleLine, pageWidth / 2 + 10, 10, { color: GREY })
    y -= 12
    if (quote.customer_email) text(quote.customer_email, margin, 10, { color: GREY })
    y -= 20

    // Line items table -- numeric columns defined by their right edge and
    // worked backwards with a real gap between each, so headers ("UNIT
    // PRICE" is the widest label at this font) can't run into their
    // neighbour the way a shared left-aligned x position let them before.
    const colNo = margin
    const colType = margin + 28
    const colDesc = margin + 95
    const amountRight = pageWidth - margin
    const unitPriceRight = amountRight - 85
    const qtyRight = unitPriceRight - 75
    newPageIfNeeded(20)
    page.drawRectangle({ x: margin, y: y - 4, width: pageWidth - margin * 2, height: 16, color: ORANGE })
    text('NO', colNo, 10, { bold: true, color: rgb(1, 1, 1) })
    text('TYPE', colType, 10, { bold: true, color: rgb(1, 1, 1) })
    text('DESCRIPTION', colDesc, 10, { bold: true, color: rgb(1, 1, 1) })
    text('QTY', qtyRight, 10, { bold: true, color: rgb(1, 1, 1), align: 'right' })
    text('UNIT PRICE', unitPriceRight, 10, { bold: true, color: rgb(1, 1, 1), align: 'right' })
    text('AMOUNT', amountRight, 10, { bold: true, color: rgb(1, 1, 1), align: 'right' })
    y -= 18

    let subtotal = 0
    const validLines = lineItems.filter(it => (it.description ?? '').trim())
    validLines.forEach((item, i) => {
      newPageIfNeeded(16)
      const amount = Number(item.qty) * Number(item.unit_price)
      subtotal += amount
      text(String(i + 1), colNo, 9)
      text(item.item_type, colType, 9, { color: GREY })
      text(item.description, colDesc, 9)
      text(String(item.qty), qtyRight, 9, { align: 'right' })
      text(fmtRM(Number(item.unit_price)), unitPriceRight, 9, { align: 'right' })
      text(fmtRM(amount), amountRight, 9, { align: 'right', bold: true })
      y -= 14
    })
    y -= 6
    page.drawLine({ start: { x: margin, y: y + 10 }, end: { x: pageWidth - margin, y: y + 10 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })

    // Totals
    newPageIfNeeded(60)
    const totalsX = pageWidth - margin - 220
    text(`SUBTOTAL (${validLines.length} items)`, totalsX, 10, { color: GREY })
    text(fmtRM(subtotal), pageWidth - margin, 10, { align: 'right' })
    y -= 16
    if (Number(quote.discount_amount) > 0) {
      text('DISCOUNT', totalsX, 10, { color: GREY })
      text(`-${fmtRM(Number(quote.discount_amount))}`, pageWidth - margin, 10, { align: 'right', color: rgb(0.75, 0.2, 0.2) })
      y -= 16
    }
    page.drawRectangle({ x: totalsX - 8, y: y - 4, width: pageWidth - margin - totalsX + 8, height: 18, color: ORANGE })
    text('TOTAL (RM)', totalsX, 11, { bold: true, color: rgb(1, 1, 1) })
    text(fmtRM(Number(quote.total_amount ?? 0)), pageWidth - margin, 12, { bold: true, color: rgb(1, 1, 1), align: 'right' })
    y -= 28

    // Notes
    if (quote.notes) {
      newPageIfNeeded(40)
      text('NOTES', margin, 9, { bold: true, color: GREY })
      y -= 13
      text(quote.notes, margin, 10)
      y -= 20
    }

    // Terms
    newPageIfNeeded(30)
    text(`This quotation is valid for ${quote.validity_days} day${quote.validity_days !== 1 ? 's' : ''} from the date of issue.`, margin, 9, { color: GREY })
    y -= 12
    text('Prices are subject to change without prior notice after the validity period.', margin, 9, { color: GREY })
    y -= 24

    // Footer
    text('Thank you for your enquiry! This quotation is computer-generated.', margin, 9, { color: rgb(0.7, 0.7, 0.7) })

    const pdfBytes = await pdf.save()
    const path = `${quotation_id}/${Date.now()}.pdf`
    const { error: uploadErr } = await adminClient.storage.from('quotation-pdfs').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: false })
    if (uploadErr) throw uploadErr

    const { data: signed, error: signErr } = await adminClient.storage.from('quotation-pdfs').createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (signErr || !signed) throw signErr ?? new Error('Failed to sign URL')

    return new Response(JSON.stringify({ url: signed.signedUrl }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('quotation-pdf error', e)
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
