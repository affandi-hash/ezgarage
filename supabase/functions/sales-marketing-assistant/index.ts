import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Drives the "Ask Your CSMO" business-profile interview. One call per chat
// turn: sends the conversation + current profile state to Claude, lets it
// reply conversationally AND (via a tool call) persist whatever profile
// fields it just learned, then returns the reply. Keeps the interview
// resumable across sessions since the transcript and profile both live in
// sales_marketing_business_profile, not in memory.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const START_SENTINEL = '__START_INTERVIEW__'

const PROFILE_FIELDS = [
  'tagline', 'website_url', 'instagram_handle', 'tiktok_handle', 'facebook_handle', 'whatsapp_number',
  'pricing_position', 'monthly_budget_myr', 'execution_capacity',
  'brand_voice', 'target_audience', 'unique_selling_points', 'competitors', 'goals', 'guardrails', 'seasonal_notes',
] as const

const UPDATE_TOOL = {
  name: 'update_business_profile',
  description: 'Save one or more Business Profile fields you have just learned from the owner. Call this whenever the conversation reveals new or updated information for any field -- do not wait until the end. Only include fields you actually have new information for.',
  input_schema: {
    type: 'object',
    properties: {
      tagline: { type: 'string', description: 'Short tagline or mission statement' },
      website_url: { type: 'string' },
      instagram_handle: { type: 'string' },
      tiktok_handle: { type: 'string' },
      facebook_handle: { type: 'string' },
      whatsapp_number: { type: 'string' },
      pricing_position: { type: 'string', enum: ['budget', 'mid_market', 'premium'] },
      monthly_budget_myr: { type: 'number' },
      execution_capacity: { type: 'string', description: 'Who executes marketing day-to-day, e.g. "just the owner" or "front desk helps part-time"' },
      brand_voice: { type: 'string', description: 'A concise description of the brand tone/voice, written for reuse in prompts' },
      target_audience: { type: 'string', description: 'Customer segments and demographics, in a few sentences' },
      unique_selling_points: { type: 'string', description: 'What makes this business different, and known competitors' },
      competitors: { type: 'string' },
      goals: { type: 'string', description: 'Current marketing priorities, ranked' },
      guardrails: { type: 'string', description: 'Things to avoid or always include' },
      seasonal_notes: { type: 'string', description: 'Known slow/peak periods and why' },
    },
    additionalProperties: false,
  },
}

function systemPrompt(profile: Record<string, unknown>) {
  const known = PROFILE_FIELDS.filter(f => profile[f] !== null && profile[f] !== undefined && profile[f] !== '')
    .map(f => `- ${f}: ${profile[f]}`).join('\n') || '(nothing yet)'
  const missing = PROFILE_FIELDS.filter(f => profile[f] === null || profile[f] === undefined || profile[f] === '')

  return `You are acting as the Chief Sales & Marketing Officer for a garage/workshop business (car and bike servicing), conducting a guided interview to fill in its Business Profile -- the permanent briefing every other AI feature in this app reads before doing anything else.

Known so far:
${known}

Still missing: ${missing.join(', ') || 'nothing -- the profile is complete'}

Rules:
- Ask ONE focused, open-ended question at a time. Do not list multiple questions in one message.
- When the owner's message gives you information for any field, call update_business_profile immediately with a concise, well-written value (not a verbatim quote) -- even if they only touched on it briefly.
- Prioritize the narrative fields (brand_voice, target_audience, unique_selling_points, competitors, goals, guardrails, seasonal_notes) -- those are the ones a form can't capture well. Structured fields (channels, budget, pricing_position) can be asked briefly or skipped if the owner seems to want to move faster.
- Keep replies short: 1-3 sentences plus your next question.
- If the message is exactly "${START_SENTINEL}", this is a system trigger, not a real owner message -- introduce yourself in one sentence and ask your first question. Do not acknowledge or repeat the sentinel text.
- If everything important is filled in, say so plainly and offer to revisit any field, rather than inventing more questions.`
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

    const { data: callerProfile } = await anonClient.from('users').select('role, tenant_id').eq('id', caller.id).single()
    if (!callerProfile || !['super_admin', 'ops_manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: corsHeaders })
    }

    const { message } = await req.json()
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: 'message is required' }), { status: 400, headers: corsHeaders })
    }

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    let { data: row } = await adminClient.from('sales_marketing_business_profile')
      .select('*').eq('tenant_id', callerProfile.tenant_id).maybeSingle()

    if (!row) {
      const { data: created, error: createErr } = await adminClient.from('sales_marketing_business_profile')
        .insert({ tenant_id: callerProfile.tenant_id, conversation: [], updated_by: caller.id })
        .select('*').single()
      if (createErr || !created) return new Response(JSON.stringify({ error: createErr?.message ?? 'Failed to create profile' }), { status: 500, headers: corsHeaders })
      row = created
    }

    const conversation = Array.isArray(row.conversation) ? row.conversation : []
    let history = [...conversation, { role: 'user', content: message }]
    const updates: Record<string, unknown> = {}

    async function callClaude(msgs: unknown[]) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 1024,
          system: systemPrompt({ ...row, ...updates }),
          tools: [UPDATE_TOOL],
          messages: msgs,
        }),
      })
      if (!res.ok) throw new Error(`Assistant call failed: ${await res.text()}`)
      return res.json()
    }

    // A turn where Claude calls the tool may come back with no text at all
    // (stop_reason "tool_use", nothing to show the owner). Round-trip the
    // tool_result and ask again so there's always a reply to display --
    // capped at one extra round so a model that keeps calling tools can't
    // turn one chat message into an unbounded chain of API calls.
    let replyText = ''
    for (let round = 0; round < 2; round++) {
      const anthropicMsg = await callClaude(history)
      const content: Array<Record<string, unknown>> = anthropicMsg.content ?? []
      const toolUses = content.filter(b => b.type === 'tool_use')

      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>
        for (const field of PROFILE_FIELDS) {
          if (input[field] !== undefined) updates[field] = input[field]
        }
      }

      history = [...history, { role: 'assistant', content }]
      const text = content.filter(b => b.type === 'text').map(b => b.text as string).join('\n').trim()
      if (text) replyText = text

      if (toolUses.length === 0) break
      history = [...history, {
        role: 'user',
        content: toolUses.map(tu => ({ type: 'tool_result', tool_use_id: tu.id, content: 'Saved.' })),
      }]
      if (text) break
    }

    const newHistory = history

    const { data: updatedRow, error: updateErr } = await adminClient.from('sales_marketing_business_profile')
      .update({ ...updates, conversation: newHistory, updated_by: caller.id })
      .eq('id', row.id)
      .select('*').single()

    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: corsHeaders })

    return new Response(JSON.stringify({ reply: replyText, profile: updatedRow }), { status: 200, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
