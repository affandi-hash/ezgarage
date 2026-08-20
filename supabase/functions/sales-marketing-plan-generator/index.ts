import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Generates a Marketing Plan for a specific period, grounded in real
// historical job/revenue volume for THIS tenant -- not just the owner's
// stated seasonal beliefs. Reuses the exact date/status conventions
// already trusted in ReportsPage/useDashboard: job volume buckets on
// `checked_in_at` with `status = 'delivered'` for completed jobs; revenue
// buckets on `issue_date`, "paid" = cash-basis (status = 'paid'), "all" =
// accrual (status IN sent/overdue/paid, excluding draft/void).
//
// One call, one plan: the plan row is created with the caller-supplied
// title/dates, then Claude fills in the theme/budget/rationale via a
// single set_plan_details tool call and adds initiatives one at a time
// via add_initiative -- same one-row-per-item principle as competitors,
// goals, etc, so editing initiative #5 later never touches #1-4.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const FEATURE = 'marketing_plan_assistant'
const HISTORY_MONTHS = 24

const SET_PLAN_DETAILS_TOOL = {
  name: 'set_plan_details',
  description: 'Set the theme, target segments, budget, and rationale for this plan. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      theme: { type: 'string', description: 'The objective/positioning for this period, one or two sentences' },
      target_segment_names: { type: 'array', items: { type: 'string' }, description: 'Names of audience segments this plan focuses on -- must match names from the known segments list exactly' },
      budget_allocated_myr: { type: 'number' },
      ai_rationale: { type: 'string', description: 'Why this plan looks the way it does -- explicitly reference the real historical job/revenue data provided, not just the owner\'s stated beliefs. Call out where the data confirms or contradicts what the owner assumed.' },
      initiative_count: { type: 'number', description: 'How many concrete initiatives you will add next via add_initiative, one call each. Pick between 4 and 8 based on how much this plan genuinely needs.' },
    },
    required: ['theme', 'ai_rationale', 'initiative_count'],
    additionalProperties: false,
  },
}

const ADD_INITIATIVE_TOOL = {
  name: 'add_initiative',
  description: 'Add ONE concrete marketing initiative/tactic to this plan. Call once per initiative -- aim for 4 to 8 specific, actionable initiatives, not vague ideas.',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'A specific, actionable initiative, e.g. "WhatsApp blast to ESP members offering pre-Raya brake & tyre check"' },
      channel: { type: 'string', description: 'e.g. instagram, tiktok, facebook, whatsapp, in_person, email' },
      owner_text: { type: 'string', description: 'Who should execute this, based on the business\'s stated execution capacity' },
      due_date: { type: 'string', description: 'ISO date, if a specific timing makes sense within the plan period' },
      priority_rank: { type: 'number', description: '1 = highest priority' },
    },
    required: ['description'],
    additionalProperties: false,
  },
}

