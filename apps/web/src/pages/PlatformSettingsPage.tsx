import { useState, useEffect } from 'react'
import { Globe2, Check, Send, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/components/ui/Toast'

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#1E1E1E',
  border: '1px solid #2A2A2A',
  color: '#F0F0F0',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  marginBottom: 6,
  color: '#A0A0A0',
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#161616',
  border: '1px solid #2A2A2A',
  borderRadius: 12,
  overflow: 'hidden',
}

interface PlatformSettings {
  raudhahpay_pic_email: string | null
  daily_statement_enabled: boolean
}

interface StatementLogRow {
  id: string
  statement_date: string
  recipient_email: string
  total_amount: number
  transaction_count: number
  status: string
  error_message: string | null
  sent_at: string
}

export function PlatformSettingsPage() {
  const [form, setForm] = useState<PlatformSettings>({ raudhahpay_pic_email: null, daily_statement_enabled: true })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [logs, setLogs] = useState<StatementLogRow[]>([])

  useEffect(() => {
    supabase.from('platform_settings').select('raudhahpay_pic_email, daily_statement_enabled').single()
      .then(({ data }) => { if (data) setForm(data); setLoading(false) })
    loadLogs()
  }, [])

  function loadLogs() {
    supabase.from('raudhahpay_statement_log').select('*').order('statement_date', { ascending: false }).limit(14)
      .then(({ data }) => setLogs(data ?? []))
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('platform_settings').update({
      raudhahpay_pic_email: form.raudhahpay_pic_email?.trim() || null,
      daily_statement_enabled: form.daily_statement_enabled,
    }).eq('id', (await supabase.from('platform_settings').select('id').single()).data?.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  async function sendTestNow() {
    setSendingTest(true)
    const { data, error } = await supabase.functions.invoke('raudhahpay-daily-statement', { body: { manual: true } })
    setSendingTest(false)
    if (error || data?.error) { toast.error(data?.error ?? error?.message ?? 'Failed to send'); return }
    toast.success('Statement sent')
    loadLogs()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div style={cardStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe2 size={16} color="#F15A22" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>RaudhahPay Daily Statement</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666' }}><Loader2 className="animate-spin" size={20} /></div>
        ) : (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              padding: '12px 16px', borderRadius: 8, backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A',
              fontSize: 12, color: '#6B7280', lineHeight: 1.6,
            }}>
              Every night at midnight (MYT), EZGarage emails Chip In Sdn Bhd a PDF statement of the previous day's
              RaudhahPay transactions across every tenant, so they know what to disburse and to whom.
            </div>

            <div style={{ marginBottom: 4 }}>
              <label style={labelStyle}>RaudhahPay PIC Email</label>
              <input
                style={inputStyle}
                type="email"
                value={form.raudhahpay_pic_email ?? ''}
                onChange={e => setForm(f => ({ ...f, raudhahpay_pic_email: e.target.value }))}
                placeholder="ops@chipin.com.my"
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.daily_statement_enabled}
                onChange={e => setForm(f => ({ ...f, daily_statement_enabled: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: '#F15A22' }}
              />
              <span style={{ fontSize: 13, color: '#A0A0A0' }}>Send the daily statement automatically</span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={save} disabled={saving}
                style={{
                  padding: '9px 20px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saved && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#22C55E' }}>
                  <Check size={14} /> Saved
                </span>
              )}
              <button
                onClick={sendTestNow} disabled={sendingTest || !form.raudhahpay_pic_email}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8,
                  border: '1px solid #2A2A2A', backgroundColor: 'transparent', color: '#A0A0A0', fontSize: 13,
                  cursor: (sendingTest || !form.raudhahpay_pic_email) ? 'not-allowed' : 'pointer',
                  opacity: (sendingTest || !form.raudhahpay_pic_email) ? 0.5 : 1,
                }}
              >
                <Send size={13} /> {sendingTest ? 'Sending…' : "Send Yesterday's Statement Now"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Recent Statements</span>
        </div>
        {logs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No statements sent yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Date', 'Sent To', 'Transactions', 'Total (RM)', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                  <td style={{ padding: '10px 14px', color: '#F0F0F0' }}>{l.statement_date}</td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{l.recipient_email}</td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{l.transaction_count}</td>
                  <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{Number(l.total_amount).toFixed(2)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                      color: l.status === 'sent' ? '#22C55E' : '#EF4444',
                      background: l.status === 'sent' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                    }}>
                      {l.status.toUpperCase()}
                    </span>
                    {l.error_message && <span style={{ marginLeft: 8, fontSize: 11, color: '#EF4444' }}>{l.error_message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
