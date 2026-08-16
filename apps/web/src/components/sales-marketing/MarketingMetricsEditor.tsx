import { useEffect, useState, useCallback } from 'react'
import { X, Trash2, Plus, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/components/ui/Toast'

// One row per (tenant, branch, month, channel, metric) in
// sales_marketing_period_metrics (migration 136). "Overall" rows have
// channel = null and back the headline dashboard tiles; channel rows are
// optional and back the Performance by Selling Method table.

interface MetricRow {
  id: string
  channel: string | null
  metric_key: string
  value: number
}

const OVERALL_METRICS: { key: string; label: string; hint: string }[] = [
  { key: 'reach', label: 'Reach', hint: 'People who saw any ad/post/listing this month' },
  { key: 'leads', label: 'Leads', hint: 'First contact from a potential customer' },
  { key: 'prospects', label: 'Prospects', hint: 'Leads who showed real buying intent' },
  { key: 'google_reviews_count', label: 'Google Reviews (new this month)', hint: '' },
  { key: 'google_reviews_rating', label: 'Google Rating', hint: 'Current average, e.g. 4.8' },
  { key: 'revenue_target', label: 'Revenue Target (RM)', hint: 'For Revenue vs Target' },
  { key: 'esp_target', label: 'ESP Members Target', hint: '' },
]

const CHANNELS = [
  { key: 'mia_whatsapp', label: 'Mia (WhatsApp)' },
  { key: 'facebook_instagram', label: 'Facebook / Instagram' },
  { key: 'walkin', label: 'Walk-in' },
  { key: 'google', label: 'Google (Search/Maps)' },
  { key: 'community_events', label: 'Community / Events' },
  { key: 'referrals', label: 'Referrals' },
]

const CHANNEL_METRICS = [
  { key: 'reach', label: 'Reach' },
  { key: 'leads', label: 'Leads' },
  { key: 'prospects', label: 'Prospects' },
  { key: 'spend', label: 'Spend (RM)' },
]

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13,
  backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#F0F0F0', outline: 'none',
  boxSizing: 'border-box',
}

