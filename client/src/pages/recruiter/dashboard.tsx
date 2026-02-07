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
  CreditCard,
  UserCheck,
  BarChart3,
} from 'lucide-react'

interface DashboardStats {
  activeJobs: number
  totalApplications: number
  pendingInterviews: number
  hiredThisMonth: number
}

export function RecruiterDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    activeJobs: 0,
    totalApplications: 0,
    pendingInterviews: 0,
    hiredThisMonth: 0,
  })
  const [recentApps, setRecentApps] = useState<Array<{
    id: number
    candidate_name: string
    job_title: string
    status: string
    created_at: string
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [jobsRes, appsRes] = await Promise.allSettled([
          apiCall<{ jobs: Array<unknown> }>('/recruiter/jobs'),
          apiCall<{ applications: Array<{ id: number; candidate_name: string; job_title: string; status: string; created_at: string }> }>('/recruiter/applications?limit=5'),
        ])

        if (jobsRes.status === 'fulfilled') {
          setStats(prev => ({ ...prev, activeJobs: jobsRes.value.jobs?.length || 0 }))
        }
        if (appsRes.status === 'fulfilled') {
          const apps = appsRes.value.applications || []
          setRecentApps(apps.slice(0, 5))
          setStats(prev => ({ ...prev, totalApplications: apps.length }))
        }
      } catch {
        // Best-effort
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [])

  const quickActions = [
    { label: 'Post a Job', href: '/recruiter/jobs/new', icon: Plus, color: 'text-blue-600 bg-blue-100' },
    { label: 'Review Applications', href: '/recruiter/applications', icon: FileText, color: 'text-green-600 bg-green-100' },
    { label: 'Schedule Interview', href: '/recruiter/interviews', icon: Calendar, color: 'text-purple-600 bg-purple-100' },
    { label: 'View Analytics', href: '/recruiter/analytics', icon: BarChart3, color: 'text-orange-600 bg-orange-100' },
  ]

  const statusColor: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
    pending: 'warning',
    reviewing: 'secondary',
    shortlisted: 'default',
    interview: 'default',
    offered: 'success',
    hired: 'success',
    rejected: 'destructive',
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            Welcome back, {user?.name?.split(' ')[0] || 'there'}
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
              <p className="text-xs text-muted-foreground">Applications</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
              <Calendar className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.pendingInterviews}</p>
              <p className="text-xs text-muted-foreground">Pending Interviews</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
              <UserCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.hiredThisMonth}</p>
              <p className="text-xs text-muted-foreground">Hired This Month</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Link key={action.href} to={action.href}>
            <Card className="transition-shadow hover:shadow-md cursor-pointer">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${action.color}`}>
                  <action.icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">{action.label}</span>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
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
          ) : recentApps.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No applications yet. Post a job to start receiving applications!
            </div>
          ) : (
            <div className="space-y-3">
              {recentApps.map((app) => (
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
                    <Link to={`/recruiter/applications/${app.id}`}>
                      <Button variant="ghost" size="sm">
                        Review
                      </Button>
                    </Link>
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
