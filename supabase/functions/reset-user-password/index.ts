import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is authenticated and is ops_manager/super_admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller } } = await anonClient.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: callerProfile } = await anonClient.from('users').select('role, tenant_id').eq('id', caller.id).single()
    if (!callerProfile || !['super_admin', 'ops_manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: corsHeaders })
    }

    const { user_id, new_password } = await req.json()
    if (!user_id || !new_password || new_password.length < 8) {
      return new Response(JSON.stringify({ error: 'user_id and new_password (min 8 chars) required' }), { status: 400, headers: corsHeaders })
    }

    // Use service role key to update the password
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify target user is in the same tenant (unless super_admin)
    if (callerProfile.role !== 'super_admin') {
      const { data: target } = await adminClient.from('users').select('tenant_id').eq('id', user_id).single()
      if (!target || target.tenant_id !== callerProfile.tenant_id) {
        return new Response(JSON.stringify({ error: 'Cannot reset password for user in another tenant' }), { status: 403, headers: corsHeaders })
      }
    }

    const { error } = await adminClient.auth.admin.updateUserById(user_id, { password: new_password })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
