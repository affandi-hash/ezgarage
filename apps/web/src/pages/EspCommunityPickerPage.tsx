import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Wrench, Loader2, AlertCircle, ChevronRight, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Same public-page color convention as EspRegistrationPage.tsx / CustomerPortalPage.tsx.
const C = {
  bg: '#0E0E0E',
  surface: '#161616',
  surface2: '#1C1C1C',
  border: '#2A2A2A',
  orange: '#F15A22',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
  red: '#EF4444',
}

interface CommunitySummary {
  id: string
  name: string
  slug: string
  description: string | null
}

interface PickerConfig {
  tenant_name: string
  tenant_logo_url: string | null
  communities: CommunitySummary[]
}

export function EspCommunityPickerPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>()

  const [config, setConfig] = useState<PickerConfig | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenantSlug) return
    setLoading(true)
    supabase.rpc('get_esp_communities_public', { p_tenant_slug: tenantSlug }).then(({ data, error }) => {
      setLoading(false)
      if (error || !data || data.error) {
        setError('This link is invalid or no longer active.')
        return
      }
      setConfig(data as PickerConfig)
    })
  }, [tenantSlug])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} color={C.textSecondary} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (error || !config) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <AlertCircle size={32} color={C.red} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{error || 'This link is invalid or no longer active.'}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>

      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {config.tenant_logo_url ? (
            <img src={config.tenant_logo_url} alt={config.tenant_name} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'contain', background: '#fff' }} />
          ) : (
            <div style={{ width: 34, height: 34, background: C.orange, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wrench size={17} color="#fff" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{config.tenant_name}</div>
            <div style={{ fontSize: 11, color: C.textSecondary }}>Exclusive Service Partner Programme</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 24px 60px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Choose Your Community</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>
            Select the club or community you're registering your ESP membership under.
          </div>
        </div>

        {config.communities.length === 0 ? (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
            No communities are open for registration right now. Please check back later or contact the workshop directly.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {config.communities.map(c => (
              <Link key={c.id} to={`/esp/${c.slug}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Users size={15} color={C.orange} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div>
                  {c.description && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{c.description}</div>}
                </div>
                <ChevronRight size={16} color={C.textSecondary} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
