// Signs short-lived URLs for a job's customer-visible photos, for the ESP
// member portal's Vehicle Log. job_photos and the job-photos storage
// bucket are both authenticated-only (017/079/080), so this mirrors
// portal-job-photos exactly, just re-verifying via phone+password
// (esp_verify_job_photo_access, 124) instead of plate+phone+IC.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SIGNED_URL_TTL_SECONDS = 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone, password, job_id } = await req.json()

    if (!phone || !password || !job_id) {
      return new Response(JSON.stringify({ error: 'phone, password, and job_id are required' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: verified, error: verifyErr } = await supabase.rpc('esp_verify_job_photo_access', {
      p_phone: phone, p_password: password, p_job_id: job_id,
    })
    if (verifyErr || !verified) {
      return new Response(JSON.stringify({ error: 'Could not verify your identity for this job' }), { status: 403, headers: corsHeaders })
    }

    const { data: photos, error: photosErr } = await supabase
      .from('job_photos')
      .select('id, storage_path, caption, category, created_at')
      .eq('job_id', job_id)
      .eq('visible_to_customer', true)
      .order('created_at', { ascending: true })

    if (photosErr) {
      return new Response(JSON.stringify({ error: photosErr.message }), { status: 500, headers: corsHeaders })
    }
    if (!photos || photos.length === 0) {
      return new Response(JSON.stringify({ photos: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from('job-photos')
      .createSignedUrls(photos.map(p => p.storage_path), SIGNED_URL_TTL_SECONDS)

    if (signErr) {
      return new Response(JSON.stringify({ error: signErr.message }), { status: 500, headers: corsHeaders })
    }

    const urlByPath = new Map(signed.map(s => [s.path, s.signedUrl]))
    const result = photos
      .map(p => ({ id: p.id, url: urlByPath.get(p.storage_path) ?? null, caption: p.caption, category: p.category, created_at: p.created_at }))
      .filter(p => p.url)

    return new Response(JSON.stringify({ photos: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
