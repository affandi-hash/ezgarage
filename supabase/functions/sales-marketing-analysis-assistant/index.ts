import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// "Business Analysis" -- the sync step between what the real data shows
// and what the owner knows that no file/table can ever capture (a
// competitor closing, a renovation explaining a dip, a planned price
// change). This is NOT a report the AI writes and the owner reads --
// it's a reconciliation: the AI states its data-driven read AND its own
// key assumptions/uncertainties, explicitly inviting correction, and
// keeps updating its saved understanding (via save_analysis) as the
// owner corrects or adds context that isn't in any table.
//
// One evergreen row per tenant (sales_marketing_business_analysis, 141),
// not one per plan -- context the owner gives today (e.g. "we stopped
// doing walk-in bikes on Sundays") should still be known next time, not
// re-explained from scratch. Re-opened, not restarted: START_SENTINEL
// only fires once (no row yet); REFRESH_SENTINEL re-reads current data
// and asks the model to reconcile it against what's already agreed,
// flagging anything new or changed rather than silently overwriting it.
//
// sales-marketing-plan-generator reads current_analysis as
// already-agreed context -- the whole point is that a plan gets drafted
// against a diagnosis the owner has already corrected, not one it has
// to fix after the fact.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const START_SENTINEL = '__START_ANALYSIS__'
const REFRESH_SENTINEL = '__REFRESH_ANALYSIS__'
const SAVE_SENTINEL = '__SAVE_ANALYSIS__'
const FEATURE = 'business_analysis_assistant'
const HISTORY_MONTHS = 24

const SAVE_ANALYSIS_TOOL = {
  name: 'save_analysis',
  description: 'Save your current reconciled understanding of the business -- call this whenever it changes: after your initial read, and again every time the owner confirms, corrects, or adds context that changes the picture. This is what the Marketing Plan generator will read later, so it must reflect the OWNER-CONFIRMED understanding, not just your first guess from the raw numbers.',
  input_schema: {
    type: 'object',
    properties: {
      analysis_summary: { type: 'string', description: 'A few paragraphs: the current state of the business, what the data shows, and anything the owner has told you that the data alone would not reveal. Written for another AI (the plan generator) to read as ground truth.' },
    },
    required: ['analysis_summary'],
    additionalProperties: false,
  },
}

function monthKey(dateStr: string) { return dateStr.slice(0, 7) }
function monthName(key: string) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

