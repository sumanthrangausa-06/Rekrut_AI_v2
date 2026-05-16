import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Crown,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react'
import { useAuth, getDashboardPath } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { apiCall } from '@/lib/api'
import { trackEvent } from '@/lib/analytics'

type BillingCycle = 'monthly' | 'yearly'

type PricingPlan = {
  id: string
  name: string
  description: string
  monthlyAmount: number | null
  yearlyAmount: number | null
  popular: boolean
  highlight?: string | null
  features: string[]
  custom: boolean
}

type PlansResponse = {
  stripeConfigured: boolean
  plans: PricingPlan[]
}

type ConfirmResponse = {
  verified: boolean
  synced: boolean
  planId: string | null
  billingCycle: string | null
  subscriptionId: string | null
  subscriptionStatus: string | null
}

const billingOptions: { id: BillingCycle; label: string; helper: string }[] = [
  { id: 'monthly', label: 'Monthly', helper: 'Pay month to month' },
  { id: 'yearly', label: 'Yearly', helper: 'Save with annual billing' },
]

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function yearlySavings(monthly: number | null, yearly: number | null) {
  if (!monthly || !yearly || monthly * 12 <= yearly) return 0
  return Math.round((1 - yearly / (monthly * 12)) * 100)
}

export function PricingPage() {
  const { user } = useAuth()
  const location = useLocation()
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const [plans, setPlans] = useState<PricingPlan[]>([])
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [plansLoading, setPlansLoading] = useState(true)
  const [pageMessage, setPageMessage] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [syncingSession, setSyncingSession] = useState(false)

  const dashboardPath = user ? getDashboardPath(user.role) : '/login'
  const search = useMemo(() => new URLSearchParams(location.search), [location.search])

  useEffect(() => {
    trackEvent('page_view_pricing', { billing_cycle: billingCycle })
  }, [])

  useEffect(() => {
    trackEvent('pricing_cycle_change', { billing_cycle: billingCycle })
  }, [billingCycle])

  useEffect(() => {
    let active = true

    async function loadPlans() {
      setPlansLoading(true)
      try {
        const data = await apiCall<PlansResponse>('/billing/plans', { method: 'GET' })
        if (!active) return
        setPlans(data.plans)
        setStripeConfigured(data.stripeConfigured)
      } catch (error) {
        if (!active) return
        setPageMessage(error instanceof Error ? error.message : 'Failed to load pricing.')
      } finally {
        if (active) setPlansLoading(false)
      }
    }

    loadPlans()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const canceled = search.get('canceled')
    const success = search.get('success')
    const sessionId = search.get('session_id')

    if (canceled) {
      trackEvent('pricing_checkout_canceled')
      setPageMessage('Checkout canceled. You can try again whenever you want.')
      return
    }

    if (success && sessionId) {
      let active = true
      setSyncingSession(true)
      setPageMessage('Confirming your payment...')

      async function confirm() {
        try {
          const data = await apiCall<ConfirmResponse>('/billing/confirm-session', {
            method: 'POST',
            body: { session_id: sessionId },
          })

          if (!active) return
          if (data.verified) {
            trackEvent('pricing_checkout_confirmed', {
              plan_id: data.planId,
              billing_cycle: data.billingCycle,
            })
            setPageMessage(
              data.synced
                ? 'Payment confirmed. Your account is active.'
                : 'Payment confirmed. Sign in to sync it to your account.'
            )
          } else {
            setPageMessage('We could not confirm that checkout session yet.')
          }
        } catch (error) {
          if (!active) return
          setPageMessage(error instanceof Error ? error.message : 'Could not confirm payment yet.')
        } finally {
          if (active) setSyncingSession(false)
        }
      }

      confirm()

      return () => {
        active = false
      }
    }
  }, [search])

  const handleCheckout = async (planId: string) => {
    setCheckoutLoading(planId)
    setPageMessage(null)

    try {
      const data = await apiCall<{ url: string }>('/billing/checkout-session', {
        method: 'POST',
        body: { planId, billingCycle },
      })

      if (!data.url) {
        throw new Error('Stripe did not return a checkout URL.')
      }

      window.location.assign(data.url)
    } catch (error) {
      setCheckoutLoading(null)
      setPageMessage(error instanceof Error ? error.message : 'Checkout failed.')
    }
  }

  return (
    <div className="min-h-dvh-safe bg-gradient-to-b from-background via-background to-muted/30">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground font-heading">
              R
            </div>
            <span className="font-heading text-xl font-bold">Rekrut AI</span>
          </Link>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            {user ? (
              <Link to={dashboardPath} className="block w-full sm:w-auto">
                <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                  Dashboard
                </Button>
              </Link>
            ) : (
              <Link to="/login" className="block w-full sm:w-auto">
                <Button variant="ghost" size="sm" className="w-full sm:w-auto">
                  Sign in
                </Button>
              </Link>
            )}
            <Link to="/register" className="block w-full sm:w-auto">
              <Button size="sm" className="w-full sm:w-auto">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:py-16 lg:py-20">
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center rounded-full border bg-muted px-3 py-1.5 text-xs text-muted-foreground sm:px-4 sm:text-sm">
            <Sparkles className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Simple plans for teams that need to hire faster
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-5xl">
            Choose a plan that fits your hiring volume.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground sm:text-xl">
            Launch with a clean pricing page, then send buyers straight into Stripe Checkout with one click.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            {billingOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={billingCycle === option.id}
                onClick={() => {
                  setBillingCycle(option.id)
                  trackEvent('pricing_cycle_toggle_click', { billing_cycle: option.id })
                }}
                className={`flex w-full items-start gap-2 rounded-full border px-4 py-3 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto sm:items-center sm:px-5 sm:py-2 ${
                  billingCycle === option.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted'
                }`}
              >
                <span>{option.label}</span>
                <span className="text-xs font-normal opacity-70 sm:ml-2">{option.helper}</span>
              </button>
            ))}
          </div>

          {pageMessage ? (
            <div className="mt-6 rounded-2xl border bg-card px-4 py-3 text-sm text-foreground shadow-sm" role="status" aria-live="polite">
              {syncingSession ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
              {pageMessage}
            </div>
          ) : null}

          {!stripeConfigured && !plansLoading ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
              Stripe Checkout is not configured yet. Add <code>STRIPE_SECRET_KEY</code> in Settings &gt; Advanced to enable checkout.
            </div>
          ) : null}
        </section>

        <section className="mt-12">
          {plansLoading ? (
            <div className="flex min-h-80 items-center justify-center rounded-3xl border bg-card shadow-sm">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading pricing plans...
              </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              {plans.map((plan) => {
                const price = billingCycle === 'yearly' ? plan.yearlyAmount : plan.monthlyAmount
                const intervalLabel = billingCycle === 'yearly' ? '/year' : '/month'
                const savings = yearlySavings(plan.monthlyAmount, plan.yearlyAmount)
                const isDisabled = !stripeConfigured || plan.custom

                return (
                  <Card
                    key={plan.id}
                    className={`relative overflow-hidden border bg-card shadow-sm ${
                      plan.popular ? 'ring-2 ring-primary/20' : ''
                    }`}
                  >
                    {plan.popular ? (
                      <div className="absolute right-4 top-4 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                        Most popular
                      </div>
                    ) : null}
                    {plan.highlight ? (
                      <div className="absolute left-4 top-4 rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                        {plan.highlight}
                      </div>
                    ) : null}
                    <CardHeader className="pt-14">
                      <CardTitle className="flex items-center gap-2 text-2xl">
                        {plan.popular ? <Crown className="h-5 w-5 text-primary" /> : <BadgeCheck className="h-5 w-5 text-primary" />}
                        {plan.name}
                      </CardTitle>
                      <CardDescription className="min-h-12 text-base">{plan.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div>
                        {plan.custom ? (
                          <div className="text-4xl font-bold tracking-tight">Custom</div>
                        ) : price ? (
                          <div className="space-y-1">
                            <div className="text-4xl font-bold tracking-tight">{formatCurrency(price)}</div>
                            <div className="text-sm text-muted-foreground">
                              {intervalLabel}
                              {billingCycle === 'yearly' && savings > 0 ? (
                                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                                  Save {savings}%
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <ul className="space-y-3 text-sm text-muted-foreground">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-3">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                    <CardFooter>
                      {plan.custom ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            trackEvent('pricing_contact_sales_click', { plan_id: plan.id, billing_cycle: billingCycle })
                            window.location.href = 'mailto:hello@rekrutai.co?subject=Rekrut%20AI%20Enterprise%20Pricing'
                          }}
                        >
                          Contact sales
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          className="w-full gap-2"
                          disabled={isDisabled || checkoutLoading === plan.id}
                          onClick={() => {
                            trackEvent('pricing_checkout_click', { plan_id: plan.id, billing_cycle: billingCycle })
                            handleCheckout(plan.id)
                          }}
                        >
                          {checkoutLoading === plan.id ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Redirecting...
                            </>
                          ) : (
                            <>
                              Start checkout
                              <ArrowRight className="h-4 w-4" />
                            </>
                          )}
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        <section className="mt-12 rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Zap,
                title: 'Fast checkout',
                text: 'Stripe handles payment collection and subscription creation.'
              },
              {
                icon: BadgeCheck,
                title: 'Easy sync',
                text: 'Signed-in users get their Rekrut AI account updated after payment.'
              },
              {
                icon: Sparkles,
                title: 'Flexible billing',
                text: 'Switch between monthly and yearly pricing without leaving the page.'
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-heading font-semibold">{item.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
