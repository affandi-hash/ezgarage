import type { LucideIcon } from 'lucide-react'
import { Target, Share2, Tag, PieChart, Sparkles } from 'lucide-react'

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

export function MarketingPlanPage() {
  return (
    <ComingSoonShell
      icon={Target}
      title="Marketing Plan"
      description="AI-drafted monthly and quarterly marketing plans, aware of your real booking history -- including seasonal slow periods and peak demand."
      bullets={[
        'Campaign ideas grounded in your actual job volume trends, not generic templates.',
        'Editable plan documents you can revise before committing to a budget or timeline.',
      ]}
    />
  )
}

export function SocialMediaEngagementPage() {
  return (
    <ComingSoonShell
      icon={Share2}
      title="Social Media Engagement"
      description="A content calendar with AI-drafted captions and post ideas, plus reply and comment suggestions for your existing channels."
      bullets={[
        'Drafts content for you to review and post manually at first -- direct publishing to Instagram/TikTok needs a separate platform-account connection.',
        'Suggestions tuned to your Business Profile’s brand voice.',
      ]}
    />
  )
}

export function CampaignsPromotionsPage() {
  return (
    <ComingSoonShell
      icon={Tag}
      title="Campaigns & Promotions"
      description="Track promo codes and discounts, and see which bookings they actually drove -- the missing link that turns marketing analysis from guesswork into attribution."
      bullets={[
        'Attach a campaign to a promo code once, and every booking that uses it gets counted automatically.',
        'Feeds directly into Analytics & Insights for real ROI numbers.',
      ]}
    />
  )
}

export function SalesMarketingAnalyticsPage() {
  return (
    <ComingSoonShell
      icon={PieChart}
      title="Analytics & Insights"
      description="Dashboards blending Operations, Finance, and Marketing data -- revenue by service line, campaign ROI, repeat-customer rate, and ESP membership growth."
      bullets={[
        'Built on data you already have in Reports and Accounts Receivable, plus new Campaign attribution once that’s tracked.',
        'Surfaces trends proactively rather than waiting for you to go looking.',
      ]}
    />
  )
}

export function AskYourCsmoPage() {
  return (
    <ComingSoonShell
      icon={Sparkles}
      title="Ask Your CSMO"
      description="A persistent chat with an AI that acts like a real Chief Sales & Marketing Officer -- grounded in your Business Profile and live business data."
      bullets={[
        'Asks clarifying questions only when something critical is missing for your specific request -- otherwise it proceeds and states its assumptions.',
        'Every suggestion becomes a real, trackable item elsewhere in this module, not just chat text that disappears.',
      ]}
    />
  )
}
