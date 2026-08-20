// Extracts structured monthly metrics (revenue, net_profit, reach, etc.)
// from an uploaded image or PDF of an old report -- for a tenant that
// migrated onto ezgarage mid-history, this is the only way the Marketing
// Plan generator can see pre-adoption context instead of misreading the
// empty period before adoption as "the business had no revenue."
//
// One-shot structured-output extraction, not a chat -- mirrors
// sales-marketing-assistant's image-download-and-inline-base64 pattern,
// but returns parsed entries directly to the caller. Nothing is written
// to the database here; the frontend shows the extraction for review and
// saves only what the user confirms.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const UPLOADS_BUCKET = 'sales-marketing-uploads'
const FEATURE = 'marketing_historical_import'

const METRIC_KEYS = ['reach', 'leads', 'prospects', 'google_reviews_count', 'google_reviews_rating', 'spend', 'revenue', 'net_profit']

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          period_month: { type: 'string', description: 'First day of the month this value covers, ISO date, e.g. 2025-10-01' },
          metric_key: { type: 'string', enum: METRIC_KEYS },
          value: { type: 'number' },
        },
        required: ['period_month', 'metric_key', 'value'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'Anything ambiguous, hard to read, or a value you are not confident about. Empty string if none.' },
  },
  required: ['entries', 'notes'],
  additionalProperties: false,
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller } } = await anonClient.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: callerProfile } = await anonClient.from('users').select('role, tenant_id').eq('id', caller.id).single()
    if (!callerProfile || !['super_admin', 'ops_manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: corsHeaders })
    }

    const { filePath } = await req.json()
    if (!filePath) return new Response(JSON.stringify({ error: 'filePath is required' }), { status: 400, headers: corsHeaders })

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const tenantId = callerProfile.tenant_id

    const { data: bpRow } = await adminClient.from('sales_marketing_business_profile').select('id').eq('tenant_id', tenantId).maybeSingle()
    if (!bpRow) return new Response(JSON.stringify({ error: 'Fill in the Business Profile first.' }), { status: 400, headers: corsHeaders })

    // Uploads live under `${business_profile_id}/...` -- same path
    // convention the storage RLS policy (130) already enforces.
    if (!filePath.startsWith(`${bpRow.id}/`)) {
      return new Response(JSON.stringify({ error: 'Invalid file path' }), { status: 403, headers: corsHeaders })
    }

    const { data: fileBlob, error: dlErr } = await adminClient.storage.from(UPLOADS_BUCKET).download(filePath)
    if (dlErr || !fileBlob) return new Response(JSON.stringify({ error: 'Could not read the uploaded file' }), { status: 400, headers: corsHeaders })

    const mediaType = fileBlob.type || 'image/jpeg'
    const base64 = bytesToBase64(new Uint8Array(await fileBlob.arrayBuffer()))
    const fileContentBlock = mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }

    const today = new Date().toISOString().slice(0, 10)
    const systemPrompt = `You are extracting historical business metrics from an old report (a chart, dashboard screenshot, or exported document) so they can be used as pre-migration context for this business's Marketing Plan. Today's date is ${today}.

Read every data point visible in the attached file -- bar/line chart values, stat cards, table rows -- and return one entry per (month, metric) pair you can confidently read.

Only use these metric_key values: ${METRIC_KEYS.join(', ')}.
- "revenue" = total sales/turnover for that month.
- "net_profit" = net profit or loss for that month (negative for a loss).
- "reach" = total impressions/views/reach across all channels shown for that month, summed if multiple platforms are shown separately.
- Use the others (leads, prospects, google_reviews_count, google_reviews_rating, spend) only if the document clearly shows them.

Rules:
- period_month must be the FIRST DAY of the calendar month the value covers, e.g. "2025-10-01" for October 2025.
- If a value's month or number is genuinely unclear, leave it out rather than guessing, and mention it in "notes".
- Do not invent data that isn't visibly present in the file.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: [fileContentBlock, { type: 'text', text: 'Extract the historical metrics from this file.' }] }],
        output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      }),
    })

    if (!res.ok) return new Response(JSON.stringify({ error: `Extraction failed: ${await res.text()}` }), { status: 502, headers: corsHeaders })
    const json = await res.json()
    const textBlock = (json.content ?? []).find((b: { type: string }) => b.type === 'text')
    if (!textBlock) return new Response(JSON.stringify({ error: 'No extraction returned' }), { status: 502, headers: corsHeaders })

    let parsed: { entries: { period_month: string; metric_key: string; value: number }[]; notes: string }
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      return new Response(JSON.stringify({ error: 'Could not parse the extraction result' }), { status: 502, headers: corsHeaders })
    }

    const validEntries = parsed.entries.filter(e =>
      /^\d{4}-\d{2}-01$/.test(e.period_month) && METRIC_KEYS.includes(e.metric_key) && typeof e.value === 'number' && Number.isFinite(e.value)
    )

    const u = json.usage ?? {}
    await adminClient.from('ai_token_usage').insert({
      tenant_id: tenantId, feature: FEATURE, model: 'claude-opus-5',
      input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0, cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      requested_by: caller.id,
    }).then(({ error }) => { if (error) console.error('ai_token_usage insert failed:', error.message) })

    return new Response(JSON.stringify({ entries: validEntries, notes: parsed.notes ?? '' }), { status: 200, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
