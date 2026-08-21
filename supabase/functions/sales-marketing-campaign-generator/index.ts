import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Minimal version of the "Campaign" execution layer: promotes ONE Sales
// activity (sales_marketing_plan_initiatives row) into a campaign with an
// actual plan and ready-to-send copy, via two AI roles in sequence --
// Project Manager (audience/timing/success metric), then Copywriter (the
// real words, grounded in that plan). Designer and Analyst roles, and
// campaigns not promoted from an initiative, are out of scope for v1.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const FEATURE = 'campaign_generator'

const SET_CAMPAIGN_PLAN_TOOL = {
  name: 'set_campaign_plan',
  description: 'Define the plan for this campaign, as a Project Manager would, before any copy gets written. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      target_audience: { type: 'string', description: 'Who this is actually for, in plain words -- e.g. "past customers who haven\'t visited in 60+ days"' },
      timing: { type: 'string', description: 'When to send/post this, in plain words -- e.g. "Tuesday and Thursday this week"' },
      success_metric: { type: 'string', description: 'What "it worked" looks like -- e.g. "3+ replies booking a check-up"' },
    },
    required: ['target_audience', 'timing', 'success_metric'],
    additionalProperties: false,
  },
}

const SET_CAMPAIGN_COPY_TOOL = {
  name: 'set_campaign_copy',
  description: 'Write the actual message/post copy for this campaign, as a Copywriter following the plan already set. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      copy: { type: 'string', description: 'The full, ready-to-send text for the stated channel -- not a description of what to write, the actual words a customer would read, in the business\'s real brand voice.' },
      alt_copy: { type: 'string', description: 'Optional: a shorter alternate version, e.g. for SMS if the main copy is written for WhatsApp/Instagram.' },
    },
    required: ['copy'],
    additionalProperties: false,
  },
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

    const { initiative_id } = await req.json()
    if (!initiative_id) return new Response(JSON.stringify({ error: 'initiative_id is required' }), { status: 400, headers: corsHeaders })

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const tenantId = callerProfile.tenant_id

    const { data: initiative } = await adminClient.from('sales_marketing_plan_initiatives').select('*').eq('id', initiative_id).eq('tenant_id', tenantId).maybeSingle()
    if (!initiative) return new Response(JSON.stringify({ error: 'Initiative not found' }), { status: 404, headers: corsHeaders })

    const { data: bpRow } = await adminClient.from('sales_marketing_business_profile').select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!bpRow) return new Response(JSON.stringify({ error: 'Fill in the Business Profile first.' }), { status: 400, headers: corsHeaders })

    const known = (label: string, rows: Record<string, unknown>[] | null) =>
      !rows || rows.length === 0 ? `${label}: (none yet)` : `${label}:\n${rows.map(r => `- ${Object.entries(r).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join(', ')}`).join('\n')}`

    const [segmentsRes] = await Promise.all([
      adminClient.from('sales_marketing_audience_segments').select('name, description, priority').eq('business_profile_id', bpRow.id),
    ])

    const systemPrompt = `You are Izzy's Sales & Marketing team for a garage/workshop business, turning ONE approved activity into a real, ready-to-run campaign. Two roles work in sequence: Project Manager sets the plan, then Copywriter writes the actual words -- ground everything in what's actually below, don't invent details the business hasn't given you.

BUSINESS PROFILE
Tagline: ${bpRow.tagline ?? '(none)'}
Brand voice: ${bpRow.brand_voice ?? '(none)'}
Unique selling points: ${bpRow.unique_selling_points ?? '(none)'}
Guardrails: ${bpRow.guardrails ?? '(none)'}
Pricing position: ${bpRow.pricing_position ?? '(none)'}

${known('Audience segments', segmentsRes.data)}

THE ACTIVITY BEING PROMOTED INTO A CAMPAIGN
Summary: ${initiative.summary ?? initiative.description}
Full detail: ${initiative.description}
Channel: ${initiative.channel ?? '(not specified -- infer the most sensible one from the activity itself)'}
Owner: ${initiative.owner_text ?? '(not specified)'}
Due: ${initiative.due_date ?? '(not specified)'}

Rules:
- The plan (target_audience, timing, success_metric) must be specific to THIS activity, not generic marketing advice.
- The copy must be the actual, final text -- not a placeholder, not a description of what the message should contain.
- Respect the guardrails and brand voice on file. Never invent a discount, price, or promise the business hasn't stated.
- If the channel implies a length constraint (e.g. SMS vs a longer WhatsApp message), respect it.`

    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

    // Same caching shape as sales-marketing-plan-generator: systemPrompt is
    // fully static across both calls in this request, so the second
    // (Copywriter) call reads back most of the first (PM) call's prefix
    // instead of paying full price for identical tokens seconds apart.
    function withCacheBreakpoint(msgs: Record<string, unknown>[]): Record<string, unknown>[] {
      const out = msgs.map(m => ({ ...m }))
      const last = out[out.length - 1] as { role: string; content: unknown } | undefined
      if (!last) return out
      const blocks: Record<string, unknown>[] = typeof last.content === 'string'
        ? [{ type: 'text', text: last.content }]
        : [...(last.content as Record<string, unknown>[])]
      if (blocks.length === 0) return out
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
      out[out.length - 1] = { role: last.role, content: blocks }
      return out
    }

    async function callClaude(msgs: Record<string, unknown>[], toolChoice: Record<string, unknown>) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 2048,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          tools: [SET_CAMPAIGN_PLAN_TOOL, SET_CAMPAIGN_COPY_TOOL],
          messages: withCacheBreakpoint(msgs),
          tool_choice: toolChoice,
        }),
      })
      if (!res.ok) throw new Error(`Campaign generator call failed: ${await res.text()}`)
      const json = await res.json()
      const u = json.usage ?? {}
      usage.input_tokens += u.input_tokens ?? 0
      usage.output_tokens += u.output_tokens ?? 0
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
      return json
    }

    function pushTurn(history: Record<string, unknown>[], content: Array<Record<string, unknown>>, resultText: string) {
      const next = [...history, { role: 'assistant', content }]
      const toolUses = content.filter(b => b.type === 'tool_use') as { id: string; name: string; input?: Record<string, unknown> }[]
      if (toolUses.length > 0) {
        return { history: [...next, { role: 'user', content: toolUses.map(tu => ({ type: 'tool_result', tool_use_id: tu.id, content: resultText })) }], toolUses }
      }
      return { history: next, toolUses }
    }

    let history: Record<string, unknown>[] = [{ role: 'user', content: 'Turn this activity into a campaign now.' }]

    const planMsg = await callClaude(history, { type: 'tool', name: 'set_campaign_plan' })
    const planStep = pushTurn(history, planMsg.content ?? [], 'Saved.')
    history = planStep.history
    const planInput = planStep.toolUses.find(tu => tu.name === 'set_campaign_plan')?.input ?? {}

    // Forcing tool_choice alone isn't enough of a bridge between the two
    // roles -- with nothing but a bare "Saved." tool_result before the next
    // forced call, the model once echoed that same word back as the copy
    // itself instead of writing anything new. An explicit instruction turn
    // fixes it, same principle as the save_analysis fallback elsewhere in
    // this codebase: never rely on tool_choice pressure alone to carry
    // intent the model hasn't actually been told in words.
    history = [...history, {
      role: 'user',
      content: 'Good -- now write the actual copy for this campaign, following the plan you just set. This must be the real, final, ready-to-send text a customer would read, not a placeholder or restatement of the plan.',
    }]

    const copyMsg = await callClaude(history, { type: 'tool', name: 'set_campaign_copy' })
    const copyStep = pushTurn(history, copyMsg.content ?? [], 'Saved.')
    const copyInput = copyStep.toolUses.find(tu => tu.name === 'set_campaign_copy')?.input ?? {}
    // A real message is never this short -- leave it null (visibly missing
    // in the UI) rather than store a degenerate one-word "copy" as if it
    // were real, usable content.
    const copyText = typeof copyInput.copy === 'string' && copyInput.copy.trim().length >= 20 ? copyInput.copy.trim() : null

    const { data: campaign, error: campaignErr } = await adminClient.from('sales_marketing_campaigns')
      .insert({
        tenant_id: tenantId,
        business_profile_id: bpRow.id,
        initiative_id,
        title: (initiative.summary ?? initiative.description).slice(0, 200),
        channel: initiative.channel,
        target_audience: typeof planInput.target_audience === 'string' ? planInput.target_audience : null,
        timing: typeof planInput.timing === 'string' ? planInput.timing : null,
        success_metric: typeof planInput.success_metric === 'string' ? planInput.success_metric : null,
        copy: copyText,
        alt_copy: typeof copyInput.alt_copy === 'string' ? copyInput.alt_copy : null,
        created_by: caller.id,
        generation_tokens: usage.input_tokens + usage.output_tokens,
      })
      .select('*').single()

    if (campaignErr || !campaign) return new Response(JSON.stringify({ error: campaignErr?.message ?? 'Failed to create campaign' }), { status: 500, headers: corsHeaders })

    await adminClient.from('ai_token_usage').insert({
      tenant_id: tenantId, feature: FEATURE, model: 'claude-opus-5',
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens, cache_read_input_tokens: usage.cache_read_input_tokens,
      requested_by: caller.id,
    }).then(({ error }) => { if (error) console.error('ai_token_usage insert failed:', error.message) })

    return new Response(JSON.stringify({ campaign, usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens } }), { status: 200, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