type ContentBlock = Record<string, unknown>
type Turn = { role: string; content: string | ContentBlock[] }

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

    const { message } = await req.json()
    if (!message?.trim()) return new Response(JSON.stringify({ error: 'message is required' }), { status: 400, headers: corsHeaders })

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const tenantId = callerProfile.tenant_id

    const { data: bpRow } = await adminClient.from('sales_marketing_business_profile').select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!bpRow) return new Response(JSON.stringify({ error: 'Fill in the Business Profile first.' }), { status: 400, headers: corsHeaders })

    let { data: row } = await adminClient.from('sales_marketing_business_analysis').select('*').eq('tenant_id', tenantId).maybeSingle()
    if (!row) {
      const { data: created, error: createErr } = await adminClient.from('sales_marketing_business_analysis')
        .insert({ tenant_id: tenantId, business_profile_id: bpRow.id, conversation: [], updated_by: caller.id })
        .select('*').single()
      if (createErr || !created) return new Response(JSON.stringify({ error: createErr?.message ?? 'Failed to start analysis' }), { status: 500, headers: corsHeaders })
      row = created
    }

    // Real data -- same conventions/window as sales-marketing-plan-generator
    // (ReportsPage/useDashboard), so the two features never disagree about
    // what "the real numbers" are.
    const since = new Date()
    since.setMonth(since.getMonth() - HISTORY_MONTHS)
    const sinceIso = since.toISOString()
    const sinceDate = sinceIso.slice(0, 10)

    const [competitorsRes, segmentsRes, goalsRes, eventsRes, jobsRes, invoicesRes, metricsRes] = await Promise.all([
      adminClient.from('sales_marketing_competitors').select('name, competitor_type, threat_level, our_counter').eq('business_profile_id', bpRow.id),
      adminClient.from('sales_marketing_audience_segments').select('name, description, priority').eq('business_profile_id', bpRow.id),
      adminClient.from('sales_marketing_goals').select('description, metric, target_value, current_value, status').eq('business_profile_id', bpRow.id).eq('status', 'active'),
      adminClient.from('sales_marketing_seasonal_events').select('period_label, theme, focus_notes, priority').eq('business_profile_id', bpRow.id),
      adminClient.from('jobs').select('checked_in_at, status').eq('tenant_id', tenantId).gte('checked_in_at', sinceIso),
      adminClient.from('invoices').select('issue_date, status, total_amount').eq('tenant_id', tenantId).gte('issue_date', sinceDate).in('status', ['sent', 'overdue', 'paid']),
      adminClient.from('sales_marketing_period_metrics').select('period_month, metric_key, value, source').eq('tenant_id', tenantId).is('channel', null).gte('period_month', sinceDate),
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
      : '(no job/invoice history in the last 24 months)'
    const firstLiveMonth = sortedMonths[0] ? monthName(sortedMonths[0]) : null

    const historicalRows = (metricsRes.data ?? []).map(r =>
      `${monthName(monthKey(r.period_month))}: ${r.metric_key}=${r.value} (${r.source === 'ai_extracted_historical' ? 'imported from an uploaded document -- approximate' : 'manually entered by staff'})`
    )
    const historicalTable = historicalRows.length ? historicalRows.join('\n') : '(none on file)'

    const known = (label: string, rows: Record<string, unknown>[] | null) =>
      !rows || rows.length === 0 ? `${label}: (none yet)` : `${label}:\n${rows.map(r => `- ${Object.entries(r).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join(', ')}`).join('\n')}`

    function buildSystemPrompt(currentAnalysis: string | null) {
      return `You are Izzy, an AI acting as Chief Sales & Marketing Officer for a garage/workshop business. You are having a "Business Analysis" conversation with the owner -- the purpose is NOT to write a report for them to passively read. It is to reconcile what the real data shows against what the owner actually knows, because a huge amount of real context (a competitor closing, a renovation, a planned price change, a regular customer's plans) will never appear in any table or uploaded document.

BUSINESS PROFILE
Tagline: ${bpRow.tagline ?? '(none)'}
Brand voice: ${bpRow.brand_voice ?? '(none)'}
Unique selling points: ${bpRow.unique_selling_points ?? '(none)'}
Pricing position: ${bpRow.pricing_position ?? '(none)'}

${known('Competitors', competitorsRes.data)}
${known('Audience segments', segmentsRes.data)}
${known('Active goals', goalsRes.data)}
${known('Owner-stated seasonal context', eventsRes.data)}

REAL JOB/REVENUE HISTORY (last 12 months on file)
${trendTable}
${firstLiveMonth ? `This tenant's own recorded job/invoice history in this system begins at ${firstLiveMonth}. Do NOT interpret the absence of data before that date as zero business activity -- it means they were using a different system before switching, not that the business didn't exist.` : 'No job/invoice history in this system yet.'}

OTHER MARKETING METRICS ON FILE (manually entered and/or imported from uploaded documents)
${historicalTable}

${currentAnalysis ? `YOUR PREVIOUSLY AGREED ANALYSIS (reconcile this against the fresh data above -- if something has changed, say so explicitly; if the owner already explained something here, do not ask about it again)\n${currentAnalysis}` : ''}

Rules:
- State your read of the real data plainly, then explicitly name your OWN key assumptions and uncertainties -- anything you are inferring rather than actually seeing in the data -- and invite the owner to confirm or correct it. This is the entire point of the conversation.
- When the owner tells you something the data can't show (an explanation, an upcoming change, a correction), fold it into your understanding and call save_analysis again with the updated, reconciled summary. Call save_analysis after your very first analysis too, and again any time the picture changes -- not just once.
- Keep messages conversational and short -- a few sentences, not a wall of text. This is a discussion, not a report.
- If the message is exactly "${START_SENTINEL}", this is the very first analysis for this business -- introduce the analysis briefly and give your initial read, ending with the specific things you want the owner to confirm or correct.
- If the message is exactly "${REFRESH_SENTINEL}", this is a request to re-check against fresh data -- compare it to your previously agreed analysis and call out ONLY what's new or changed, don't repeat everything. If nothing meaningful has changed, say so briefly.
- If the message is exactly "${SAVE_SENTINEL}", this is a system trigger (not from the owner) forcing you to call save_analysis right now -- write the full current reconciled analysis_summary reflecting everything agreed in this conversation so far, not just the latest message.`
    }

    const conversation: Turn[] = Array.isArray(row.conversation) ? row.conversation : []
    let claudeHistory: Turn[] = [...conversation, { role: 'user', content: message }]
    let dbHistory: Turn[] = [...conversation, { role: 'user', content: message }]

    let currentAnalysis: string | null = row.current_analysis
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

    async function callClaude(msgs: Turn[], toolChoice?: Record<string, unknown>) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-5',
          // Replies here are a multi-paragraph analysis plus a numbered list
          // of assumptions, not the 1-3 sentence replies sales-marketing-
          // assistant gives -- 1536 left no room for save_analysis's
          // analysis_summary argument after that much text, so the tool
          // call came back with an empty input every time.
          max_tokens: 4096,
          system: buildSystemPrompt(currentAnalysis),
          tools: [SAVE_ANALYSIS_TOOL],
          messages: msgs,
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
        }),
      })
      if (!res.ok) throw new Error(`Assistant call failed: ${await res.text()}`)
      return res.json()
    }

    let replyText = ''
    let savedThisTurn = false
    for (let round = 0; round < 2; round++) {
      const anthropicMsg = await callClaude(claudeHistory)
      const u = anthropicMsg.usage ?? {}
      usage.input_tokens += u.input_tokens ?? 0
      usage.output_tokens += u.output_tokens ?? 0
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0

      const content: ContentBlock[] = anthropicMsg.content ?? []
      const toolUses = content.filter(b => b.type === 'tool_use') as { id: string; name: string; input?: Record<string, unknown> }[]

      // A malformed save_analysis call (empty/missing analysis_summary) must
      // NOT get told "Saved." -- that would leave Claude believing an
      // update went through when nothing was actually persisted. Telling it
      // the truth gives it a chance to retry with real content instead.
      let hadMalformedSave = false
      for (const tu of toolUses) {
        if (tu.name !== 'save_analysis') continue
        if (typeof tu.input?.analysis_summary === 'string' && tu.input.analysis_summary.trim()) {
          currentAnalysis = tu.input.analysis_summary
          savedThisTurn = true
        } else {
          hadMalformedSave = true
        }
      }

      const assistantTurn: Turn = { role: 'assistant', content }
      claudeHistory = [...claudeHistory, assistantTurn]
      dbHistory = [...dbHistory, assistantTurn]

      const text = content.filter(b => b.type === 'text').map(b => b.text as string).join('\n').trim()
      if (text) replyText = text

      if (toolUses.length === 0) break
      const toolResultTurn: Turn = {
        role: 'user',
        content: toolUses.map(tu => ({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: tu.name === 'save_analysis' && hadMalformedSave && !(typeof tu.input?.analysis_summary === 'string' && tu.input.analysis_summary.trim())
            ? 'Error: analysis_summary was empty, nothing was saved. Call save_analysis again with the actual summary text.'
            : 'Saved.',
        })),
      }
      claudeHistory = [...claudeHistory, toolResultTurn]
      dbHistory = [...dbHistory, toolResultTurn]
      if (text && !hadMalformedSave) break
    }

    // Leaving save_analysis to the model's discretion isn't reliable enough
    // for a feature whose entire point is persisting the reconciled
    // understanding -- observed live: a real owner correction got a
    // conversational reply with no follow-up save_analysis call at all.
    // Force it explicitly every turn instead of hoping the model chooses to.
    if (!savedThisTurn) {
      claudeHistory = [...claudeHistory, { role: 'user', content: SAVE_SENTINEL }]
      const saveMsg = await callClaude(claudeHistory, { type: 'tool', name: 'save_analysis' })
      const u = saveMsg.usage ?? {}
      usage.input_tokens += u.input_tokens ?? 0
      usage.output_tokens += u.output_tokens ?? 0
      usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0

      const content: ContentBlock[] = saveMsg.content ?? []
      const tu = content.find(b => b.type === 'tool_use') as { input?: Record<string, unknown> } | undefined
      if (typeof tu?.input?.analysis_summary === 'string' && tu.input.analysis_summary.trim()) {
        currentAnalysis = tu.input.analysis_summary
      }
      dbHistory = [...dbHistory, { role: 'user', content: SAVE_SENTINEL }, { role: 'assistant', content }]
    }

    const { data: updatedRow, error: updateErr } = await adminClient.from('sales_marketing_business_analysis')
      .update({ current_analysis: currentAnalysis, conversation: dbHistory, updated_by: caller.id, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*').single()

    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: corsHeaders })

    await adminClient.from('ai_token_usage').insert({
      tenant_id: tenantId, feature: FEATURE, model: 'claude-opus-5',
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens, cache_read_input_tokens: usage.cache_read_input_tokens,
      requested_by: caller.id,
    }).then(({ error }) => { if (error) console.error('ai_token_usage insert failed:', error.message) })

    return new Response(JSON.stringify({
      reply: replyText,
      analysis: updatedRow,
      usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens },
    }), { status: 200, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), { status: 500, headers: corsHeaders })
  }
})
