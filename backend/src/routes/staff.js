import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/roleCheck.js'
import { supabase } from '../services/supabase.js'

const router = Router()

/**
 * POST /api/staff/invite
 * Body: { email, full_name, role, branch_id }
 * Requires: ceo or branch_manager
 * Uses service role key to call auth.admin.inviteUserByEmail
 */
router.post(
  '/invite',
  requireAuth,
  requireRole('ceo', 'branch_manager'),
  async (req, res) => {
    const { email, full_name, role, branch_id } = req.body

    if (!email || !role || !branch_id) {
      return res.status(400).json({ error: 'email, role, and branch_id are required' })
    }

    const ALLOWED_ROLES = ['branch_manager', 'operation_manager', 'hr_manager', 'staff']

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(', ')}` })
    }

    // branch_manager can only invite to their own branch
    if (req.user.role === 'branch_manager' && req.user.branch_id !== branch_id) {
      return res.status(403).json({ error: 'Branch managers can only invite staff to their own branch' })
    }

    // Send invite email via Supabase Auth (requires service role key)
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: full_name ?? '',
        role,
        branch_id,
      },
    })

    if (inviteError) {
      return res.status(500).json({ error: inviteError.message })
    }

    const userId = inviteData?.user?.id

    // Pre-create user_profile row so the user has proper role/branch on first login
    if (userId) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .upsert(
          {
            id: userId,
            email,
            full_name: full_name ?? '',
            role,
            branch_id,
            status: 'active',
          },
          { onConflict: 'id' }
        )

      if (profileError) {
        console.error('Failed to pre-create user_profile:', profileError.message)
        // Non-fatal — invite email was already sent
      }
    }

    return res.json({ message: `Invite sent to ${email}`, userId })
  }
)

export default router
