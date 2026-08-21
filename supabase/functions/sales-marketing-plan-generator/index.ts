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
      initiative_count: { type: 'number', description: 'Your ESTIMATE of how many concrete initiatives this plan needs. You will call add_initiative up to this many times, but call finish_initiatives as soon as you run out of genuinely distinct, actionable initiatives -- never pad to hit this number.' },
    },
    required: ['theme', 'ai_rationale', 'initiative_count'],
    additionalProperties: false,
  },
}

function buildAddInitiativeTool(staff: { id: string; label: string }[]) {
  return {
    name: 'add_initiative',
    description: 'Add ONE concrete, atomic marketing initiative/tactic to this plan -- a single action one person can execute and mark done, not a bundle of sub-tasks and not commentary about the plan itself. Call once per initiative. Call finish_initiatives instead once you have covered everything this plan genuinely needs, even if that is fewer than your original estimate.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['sales', 'fixing', 'other'],
          description: '"sales" = grows the business (gets more customers, more bookings). "fixing" = repairs something broken INSIDE the business that has to be right before sales even matters (a cash/collection problem, a data-logging gap, a capacity constraint). "other" = doesn\'t grow or fix, but still matters (setting up tracking, turning on a tool).',
        },
        summary: { type: 'string', description: 'ONE short, plain sentence a busy owner can scan in two seconds -- no numbers, no jargon, just the action. e.g. "Chase unpaid invoices from July." This is what shows by default; the fuller reasoning goes in description.' },
        description: { type: 'string', description: 'The fuller version, shown only when the owner expands this item: WHY this matters, which real number it ties back to, and what "done" looks like. ONE specific, actionable initiative for ONE owner -- e.g. "WhatsApp blast to ESP members offering pre-Raya brake & tyre check, because reach fell 96% since May and this reactivates the audience we already have." If a real initiative naturally has several people involved (e.g. the owner visits SMEs AND the manager calls ESP partners), split it into separate add_initiative calls, one per owner. Never write a summary, consolidation note, kickoff briefing, or any other meta-commentary here -- those are not initiatives.' },
        channel: { type: 'string', description: 'e.g. instagram, tiktok, facebook, whatsapp, in_person, email' },
        assigned_to_user_id: {
          type: 'string',
          enum: staff.map(s => s.id),
          description: `The single real staff member who owns this initiative -- must be exactly one id from this team:\n${staff.map(s => `${s.id} = ${s.label}`).join('\n')}`,
        },
        due_date: { type: 'string', description: 'ISO date, if a specific timing makes sense within the plan period' },
        priority_rank: { type: 'number', description: '1 = highest priority' },
      },
      required: ['category', 'summary', 'description', 'assigned_to_user_id'],
      additionalProperties: false,
    },
  }
}

