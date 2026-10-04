// Sends queued ON-SITE booking notifications. Called every minute by pg_cron
// (migration 153). Channels are pluggable: only 'email' (Resend) is wired up;
// a 'whatsapp' sender (WATI) slots into SENDERS once a number is registered.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://ezgarage-web.vercel.app'
// Resend's sandbox sender only delivers to the account owner. Verify the
// motoversegarage.com domain in Resend and set ONSITE_FROM to go live.
const FROM = Deno.env.get('ONSITE_FROM') ?? 'Motoverse ON-SITE <onboarding@resend.dev>'

type Booking = {
  token: string; booking_number: string; customer_name: string; package_name: string | null; grade_name: string | null
  vehicle_plate: string; address: string | null; service_date: string | null; slot_label: string | null
  deposit_amount: number; price_total: number | null; refund_due_at: string | null; cancel_reason: string | null
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const rm = (n: number | null) => (n == null ? '' : 'RM ' + Number(n).toFixed(2))
const when = (b: Booking) => (b.service_date ? new Date(b.service_date + 'T00:00:00+08:00').toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur' }) + (b.slot_label ? `, ${b.slot_label}` : '') : 'to be confirmed')
const service = (b: Booking) => [b.package_name, b.grade_name].filter(Boolean).join(' · ')

type Tpl = { subject: string; lines: string[]; cta?: string }
function template(event: string, b: Booking): Tpl | null {
  const link = `${APP_URL}/on-site/status/${b.token}`
  const detail = [`Booking: ${b.booking_number}`, `Service: ${service(b)}`, `Vehicle: ${b.vehicle_plate}`, `Where: ${b.address ?? ''}`, `When: ${when(b)}`]
  switch (event) {
    case 'booking_received':
      return { subject: `Pay your deposit to confirm ${b.booking_number}`, cta: 'Pay deposit', lines: [`Hi ${b.customer_name}, we are holding your slot. Pay the ${rm(b.deposit_amount)} deposit to confirm it.`, ...detail] }
    case 'request_received':
      return { subject: `We got your request ${b.booking_number}`, cta: 'View request', lines: [`Hi ${b.customer_name}, thanks. Our team will review your request and reply here. No payment is needed yet.`, ...detail] }
    case 'request_approved':
      return { subject: `Approved: pay the deposit for ${b.booking_number}`, cta: 'Pay deposit', lines: [`Hi ${b.customer_name}, your request is approved. Pay the ${rm(b.deposit_amount)} deposit to lock the slot.`, ...detail] }
    case 'request_declined':
      return { subject: `About your request ${b.booking_number}`, cta: 'View details', lines: [`Hi ${b.customer_name}, sorry, we cannot take this request.`, b.cancel_reason ?? ''] }
    case 'deposit_received':
      return { subject: `Deposit received for ${b.booking_number}`, cta: 'View booking', lines: [`Hi ${b.customer_name}, we have your deposit. We will confirm the slot shortly.`, ...detail] }
    case 'booking_confirmed':
      return { subject: `Confirmed: ${b.booking_number}`, cta: 'View booking', lines: [`Hi ${b.customer_name}, you are confirmed. Our technician will message you when they are on the way.`, ...detail] }
    case 'rescheduled':
      return { subject: `Rescheduled: ${b.booking_number}`, cta: 'View booking', lines: [`Hi ${b.customer_name}, your booking has a new time.`, ...detail] }
    case 'reminder':
      return { subject: `Reminder: service ${when(b)}`, cta: 'View booking', lines: [`Hi ${b.customer_name}, a reminder that we are coming soon. Please make sure the vehicle is accessible.`, ...detail] }
    case 'en_route':
      return { subject: `Your technician is on the way (${b.booking_number})`, cta: 'View booking', lines: [`Hi ${b.customer_name}, your technician is heading to you now.`, ...detail] }
    case 'completed':
      return { subject: `Service done: ${b.booking_number}`, cta: 'See photos, receipt and pay balance', lines: [`Hi ${b.customer_name}, your service is complete. Photos, the health check and your balance are on your booking page.`, ...detail] }
    case 'cancelled_refund_due':
      return { subject: `Cancelled: refund for ${b.booking_number}`, cta: 'View booking', lines: [`Hi ${b.customer_name}, your booking is cancelled. Your ${rm(b.deposit_amount)} deposit will be refunded manually within 48 hours.`] }
    case 'cancelled_forfeited':
      return { subject: `Cancelled: ${b.booking_number}`, cta: 'View booking', lines: [`Hi ${b.customer_name}, your booking is cancelled. As it was inside the cancellation window, the deposit is not refundable.`] }
    case 'cancelled':
      return { subject: `Cancelled: ${b.booking_number}`, lines: [`Hi ${b.customer_name}, your booking is cancelled.`] }
    case 'no_show':
      return { subject: `Missed visit: ${b.booking_number}`, cta: 'View booking', lines: [`Hi ${b.customer_name}, we could not reach you at the booked time, so the deposit is kept as per our policy.`] }
    case 'hold_expired':
      return { subject: `Your held slot was released (${b.booking_number})`, lines: [`Hi ${b.customer_name}, we did not receive the deposit in time so the slot was released. You are welcome to book again.`] }
    case 'late_payment_refund':
      return { subject: `Deposit refund for ${b.booking_number}`, lines: [`Hi ${b.customer_name}, your deposit arrived after the slot was released and it is now taken. We will refund it manually within 48 hours.`] }
    case 'refunded':
      return { subject: `Refund sent for ${b.booking_number}`, lines: [`Hi ${b.customer_name}, we have refunded your deposit. It should show in your account soon.`] }
    default:
      return null
  }
}

function html(t: Tpl, b: Booking): string {
  const link = `${APP_URL}/on-site/status/${b.token}`
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111">
<h2 style="color:#F15A22;margin:0 0 12px">Motoverse ON-SITE</h2>
${t.lines.filter(Boolean).map(l => `<p style="margin:6px 0;line-height:1.5">${esc(l)}</p>`).join('')}
${t.cta ? `<p style="margin:20px 0"><a href="${link}" style="background:#F15A22;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(t.cta)}</a></p>` : ''}
<p style="color:#888;font-size:12px">Or open: ${link}</p></div>`
}

const SENDERS: Record<string, (to: string, t: Tpl, b: Booking) => Promise<string | null>> = {
  async email(to, t, b) {
    const key = Deno.env.get('RESEND_API_KEY')
    if (!key) return 'RESEND_API_KEY not set'
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: t.subject, html: html(t, b) }),
    })
    return res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`
  },
}

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: queue, error } = await supabase
    .from('os_notifications')
    .select('id, event, channel, to_address, booking:os_bookings(token, booking_number, customer_name, package_name, grade_name, vehicle_plate, address, service_date, slot_label, deposit_amount, price_total, refund_due_at, cancel_reason)')
    .eq('status', 'queued').order('created_at').limit(25)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  let sent = 0, failed = 0
  for (const n of queue ?? []) {
    const b = n.booking as unknown as Booking | null
    const tpl = b ? template(n.event, b) : null
    const sender = SENDERS[n.channel]
    let err: string | null = null
    if (!b || !tpl) err = 'no template'
    else if (!sender || !n.to_address) err = 'no sender or address'
    else { try { err = await sender(n.to_address, tpl, b) } catch (e) { err = e instanceof Error ? e.message : 'send failed' } }
    await supabase.from('os_notifications').update(err ? { status: 'failed', error: err } : { status: 'sent', sent_at: new Date().toISOString() }).eq('id', n.id)
    err ? failed++ : sent++
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { 'Content-Type': 'application/json' } })
})
