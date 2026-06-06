import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, getDashboardPath } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { trackEvent } from '@/lib/analytics'
import { Logo } from '@/components/ui/logo'
import {
  Briefcase,
  Users,
  BarChart3,
  Shield,
  Zap,
  Star,
  ArrowRight,
  CheckCircle2,
  MessageSquareText,
  Video,
  FileText,
  Sparkles,
  Search,
  ArrowUpRight,
  Menu,
  X,
  ChevronDown,
  ChevronUp,
  Play,
  Globe,
  Rocket,
  Heart,
  Target,
  Cpu,
  Award,
  Clock,
  Building2,
  MapPin,
  Phone,
  Mail,
  Linkedin,
  Twitter,
  Github,
  Instagram,
  Send,
  MessageCircle,
  Youtube,
} from 'lucide-react'

// ─── Data ─────────────────────────────────────────────────────────────

const features = [
  {
    icon: Sparkles,
    title: 'AI Job Matching',
    description:
      'Our AI engine analyzes skills, experience, and role fit to surface the best matches — not just keyword matches.',
  },
  {
    icon: Cpu,
    title: 'OmniScore',
    description:
      'A unified candidate readiness score that combines assessment results, interview feedback, and skill validation in one number.',
  },
  {
    icon: Shield,
    title: 'TrustScore',
    description:
      'Two-sided trust signals help candidates vet companies and recruiters evaluate candidate reliability before engaging.',
  },
  {
    icon: Video,
    title: 'AI Video Interviews',
    description:
      'Built-in video calling with AI-powered interview assistance, transcription, and structured feedback collection.',
  },
  {
    icon: MessageSquareText,
    title: 'Smart Screening',
    description:
      'AI-assisted application review, automated shortlisting, and contextual follow-up questions reduce recruiter workload.',
  },
  {
    icon: FileText,
    title: 'Contract Generation',
    description:
      'Generate compliant offer letters and employment contracts in minutes with built-in templates and e-signatures.',
  },
  {
    icon: Zap,
    title: 'Onboarding Automation',
    description:
      'From document collection to checklist tracking, guide every new hire through a seamless first week.',
  },
  {
    icon: BarChart3,
    title: 'Hiring Analytics',
    description:
      'Real-time dashboards on pipeline health, time-to-hire, source effectiveness, and conversion trends.',
  },
]

const steps = [
  {
    number: '01',
    icon: Users,
    title: 'Create your profile',
    description:
      'Candidates build rich profiles with skills, experience, and preferences. Recruiters set up company pages and job postings in minutes.',
  },
  {
    number: '02',
    icon: Sparkles,
    title: 'Get AI-matched',
    description:
      'Our AI engine surfaces high-fit candidates and roles. OmniScore ranks top prospects so you spend time on the best matches.',
  },
  {
    number: '03',
    icon: Rocket,
    title: 'Hire with confidence',
    description:
      'Interview, assess, generate contracts, and onboard — all inside one platform. Track every step with analytics.',
  },
]

const testimonials = [
  {
    quote:
      'Rekrut AI cut our time-to-hire by 40%. The OmniScore made it obvious who we should interview first.',
    author: 'Priya Sharma',
    role: 'Head of Talent, TechScale India',
    avatar: 'PS',
  },
  {
    quote:
      'The AI matching is uncanny. We found three senior engineers in two weeks who were genuinely excited about the role.',
    author: 'James Chen',
    role: 'VP Engineering, CloudPath',
    avatar: 'JC',
  },
  {
    quote:
      'As a candidate, I loved the transparency. I could see my TrustScore and how I compared to other applicants.',
    author: 'Ananya Reddy',
    role: 'Senior Product Designer',
    avatar: 'AR',
  },
  {
    quote:
      'Onboarding automation saved our HR team 15 hours per new hire. Document collection is now completely hands-off.',
    author: 'Michael Torres',
    role: 'People Operations Lead, GrowthLabs',
    avatar: 'MT',
  },
]

const companyLogos = [
  'TechScale',
  'CloudPath',
  'GrowthLabs',
  'DataBridge',
  'NexGen',
  'InnovaCorp',
  'SwiftHire',
  'PixelWorks',
]

const stats = [
  { value: '40%', label: 'Faster time-to-hire' },
  { value: '3x', label: 'Better candidate matches' },
  { value: '15+', label: 'Hours saved per hire' },
  { value: '50K+', label: 'Candidates matched' },
]

