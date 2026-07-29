import { useState, useEffect } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/Toast'

const cardStyle: React.CSSProperties = { backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, overflow: 'hidden' }

interface CommunityStats {
  community_id: string
  community_name: string
  is_active: boolean
  active_members: number
  pending_members: number
  expired_members: number
  cancelled_members: number
  fees_collected: number
  discount_given: number
}

function formatRM(n: number) {
  return `RM ${Number(n).toFixed(2)}`
}

export function EspReportsPage() {
  const { user } = useAuthStore()
  const [rows, setRows] = useState<CommunityStats[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    if (!user?.tenant_id) return
    setLoading(true)
    supabase.rpc('get_esp_community_stats').then(({ data, error }) => {
      setLoading(false)
      if (error) { toast.error(error.message); return }
      setRows((data ?? []) as CommunityStats[])
    })
  }

  useEffect(() => { load() }, [user?.tenant_id])

  const totals = rows.reduce((acc, r) => ({
    members: acc.members + r.active_members + r.pending_members,
    fees: acc.fees + Number(r.fees_collected),
    discount: acc.discount + Number(r.discount_given),
  }), { members: 0, fees: 0, discount: 0 })

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0' }}>ESP Reports</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div style={{ ...cardStyle, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Total Members (active + pending)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F0' }}>{totals.members}</div>
        </div>
        <div style={{ ...cardStyle, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Membership Fees Collected</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#22C55E' }}>{formatRM(totals.fees)}</div>
        </div>
        <div style={{ ...cardStyle, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Discount Given</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F15A22' }}>{formatRM(totals.discount)}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={16} color="#F15A22" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>By Community</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666' }}><Loader2 className="animate-spin" size={20} /></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>No ESP communities yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A2A' }}>
                  {['Community', 'Status', 'Active', 'Pending', 'Expired', 'Cancelled', 'Fees Collected', 'Discount Given'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#666', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.community_id} style={{ borderBottom: '1px solid #1E1E1E' }}>
                    <td style={{ padding: '10px 14px', color: '#F0F0F0', fontWeight: 600 }}>{r.community_name}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: r.is_active ? '#22C55E' : '#EF4444', background: r.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' }}>
                        {r.is_active ? 'ACTIVE' : 'RETIRED'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{r.active_members}</td>
                    <td style={{ padding: '10px 14px', color: '#F59E0B' }}>{r.pending_members}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{r.expired_members}</td>
                    <td style={{ padding: '10px 14px', color: '#A0A0A0' }}>{r.cancelled_members}</td>
                    <td style={{ padding: '10px 14px', color: '#22C55E' }}>{formatRM(r.fees_collected)}</td>
                    <td style={{ padding: '10px 14px', color: '#F15A22' }}>{formatRM(r.discount_given)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p style={{ fontSize: 11, color: '#666' }}>
        Discount given reflects invoices/quotations whose vehicle is currently linked to an ESP member -- a reporting view, not an immutable ledger.
      </p>
    </div>
  )
}