function monthKey(dateStr: string) { return dateStr.slice(0, 7) }
function monthName(key: string) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
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

    const { title, period_start, period_end, focus_notes } = await req.json()
    if (!title?.trim() || !period_start || !period_end) {
      return new Response(JSON.stringify({ error: 'title, period_start, and period_end are required' }), { status: 400, headers: corsHeaders })
    }

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const tenantId = callerProfile.tenant_id

    const { data: bpRow } = await adminClient.from('sales_marketing_business_profile')
      .select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!bpRow) {
      return new Response(JSON.stringify({ error: 'Fill in the Business Profile first -- Izzy needs it to write a grounded plan.' }), { status: 400, headers: corsHeaders })
    }

    const [competitorsRes, segmentsRes, goalsRes, eventsRes] = await Promise.all([
      adminClient.from('sales_marketing_competitors').select('name, competitor_type, threat_level, our_counter').eq('business_profile_id', bpRow.id),
      adminClient.from('sales_marketing_audience_segments').select('name, description, priority').eq('business_profile_id', bpRow.id),
      adminClient.from('sales_marketing_goals').select('description, metric, target_value, current_value, status').eq('business_profile_id', bpRow.id).eq('status', 'active'),
      adminClient.from('sales_marketing_seasonal_events').select('period_label, theme, focus_notes, priority').eq('business_profile_id', bpRow.id),
    ])

    // Real historical data -- same conventions as ReportsPage/useDashboard:
    // job volume on checked_in_at + status='delivered', revenue on
    // issue_date with paid (cash) vs all-committed (accrual) split.
    const since = new Date()
    since.setMonth(since.getMonth() - HISTORY_MONTHS)
    const sinceIso = since.toISOString()
    const sinceDate = sinceIso.slice(0, 10)

    const [jobsRes, invoicesRes, historicalRes, analysisRes] = await Promise.all([
      adminClient.from('jobs').select('checked_in_at, status').eq('tenant_id', tenantId).gte('checked_in_at', sinceIso),
      adminClient.from('invoices').select('issue_date, status, total_amount').eq('tenant_id', tenantId).gte('issue_date', sinceDate).in('status', ['sent', 'overdue', 'paid']),
      adminClient.from('sales_marketing_period_metrics').select('period_month, metric_key, value, source').eq('tenant_id', tenantId).is('channel', null).gte('period_month', sinceDate),
      adminClient.from('sales_marketing_business_analysis').select('current_analysis').eq('tenant_id', tenantId).maybeSingle(),
    ])

    type MonthStat = { jobs: number; delivered: number; revenuePaid: number; revenueAll: number }
    const monthly: Record<string, MonthStat> = {}
    function bucket(key: string): MonthStat {
      if (!monthly[key]) monthly[key] = { jobs: 0, delivered: 0, revenuePaid: 0, revenueAll: 0 }
      return monthly[key]
    }
    for (const j of jobsRes.data ?? []) {
      if (!j.checked_in_at) continue
      const b = bucket(monthKey(j.checked_in_at))
      b.jobs += 1
      if (j.status === 'delivered') b.delivered += 1
    }
    for (const inv of invoicesRes.data ?? []) {
      const b = bucket(monthKey(inv.issue_date))
      const amt = inv.total_amount ?? 0
      b.revenueAll += amt
      if (inv.status === 'paid') b.revenuePaid += amt
    }

    const sortedMonths = Object.keys(monthly).sort()
    const last12 = sortedMonths.slice(-12)
    const trendTable = last12.length
      ? last12.map(k => `${monthName(k)}: ${monthly[k].jobs} jobs (${monthly[k].delivered} delivered), RM${monthly[k].revenuePaid.toFixed(0)} paid / RM${monthly[k].revenueAll.toFixed(0)} accrual`).join('\n')
      : '(no job/invoice history in the last 24 months -- this tenant is new or has no recorded activity yet)'

    // Same-calendar-month history for whichever months the requested
    // period spans, across every year of data available -- this is what
    // actually answers "is this period historically slow or busy," not
    // just a general trend.
    const periodMonths = new Set<number>()
    const startDate = new Date(period_start)
    const endDate = new Date(period_end)
    for (let d = new Date(startDate); d <= endDate; d.setMonth(d.getMonth() + 1)) periodMonths.add(d.getMonth() + 1)
    const samePeriodHistory = sortedMonths
      .filter(k => periodMonths.has(Number(k.split('-')[1])))
      .map(k => `${monthName(k)}: ${monthly[k].jobs} jobs (${monthly[k].delivered} delivered), RM${monthly[k].revenuePaid.toFixed(0)} paid revenue`)
      .join('\n') || '(no historical data for these specific calendar months yet)'

    // sales_marketing_period_metrics rows -- both manually-entered live
    // metrics (Reach/Leads/Prospects etc, otherwise invisible to this
    // generator) and imported pre-adoption history, each labeled by
    // source so the model never treats an uploaded document's numbers as
    // if they were verified ezgarage records.
    const historicalRows = (historicalRes.data ?? []).map(r =>
      `${monthName(monthKey(r.period_month))}: ${r.metric_key}=${r.value} (${r.source === 'ai_extracted_historical' ? 'imported from an uploaded document -- treat as approximate' : 'manually entered by staff'})`
    )
    const historicalTable = historicalRows.length ? historicalRows.join('\n') : '(none on file)'
    const firstLiveMonth = sortedMonths[0] ? monthName(sortedMonths[0]) : null

    const known = (label: string, rows: Record<string, unknown>[] | null) =>
      !rows || rows.length === 0 ? `${label}: (none yet)` : `${label}:\n${rows.map(r => `- ${Object.entries(r).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join(', ')}`).join('\n')}`

    const systemPrompt = `You are Izzy, an AI acting as Chief Sales & Marketing Officer for a garage/workshop business, writing a Marketing Plan for a specific period. Ground every claim in the REAL data below -- this is not a generic template, it's a plan for this specific business's actual numbers.

PLAN BEING CREATED: "${title}", ${period_start} to ${period_end}.
${focus_notes ? `Owner's focus notes: ${focus_notes}` : ''}

