import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Drives "Ask Izzy" -- the Business Profile interview. One call per chat
// turn: sends the conversation + current known state to Claude, lets it
// reply conversationally AND (via tool calls) persist whatever it just
// learned, then returns the reply. Keeps the interview resumable across
// sessions since the transcript and profile both live in
// sales_marketing_business_profile, not in memory.
//
// Competitors, audience segments, goals, and seasonal events are each
// their own table (one row per item) rather than a free-text field on the
// profile. A free-text field gets REPLACED on every update, which means
// mentioning one new competitor would require the model to perfectly
// retype every existing one from context or silently drop them -- that's
// exactly what corrupted a real tenant's Competitors field once already.
// Upserting by name/description makes an update an insert, not a rewrite
// of everything else.
//
// Owners can also attach an image (competitor screenshot, existing
// marketing material). It's sent to Claude in full for the turn it's
// attached in, but persisted as a lightweight { type: 'image_ref', path }
// -- re-sending the same image bytes on every later turn would grow both
// latency and token spend with conversation length for no benefit, since
// whatever mattered was already captured into a field or a table row.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const START_SENTINEL = '__START_INTERVIEW__'
const UPLOADS_BUCKET = 'sales-marketing-uploads'
const FEATURE = 'business_profile_assistant'

// Genuinely single cohesive statements, not lists -- stay as free text on
// the profile row itself.
const PROFILE_FIELDS = [
  'tagline', 'website_url', 'instagram_handle', 'tiktok_handle', 'facebook_handle', 'whatsapp_number',
  'pricing_position', 'monthly_budget_myr', 'execution_capacity',
  'brand_voice', 'unique_selling_points', 'guardrails',
] as const

const UPDATE_TOOL = {
  name: 'update_business_profile',
  description: 'Save one or more Business Profile fields you have just learned from the owner. Call this whenever the conversation reveals new or updated information for any field -- do not wait until the end. Only include fields you actually have new information for. Do NOT use this for competitors, audience segments, goals, or seasonal events -- those have their own tools.',
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
      unique_selling_points: { type: 'string', description: 'What makes this business different' },
      guardrails: { type: 'string', description: 'Things to avoid or always include' },
    },
    additionalProperties: false,
  },
}

const UPSERT_COMPETITOR_TOOL = {
  name: 'upsert_competitor',
  description: 'Add or update ONE competitor. Call this once per competitor mentioned -- never bundle several into one call, and never call it again for a competitor whose details have not changed.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Competitor name -- identifies this competitor for future updates' },
      competitor_type: { type: 'string', enum: ['direct', 'indirect'] },
      notes: { type: 'string', description: 'What they do and how they position themselves' },
      threat_level: { type: 'string', enum: ['low', 'medium', 'high'] },
      our_counter: { type: 'string', description: 'How we differentiate against this specific competitor' },
    },
    required: ['name'],
    additionalProperties: false,
  },
}

const UPSERT_AUDIENCE_SEGMENT_TOOL = {
  name: 'upsert_audience_segment',
  description: 'Add or update ONE customer segment. Call once per distinct segment (e.g. "Harley owners" and "e-hailing drivers" are two separate calls, not one).',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short segment name, e.g. "Harley / premium bike owners"' },
      description: { type: 'string', description: 'Who they are, demographics, what they need' },
      messaging_angle: { type: 'string', description: 'How to talk to this segment specifically' },
      priority: { type: 'string', enum: ['primary', 'secondary'] },
    },
    required: ['name'],
    additionalProperties: false,
  },
}

const UPSERT_GOAL_TOOL = {
  name: 'upsert_goal',
  description: 'Add or update ONE business/marketing goal. Call once per distinct goal so progress can be tracked over time.',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'The goal, e.g. "Increase monthly revenue to RM150k" -- identifies this goal for future updates' },
      metric: { type: 'string', description: 'What is measured, e.g. "Monthly revenue (RM)"' },
      target_value: { type: 'number' },
      current_value: { type: 'number' },
      deadline: { type: 'string', description: 'ISO date, if one was given' },
      priority_rank: { type: 'number', description: '1 = top priority' },
      status: { type: 'string', enum: ['active', 'achieved', 'dropped'] },
    },
    required: ['description'],
    additionalProperties: false,
  },
}

