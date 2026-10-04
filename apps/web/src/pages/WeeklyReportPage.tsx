import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FileDown, Loader2, Save, Settings2, Trash2, FileBarChart } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'
import {
  addDays, computeReport, DEFAULT_BASIS, DEFAULT_SETTINGS, loadReportInput, loadSettings, mondayOf, parseYmd, toYmd,
  type ComputeInput, type ReportBasis, type ReportData, type ReportMode, type ReportSettings, type ReportWord,
} from '@/lib/weeklyReport'
import { openReportPrintWindow, reportPageCount, WeeklyReportPages } from '@/components/reports/WeeklyReportPages'

const C = { bg: '#0E0E0E', surface: '#1E1E1E', border: '#2A2A2A', orange: '#F15A22', text: '#F0F0F0', muted: '#A0A0A0' }
const PAGE_W = 1123, PAGE_H = 794

interface Snapshot { id: string; title: string; period_mode: ReportMode; period_start: string; period_end: string; created_at: string; data: ReportData & { savedWords?: ReportWord[][] | ReportWord[] } }
interface BranchRow { id: string; name: string }

const input: React.CSSProperties = { background: '#111', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, padding: '9px 12px', outline: 'none' }
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }
const btn = (primary = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${primary ? C.orange : C.border}`, background: primary ? C.orange : C.surface, color: primary ? '#fff' : C.text,
})

const wordSets = (d: ReportData): ReportWord[][] => (d.sections ?? [d]).map(sec => sec.words)
const lastCompletedWeek = () => mondayOf(addDays(toYmd(new Date()), -7))
const thisMonth = () => toYmd(new Date()).slice(0, 7)

export function WeeklyReportPage() {
  const user = useAuthStore(s => s.user)
  const tenant = useAuthStore(s => s.tenant)
  const tenantId = user?.tenant_id ?? ''
  const canEditTargets = user?.role === 'super_admin' || user?.role === 'ops_manager'

  const [mode, setMode] = useState<ReportMode>('week')
  const [weekStart, setWeekStart] = useState(lastCompletedWeek())
  const [month, setMonth] = useState(thisMonth())
  const [from, setFrom] = useState(toYmd(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(toYmd(new Date()))
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<BranchRow[]>([])

  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [rawInput, setRawInput] = useState<ComputeInput | null>(null)   // raw figures behind the report, so the comparison basis can change without reloading
  const [basis, setBasis] = useState<ReportBasis>(DEFAULT_BASIS)
  const [words, setWords] = useState<ReportWord[][]>([])
  const [savedId, setSavedId] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [settings, setSettings] = useState<ReportSettings>(DEFAULT_SETTINGS)
  const [showTargets, setShowTargets] = useState(false)

  const pagesRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  const loadSnapshots = useCallback(async () => {
    const { data } = await supabase.from('weekly_report_snapshots')
      .select('id, title, period_mode, period_start, period_end, created_at, data').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(30)
    setSnapshots((data as Snapshot[]) ?? [])
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).order('name').then(({ data }) => setBranches((data as BranchRow[]) ?? []))
    loadSettings(tenantId).then(setSettings)
    loadSnapshots()
  }, [tenantId, loadSnapshots])

  // fit the 1123px-wide pages to the available width
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / PAGE_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [report])

  function resolvePeriod(): { start: string; end: string } | string {
    const today = toYmd(new Date())
    if (mode === 'week') {
      const s = mondayOf(weekStart)
      return { start: s, end: addDays(s, 6) }
    }
    if (mode === 'month') {
      const [y, m] = month.split('-').map(Number)
      const last = toYmd(new Date(y, m, 0))
      return { start: `${month}-01`, end: last > today ? today : last }
    }
    if (!from || !to || from > to) return 'Choose a valid date range'
    if ((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86400000 > 120) return 'Custom range is limited to about 4 months'
    return { start: from, end: to }
  }

  async function generate() {
    const p = resolvePeriod()
    if (typeof p === 'string') { toast(p, 'error'); return }
    setBusy(true)
    try {
      const inp = await loadReportInput({
        tenantId, tenantName: tenant?.name ?? 'Motoverse Garage', branchId: branchId || null,
        branchLabel: branchId ? (branches.find(b => b.id === branchId)?.name ?? '') : 'All branches',
        mode, start: p.start, end: p.end,
      })
      const data = computeReport({ ...inp, basis })
      setRawInput(inp); setReport(data); setWords(wordSets(data)); setSavedId(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not generate the report', 'error')
    }
    setBusy(false)
  }

  // changing a comparison re-works the numbers from the loaded figures; edited words are kept
  function changeBasis(next: ReportBasis) {
    setBasis(next)
    if (rawInput) { setReport(computeReport({ ...rawInput, basis: next })); setSavedId(null) }
  }

  async function save() {
    if (!report) return
    const title = `${report.mode === 'week' ? 'Weekly' : report.mode === 'month' ? 'Monthly' : 'Custom'} report ${report.periodLabel}`
    const { data, error } = await supabase.from('weekly_report_snapshots').insert({
      tenant_id: tenantId, title, period_mode: report.mode, period_start: report.periodStart, period_end: report.periodEnd,
      branch_id: branchId || null, data: { ...report, savedWords: words }, created_by: user?.id,
    }).select('id').single()
    if (error) { toast(error.message, 'error'); return }
    setSavedId(data.id); toast('Report saved'); loadSnapshots()
  }

  function open(s: Snapshot) {
    const { savedWords, ...data } = s.data
    const rd = data as ReportData
    // reports saved before sections existed stored one flat list of words
    setRawInput(null); if (rd.basis) setBasis(rd.basis)
    setReport(rd); setWords(Array.isArray(savedWords) && Array.isArray(savedWords[0]) ? (savedWords as ReportWord[][]) : Array.isArray(savedWords) && savedWords.length ? [savedWords as ReportWord[]] : wordSets(rd)); setSavedId(s.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(s: Snapshot) {
    if (!window.confirm(`Delete "${s.title}"?`)) return
    const { error } = await supabase.from('weekly_report_snapshots').delete().eq('id', s.id)
    if (error) { toast(error.message, 'error'); return }
    if (savedId === s.id) setSavedId(null)
    loadSnapshots()
  }

  function download() {
    if (!pagesRef.current || !report) return
    if (!openReportPrintWindow(pagesRef.current, `Weekly Report ${report.periodLabel}`)) toast('Allow pop-ups to download the PDF', 'error')
  }

  async function saveTargets() {
    const { error } = await supabase.from('report_settings').upsert({ tenant_id: tenantId, ...settings, updated_by: user?.id, updated_at: new Date().toISOString() })
    if (error) { toast(error.message, 'error'); return }
    toast('Targets saved. Generate the report again to apply them.')
  }

  const num = (v: string) => (v === '' ? 0 : Number(v))

  return (
    <div style={{ padding: 24, maxWidth: 1240, margin: '0 auto', color: C.text }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Weekly Report</h1>
        <p style={{ color: C.muted, fontSize: 13, margin: '4px 0 0' }}>Sales, parts cost, OPEX/CAPEX and customer mix, laid out as the management report. Net profit = gross profit − OPEX − CAPEX.</p>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <span style={label}>Period</span>
            <select style={input} value={mode} onChange={e => setMode(e.target.value as ReportMode)}>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="custom">Custom range</option>
            </select>
          </div>
          {mode === 'week' && (
            <div>
              <span style={label}>Week containing</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" style={input} value={weekStart} onChange={e => e.target.value && setWeekStart(mondayOf(e.target.value))} />
                <button style={btn()} onClick={() => setWeekStart(lastCompletedWeek())}>Last week</button>
                <button style={btn()} onClick={() => setWeekStart(mondayOf(toYmd(new Date())))}>This week</button>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 5 }}>Mon {weekStart} to Sun {addDays(weekStart, 6)}, plus the 3 weeks before</div>
            </div>
          )}
          {mode === 'month' && (
            <div><span style={label}>Month</span><input type="month" style={input} value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></div>
          )}
          {mode === 'custom' && (
            <>
              <div><span style={label}>From</span><input type="date" style={input} value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div><span style={label}>To</span><input type="date" style={input} value={to} onChange={e => setTo(e.target.value)} /></div>
            </>
          )}
          <div>
            <span style={label}>Branch</span>
            <select style={input} value={branchId} onChange={e => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button style={btn(true)} onClick={generate} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileBarChart size={16} />} Generate report
          </button>
          <button style={{ ...btn(), marginLeft: 'auto' }} onClick={() => setShowTargets(s => !s)}><Settings2 size={16} /> Targets</button>
        </div>
        {branchId && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>For a single branch, only that branch's invoices and expenses are counted. Shared / HQ expenses appear in All branches only.</div>}

        {showTargets && (
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><span style={label}>Monthly sales goal (RM)</span><input style={{ ...input, width: 150 }} type="number" min={0} disabled={!canEditTargets} value={settings.monthly_sales_goal} onChange={e => setSettings({ ...settings, monthly_sales_goal: num(e.target.value) })} /></div>
            <div><span style={label}>Working days / month</span><input style={{ ...input, width: 130 }} type="number" min={1} max={31} disabled={!canEditTargets} value={settings.working_days_month} onChange={e => setSettings({ ...settings, working_days_month: num(e.target.value) })} /></div>
            <div><span style={label}>Target GP %</span><input style={{ ...input, width: 110 }} type="number" min={1} max={100} disabled={!canEditTargets} value={settings.target_gp_pct} onChange={e => setSettings({ ...settings, target_gp_pct: num(e.target.value) })} /></div>
            <div><span style={label}>Weekly target override (RM, optional)</span><input style={{ ...input, width: 190 }} type="number" min={0} disabled={!canEditTargets} value={settings.weekly_target_override ?? ''} onChange={e => setSettings({ ...settings, weekly_target_override: e.target.value === '' ? null : num(e.target.value) })} /></div>
            {canEditTargets && <button style={btn(true)} onClick={saveTargets}>Save targets</button>}
            <div style={{ fontSize: 12, color: C.muted, flexBasis: '100%' }}>
              Daily target = monthly goal ÷ working days. Weekly sales target = (OPEX + CAPEX for the period) ÷ target GP %, unless you set an override.
            </div>
          </div>
        )}
      </div>

      {report && (
        <>
          {report.warnings.map(w => (
            <div key={w} style={{ border: '1px solid #F59E0B55', background: '#F59E0B14', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 8 }}>{w}</div>
          ))}

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, margin: '8px 0 0' }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Compare against <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(the choice is printed on each tile)</span></div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
              {([
                ['Revenue tile', 'month', [['prev', 'Previous month (same days)'], ['goal', 'Monthly goal pace']]],
                ['GP %', 'gp', [['prev', 'Previous period'], ['avg4', 'Average of last 4'], ['target', 'Target GP %']]],
                ['Customer count', 'tx', [['prev', 'Previous period'], ['avg4', 'Average of last 4']]],
                ['Spend per customer', 'avg', [['prev', 'Previous period'], ['avg4', 'Average of last 4']]],
              ] as [string, keyof ReportBasis, [string, string][]][]).map(([name, key, opts]) => (
                <div key={key}>
                  <span style={label}>{name}</span>
                  <select style={input} value={basis[key]} disabled={!rawInput} onChange={e => changeBasis({ ...basis, [key]: e.target.value } as ReportBasis)}>
                    {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {!rawInput && <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>This is a saved report, so its comparisons are fixed. Generate again to change them.</div>}
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, margin: '8px 0 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>Words to describe the {report.mode === 'week' ? 'week' : report.mode === 'month' ? 'month' : 'period'} <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(suggested from the numbers, edit if you like)</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn()} onClick={save} disabled={!!savedId}><Save size={16} /> {savedId ? 'Saved' : 'Save to archive'}</button>
                <button style={btn(true)} onClick={download}><FileDown size={16} /> Download PDF</button>
              </div>
            </div>
            {words.map((set, si) => (
              <div key={si} style={{ marginTop: si ? 14 : 0 }}>
                {words.length > 1 && <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, marginBottom: 6 }}>{report.sections?.[si]?.periodLabel}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {set.map((w, i) => (
                    <div key={i}>
                      <input style={{ ...input, width: '100%', boxSizing: 'border-box', fontWeight: 700, marginBottom: 4 }} value={w.word} onChange={e => setWords(words.map((ws, j) => (j === si ? ws.map((x, k) => (k === i ? { ...x, word: e.target.value } : x)) : ws)))} />
                      <input style={{ ...input, width: '100%', boxSizing: 'border-box', fontSize: 12 }} value={w.caption} onChange={e => setWords(words.map((ws, j) => (j === si ? ws.map((x, k) => (k === i ? { ...x, caption: e.target.value } : x)) : ws)))} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div ref={boxRef} style={{ width: '100%', overflow: 'hidden', background: '#444', borderRadius: 8, padding: 0 }}>
            <div style={{ width: PAGE_W * scale, height: (PAGE_H * reportPageCount(report) + 24 * (reportPageCount(report) - 1)) * scale }}>
              <div ref={pagesRef} style={{ width: PAGE_W, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'flex', flexDirection: 'column', gap: 24 }}>
                <WeeklyReportPages data={report} words={words} />
              </div>
            </div>
          </div>
        </>
      )}

      {!report && !busy && (
        <div style={{ border: `1px dashed ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.muted, fontSize: 14 }}>
          Pick a period and press Generate report. The default is the last completed week.
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>Saved reports</h2>
        {snapshots.length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>Nothing saved yet. Saved reports keep their numbers even if invoices are changed later.</div> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {snapshots.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{s.data.branchLabel} · saved {new Date(s.created_at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
                </div>
                <button style={btn()} onClick={() => open(s)}>Open</button>
                {canEditTargets && <button style={{ ...btn(), color: '#EF4444' }} onClick={() => remove(s)} aria-label="Delete"><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
