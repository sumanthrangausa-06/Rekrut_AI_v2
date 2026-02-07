import { Link } from 'react-router-dom'
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
} from 'lucide-react'

const features = [
  {
    icon: Briefcase,
    title: 'Smart Job Matching',
    description: 'AI-powered matching connects candidates with the right opportunities based on skills and preferences.',
  },
  {
    icon: Users,
    title: 'Streamlined Recruiting',
    description: 'Manage applications, schedule interviews, and track candidates through your hiring pipeline.',
  },
  {
    icon: BarChart3,
    title: 'OmniScore Analytics',
    description: 'Comprehensive candidate scoring that goes beyond resumes to evaluate real potential.',
  },
  {
    icon: Shield,
    title: 'Automated Onboarding',
    description: 'AI-driven onboarding handles paperwork, documents, and compliance so you can focus on people.',
  },
  {
    icon: Zap,
    title: 'AI Interview Coach',
    description: 'Practice interviews with AI feedback to improve performance and confidence.',
  },
  {
    icon: Star,
    title: 'Skill Assessments',
    description: 'Verify candidate skills with AI-generated assessments tailored to each role.',
  },
]

const stats = [
  { value: '10x', label: 'Faster hiring' },
  { value: '85%', label: 'Match accuracy' },
  { value: '50%', label: 'Less paperwork' },
]

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-heading font-bold text-sm">
              H
            </div>
            <span className="font-heading text-xl font-bold">HireLoop</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/register">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-20 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex items-center rounded-full border bg-muted px-4 py-1.5 text-sm text-muted-foreground">
              <Zap className="mr-1.5 h-3.5 w-3.5 text-primary" />
              AI-Powered Recruitment Platform
            </div>
            <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Hire smarter.{' '}
              <span className="text-primary">Grow faster.</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              The all-in-one recruitment platform that uses AI to match candidates,
              streamline hiring, and automate onboarding.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link to="/register">
                <Button size="lg" className="gap-2">
                  Start hiring free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/register?role=candidate">
                <Button variant="outline" size="lg">
                  Find jobs
                </Button>
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-16 grid max-w-lg grid-cols-3 gap-8 lg:max-w-2xl">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="font-heading text-3xl font-bold text-primary">{stat.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-heading text-3xl font-bold">Everything you need to hire</h2>
            <p className="mt-3 text-muted-foreground">
              From job posting to onboarding, HireLoop handles it all.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="border-0 shadow-none bg-card">
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

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="rounded-2xl bg-primary p-8 text-center text-primary-foreground lg:p-16">
            <h2 className="font-heading text-3xl font-bold lg:text-4xl">
              Ready to transform your hiring?
            </h2>
            <p className="mt-3 text-primary-foreground/80 lg:text-lg">
              Join companies already using HireLoop to build better teams.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link to="/register">
                <Button variant="secondary" size="lg" className="gap-2">
                  Get started free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} HireLoop. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