${analysisRes.data?.current_analysis ? `OWNER-RECONCILED BUSINESS ANALYSIS (read this first -- the owner has already discussed and corrected this with Izzy, so it accounts for context the raw data below cannot show. Build the plan on this understanding, not a re-derivation from scratch.)\n${analysisRes.data.current_analysis}\n` : ''}

BUSINESS PROFILE
Tagline: ${bpRow.tagline ?? '(none)'}
Brand voice: ${bpRow.brand_voice ?? '(none)'}
Unique selling points: ${bpRow.unique_selling_points ?? '(none)'}
Guardrails: ${bpRow.guardrails ?? '(none)'}
Pricing position: ${bpRow.pricing_position ?? '(none)'}
Monthly marketing budget: ${bpRow.monthly_budget_myr != null ? `RM${bpRow.monthly_budget_myr}` : '(not set)'}
Who executes marketing: ${bpRow.execution_capacity ?? '(not set)'}

${known('Competitors', competitorsRes.data)}

${known('Audience segments (use these exact names in target_segment_names)', segmentsRes.data)}

${known('Active goals', goalsRes.data)}

${known('Owner-stated seasonal context', eventsRes.data)}

REAL HISTORICAL PERFORMANCE (this tenant's actual records, last ${HISTORY_MONTHS} months)
Last 12 months trend:
${trendTable}

Same calendar month(s) as this plan's period, across all available years:
${samePeriodHistory}

${firstLiveMonth ? `This tenant's own recorded job/invoice history in this system begins at ${firstLiveMonth}. Do NOT interpret the absence of jobs/invoices data before that date as zero business activity -- it almost certainly means the business was using a different system before switching to this one, not that it didn't exist.` : `This tenant has no job/invoice history in this system yet.`}

OTHER MARKETING METRICS ON FILE (manually entered and/or imported from uploaded documents -- see label per row)
${historicalTable}

Instructions:
- Call set_plan_details exactly once. In ai_rationale, explicitly say whether the real data confirms or contradicts the owner's stated seasonal beliefs for this period, and size the plan accordingly (e.g. don't recommend an acquisition blitz into a month the data shows is structurally slow for reasons unrelated to marketing).
- If there's no historical data for this period yet, say so plainly in the rationale rather than inventing a trend. Never present pre-adoption silence in the jobs/invoices data as if it were a real business slowdown.
- Treat imported-document figures as approximate context, not verified fact -- if a plan decision hinges on one, say so.
- Respect the guardrails and brand voice already on file.
- Do not exceed the stated monthly budget across the plan unless the owner's focus notes say otherwise.`

    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

    async function callClaude(msgs: unknown[], toolChoice: Record<string, unknown>) {
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
          tools: [SET_PLAN_DETAILS_TOOL, ADD_INITIATIVE_TOOL],
          messages: msgs,
          tool_choice: toolChoice,
        }),
      })
      if (!res.ok) throw new Error(`Assistant call failed: ${await res.text()}`)
      const json = await res.json()
      const u = json.usage ?? {}
      usage.input_tokens += u.input_tokens ?? 0
      usage.output_tokens += u.output_tokens ?? 0
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
      return json
    }

    // Rather than asking nicely and hoping the model calls add_initiative
    // for every item it describes (it sometimes just writes a numbered
    // list in prose instead, saving nothing), tool_choice forces the
    // shape of each turn: one turn locked to set_plan_details, then one
    // turn per initiative locked to add_initiative, then one turn locked
    // to plain text for the owner-facing summary. The model can no longer
    // "choose" to skip saving.
    let history: unknown[] = [{ role: 'user', content: 'Generate the plan now.' }]

    // Every tool_use block Claude emits MUST get a matching tool_result in
    // the very next message, or the next API call is rejected outright --
    // this pushes both halves together unconditionally so a turn can never
    // leave a dangling tool_use, regardless of which tool actually fired.
    function pushTurn(content: Array<Record<string, unknown>>, resultText: string) {
      history = [...history, { role: 'assistant', content }]
      const toolUses = content.filter(b => b.type === 'tool_use') as { id: string; name: string; input?: Record<string, unknown> }[]
      if (toolUses.length > 0) {
        history = [...history, { role: 'user', content: toolUses.map(tu => ({ type: 'tool_result', tool_use_id: tu.id, content: resultText })) }]
      }
      return toolUses
    }

    const planMsg = await callClaude(history, { type: 'tool', name: 'set_plan_details' })
    const planToolUses = pushTurn(planMsg.content ?? [], 'Saved.')
    const planTu = planToolUses.find(tu => tu.name === 'set_plan_details')
    const planDetails: Record<string, unknown> = planTu?.input ?? {}

    const targetCount = Math.min(8, Math.max(4, Math.round(Number(planDetails.initiative_count)) || 6))
    const initiativeInputs: Record<string, unknown>[] = []
    for (let i = 0; i < targetCount; i++) {
      const msg = await callClaude(history, { type: 'tool', name: 'add_initiative' })
      const toolUses = pushTurn(msg.content ?? [], `Saved as initiative #${initiativeInputs.length + 1}.`)
      const tu = toolUses.find(t => t.name === 'add_initiative')
      if (tu) initiativeInputs.push(tu.input ?? {})
    }

    const summaryMsg = await callClaude(
      [...history, { role: 'user', content: 'Write a short 2-4 sentence summary of this plan for the owner. Do not call any tools.' }],
      { type: 'none' },
    )
    const replyText = ((summaryMsg.content ?? []) as Array<Record<string, unknown>>)
      .filter(b => b.type === 'text').map(b => b.text as string).join('\n').trim()

    const { data: plan, error: planErr } = await adminClient.from('sales_marketing_plans')
      .insert({
        tenant_id: tenantId,
        business_profile_id: bpRow.id,
        title: title.trim(),
        period_start,
        period_end,
        theme: planDetails?.theme ?? null,
        target_segment_names: planDetails?.target_segment_names ?? null,
        budget_allocated_myr: planDetails?.budget_allocated_myr ?? bpRow.monthly_budget_myr ?? null,
        ai_rationale: planDetails?.ai_rationale ?? null,
        created_by: caller.id,
      })
      .select('*').single()

    if (planErr || !plan) return new Response(JSON.stringify({ error: planErr?.message ?? 'Failed to create plan' }), { status: 500, headers: corsHeaders })

    // Insert one at a time -- if one initiative has a malformed field
    // (e.g. a non-ISO due_date), it must not take the rest of a
    // perfectly good batch down with it.
    const initiatives: Record<string, unknown>[] = []
    for (const raw of initiativeInputs) {
      const description = typeof raw.description === 'string' ? raw.description.trim() : ''
      if (!description) continue
      const channel = typeof raw.channel === 'string' && raw.channel.trim() ? raw.channel.trim() : null
      const owner_text = typeof raw.owner_text === 'string' && raw.owner_text.trim() ? raw.owner_text.trim() : null
      const due_date = typeof raw.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.due_date) ? raw.due_date : null
      const priorityRankNum = Number(raw.priority_rank)
      const priority_rank = Number.isFinite(priorityRankNum) ? priorityRankNum : initiatives.length + 1
      const { data, error } = await adminClient.from('sales_marketing_plan_initiatives')
        .insert({ tenant_id: tenantId, plan_id: plan.id, description, channel, owner_text, due_date, priority_rank })
        .select('*').single()
      if (error) console.error('Failed to insert initiative:', error.message, description)
      else initiatives.push(data)
    }

    await adminClient.from('ai_token_usage').insert({
      tenant_id: tenantId,
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
      plan,
      initiatives,
      usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens },
    }), { status: 200, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
