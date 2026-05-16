import { useEffect, useMemo, useState, type ElementType } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiCall } from '@/lib/api'
import { trackEvent } from '@/lib/analytics'
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  Crown,
  Loader2,
  Megaphone,
  Percent,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react'

type PageViewRow = {
  event_type: string
  count: number | string
  unique_visitors?: number | string
}

type SignupFunnel = {
  landing_views: number
  signup_page_views: number
  signup_clicks: number
  candidate_signups: number
  recruiter_signups: number
  total_signups: number
  conversion_rate: string
  click_through_rate: string
}

type RevenueFunnel = {
  pricing_views: number
  billing_cycle_toggles: number
  checkout_clicks: number
  checkout_confirmed: number
  checkout_canceled: number
  contact_sales_clicks: number
  pricing_to_checkout_rate: string
  checkout_completion_rate: string
  enterprise_contact_rate: string
}

type DailyVisitor = {
  date: string
  visitors: number
}

type AnalyticsResponse = {
  data: {
    page_views: PageViewRow[]
    signup_funnel: SignupFunnel
    revenue_funnel: RevenueFunnel
    daily_visitors: DailyVisitor[]
  }
}

type Plan = {
  id: string
  name: string
  description: string
  monthlyAmount: number | null
  yearlyAmount: number | null
  popular: boolean
  highlight?: string | null
  custom: boolean
  features: string[]
}

type PlansResponse = {
  stripeConfigured: boolean
  plans: Plan[]
}

const revenueMilestones = [
  { label: 'Pricing views', icon: Users, key: 'pricing_views', tone: 'text-blue-600' },
  { label: 'Checkout starts', icon: ShoppingCart, key: 'checkout_clicks', tone: 'text-purple-600' },
  { label: 'Checkout confirmed', icon: BadgeCheck, key: 'checkout_confirmed', tone: 'text-emerald-600' },
  { label: 'Enterprise leads', icon: Megaphone, key: 'contact_sales_clicks', tone: 'text-amber-600' },
] as const

