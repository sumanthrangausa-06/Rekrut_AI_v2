import { Link } from 'react-router-dom'
import { useAuth, getDashboardPath } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Briefcase,
  Users,
  BarChart3,
  Shield,
  Zap,
  ArrowRight,
  CheckCircle2,
  Star,
  LayoutDashboard,
  Search,
  ClipboardCheck,
  MessageSquareText,
} from 'lucide-react'

const features = [
  {
    icon: Briefcase,
    title: 'AI Job Matching',
    description: 'Connect candidates and open roles using skills, experience, and role fit instead of keyword noise.',
  },
  {
    icon: Users,
    title: 'Candidate Screening',
    description: 'Review applications, shortlist faster, and keep every hiring stage moving without spreadsheet chaos.',
  },
  {
    icon: BarChart3,
    title: 'Recruiting Analytics',
    description: 'See pipeline health, hiring performance, and conversion trends in one place.',
  },
  {
    icon: Shield,
    title: 'Onboarding Automation',
    description: 'Reduce manual paperwork with guided onboarding, document collection, and compliance support.',
  },
  {
    icon: Zap,
    title: 'Interview Practice',
    description: 'Help candidates prepare with AI feedback so they show up ready and confident.',
  },
  {
    icon: Star,
    title: 'OmniScore & TrustScore',
    description: 'Use two-sided scoring to surface candidate readiness and company trust signals.',
  },
]

const steps = [
  {
    icon: Search,
    title: 'Attract',
    description: 'Bring in applicants through a cleaner landing experience and role-specific flows.',
  },
  {
    icon: ClipboardCheck,
    title: 'Evaluate',
    description: 'Screen, assess, and compare candidates with AI support across the hiring funnel.',
  },
  {
    icon: MessageSquareText,
    title: 'Convert',
    description: 'Move great candidates from interview to offer and onboarding with fewer drop-offs.',
  },
]

const stats = [
  { value: 'AI', label: 'Recruitment software' },
  { value: 'Fast', label: 'Candidate screening' },
  { value: 'Simple', label: 'Onboarding workflow' },
]

const faq = [
  {
    question: 'What is Rekrut AI?',
    answer:
      'Rekrut AI is an AI recruitment platform that helps teams source, screen, interview, onboard, and analyze hiring performance in one place.',
  },
  {
    question: 'Who is it for?',
    answer:
      'It is built for recruiters, hiring managers, operations teams, and candidates who want a smoother hiring experience.',
  },
  {
    question: 'What makes it different?',
    answer:
      'It combines matching, scoring, onboarding, and analytics instead of splitting those jobs across disconnected tools.',
  },
]

export function LandingPage() {
  const { isAuthenticated, user } = useAuth()
  const dashboardPath = user ? getDashboardPath(user.role) : '/login'

  return (
    <div className="min-h-dvh-safe bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground font-heading">
              R
            </div>
            <span className="font-heading text-xl font-bold">Rekrut AI</span>
          </Link>
          <div className="flex items-center gap-3">
            {isAuthenticated && user ? (
              <Link to={dashboardPath} data-analytics="header-dashboard">
                <Button size="sm" className="gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login" data-analytics="header-sign-in">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link to="/register" data-analytics="header-get-started">
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:py-20 lg:py-28">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mb-4 inline-flex items-center rounded-full border bg-muted px-3 py-1.5 text-xs text-muted-foreground sm:px-4 sm:text-sm">
                <Zap className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
                AI recruitment software for faster hiring
              </div>
              <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Hire smarter with an AI platform built for recruiters and candidates.
              </h1>
              <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
                Match talent faster, screen candidates with less friction, and keep onboarding moving with one workflow.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                {isAuthenticated && user ? (
                  <Link to={dashboardPath} data-analytics="hero-dashboard">
                    <Button size="lg" className="gap-2">
                      Go to Dashboard
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Link to="/register" data-analytics="hero-start-hiring">
                      <Button size="lg" className="gap-2">
                        Start hiring free
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Link to="/register?role=candidate" data-analytics="hero-find-jobs">
                      <Button variant="outline" size="lg">
                        Find jobs
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </div>

            <div className="mx-auto mt-12 grid max-w-2xl gap-4 sm:mt-16 sm:grid-cols-3 sm:gap-6">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border bg-card p-5 text-center shadow-sm">
                  <p className="font-heading text-2xl font-bold text-primary sm:text-3xl">{stat.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-heading text-3xl font-bold">Everything needed across the hiring funnel</h2>
              <p className="mt-3 text-muted-foreground">
                Rekrut AI gives hiring teams a cleaner way to attract talent, evaluate applicants, and convert strong candidates.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Card key={feature.title} className="border-0 bg-card shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="mt-4 font-heading font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="grid gap-6 lg:grid-cols-3">
              {steps.map((step) => (
                <Card key={step.title} className="border bg-card shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <step.icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-heading text-xl font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-heading text-3xl font-bold">Built for SEO and conversion</h2>
              <p className="mt-3 text-muted-foreground">
                Clear messaging, repeated calls to action, and search-friendly language help the homepage do more of the selling.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {['AI recruitment platform', 'candidate screening software', 'onboarding automation'].map((term) => (
                <div key={term} className="rounded-2xl border bg-muted/30 p-5 text-sm font-medium text-foreground shadow-sm">
                  {term}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-heading text-3xl font-bold">Frequently asked questions</h2>
            </div>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {faq.map((item) => (
                <Card key={item.question} className="border-0 bg-card shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <div>
                        <h3 className="font-heading font-semibold">{item.question}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="rounded-3xl bg-primary p-6 text-center text-primary-foreground sm:p-8 lg:p-16">
              <h2 className="font-heading text-2xl font-bold sm:text-3xl lg:text-4xl">
                Ready to turn more visits into hires?
              </h2>
              <p className="mt-3 text-primary-foreground/80 lg:text-lg">
                Start with a cleaner landing page and a faster path from first click to active applicant.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Link to="/register" data-analytics="cta-start-hiring">
                  <Button variant="secondary" size="lg" className="gap-2">
                    Start hiring free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/register?role=candidate" data-analytics="cta-find-jobs">
                  <Button variant="outline" size="lg" className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                    Find jobs
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Rekrut AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