const faq = [
  {
    question: 'What is Rekrut AI?',
    answer:
      'Rekrut AI is an AI-native recruitment platform that connects candidates and recruiters. It covers the entire hiring lifecycle — from job matching and screening to interviews, contract generation, and onboarding — in one unified workflow.',
  },
  {
    question: 'Who is Rekrut AI for?',
    answer:
      'We serve both sides of the hiring market. Recruiters and hiring managers use Rekrut AI to source, screen, and onboard candidates faster. Job seekers use it to find roles matched to their skills and get AI-powered interview coaching.',
  },
  {
    question: 'How does AI job matching work?',
    answer:
      'Our AI analyzes your profile, skills, experience, and preferences against open roles. It looks beyond keywords to understand context, seniority, and cultural fit. The result is a ranked list of high-probability matches, not just keyword hits.',
  },
  {
    question: 'What is OmniScore and TrustScore?',
    answer:
      'OmniScore is a unified candidate readiness score combining assessments, interview feedback, and skill validation. TrustScore is a two-sided rating system where candidates and companies rate each other, surfacing reliable partners on both sides.',
  },
  {
    question: 'Is there a free plan?',
    answer:
      'Yes. Candidates can create profiles, apply to jobs, and access AI coaching for free. Recruiters can post jobs and review applicants on our free tier. Paid plans unlock proactive outreach, advanced analytics, and team features.',
  },
  {
    question: 'Is Rekrut AI available globally?',
    answer:
      'Absolutely. While we have strong roots in India, Rekrut AI is built for global hiring. We support multi-currency, multi-language, and compliance templates for major markets including the US, UK, EU, and APAC.',
  },
]

// ─── Components ─────────────────────────────────────────────────────────

function MobileMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" onClick={onClose}>
            <Logo size="md" />
            <span className="font-heading text-xl font-bold">Rekrut AI</span>
          </Link>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <nav className="mt-8 flex flex-col gap-4">
          <Link to="/pricing" onClick={() => { trackEvent('mobile_menu_pricing_click'); onClose() }}>
            <Button variant="ghost" className="w-full justify-start text-lg">Pricing</Button>
          </Link>
          <Link to="/blog" onClick={() => { trackEvent('mobile_menu_blog_click'); onClose() }}>
            <Button variant="ghost" className="w-full justify-start text-lg">Blog</Button>
          </Link>
          <Link to="/about" onClick={() => { trackEvent('mobile_menu_about_click'); onClose() }}>
            <Button variant="ghost" className="w-full justify-start text-lg">About</Button>
          </Link>
          <Link to="/contact" onClick={() => { trackEvent('mobile_menu_contact_click'); onClose() }}>
            <Button variant="ghost" className="w-full justify-start text-lg">Contact</Button>
          </Link>
          <div className="mt-4 border-t pt-4">
            <Link to="/login" onClick={() => { trackEvent('mobile_menu_sign_in_click'); onClose() }}>
              <Button variant="outline" className="w-full">Sign in</Button>
            </Link>
            <Link to="/register" className="mt-3 block" onClick={() => { trackEvent('mobile_menu_get_started_click'); onClose() }}>
              <Button className="w-full">Get started</Button>
            </Link>
          </div>
        </nav>
      </div>
    </div>
  )
}