const UPSERT_SEASONAL_EVENT_TOOL = {
  name: 'upsert_seasonal_event',
  description: 'Add or update ONE recurring seasonal/calendar period relevant to marketing timing (a month, a festive period, a riding season, etc). Call once per distinct period.',
  input_schema: {
    type: 'object',
    properties: {
      period_label: { type: 'string', description: 'e.g. "Ramadan / Hari Raya" or "January" -- identifies this period for future updates' },
      theme: { type: 'string' },
      focus_notes: { type: 'string', description: 'What to promote or focus on during this period' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['period_label'],
    additionalProperties: false,
  },
}

const ALL_TOOLS = [UPDATE_TOOL, UPSERT_COMPETITOR_TOOL, UPSERT_AUDIENCE_SEGMENT_TOOL, UPSERT_GOAL_TOOL, UPSERT_SEASONAL_EVENT_TOOL]

function listKnown(label: string, rows: Record<string, unknown>[], fields: string[]) {
  if (rows.length === 0) return `${label}: (none yet)`
  const items = rows.map(r => fields.map(f => r[f] != null && r[f] !== '' ? `${f}=${r[f]}` : null).filter(Boolean).join(', '))
  return `${label}:\n${items.map(i => `- ${i}`).join('\n')}`
}

// Split so the ever-changing "known so far" status (this literally IS the
// interview's progress, rewritten by `updates` within the same turn's round
// loop whenever a tool fires) sits after the cache boundary. The intro +
// Rules below never change, so they're the only part worth caching --
// bundling the volatile status into the same block would invalidate the
// cache on almost every round, the same mistake made (and fixed) in
// sales-marketing-analysis-assistant.
const STABLE_SYSTEM_PROMPT = `You are Izzy, an AI acting as the Chief Sales & Marketing Officer for a garage/workshop business (car and bike servicing), conducting a guided interview to fill in its Business Profile -- the permanent briefing every other AI feature in this app reads before doing anything else.

Rules:
- Ask ONE focused, open-ended question at a time. Do not list multiple questions in one message.
- Competitors, audience segments, goals, and seasonal events each have their own tool (upsert_competitor, upsert_audience_segment, upsert_goal, upsert_seasonal_event) -- call the matching one immediately whenever the owner mentions one, one call per item. Never put this information into update_business_profile.
- When the owner's message gives you information for a single-statement field (brand voice, USPs, guardrails, channels, budget), call update_business_profile immediately with a concise, well-written value -- even if they only touched on it briefly.
- The owner can attach images (screenshots of competitors, existing marketing materials, price lists). Use what you see in them the same way you'd use a text answer.
- Prioritize brand_voice, unique_selling_points, guardrails, and the competitors/segments/goals/seasonal events -- those are what a form can't capture well. Structured contact/channel fields can be asked briefly or skipped if the owner wants to move faster.
- Keep replies short: 1-3 sentences plus your next question.
- If the message is exactly "${START_SENTINEL}", this is a system trigger, not a real owner message -- introduce yourself as Izzy in one sentence and ask your first question. Do not acknowledge or repeat the sentinel text.
- If everything important is filled in, say so plainly and offer to revisit any item, rather than inventing more questions.`

function profileStatusBlock(profile: Record<string, unknown>, related: {
  competitors: Record<string, unknown>[]
  audienceSegments: Record<string, unknown>[]
  goals: Record<string, unknown>[]
  seasonalEvents: Record<string, unknown>[]
}) {
  const known = PROFILE_FIELDS.filter(f => profile[f] !== null && profile[f] !== undefined && profile[f] !== '')
    .map(f => `- ${f}: ${profile[f]}`).join('\n') || '(nothing yet)'
  const missing = PROFILE_FIELDS.filter(f => profile[f] === null || profile[f] === undefined || profile[f] === '')

  return `Known so far (single-statement fields):
${known}

Still missing: ${missing.join(', ') || 'nothing -- these fields are complete'}

${listKnown('Known competitors', related.competitors, ['name', 'competitor_type', 'notes', 'threat_level', 'our_counter'])}

${listKnown('Known audience segments', related.audienceSegments, ['name', 'description', 'messaging_angle', 'priority'])}

${listKnown('Known goals', related.goals, ['description', 'metric', 'target_value', 'current_value', 'deadline', 'priority_rank', 'status'])}

${listKnown('Known seasonal events', related.seasonalEvents, ['period_label', 'theme', 'focus_notes', 'priority'])}`
}

type ContentBlock = Record<string, unknown>
type Turn = { role: string; content: string | ContentBlock[]; meta?: { at: string; tokens?: number } }

// Historical image_ref blocks are never resent -- see file header. Every
// other block (text, tool_use, tool_result, thinking) passes through as-is.
function sanitizeForClaude(content: Turn['content']): Turn['content'] {
  if (typeof content === 'string' || !Array.isArray(content)) return content
  return content.map(b => b.type === 'image_ref' ? { type: 'text', text: '[Image attached earlier -- not resent]' } : b)
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

    const { message, imagePath } = await req.json()
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

    // adminClient uses the service-role key, which bypasses storage RLS --
    // the tenant scoping that normally keeps one tenant's images out of
    // another's reach has to be re-checked explicitly here.
    if (imagePath && !imagePath.startsWith(`${row.id}/`)) {
      return new Response(JSON.stringify({ error: 'Invalid image path' }), { status: 403, headers: corsHeaders })
    }

    const [competitorsRes, segmentsRes, goalsRes, eventsRes] = await Promise.all([
      adminClient.from('sales_marketing_competitors').select('*').eq('business_profile_id', row.id).order('created_at'),
      adminClient.from('sales_marketing_audience_segments').select('*').eq('business_profile_id', row.id).order('created_at'),
      adminClient.from('sales_marketing_goals').select('*').eq('business_profile_id', row.id).order('priority_rank', { nullsFirst: false }),
      adminClient.from('sales_marketing_seasonal_events').select('*').eq('business_profile_id', row.id).order('created_at'),
    ])
    const related = {
      competitors: competitorsRes.data ?? [],
      audienceSegments: segmentsRes.data ?? [],
      goals: goalsRes.data ?? [],
      seasonalEvents: eventsRes.data ?? [],
    }

    let claudeUserContent: Turn['content'] = message
    let dbUserContent: Turn['content'] = message

    if (imagePath) {
      const { data: fileBlob, error: dlErr } = await adminClient.storage.from(UPLOADS_BUCKET).download(imagePath)
      if (dlErr || !fileBlob) {
        return new Response(JSON.stringify({ error: 'Could not read the attached image' }), { status: 400, headers: corsHeaders })
      }
      const base64 = bytesToBase64(new Uint8Array(await fileBlob.arrayBuffer()))
      const mediaType = fileBlob.type || 'image/jpeg'
      claudeUserContent = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: message },
      ]
      dbUserContent = [{ type: 'image_ref', path: imagePath }, { type: 'text', text: message }]
    }

    const conversation: Turn[] = Array.isArray(row.conversation) ? row.conversation : []
    let claudeHistory: Turn[] = [...conversation.map(t => ({ role: t.role, content: sanitizeForClaude(t.content) })), { role: 'user', content: claudeUserContent }]
    let dbHistory: Turn[] = [...conversation, { role: 'user', content: dbUserContent, meta: { at: new Date().toISOString() } }]
    const updates: Record<string, unknown> = {}
    const competitorUpserts: Record<string, unknown>[] = []
    const segmentUpserts: Record<string, unknown>[] = []
    const goalUpserts: Record<string, unknown>[] = []
    const eventUpserts: Record<string, unknown>[] = []
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

    function withCacheBreakpoint(msgs: Turn[]): ContentBlock[] {
      const out = msgs.map(m => ({ role: m.role, content: m.content }))
      const last = out[out.length - 1]
      if (!last) return out
      const blocks: ContentBlock[] = typeof last.content === 'string'
        ? [{ type: 'text', text: last.content }]
        : [...last.content]
      if (blocks.length === 0) return out
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
      out[out.length - 1] = { role: last.role, content: blocks }
      return out
    }

    async function callClaude(msgs: Turn[]) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 1536,
          system: [
            { type: 'text', text: STABLE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: profileStatusBlock({ ...row, ...updates }, related) },
          ],
          tools: ALL_TOOLS,
          messages: withCacheBreakpoint(msgs),
        }),
      })
      if (!res.ok) throw new Error(`Assistant call failed: ${await res.text()}`)
      return res.json()
    }

    // A turn where Claude only calls tools may come back with no text at
    // all (stop_reason "tool_use", nothing to show the owner). Round-trip
    // the tool_results and ask again so there's always a reply to display
    // -- capped at one extra round so a model that keeps calling tools
    // can't turn one chat message into an unbounded chain of API calls.
    let replyText = ''
    let replyTurnRef: Turn | null = null
    for (let round = 0; round < 2; round++) {
      const anthropicMsg = await callClaude(claudeHistory)
      const u = anthropicMsg.usage ?? {}
      usage.input_tokens += u.input_tokens ?? 0
      usage.output_tokens += u.output_tokens ?? 0
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0

      const content: ContentBlock[] = anthropicMsg.content ?? []
      const toolUses = content.filter(b => b.type === 'tool_use')

      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>
        switch (tu.name) {
          case 'update_business_profile':
            for (const field of PROFILE_FIELDS) {
              if (input[field] !== undefined) updates[field] = input[field]
            }
            break
          case 'upsert_competitor': competitorUpserts.push(input); break
          case 'upsert_audience_segment': segmentUpserts.push(input); break
          case 'upsert_goal': goalUpserts.push(input); break
          case 'upsert_seasonal_event': eventUpserts.push(input); break
        }
      }

      claudeHistory = [...claudeHistory, { role: 'assistant', content }]
      const dbAssistantTurn: Turn = { role: 'assistant', content }
      dbHistory = [...dbHistory, dbAssistantTurn]

      const text = content.filter(b => b.type === 'text').map(b => b.text as string).join('\n').trim()
      if (text) { replyText = text; replyTurnRef = dbAssistantTurn }

      if (toolUses.length === 0) break
      const toolResultTurn: Turn = {
        role: 'user',
        content: toolUses.map(tu => ({ type: 'tool_result', tool_use_id: tu.id, content: 'Saved.' })),
      }
      claudeHistory = [...claudeHistory, toolResultTurn]
      dbHistory = [...dbHistory, toolResultTurn]
      if (text) break
    }

    if (replyTurnRef) replyTurnRef.meta = { at: new Date().toISOString(), tokens: usage.input_tokens + usage.output_tokens }

    const { data: updatedRow, error: updateErr } = await adminClient.from('sales_marketing_business_profile')
      .update({ ...updates, conversation: dbHistory, updated_by: caller.id })
      .eq('id', row.id)
      .select('*').single()

    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: corsHeaders })

    await Promise.all([
      competitorUpserts.length && adminClient.from('sales_marketing_competitors')
        .upsert(competitorUpserts.map(c => ({ ...c, tenant_id: callerProfile.tenant_id, business_profile_id: row.id })), { onConflict: 'business_profile_id,name' }),
      segmentUpserts.length && adminClient.from('sales_marketing_audience_segments')
        .upsert(segmentUpserts.map(s => ({ ...s, tenant_id: callerProfile.tenant_id, business_profile_id: row.id })), { onConflict: 'business_profile_id,name' }),
      goalUpserts.length && adminClient.from('sales_marketing_goals')
        .upsert(goalUpserts.map(g => ({ ...g, tenant_id: callerProfile.tenant_id, business_profile_id: row.id })), { onConflict: 'business_profile_id,description' }),
      eventUpserts.length && adminClient.from('sales_marketing_seasonal_events')
        .upsert(eventUpserts.map(e => ({ ...e, tenant_id: callerProfile.tenant_id, business_profile_id: row.id })), { onConflict: 'business_profile_id,period_label' }),
    ].filter(Boolean))

    const [freshCompetitors, freshSegments, freshGoals, freshEvents] = await Promise.all([
      adminClient.from('sales_marketing_competitors').select('*').eq('business_profile_id', row.id).order('created_at'),
      adminClient.from('sales_marketing_audience_segments').select('*').eq('business_profile_id', row.id).order('created_at'),
      adminClient.from('sales_marketing_goals').select('*').eq('business_profile_id', row.id).order('priority_rank', { nullsFirst: false }),
      adminClient.from('sales_marketing_seasonal_events').select('*').eq('business_profile_id', row.id).order('created_at'),
    ])

    // Token logging is a nice-to-have for analysis, not load-bearing for
    // the chat itself -- a failure here shouldn't fail the user's turn.
    await adminClient.from('ai_token_usage').insert({
      tenant_id: callerProfile.tenant_id,
      feature: FEATURE,
      model: 'claude-opus-5',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      requested_by: caller.id,
    }).then(({ error }) => { if (error) console.error('ai_token_usage insert failed:', error.message) })

    return new Response(JSON.stringify({
      reply: replyText,
      profile: updatedRow,
      competitors: freshCompetitors.data ?? [],
      audienceSegments: freshSegments.data ?? [],
      goals: freshGoals.data ?? [],
      seasonalEvents: freshEvents.data ?? [],
      usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens },
    }), { status: 200, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