const acquisitionMilestones = [
  { label: 'Landing views', icon: Sparkles, key: 'landing_views', tone: 'text-indigo-600' },
  { label: 'Signup clicks', icon: ArrowRight, key: 'signup_clicks', tone: 'text-violet-600' },
  { label: 'Signup completions', icon: Check, key: 'total_signups', tone: 'text-emerald-600' },
] as const

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatCurrency(cents: number | null) {
  if (!cents) return 'Custom'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function toNumber(value: number | string | undefined | null) {
  return typeof value === 'number' ? value : Number(value || 0)
}

function toPercent(value: string | number | undefined) {
  if (typeof value === 'number') return `${value.toFixed(1)}%`
  return value || '0.0%'
}

function FunnelCard({
  title,
  description,
  milestones,
  values,
}: {
  title: string
  description: string
  milestones: ReadonlyArray<{ label: string; icon: ElementType; key: string; tone: string }>
  values: Record<string, number>
}) {
  const maxValue = Math.max(...milestones.map((milestone) => values[milestone.key] || 0), 1)

  return (
    <Card className="border bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {milestones.map((milestone, index) => {
          const value = values[milestone.key] || 0
          const width = Math.max((value / maxValue) * 100, value > 0 ? 8 : 2)
          const previousKey = milestones[index - 1]?.key
          const previousValue = previousKey ? values[previousKey] || 0 : 0
          const stepRate = previousValue > 0 && index > 0 ? `${((value / previousValue) * 100).toFixed(1)}%` : null

          return (
            <div key={milestone.key} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <milestone.icon className={`h-4 w-4 ${milestone.tone}`} />
                  <span>{milestone.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {stepRate ? <span className="text-xs text-muted-foreground">{stepRate} of prior step</span> : null}
                  <span className="font-semibold tabular-nums">{formatCount(value)}</span>
                </div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function RevenuePage() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse['data'] | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    trackEvent('admin_revenue_view')
  }, [])

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [analyticsData, billingData] = await Promise.all([
          apiCall<AnalyticsResponse>('/admin/revenue', { credentials: 'include' }),
          apiCall<PlansResponse>('/billing/plans'),
        ])

        if (!active) return

        setAnalytics(analyticsData.data)
        setPlans(billingData.plans)
        setStripeConfigured(billingData.stripeConfigured)
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load revenue data.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  const pageViews = useMemo(() => {
    const rows = analytics?.page_views || []
    return rows
      .map((row) => ({
        event_type: row.event_type,
        count: toNumber(row.count),
        unique_visitors: toNumber(row.unique_visitors),
      }))
      .sort((a, b) => b.unique_visitors - a.unique_visitors)
  }, [analytics])

  const revenueFunnel = analytics?.revenue_funnel || {
    pricing_views: 0,
    billing_cycle_toggles: 0,
    checkout_clicks: 0,
    checkout_confirmed: 0,
    checkout_canceled: 0,
    contact_sales_clicks: 0,
    pricing_to_checkout_rate: '0.0%',
    checkout_completion_rate: '0.0%',
    enterprise_contact_rate: '0.0%',
  }

  const acquisitionFunnel = analytics?.signup_funnel || {
    landing_views: 0,
    signup_page_views: 0,
    signup_clicks: 0,
    candidate_signups: 0,
    recruiter_signups: 0,
    total_signups: 0,
    conversion_rate: '0.0%',
    click_through_rate: '0.0%',
  }

  const headlineMetrics = [
    {
      label: 'Pricing viewers',
      value: revenueFunnel.pricing_views,
      icon: Users,
      tone: 'text-blue-600',
      helper: `${toPercent(revenueFunnel.pricing_to_checkout_rate)} to checkout`,
    },
    {
      label: 'Checkout starts',
      value: revenueFunnel.checkout_clicks,
      icon: ShoppingCart,
      tone: 'text-purple-600',
      helper: `${toPercent(revenueFunnel.checkout_completion_rate)} completion`,
    },
    {
      label: 'Checkout confirmations',
      value: revenueFunnel.checkout_confirmed,
      icon: BadgeCheck,
      tone: 'text-emerald-600',
      helper: `${formatCount(revenueFunnel.checkout_canceled)} canceled`,
    },
    {
      label: 'Enterprise leads',
      value: revenueFunnel.contact_sales_clicks,
      icon: Megaphone,
      tone: 'text-amber-600',
      helper: `${toPercent(revenueFunnel.enterprise_contact_rate)} of pricing visitors`,
    },
  ]

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center rounded-3xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading revenue dashboard...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border bg-card p-6 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={stripeConfigured ? 'default' : 'secondary'}>
              {stripeConfigured ? 'Stripe ready' : 'Stripe needs setup'}
            </Badge>
            <Badge variant="outline">Revenue</Badge>
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Revenue Dashboard + Funnel Metrics</h1>
          <p className="max-w-2xl text-muted-foreground">
            Track pricing interest, checkout starts, completed payments, and enterprise handoffs from one place.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/pricing">Open pricing page</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/admin/ai-health">AI health</Link>
          </Button>
          <Button asChild>
            <Link to="/register">Test signup flow</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {headlineMetrics.map((metric) => (
          <Card key={metric.label} className="border bg-card shadow-sm">
            <CardContent className="flex items-start gap-4 p-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                <metric.icon className={`h-5 w-5 ${metric.tone}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{formatCount(metric.value)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric.helper}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FunnelCard
          title="Acquisition funnel"
          description="Landing visitors should flow into signups and role selection."
          milestones={acquisitionMilestones}
          values={acquisitionFunnel}
        />
        <FunnelCard
          title="Monetization funnel"
          description="Pricing visitors should flow into checkout starts, confirmations, and sales leads."
          milestones={revenueMilestones}
          values={revenueFunnel}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3 border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Top page views
            </CardTitle>
            <CardDescription>Visitor volume by tracked page view event.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {pageViews.length > 0 ? (
              pageViews.slice(0, 6).map((row) => {
                const isPricing = row.event_type === 'page_view_pricing'
                const isLanding = row.event_type === 'page_view_landing'
                const isSignup = row.event_type === 'page_view_signup'
                const label = isPricing ? 'Pricing' : isLanding ? 'Landing' : isSignup ? 'Signup' : row.event_type.replace('page_view_', '').replace(/_/g, ' ')
                const maxVisitors = Math.max(...pageViews.map((item) => item.unique_visitors), 1)
                const width = Math.max((row.unique_visitors / maxVisitors) * 100, 6)

                return (
                  <div key={row.event_type} className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground tabular-nums">{formatCount(row.unique_visitors)} visitors</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-sm text-muted-foreground">No page view data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Plan snapshot
            </CardTitle>
            <CardDescription>Current plan pricing and package mix from Stripe config.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-2xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{plan.name}</h3>
                      {plan.popular ? <Crown className="h-4 w-4 text-primary" /> : null}
                      {plan.custom ? <Badge variant="secondary">Custom</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{plan.custom ? 'Contact sales' : formatCurrency(plan.monthlyAmount)}</p>
                    {!plan.custom ? <p className="text-xs text-muted-foreground">{formatCurrency(plan.yearlyAmount)} / year</p> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {plan.highlight ? <Badge variant="outline">{plan.highlight}</Badge> : null}
                  {plan.features.slice(0, 2).map((feature) => (
                    <Badge key={feature} variant="secondary">
                      {feature}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            {!plans.length ? <p className="text-sm text-muted-foreground">No plans returned from the billing API.</p> : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Percent,
            title: 'Pricing to checkout',
            value: revenueFunnel.pricing_to_checkout_rate,
            text: 'Share of pricing visitors who start checkout.',
          },
          {
            icon: BadgeCheck,
            title: 'Checkout completion',
            value: revenueFunnel.checkout_completion_rate,
            text: 'Share of checkout starts that turn into confirmed sessions.',
          },
          {
            icon: Building2,
            title: 'Enterprise handoff',
            value: revenueFunnel.enterprise_contact_rate,
            text: 'Share of pricing visitors who choose contact sales.',
          },
        ].map((item) => (
          <Card key={item.title} className="border bg-card shadow-sm">
            <CardContent className="flex items-start gap-4 p-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                <item.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{item.title}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.text}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