function Header() {
  const { isAuthenticated, user } = useAuth()
  const dashboardPath = user ? getDashboardPath(user.role) : '/login'
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <Link to="/" className="flex items-center gap-2" onClick={() => trackEvent('nav_logo_click', { destination: 'home' })}>
            <Logo size="md" />
            <span className="font-heading text-xl font-bold">Rekrut AI</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 sm:flex">
            <Link to="/pricing" onClick={() => trackEvent('header_pricing_click')}>
              <Button variant="ghost" size="sm">Pricing</Button>
            </Link>
            <Link to="/blog" onClick={() => trackEvent('header_blog_click')}>
              <Button variant="ghost" size="sm">Blog</Button>
            </Link>
            <Link to="/about" onClick={() => trackEvent('header_about_click')}>
              <Button variant="ghost" size="sm">About</Button>
            </Link>
            <Link to="/contact" onClick={() => trackEvent('header_contact_click')}>
              <Button variant="ghost" size="sm">Contact</Button>
            </Link>
          </nav>

          <div className="hidden items-center gap-3 sm:flex">
            {isAuthenticated && user ? (
              <Link to={dashboardPath} onClick={() => trackEvent('header_dashboard_click', { role: user.role })}>
                <Button size="sm" className="gap-2">
                  Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login" onClick={() => trackEvent('header_sign_in_click')}>
                  <Button variant="ghost" size="sm">Sign in</Button>
                </Link>
                <Link to="/register" onClick={() => trackEvent('header_get_started_click')}>
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 sm:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <MobileMenu isOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
    </>
  )
}

function HeroSection() {
  const { isAuthenticated, user } = useAuth()
  const dashboardPath = user ? getDashboardPath(user.role) : '/login'

  return (
    <section className="relative overflow-hidden">
      {/* Background gradient blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-20 -left-20 h-72 w-72 rounded-full bg-purple-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-indigo-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-24 lg:py-32">
        <div className="mx-auto max-w-4xl text-center">
          <Badge
            variant="secondary"
            className="mb-6 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI-native recruitment platform for teams that hire fast
          </Badge>

          <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            Hire smarter.{' '}
            <span className="text-primary">Hire faster.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            The AI recruitment platform that matches candidates to roles, screens applicants with
            precision, and moves great hires from first click to onboarding — in one unified
            workflow.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {isAuthenticated && user ? (
              <Link to={dashboardPath} onClick={() => trackEvent('hero_dashboard_click', { role: user.role })}>
                <Button size="lg" className="gap-2 px-8">
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/register" onClick={() => trackEvent('hero_start_hiring_click')}>
                  <Button size="lg" className="gap-2 px-8">
                    Start hiring free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/register?role=candidate" onClick={() => trackEvent('hero_find_jobs_click')}>
                  <Button variant="outline" size="lg" className="px-8">
                    Find jobs
                  </Button>
                </Link>
              </>
            )}
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            No credit card required. Free tier available for candidates and recruiters.
          </p>
        </div>

        {/* Hero visual — abstract dashboard preview */}
        <div className="mx-auto mt-16 max-w-5xl">
          <div className="relative rounded-2xl border bg-card shadow-2xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
            <div className="relative p-6 sm:p-10">
              <div className="grid gap-6 sm:grid-cols-3">
                <Card className="border-0 bg-background/80 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Active Candidates</p>
                        <p className="text-2xl font-bold text-primary">2,847</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-0 bg-background/80 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                        <Briefcase className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Open Positions</p>
                        <p className="text-2xl font-bold text-green-600">142</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-0 bg-background/80 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                        <Star className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Avg. OmniScore</p>
                        <p className="text-2xl font-bold text-amber-600">8.4</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              <div className="mt-6 rounded-xl border bg-background/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-xs font-medium text-muted-foreground">AI Matching Engine Active</span>
                </div>
                <div className="space-y-2">
                  {[
                    { name: 'Sarah Kim — Senior React Dev', score: 94, match: 'Top match' },
                    { name: 'Rahul Mehta — Product Manager', score: 91, match: 'Strong fit' },
                    { name: 'Emma Wilson — UX Designer', score: 89, match: 'Great fit' },
                  ].map((candidate) => (
                    <div key={candidate.name} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {candidate.name.split(' ').map((n) => n[0]).join('')}
                        </div>
                        <span className="text-sm font-medium">{candidate.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">{candidate.match}</Badge>
                        <span className="text-sm font-bold text-primary">{candidate.score}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:mt-16 sm:grid-cols-4 sm:gap-6">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl border bg-card p-5 text-center shadow-sm">
              <p className="font-heading text-2xl font-bold text-primary sm:text-3xl">{stat.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FeaturesSection() {
  return (
    <section className="border-y bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">Features</Badge>
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to hire at scale
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            From sourcing to onboarding, Rekrut AI replaces a stack of disconnected tools with one
            intelligent platform.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card key={feature.title} className="group border-0 bg-card shadow-sm transition-all hover:shadow-md">
              <CardContent className="p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/15">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mt-5 font-heading text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function HowItWorksSection() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">How it works</Badge>
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Three steps to better hiring
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            No complex setup. No switching between tools. Just a faster path from open role to
            signed offer.
          </p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="relative">
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-[60%] w-[80%] border-t-2 border-dashed border-muted-foreground/20" />
              )}
              <Card className="border-0 bg-card shadow-sm h-full">
                <CardContent className="p-8">
                  <div className="flex items-center justify-between">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                      <step.icon className="h-6 w-6 text-primary" />
                    </div>
                    <span className="font-heading text-4xl font-bold text-muted-foreground/30">
                      {step.number}
                    </span>
                  </div>
                  <h3 className="mt-6 font-heading text-xl font-semibold">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SocialProofSection() {
  return (
    <section className="border-y bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4">
        {/* Logos */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Trusted by fast-growing teams
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            {companyLogos.map((logo) => (
              <div
                key={logo}
                className="flex items-center gap-2 rounded-lg bg-background px-4 py-2 shadow-sm"
              >
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-muted-foreground">{logo}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonials */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {testimonials.map((t) => (
            <Card key={t.author} className="border-0 bg-card shadow-sm">
              <CardContent className="p-6">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-foreground">"{t.quote}"</p>
                <div className="mt-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{t.author}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function PricingTeaserSection() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">Pricing</Badge>
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Simple pricing for every stage
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Start free. Upgrade when you need more power. No hidden fees, no long-term contracts.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {/* Free plan */}
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-8">
              <h3 className="font-heading text-xl font-semibold">Free</h3>
              <p className="mt-2 text-sm text-muted-foreground">For individuals and small teams getting started.</p>
              <div className="mt-6">
                <span className="font-heading text-4xl font-bold">$0</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <ul className="mt-6 space-y-3">
                {[
                  'Create profile & apply to jobs',
                  'Review applicants (recruiters)',
                  'Basic AI matching',
                  'AI interview coaching',
                  'TrustScore access',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/register" onClick={() => trackEvent('pricing_free_click')}>
                <Button variant="outline" className="mt-8 w-full">Get started free</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Pro plan */}
          <Card className="relative border-2 border-primary shadow-md">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground">
              Most popular
            </div>
            <CardContent className="p-8">
              <h3 className="font-heading text-xl font-semibold">Pro</h3>
              <p className="mt-2 text-sm text-muted-foreground">For teams that hire regularly and need proactive tools.</p>
              <div className="mt-6">
                <span className="font-heading text-4xl font-bold">$49</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <ul className="mt-6 space-y-3">
                {[
                  'Everything in Free, plus:',
                  'Proactive candidate outreach',
                  'Advanced OmniScore analytics',
                  'AI video interviews',
                  'Contract generation',
                  'Onboarding automation',
                  'Priority support',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/register" onClick={() => trackEvent('pricing_pro_click')}>
                <Button className="mt-8 w-full gap-2">
                  Start Pro trial
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Enterprise plan */}
          <Card className="border-0 bg-card shadow-sm">
            <CardContent className="p-8">
              <h3 className="font-heading text-xl font-semibold">Enterprise</h3>
              <p className="mt-2 text-sm text-muted-foreground">For large organizations with custom compliance and volume needs.</p>
              <div className="mt-6">
                <span className="font-heading text-4xl font-bold">Custom</span>
              </div>
              <ul className="mt-6 space-y-3">
                {[
                  'Everything in Pro, plus:',
                  'SSO & SAML',
                  'Custom contracts',
                  'Dedicated account manager',
                  'SLA guarantees',
                  'Advanced integrations',
                  'On-premise deployment option',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/contact" onClick={() => trackEvent('pricing_enterprise_click')}>
                <Button variant="outline" className="mt-8 w-full">Contact sales</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center">
          <Link to="/pricing" onClick={() => trackEvent('pricing_full_page_click')}>
            <Button variant="ghost" className="gap-2 text-primary">
              View full pricing details
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section className="border-y bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4">
        <div className="text-center">
          <Badge variant="outline" className="mb-4">FAQ</Badge>
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Everything you need to know about Rekrut AI. Can not find what you are looking for?{' '}
            <Link to="/contact" className="text-primary underline underline-offset-4 hover:text-primary/80" onClick={() => trackEvent('faq_contact_click')}>
              Contact us
            </Link>
            .
          </p>
        </div>

        <div className="mt-12 space-y-4">
          {faq.map((item, index) => (
            <Card key={item.question} className="border-0 bg-card shadow-sm">
              <CardContent className="p-0">
                <button
                  className="flex w-full items-center justify-between p-6 text-left"
                  onClick={() => {
                    setOpenIndex(openIndex === index ? null : index)
                    trackEvent('faq_click', { question: item.question, open: openIndex !== index })
                  }}
                >
                  <span className="font-heading font-semibold pr-4">{item.question}</span>
                  {openIndex === index ? (
                    <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
                {openIndex === index && (
                  <div className="px-6 pb-6">
                    <p className="text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function CTABannerSection() {
  const { isAuthenticated, user } = useAuth()
  const dashboardPath = user ? getDashboardPath(user.role) : '/login'

  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="relative overflow-hidden rounded-3xl bg-primary p-8 text-center text-primary-foreground sm:p-12 lg:p-16">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          </div>
          <div className="relative">
            <h2 className="font-heading text-2xl font-bold sm:text-3xl lg:text-4xl">
              Ready to transform your hiring?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-primary-foreground/80 lg:text-lg">
              Join thousands of recruiters and candidates who are already hiring smarter with Rekrut AI.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              {isAuthenticated && user ? (
                <Link to={dashboardPath} onClick={() => trackEvent('bottom_cta_dashboard_click', { role: user.role })}>
                  <Button variant="secondary" size="lg" className="gap-2 px-8">
                    Go to Dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/register" onClick={() => trackEvent('bottom_cta_start_click')}>
                    <Button variant="secondary" size="lg" className="gap-2 px-8">
                      Start hiring free
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/register?role=candidate" onClick={() => trackEvent('bottom_cta_candidate_click')}>
                    <Button
                      variant="outline"
                      size="lg"
                      className="border-primary-foreground/30 bg-transparent px-8 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                    >
                      I am looking for a job
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const productLinks = [
    { label: 'Features', href: '/#features', event: 'footer_features_click' },
    { label: 'Pricing', href: '/pricing', event: 'footer_pricing_click' },
    { label: 'AI Matching', href: '/#features', event: 'footer_ai_matching_click' },
    { label: 'OmniScore', href: '/#features', event: 'footer_omniscore_click' },
    { label: 'Video Interviews', href: '/#features', event: 'footer_video_interviews_click' },
  ]

  const companyLinks = [
    { label: 'About us', href: '/about', event: 'footer_about_click' },
    { label: 'Blog', href: '/blog', event: 'footer_blog_click' },
    { label: 'Careers', href: '/contact', event: 'footer_careers_click' },
    { label: 'Contact', href: '/contact', event: 'footer_contact_click' },
  ]

  const legalLinks = [
    { label: 'Privacy Policy', href: '/privacy', event: 'footer_privacy_click' },
    { label: 'Terms of Service', href: '/terms', event: 'footer_terms_click' },
    { label: 'Cookie Policy', href: '/privacy', event: 'footer_cookie_click' },
  ]

  const resourceLinks = [
    { label: 'Help Center', href: '/contact', event: 'footer_help_click' },
    { label: 'API Docs', href: '/contact', event: 'footer_api_click' },
    { label: 'Status', href: '/contact', event: 'footer_status_click' },
  ]

  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:py-16">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-2" onClick={() => trackEvent('footer_logo_click')}>
              <Logo size="md" />
              <span className="font-heading text-xl font-bold">Rekrut AI</span>
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              AI-native recruitment platform connecting candidates and recruiters. Built in 2026 by
              Ranga Sumanth and Suga. Hiring smarter, faster, and more transparently.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <a href="https://twitter.com/rekrutai" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent('footer_social_twitter')} className="flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10">
                <Twitter className="h-4 w-4 text-muted-foreground" />
              </a>
              <a href="https://linkedin.com/company/rekrutai" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent('footer_social_linkedin')} className="flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10">
                <Linkedin className="h-4 w-4 text-muted-foreground" />
              </a>
              <a href="https://github.com/rekrutai" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent('footer_social_github')} className="flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10">
                <Github className="h-4 w-4 text-muted-foreground" />
              </a>
              <a href="mailto:hello@rekrutai.co" onClick={() => trackEvent('footer_social_email')} className="flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-heading text-sm font-semibold">Product</h4>
            <ul className="mt-4 space-y-2.5">
              {productLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.href} onClick={() => trackEvent(link.event)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-heading text-sm font-semibold">Company</h4>
            <ul className="mt-4 space-y-2.5">
              {companyLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.href} onClick={() => trackEvent(link.event)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources & Legal */}
          <div>
            <h4 className="font-heading text-sm font-semibold">Resources</h4>
            <ul className="mt-4 space-y-2.5">
              {resourceLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.href} onClick={() => trackEvent(link.event)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <h4 className="mt-6 font-heading text-sm font-semibold">Legal</h4>
            <ul className="mt-4 space-y-2.5">
              {legalLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.href} onClick={() => trackEvent(link.event)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Rekrut AI (formerly HireLoop). All rights reserved.</p>
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" />
            <span>Made with care in India. Hiring globally.</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────

export function LandingPage() {
  useEffect(() => {
    trackEvent('page_view_landing')
  }, [])

  return (
    <div className="min-h-dvh-safe bg-background">
      <Header />
      <main>
        <HeroSection />
        <div id="features">
          <FeaturesSection />
        </div>
        <HowItWorksSection />
        <SocialProofSection />
        <PricingTeaserSection />
        <FAQSection />
        <CTABannerSection />
      </main>
      <Footer />
    </div>
  )
}
