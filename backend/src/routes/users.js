import express from 'express'
import { createClient } from '@supabase/supabase-js'

const router = express.Router()

// Admin client — uses service role key, never exposed to frontend
const adminClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Verify caller JWT and return their profile
async function getCallerProfile(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.split(' ')[1]
  const { data: { user }, error } = await adminClient.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await adminClient.from('users').select('id, role, tenant_id, branch_id').eq('id', user.id).single()
  return profile ?? null
}

// POST /api/users/invite
router.post('/invite', async (req, res) => {
  try {
    const caller = await getCallerProfile(req.headers.authorization)
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })
    if (!['ops_manager', 'super_admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Only ops_manager or super_admin can invite users' })
    }

    const { email, full_name, role, branch_id, phone, temp_password } = req.body
    if (!email || !full_name || !role || !temp_password) {
      return res.status(400).json({ error: 'email, full_name, role and temp_password are required' })
    }
    if (temp_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    // Check email not already taken
    const { data: existing } = await adminClient.from('users').select('id').eq('email', email.toLowerCase()).single()
    if (existing) return res.status(409).json({ error: 'A user with this email already exists' })

    // Create auth user via GoTrue Admin API — this is the ONLY reliable way
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase(),
      password: temp_password,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (authError) return res.status(400).json({ error: authError.message })

    // Insert app profile
    const { error: profileError } = await adminClient.from('users').insert({
      id: authUser.user.id,
      tenant_id: caller.tenant_id,
      branch_id: branch_id || null,
      full_name,
      email: email.toLowerCase(),
      phone: phone || null,
      role,
      approval_status: 'approved',
      is_active: true,
      must_change_password: true,
    })

    if (profileError) {
      // Roll back the auth user if profile insert fails
      await adminClient.auth.admin.deleteUser(authUser.user.id)
      return res.status(500).json({ error: profileError.message })
    }

    res.json({ id: authUser.user.id })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/users/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const caller = await getCallerProfile(req.headers.authorization)
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })
    if (!['ops_manager', 'super_admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Only ops_manager or super_admin can reset passwords' })
    }

    const { user_id, new_password } = req.body
    if (!user_id || !new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'user_id and new_password (min 8 chars) are required' })
    }

    // Verify target user is in same tenant (unless super_admin)
    if (caller.role !== 'super_admin') {
      const { data: target } = await adminClient.from('users').select('tenant_id').eq('id', user_id).single()
      if (!target || target.tenant_id !== caller.tenant_id) {
        return res.status(403).json({ error: 'Cannot reset password for user in another tenant' })
      }
    }

    const { error } = await adminClient.auth.admin.updateUserById(user_id, { password: new_password })
    if (error) return res.status(400).json({ error: error.message })

    // Force password change on next login
    await adminClient.from('users').update({ must_change_password: true }).eq('id', user_id)

    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/users/staff-options
// Returns foreman + mechanic users in the same tenant as the caller.
// Uses service role — bypasses RLS so any authenticated role can call this.
router.get('/staff-options', async (req, res) => {
  try {
    const caller = await getCallerProfile(req.headers.authorization)
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })

    const { data, error } = await adminClient
      .from('users')
      .select('id, full_name, role')
      .in('role', ['foreman', 'mechanic', 'ops_manager'])
      .eq('tenant_id', caller.tenant_id)
      .eq('is_active', true)
      .order('full_name')

    if (error) return res.status(500).json({ error: error.message })
    res.json(data ?? [])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
