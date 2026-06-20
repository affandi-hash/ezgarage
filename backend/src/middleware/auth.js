import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = authHeader.split(' ')[1]
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, branch_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return res.status(403).json({ error: 'User profile not found' })
  }

  req.user = profile
  next()
}
