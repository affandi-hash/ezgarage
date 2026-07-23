import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Invite User was previously calling a VITE_BACKEND_URL-hosted API route
// that was never actually deployed anywhere -- every attempt failed with
// "Could not reach server". Creating an auth user requires the service-role
// key, so this has to happen server-side; there was no existing edge
// function for it (only reset-user-password existed, for changing an
// existing user's password).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller } } = await anonClient.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: callerProfile } = await anonClient.from('users').select('role, tenant_id, is_platform_admin').eq('id', caller.id).single()
    if (!callerProfile || !(['super_admin', 'ops_manager'].includes(callerProfile.role) || callerProfile.is_platform_admin)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: corsHeaders })
    }

    const { email, full_name, role, branch_id, phone, temp_password } = await req.json()
    if (!email?.trim() || !full_name?.trim() || !role || !temp_password || temp_password.length < 6) {
      return new Response(JSON.stringify({ error: 'email, full_name, role, and temp_password (min 6 chars) are required' }), { status: 400, headers: corsHeaders })
    }

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: temp_password,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? 'Failed to create auth user' }), { status: 400, headers: corsHeaders })
    }

    const { error: profileErr } = await adminClient.from('users').insert({
      id: created.user.id,
      email: email.trim().toLowerCase(),
      full_name: full_name.trim(),
      phone: phone?.trim() || null,
      role,
      branch_id: branch_id || null,
      tenant_id: callerProfile.tenant_id,
      approval_status: 'approved',
      is_active: true,
      must_change_password: true,
    })
    if (profileErr) {
      // Don't leave an orphaned auth user with no matching profile row.
      await adminClient.auth.admin.deleteUser(created.user.id)
      return new Response(JSON.stringify({ error: profileErr.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ success: true, user_id: created.user.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
