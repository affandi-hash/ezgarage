import type { LucideIcon } from 'lucide-react'
import { BarChart3, Megaphone, Filter, Users, FileBarChart, Settings } from 'lucide-react'

function ComingSoonShell({ icon: Icon, title, description, bullets }: {
  icon: LucideIcon
  title: string
  description: string
  bullets: string[]
}) {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(241,90,34,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={18} color="#F15A22" />
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F0' }}>{title}</h1>
      </div>

      <div style={{ backgroundColor: '#161616', border: '1px solid #2A2A2A', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'inline-flex', alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#F15A22', backgroundColor: 'rgba(241,90,34,0.1)', padding: '4px 10px', borderRadius: 999 }}>
          Coming soon
        </div>
        <p style={{ fontSize: 14, color: '#A0A0A0', lineHeight: 1.6, margin: 0 }}>{description}</p>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bullets.map(b => (
            <li key={b} style={{ fontSize: 13, color: '#C0C0C0', lineHeight: 1.5 }}>{b}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function PerformancePage() {
  return (
    <ComingSoonShell
      icon={BarChart3}
      title="Performance"
      description="How Sales & Marketing is actually performing, broken down by selling method -- walk-in, WhatsApp, Facebook/Instagram, Google, community/events, referrals."
      bullets={[
        'Reach, leads, prospects, customers, transactions, and ROI per channel, not just a single blended number.',
        'Built on the same job and invoice data already trusted in Reports, so the numbers reconcile.',
      ]}
    />
  )
}

export function CampaignsPage() {
  return (
    <ComingSoonShell
      icon={Megaphone}
      title="Campaigns"
      description="Active and upcoming campaigns with budget, spend, and ROI tracked per campaign -- the execution layer under the Marketing Plan's initiatives."
      bullets={[
        'Each campaign tracks budget vs spend and attributes bookings back to it.',
        'Initiatives from the Marketing Plan can be promoted into a running campaign here.',
      ]}
    />
  )
}

export function LeadsPage() {
  return (
    <ComingSoonShell
      icon={Filter}
      title="Leads"
      description="Enquiries from every channel in one pipeline, from first contact through to becoming a customer."
      bullets={[
        'Tracks where each lead came from and how far it got -- lead, prospect, customer.',
        'Feeds Performance and Campaigns with real conversion numbers instead of estimates.',
      ]}
    />
  )
}

export function SalesMarketingCustomersPage() {
  return (
    <ComingSoonShell
      icon={Users}
      title="Customers"
      description="A Sales & Marketing view of the customer database -- segments, engagement, and repeat-visit patterns, not just contact records."
      bullets={[
        'Same underlying customers as Operations, viewed through a marketing lens: segment, last visit, lifetime value.',
        'Lines up with the Audience Segments already captured in the Business Profile.',
      ]}
    />
  )
}

export function SalesMarketingReportsPage() {
  return (
    <ComingSoonShell
      icon={FileBarChart}
      title="Reports"
      description="Exportable Sales & Marketing analytics -- performance by channel, campaign ROI, and plan progress over time."
      bullets={[
        'Export what Performance and Campaigns show, for a given period.',
        'Built for sharing outside the app, not just viewing in-app.',
      ]}
    />
  )
}

export function SalesMarketingSettingsPage() {
  return (
    <ComingSoonShell
      icon={Settings}
      title="Settings"
      description="Module-level preferences for Sales & Marketing -- notification defaults, default channels, and AI assistant behaviour."
      bullets={[
        'Scoped to this module only -- tenant-wide settings stay in the main Settings page.',
      ]}
    />
  )
}
