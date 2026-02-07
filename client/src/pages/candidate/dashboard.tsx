import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Briefcase,
  FileText,
  Star,
  GraduationCap,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  Clock,
} from 'lucide-react'

interface DashboardStats {
  applications: number
  interviews: number
  assessments: number
  omniscore: number | null
}

export function CandidateDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    applications: 0,
    interviews: 0,
    assessments: 0,
    omniscore: null,
  })
  const [recentJobs, setRecentJobs] = useState<Array<{
    id: number
    title: string
    company_name: string
    location: string
    created_at: string
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [appsRes, jobsRes] = await Promise.allSettled([
          apiCall<{ applications: Array<unknown> }>('/candidate/applications'),
          apiCall<{ jobs: Array<{ id: number; title: string; company_name: string; location: string; created_at: string }> }>('/jobs?limit=5'),
        ])

        if (appsRes.status === 'fulfilled') {
          setStats(prev => ({ ...prev, applications: appsRes.value.applications?.length || 0 }))
        }
        if (jobsRes.status === 'fulfilled') {
          setRecentJobs(jobsRes.value.jobs?.slice(0, 5) || [])
        }
      } catch {
        // Dashboard data is best-effort
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [])

  const quickActions = [
    { label: 'Browse Jobs', href: '/candidate/jobs', icon: Briefcase, color: 'text-blue-600 bg-blue-100' },
    { label: 'My Applications', href: '/candidate/applications', icon: FileText, color: 'text-green-600 bg-green-100' },
    { label: 'Take Assessment', href: '/candidate/assessments', icon: GraduationCap, color: 'text-purple-600 bg-purple-100' },
    { label: 'Practice Interview', href: '/candidate/interviews', icon: MessageSquare, color: 'text-orange-600 bg-orange-100' },
  ]

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="font-heading text-2xl font-bold">
          Welcome back, {user?.name?.split(' ')[0] || 'there'}
        </h1>
        <p className="text-muted-foreground">Here's your job search overview</p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.applications}</p>
              <p className="text-xs text-muted-foreground">Applications</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
              <MessageSquare className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.interviews}</p>
              <p className="text-xs text-muted-foreground">Interviews</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
              <GraduationCap className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.assessments}</p>
              <p className="text-xs text-muted-foreground">Assessments</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
              <Star className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.omniscore ?? '—'}</p>
              <p className="text-xs text-muted-foreground">OmniScore</p>
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

      {/* Recent jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Job Openings</CardTitle>
          <Link to="/candidate/jobs">
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
          ) : recentJobs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Briefcase className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No jobs posted yet. Check back soon!
            </div>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{job.title}</p>
                    <p className="text-xs text-muted-foreground">{job.company_name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.location && (
                      <Badge variant="secondary" className="text-xs">
                        {job.location}
                      </Badge>
                    )}
                    <Link to={`/candidate/jobs/${job.id}`}>
                      <Button variant="ghost" size="sm">
                        View
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
