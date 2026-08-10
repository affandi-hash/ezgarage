// Returns a job invoice's payment receipts for the customer portal, plus
// the invoice/branch fields needed to render them with the same
// ReceiptSheet design used for staff-printed receipts (see
// components/receipts/ReceiptSheet.tsx) -- rather than a link to the bare
// pdf-lib PDF raudhahpay-webhook generates for the internal staff-facing
// proof-of-payment record. Re-verifies identity server-side (same as
// esp-receipt's pattern) before returning anything.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('invoice_number, customer_name, vehicle_plate, status, subtotal, discount_amount, total_amount, branch_id')
      .eq('id', invoice_id)
      .single()
    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404, headers: corsHeaders })
    }

    const { data: branch } = await supabase
      .from('branches')
      .select('name, address, phone, email, logo_url')
      .eq('id', invoice.branch_id)
      .single()

    // Refund rows carry a negative amount and no reason to show a receipt
    // for one, so only real charges are returned here.
    const { data: receipts, error: receiptsErr } = await supabase
      .from('receipts')
      .select('id, amount, payment_method, payment_date, gateway_ref')
      .eq('invoice_id', invoice_id)
      .gt('amount', 0)
      .order('payment_date', { ascending: false })

    if (receiptsErr) {
      return new Response(JSON.stringify({ error: receiptsErr.message }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({
      invoice: { invoice_number: invoice.invoice_number, customer_name: invoice.customer_name, vehicle_plate: invoice.vehicle_plate, status: invoice.status, subtotal: invoice.subtotal, discount_amount: invoice.discount_amount, total_amount: invoice.total_amount },
      branch: branch ?? null,
      receipts: (receipts ?? []).map(r => ({
        receipt_id: r.id, amount: r.amount, payment_method: r.payment_method, payment_date: r.payment_date, payment_reference: r.gateway_ref,
      })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
