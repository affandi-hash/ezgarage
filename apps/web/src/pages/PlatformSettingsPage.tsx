import { useState, useEffect } from 'react'
import { Globe2, Check, Send, Loader2, Building2, Power, KeyRound, X } from 'lucide-react'
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

interface TenantHealthRow {
  tenant_id: string
  tenant_name: string
  slug: string
  plan: string
  is_active: boolean
  created_at: string
  job_count: number
  total_revenue: number
  last_activity_at: string | null
}

interface TenantAdmin {
  id: string
  full_name: string
  email: string
  role: string
}

function ResetPasswordModal({ tenantId, tenantName, onClose }: { tenantId: string; tenantName: string; onClose: () => void }) {
  const [admins, setAdmins] = useState<TenantAdmin[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.rpc('get_tenant_admins', { p_tenant_id: tenantId }).then(({ data }) => {
      setAdmins(data ?? [])
      if (data?.[0]) setSelectedId(data[0].id)
      setLoading(false)
    })
  }, [tenantId])

  async function submit() {
    if (!selectedId || newPassword.length < 8) { toast.error('Pick an admin and enter a password (min 8 chars)'); return }
    setSaving(true)
    const { error } = await supabase.rpc('reset_user_password', { p_user_id: selectedId, p_new_password: newPassword })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Password reset — they must change it on next login')
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 14, width: '100%', maxWidth: 420 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Reset admin password — {tenantName}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? <Loader2 className="animate-spin" size={18} color="#666" /> : admins.length === 0 ? (
            <div style={{ fontSize: 13, color: '#666' }}>No active admin found for this tenant.</div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>Admin account</label>
                <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={inputStyle}>
                  {admins.map(a => (
                    <option key={a.id} value={a.id}>{a.full_name} ({a.email}) — {a.role}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>New temporary password</label>
                <input style={inputStyle} type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min. 8 characters" />
                <p style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>They'll be forced to change it on next login.</p>
              </div>
              <button
                onClick={submit} disabled={saving}
                style={{ padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#F15A22', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Resetting…' : 'Reset Password'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TenantDirectory() {
  const [tenants, setTenants] = useState<TenantHealthRow[]>([])
  const [loading, setLoading] = useState(true)
  const [resetModalFor, setResetModalFor] = useState<{ id: string; name: string } | null>(null)

  function load() {
    setLoading(true)
    supabase.rpc('get_tenant_health_snapshot').then(({ data, error }) => {
      if (error) toast.error(error.message)
      setTenants(data ?? [])
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  async function toggleActive(t: TenantHealthRow) {
    const { error } = await supabase.from('tenants').update({ is_active: !t.is_active }).eq('id', t.tenant_id)
    if (error) { toast.error(error.message); return }
    toast.success(t.is_active ? `${t.tenant_name} suspended` : `${t.tenant_name} reactivated`)
    load()
  }

  return (
    <div style={cardStyle}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Building2 size={16} color="#F15A22" />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Tenant Directory</span>
      </div>
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#666' }}><Loader2 className="animate-spin" size={20} /></div>
      ) : tenants.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No tenants yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                {['Workshop', 'Plan', 'Status', 'Jobs', 'Revenue (RM)', 'Last Activity', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.tenant_id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ color: '#F0F0F0', fontWeight: 600 }}>{t.tenant_name}</div>
                    <div style={{ color: '#666', fontSize: 11 }}>{t.slug}</div>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', textTransform: 'capitalize' }}>{t.plan}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                      color: t.is_active ? '#22C55E' : '#EF4444',
                      background: t.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                    }}>
                      {t.is_active ? 'ACTIVE' : 'SUSPENDED'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{t.job_count}</td>
                  <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{Number(t.total_revenue).toFixed(2)}</td>
                  <td style={{ padding: '10px 14px', color: '#A0A0A0', fontSize: 12 }}>
                    {t.last_activity_at ? new Date(t.last_activity_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => toggleActive(t)}
                        title={t.is_active ? 'Suspend tenant' : 'Reactivate tenant'}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: t.is_active ? '#EF4444' : '#22C55E', cursor: 'pointer' }}
                      >
                        <Power size={12} /> {t.is_active ? 'Suspend' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => setResetModalFor({ id: t.tenant_id, name: t.tenant_name })}
                        title="Reset admin password"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, backgroundColor: '#1E1E1E', border: '1px solid #2A2A2A', color: '#A0A0A0', cursor: 'pointer' }}
                      >
                        <KeyRound size={12} /> Reset Password
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resetModalFor && (
        <ResetPasswordModal tenantId={resetModalFor.id} tenantName={resetModalFor.name} onClose={() => setResetModalFor(null)} />
      )}
    </div>
  )
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
      <TenantDirectory />

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
              Every night at 7pm (MYT), EZGarage emails Chip In Sdn Bhd a PDF statement of the previous day's
              RaudhahPay transactions across every tenant, so they know what to disburse and to whom.
            </div>

            <div style={{ marginBottom: 4 }}>
              <label style={labelStyle}>RaudhahPay PIC Email(s)</label>
              <input
                style={inputStyle}
                type="text"
                value={form.raudhahpay_pic_email ?? ''}
                onChange={e => setForm(f => ({ ...f, raudhahpay_pic_email: e.target.value }))}
                placeholder="ops@chipin.com.my, finance@chipin.com.my"
              />
              <p style={{ fontSize: 11, color: '#6B7280', margin: '4px 0 0' }}>Separate multiple addresses with a comma.</p>
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
