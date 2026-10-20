import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Sets a new password for a user. Who may do it:
//   * super admin: anyone (the platform owner)
//   * Branch Admin: ordinary staff in their own company, never a super admin or another Branch Admin
//   * for a company with the stricter rules switched off (MAC): ops managers as before, but never a super admin
// When the company requires the authenticator step, the caller's session must have passed it.
// The new password is temporary: the person must choose their own at the next sign-in.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller } } = await anonClient.auth.getUser()
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: me } = await admin.from('users').select('role, tenant_id, is_active, is_branch_admin').eq('id', caller.id).single()
    if (!me || !me.is_active) return json({ error: 'Insufficient permissions' }, 403)

    const { user_id, new_password } = await req.json()
    if (!user_id || !new_password || new_password.length < 8) return json({ error: 'user_id and new_password (min 8 chars) required' }, 400)

    const { data: target } = await admin.from('users').select('role, tenant_id, is_branch_admin, full_name, email').eq('id', user_id).single()
    if (!target) return json({ error: 'User not found' }, 404)

    const isSuper = me.role === 'super_admin'
    const { data: tenant } = await admin.from('tenants').select('tight_controls, require_mfa').eq('id', me.tenant_id).single()
    const strict = tenant?.tight_controls !== false

    if (!isSuper) {
      if (target.tenant_id !== me.tenant_id) return json({ error: 'Cannot reset password for user in another tenant' }, 403)
      if (target.role === 'super_admin' || target.is_branch_admin) return json({ error: 'Only a super admin can reset this account' }, 403)
      if (strict && !me.is_branch_admin) return json({ error: 'Only the Branch Admin can reset passwords' }, 403)
      if (!strict && !['ops_manager'].includes(me.role)) return json({ error: 'Insufficient permissions' }, 403)
      if (user_id === caller.id) return json({ error: 'Use Change Password for your own account' }, 403)
    }

    // the authenticator step, when the company requires it
    if (strict && tenant?.require_mfa) {
      let aal = 'aal1'
      try { const p = authHeader.replace('Bearer ', '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); aal = JSON.parse(atob(p)).aal ?? 'aal1' } catch { /* not a JWT */ }
      if (aal !== 'aal2') return json({ error: 'Enter your authenticator code first (Security page)' }, 403)
    }

    const { error } = await admin.auth.admin.updateUserById(user_id, { password: new_password })
    if (error) return json({ error: error.message }, 400)

    // the password was chosen by someone else, so the person must replace it at their next sign-in
    await admin.from('users').update({ must_change_password: true }).eq('id', user_id)

    await admin.from('audit_logs').insert({
      action: 'password_reset', module: 'users', record_id: user_id, record_type: 'user', tenant_id: me.tenant_id, user_id: caller.id,
      ip_address: (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
      details: { target: target.full_name, target_email: target.email, client: { ip: (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null, device: (req.headers.get('user-agent') ?? '').slice(0, 160) } },
    })

    return json({ success: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})