const FINISH_INITIATIVES_TOOL = {
  name: 'finish_initiatives',
  description: 'Call this INSTEAD of add_initiative once you have added every genuinely distinct, actionable initiative this plan needs. Calling this with fewer initiatives than your original estimate is correct and expected if that is all the plan genuinely needs -- do not invent placeholder or filler initiatives to hit a number.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
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

    const [competitorsRes, segmentsRes, goalsRes, eventsRes, staffRes] = await Promise.all([
      adminClient.from('sales_marketing_competitors').select('name, competitor_type, threat_level, our_counter').eq('business_profile_id', bpRow.id),
      adminClient.from('sales_marketing_audience_segments').select('name, description, priority').eq('business_profile_id', bpRow.id),
      adminClient.from('sales_marketing_goals').select('description, metric, target_value, current_value, status').eq('business_profile_id', bpRow.id).eq('status', 'active'),
      adminClient.from('sales_marketing_seasonal_events').select('period_label, theme, focus_notes, priority').eq('business_profile_id', bpRow.id),
      adminClient.from('users').select('id, full_name, role').eq('tenant_id', tenantId).eq('is_active', true),
    ])

    // Every initiative needs exactly one REAL owner it can be assigned to,
    // not a free-text role label like "Manager" that nobody can act on --
    // that's what let the generator write things like "Owner leads the SME
    // visits; Manager handles ESP partner calls" as a single unassignable
    // row. Fall back to a placeholder only if the tenant somehow has no
    // active staff yet, so add_initiative's enum is never empty.
    const staff = (staffRes.data ?? []).map(u => ({ id: u.id as string, label: `${u.full_name} (${u.role})` }))
    if (staff.length === 0) staff.push({ id: caller.id, label: 'Owner' })

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

TEAM (assign every initiative to exactly one of these people)
${staff.map(s => `- ${s.label}`).join('\n')}

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
- Do not exceed the stated monthly budget across the plan unless the owner's focus notes say otherwise.
- Every initiative must be a single atomic action for ONE named owner -- if a real tactic naturally involves two people (e.g. the owner visits SMEs and the manager calls partners), that is two initiatives, not one. Never use add_initiative to write a summary, consolidation note, kickoff briefing, or any other commentary about the plan -- that belongs in ai_rationale or the closing summary, not in the initiatives list.
- Tag every initiative's category honestly: most plans need a mix of "fixing" (repair something broken before it undermines everything else -- a collection gap, missing data, a capacity constraint) and "sales" (actions that actually grow bookings/customers). Don't label a fix as sales just because it appears in a sales plan.
- Call finish_initiatives as soon as you've covered everything genuinely worth doing, even short of your own initiative_count estimate. A shorter list of real, atomic, assignable actions is correct; padding with filler is not.`

    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

    // Unlike the Business Analysis assistant, systemPrompt here is fully
    // static for the whole request -- it's built once above and never
    // depends on anything that changes between calls. That makes this loop
    // (1 set_plan_details + 4-8 add_initiative + 1 summary, all fired
    // milliseconds apart) the cleanest possible caching case: the system
    // prompt and the growing history both get cached in full and every call
    // after the first reads most of it back instead of paying full price.
    function withCacheBreakpoint(msgs: unknown[]): unknown[] {
      const out = msgs.map(m => ({ ...(m as Record<string, unknown>) }))
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

    const addInitiativeTool = buildAddInitiativeTool(staff)
    const ALL_TOOLS = [SET_PLAN_DETAILS_TOOL, addInitiativeTool, FINISH_INITIATIVES_TOOL]

    async function callClaude(msgs: unknown[], toolChoice: Record<string, unknown>, tools: Record<string, unknown>[] = ALL_TOOLS) {
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
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          tools,
          messages: withCacheBreakpoint(msgs),
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
    function pushTurn(content: Array<Record<string, unknown>>, resultTextFor: (tu: { name: string }) => string) {
      history = [...history, { role: 'assistant', content }]
      const toolUses = content.filter(b => b.type === 'tool_use') as { id: string; name: string; input?: Record<string, unknown> }[]
      if (toolUses.length > 0) {
        history = [...history, { role: 'user', content: toolUses.map(tu => ({ type: 'tool_result', tool_use_id: tu.id, content: resultTextFor(tu) })) }]
      }
      return toolUses
    }

    const planMsg = await callClaude(history, { type: 'tool', name: 'set_plan_details' })
    const planToolUses = pushTurn(planMsg.content ?? [], () => 'Saved.')
    const planTu = planToolUses.find(tu => tu.name === 'set_plan_details')
    const planDetails: Record<string, unknown> = planTu?.input ?? {}

    // tool_choice is still forced (never plain "auto") so the model can't
    // silently write a prose list instead of calling a tool at all -- but it
    // can now choose finish_initiatives over add_initiative, which is what
    // lets it stop for real instead of inventing placeholder content once it
    // runs out of genuine ideas before hitting its own estimate.
    const targetCount = Math.min(8, Math.max(4, Math.round(Number(planDetails.initiative_count)) || 6))
    const initiativeInputs: Record<string, unknown>[] = []
    for (let i = 0; i < targetCount; i++) {
      const msg = await callClaude(history, { type: 'any' }, [addInitiativeTool, FINISH_INITIATIVES_TOOL])
      const toolUses = pushTurn(msg.content ?? [], tu =>
        tu.name === 'finish_initiatives' ? 'Understood -- moving on.' : `Saved as initiative #${initiativeInputs.length + 1}.`)
      if (toolUses.some(t => t.name === 'finish_initiatives')) break
      const tu = toolUses.find(t => t.name === 'add_initiative')
      if (tu) initiativeInputs.push(tu.input ?? {})
    }

    // finish_initiatives means the actual saved count can now legitimately
    // differ from the initiative_count estimate in set_plan_details -- left
    // to its own recollection, the model tends to anchor on that earlier
    // estimate instead of what it actually just saved. Telling it the real
    // count and list explicitly keeps the summary honest about what's
    // really in the plan.
    const savedDescriptions = initiativeInputs.map(i => i.description).filter(Boolean)
    const summaryMsg = await callClaude(
      [...history, {
        role: 'user',
        content: `Write a short 2-4 sentence summary of this plan for the owner. You actually saved ${savedDescriptions.length} initiatives, not your earlier initiative_count estimate -- summarize only these: ${savedDescriptions.map((d, i) => `(${i + 1}) ${d}`).join(' ')}. Do not mention a different number or describe anything not in this list. Do not call any tools.`,
      }],
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
        generation_tokens: usage.input_tokens + usage.output_tokens,
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
      // A model can still miss the enum despite the schema constraint --
      // fall back to "other" rather than dropping otherwise-good content
      // over one bad field, and fall back the short summary to the full
      // description so the collapsed view never shows blank text.
      const category = ['sales', 'fixing', 'other'].includes(raw.category as string) ? raw.category as string : 'other'
      const summary = typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : description
      const channel = typeof raw.channel === 'string' && raw.channel.trim() ? raw.channel.trim() : null
      // assigned_to_user_id is enum-constrained to real staff, but a model
      // can still miss the schema -- fall back to unassigned rather than
      // dropping otherwise-good initiative content over one bad field.
      const matchedStaff = staff.find(s => s.id === raw.assigned_to_user_id)
      const assigned_to = matchedStaff?.id ?? null
      const owner_text = matchedStaff?.label ?? null
      const due_date = typeof raw.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.due_date) ? raw.due_date : null
      const priorityRankNum = Number(raw.priority_rank)
      const priority_rank = Number.isFinite(priorityRankNum) ? priorityRankNum : initiatives.length + 1
      const { data, error } = await adminClient.from('sales_marketing_plan_initiatives')
        .insert({ tenant_id: tenantId, plan_id: plan.id, category, summary, description, channel, assigned_to, owner_text, due_date, priority_rank })
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