export function MarketingMetricsEditor({ open, onClose, tenantId, branchId, periodMonth, onSaved }: {
  open: boolean
  onClose: () => void
  tenantId: string
  branchId: string | null
  periodMonth: string // 'YYYY-MM-01'
  onSaved: () => void
}) {
  const [rows, setRows] = useState<MetricRow[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [addChannel, setAddChannel] = useState(CHANNELS[0].key)
  const [addMetric, setAddMetric] = useState(CHANNEL_METRICS[0].key)
  const [addValue, setAddValue] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('sales_marketing_period_metrics').select('id, channel, metric_key, value')
      .eq('tenant_id', tenantId).eq('period_month', periodMonth)
    q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null)
    const { data, error } = await q
    if (error) toast.error(error.message)
    setRows(data ?? [])
    setLoading(false)
  }, [tenantId, branchId, periodMonth])

  useEffect(() => { if (open) load() }, [open, load])

  useEffect(() => {
    const overall: Record<string, string> = {}
    for (const m of OVERALL_METRICS) {
      const row = rows.find(r => r.channel === null && r.metric_key === m.key)
      overall[m.key] = row ? String(row.value) : ''
    }
    setDrafts(overall)
  }, [rows])

  const channelRows = rows.filter(r => r.channel !== null)

  async function saveOverall(metricKey: string) {
    const raw = drafts[metricKey]
    if (raw === undefined || raw.trim() === '') return
    const value = Number(raw)
    if (Number.isNaN(value)) { toast.error('Enter a number'); return }
    setSavingKey(metricKey)
    const existing = rows.find(r => r.channel === null && r.metric_key === metricKey)
    const { error } = existing
      ? await supabase.from('sales_marketing_period_metrics').update({ value, updated_at: new Date().toISOString() }).eq('id', existing.id)
      : await supabase.from('sales_marketing_period_metrics').insert({
          tenant_id: tenantId, branch_id: branchId, period_month: periodMonth, channel: null, metric_key: metricKey, value,
        })
    setSavingKey(null)
    if (error) { toast.error(error.message); return }
    load(); onSaved()
  }

  async function addChannelRow() {
    if (!addValue.trim()) return
    const value = Number(addValue)
    if (Number.isNaN(value)) { toast.error('Enter a number'); return }
    setAdding(true)
    const existing = rows.find(r => r.channel === addChannel && r.metric_key === addMetric)
    const { error } = existing
      ? await supabase.from('sales_marketing_period_metrics').update({ value, updated_at: new Date().toISOString() }).eq('id', existing.id)
      : await supabase.from('sales_marketing_period_metrics').insert({
          tenant_id: tenantId, branch_id: branchId, period_month: periodMonth, channel: addChannel, metric_key: addMetric, value,
        })
    setAdding(false)
    if (error) { toast.error(error.message); return }
    setAddValue('')
    load(); onSaved()
  }

  async function deleteChannelRow(id: string) {
    const { error } = await supabase.from('sales_marketing_period_metrics').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    load(); onSaved()
  }

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div
        style={{ width: 480, maxWidth: '100%', height: '100%', backgroundColor: '#141414', borderLeft: '1px solid #2A2A2A', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F0' }}>Marketing Metrics</div>
            <div style={{ fontSize: 11, color: '#6A6A6A' }}>{periodMonth.slice(0, 7)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8A8A8A', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase' as const }}>Overall (this branch)</div>
          {loading ? (
            <div style={{ color: '#6A6A6A', fontSize: 13 }}>Loading…</div>
          ) : OVERALL_METRICS.map(m => (
            <div key={m.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#C0C0C0' }}>{m.label}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={inputStyle}
                  type="number"
                  value={drafts[m.key] ?? ''}
                  onChange={e => setDrafts(prev => ({ ...prev, [m.key]: e.target.value }))}
                  placeholder="—"
                />
                <button
                  onClick={() => saveOverall(m.key)}
                  disabled={savingKey === m.key}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', backgroundColor: '#F15A22', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                >
                  <Save size={12} /> Save
                </button>
              </div>
              {m.hint && <div style={{ fontSize: 10, color: '#6A6A6A' }}>{m.hint}</div>}
            </div>
          ))}

          <div style={{ borderTop: '1px solid #2A2A2A', marginTop: 8, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase' as const }}>Channel Breakdown (optional)</div>
            <div style={{ fontSize: 11, color: '#6A6A6A', margin: 0 }}>Powers the "Performance by Selling Method" table. Leave empty if you don't track this yet.</div>

            {channelRows.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, backgroundColor: '#1E1E1E' }}>
                <div style={{ flex: 1, fontSize: 12, color: '#E0E0E0' }}>
                  {CHANNELS.find(c => c.key === r.channel)?.label ?? r.channel} · {CHANNEL_METRICS.find(c => c.key === r.metric_key)?.label ?? r.metric_key}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F0F0' }}>{r.value.toLocaleString()}</div>
                <button onClick={() => deleteChannelRow(r.id)} style={{ background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', padding: 2 }}><Trash2 size={12} /></button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 6 }}>
              <select value={addChannel} onChange={e => setAddChannel(e.target.value)} style={{ ...inputStyle, flex: 1.4 }}>
                {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <select value={addMetric} onChange={e => setAddMetric(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                {CHANNEL_METRICS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <input style={{ ...inputStyle, flex: 0.8 }} type="number" value={addValue} onChange={e => setAddValue(e.target.value)} placeholder="0" />
              <button
                onClick={addChannelRow}
                disabled={adding}
                style={{ display: 'flex', alignItems: 'center', padding: '0 10px', backgroundColor: 'rgba(241,90,34,0.1)', border: '1px solid rgba(241,90,34,0.3)', borderRadius: 6, color: '#F15A22', cursor: 'pointer' }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
