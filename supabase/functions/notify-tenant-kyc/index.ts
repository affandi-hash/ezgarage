// Emails a tenant's business/payout KYC details to RaudhahPay (Chip In Sdn
// Bhd) once they're captured during onboarding, so Chip In can register
// this tenant as a distinct entity for T+1 disbursement. Best-effort —
// called fire-and-forget from OnboardingPage; a delivery failure here
// should never block onboarding itself.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // This is a public HTTPS endpoint — verify the caller is a real
    // authenticated user, and that they actually belong to the tenant
    // they're asking us to email KYC details for. Otherwise anyone could
    // trigger an email for an arbitrary tenant_id.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller } } = await anonClient.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { tenant_id } = await req.json()
    if (!tenant_id) {
      return new Response(JSON.stringify({ error: 'tenant_id is required' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: callerProfile } = await supabase.from('users').select('tenant_id').eq('id', caller.id).single()
    if (!callerProfile || callerProfile.tenant_id !== tenant_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders })
    }

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name, slug, email, phone, legal_business_name, ssm_registration_number, settlement_bank_name, settlement_bank_account_number, settlement_bank_account_name')
      .eq('id', tenant_id)
      .single()

    if (tenantErr || !tenant) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), { status: 404, headers: corsHeaders })
    }

    const { data: settings } = await supabase
      .from('platform_settings')
      .select('raudhahpay_pic_email')
      .single()

    const picEmail = settings?.raudhahpay_pic_email
    if (!picEmail) {
      console.error('notify-tenant-kyc: no raudhahpay_pic_email configured in platform_settings')
      return new Response(JSON.stringify({ error: 'RaudhahPay PIC email not configured' }), { status: 200, headers: corsHeaders })
    }

    const rows: Array<[string, string]> = [
      ['Workshop name', tenant.name ?? '—'],
      ['Legal business name', tenant.legal_business_name ?? '—'],
      ['SSM registration number', tenant.ssm_registration_number ?? '—'],
      ['Contact email', tenant.email ?? '—'],
      ['Contact phone', tenant.phone ?? '—'],
      ['Settlement bank', tenant.settlement_bank_name ?? '—'],
      ['Account number', tenant.settlement_bank_account_number ?? '—'],
      ['Account holder name', tenant.settlement_bank_account_name ?? '—'],
    ]

    const html = `
      <h2>New EZGarage tenant — RaudhahPay onboarding details</h2>
      <p>The following workshop has joined EZGarage and needs to be set up for RaudhahPay payment disbursement.</p>
      <table cellpadding="6" style="border-collapse: collapse;">
        ${rows.map(([label, value]) => `
          <tr>
            <td style="border: 1px solid #ddd; font-weight: 600;">${label}</td>
            <td style="border: 1px solid #ddd;">${value}</td>
          </tr>
        `).join('')}
      </table>
    `

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Resend's shared sandbox sender — works with no domain setup.
        // Swap for a verified custom domain address once one is added
        // to the Resend account.
        from: 'EZGarage <onboarding@resend.dev>',
        to: [picEmail],
        subject: `New EZGarage tenant onboarded: ${tenant.name}`,
        html,
      }),
    })

    if (!resendRes.ok) {
      const errBody = await resendRes.text()
      console.error('notify-tenant-kyc: Resend send failed', resendRes.status, errBody)
      return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 200, headers: corsHeaders })
    }

    await supabase.from('tenants').update({ kyc_notified_at: new Date().toISOString() }).eq('id', tenant_id)

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('notify-tenant-kyc error', e)
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
