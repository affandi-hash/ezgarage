// Signs short-lived URLs for a job's customer-visible photos. job_photos and
// the job-photos storage bucket are both authenticated-only (017/079/080
// migrations) -- there's no anon RLS path to them by design, and plain SQL
// can't mint Storage signed URLs anyway (that's a Storage-API-only op). So
// the portal re-verifies identity itself (mirrors raudhahpay-create-payment's
// pattern) before using the service role to sign URLs, rather than trusting
// a bare job_id.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SIGNED_URL_TTL_SECONDS = 3600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { job_id, plate, phone, ic_first6 } = await req.json()

    if (!job_id || !plate || !phone || !ic_first6) {
      return new Response(JSON.stringify({ error: 'job_id, plate, phone, and ic_first6 are required' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: verified, error: verifyErr } = await supabase.rpc('portal_verify_job_access', {
      p_job_id: job_id,
      p_plate: plate,
      p_phone: phone,
      p_ic_first6: ic_first6,
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
      .map(p => ({
        id: p.id,
        url: urlByPath.get(p.storage_path) ?? null,
        caption: p.caption,
        category: p.category,
        created_at: p.created_at,
      }))
      .filter(p => p.url)

    return new Response(JSON.stringify({ photos: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
