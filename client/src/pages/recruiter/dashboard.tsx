import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Briefcase,
  Users,
  FileText,
  Calendar,
  TrendingUp,
  ArrowRight,
  Plus,
  UserCheck,
  BarChart3,
  Shield,
  Clock,
  Sparkles,
} from 'lucide-react'

interface RecruiterDashboardData {
  trust_score: {
    total_score: number
    tier: string
    tier_label: string
    tier_color: string
  }
  job_stats: {
    active_jobs: string
    paused_jobs: string
    closed_jobs: string
  }
  application_stats: {
    total_applications: string
    new_applications: string
    reviewing: string
    interviewed: string
    offered: string
    hired: string
  }
  upcoming_interviews: Array<{
    id: number
    candidate_name: string
    job_title: string
    scheduled_at: string
  }>
  recent_applications: Array<{
    id: number
    candidate_name: string
    job_title: string
    status: string
    applied_at: string
  }>
}

export function RecruiterDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState<RecruiterDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const res = await apiCall<RecruiterDashboardData>('/recruiter/dashboard')
        setData(res)
      } catch {
        // Best-effort
      } finally {
        setLoading(false)
      }
    }
    loadDashboard()
  }, [])

  const stats = data ? {
    activeJobs: parseInt(data.job_stats?.active_jobs || '0'),
    totalApplications: parseInt(data.application_stats?.total_applications || '0'),
    newApplications: parseInt(data.application_stats?.new_applications || '0'),
    hired: parseInt(data.application_stats?.hired || '0'),
  } : { activeJobs: 0, totalApplications: 0, newApplications: 0, hired: 0 }

  const quickActions = [
    { label: 'Post a Job', href: '/recruiter/jobs/new', icon: Plus, color: 'text-blue-600 bg-blue-100', desc: 'AI-assisted creation' },
    { label: 'Review Applications', href: '/recruiter/applications', icon: FileText, color: 'text-green-600 bg-green-100', desc: `${stats.newApplications} new` },
    { label: 'Schedule Interview', href: '/recruiter/interviews', icon: Calendar, color: 'text-purple-600 bg-purple-100', desc: 'Manage pipeline' },
    { label: 'View Analytics', href: '/recruiter/analytics', icon: BarChart3, color: 'text-orange-600 bg-orange-100', desc: 'Hiring metrics' },
  ]

  const statusColor: Record<string, 'default' | 'secondary' | 'outline'> = {
    applied: 'secondary',
    screening: 'outline',
    shortlisted: 'default',
    reviewing: 'secondary',
    interviewed: 'default',
    offered: 'default',
    hired: 'default',
    rejected: 'outline',
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            Welcome back, {user?.name?.split(' ')[0] || 'there'} 👋
          </h1>
          <p className="text-muted-foreground">Manage your recruitment pipeline</p>
        </div>
        <Link to="/recruiter/jobs/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Post a Job
          </Button>
        </Link>
      </div>

      {/* Trust score banner */}
      {data?.trust_score && (
        <Card className="border-slate-200">
          <CardContent className="flex items-center gap-4 p-4">
            <Shield className="h-8 w-8 shrink-0" style={{ color: data.trust_score.tier_color }} />
            <div className="flex-1">
              <p className="font-medium">Employer Trust Score: <span style={{ color: data.trust_score.tier_color }}>{data.trust_score.total_score}/100</span></p>
              <p className="text-xs text-muted-foreground">{data.trust_score.tier_label} — Higher scores attract more qualified candidates</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <Briefcase className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.activeJobs}</p>
              <p className="text-xs text-muted-foreground">Active Jobs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalApplications}</p>
              <p className="text-xs text-muted-foreground">Total Applications</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.newApplications}</p>
              <p className="text-xs text-muted-foreground">New Applications</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
              <UserCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.hired}</p>
              <p className="text-xs text-muted-foreground">Hired</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Link key={action.href} to={action.href}>
            <Card className="transition-shadow hover:shadow-md cursor-pointer h-full">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${action.color} shrink-0`}>
                  <action.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{action.label}</span>
                  <p className="text-xs text-muted-foreground truncate">{action.desc}</p>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Recent applications */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Applications</CardTitle>
          <Link to="/recruiter/applications">
            <Button variant="ghost" size="sm" className="gap-1">
              View all
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : !data?.recent_applications?.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No applications yet. Post a job to start receiving applications!
            </div>
          ) : (
            <div className="space-y-3">
              {data.recent_applications.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{app.candidate_name || 'Anonymous'}</p>
                    <p className="text-xs text-muted-foreground">{app.job_title}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={statusColor[app.status] || 'secondary'}>
                      {app.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
