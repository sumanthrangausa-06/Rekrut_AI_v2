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
  User,
  Sparkles,
  Target,
  CheckCircle,
  BookmarkCheck,
} from 'lucide-react'

interface DashboardStats {
  omniscore: { total_score: number; score_tier: string }
  profile_completeness: number
  skills: { total: number; verified: number }
  experience_count: number
  education_count: number
  interviews: { total: number; avg_score: number }
  applications: number
  saved_jobs: number
  assessments: { total: number; passed: number }
}

export function CandidateDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentJobs, setRecentJobs] = useState<Array<{
    id: number; title: string; company: string; location: string; created_at: string
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [statsRes, jobsRes] = await Promise.allSettled([
          apiCall<{ success: boolean; stats: DashboardStats }>('/candidate/dashboard/stats'),
          apiCall<{ jobs: Array<{ id: number; title: string; company: string; location: string; created_at: string }> }>('/jobs?limit=5'),
        ])

        if (statsRes.status === 'fulfilled' && statsRes.value.stats) {
          setStats(statsRes.value.stats)
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
    { label: 'Browse Jobs', href: '/candidate/jobs', icon: Briefcase, color: 'text-blue-600 bg-blue-100', desc: 'AI-matched recommendations' },
    { label: 'My Applications', href: '/candidate/applications', icon: FileText, color: 'text-green-600 bg-green-100', desc: `${stats?.applications || 0} active` },
    { label: 'My Profile', href: '/candidate/profile', icon: User, color: 'text-indigo-600 bg-indigo-100', desc: `${stats?.profile_completeness || 0}% complete` },
    { label: 'Practice Interview', href: '/candidate/interviews', icon: MessageSquare, color: 'text-orange-600 bg-orange-100', desc: 'AI coaching' },
  ]

  const completenessColor = (pct: number) => pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            Welcome back, {user?.name?.split(' ')[0] || 'there'} 👋
          </h1>
          <p className="text-muted-foreground">Here's your job search overview</p>
        </div>
        <Link to="/candidate/jobs">
          <Button className="gap-2">
            <Sparkles className="h-4 w-4" />
            Find AI-Matched Jobs
          </Button>
        </Link>
      </div>

      {/* Profile completeness banner */}
      {stats && stats.profile_completeness < 80 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-4 p-4">
            <Target className="h-8 w-8 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-amber-900">Complete your profile to get better AI matches</p>
              <div className="mt-1 h-2 w-full rounded-full bg-amber-200">
                <div
                  className="h-2 rounded-full bg-amber-600 transition-all"
                  style={{ width: `${stats.profile_completeness}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-amber-700">{stats.profile_completeness}% complete — add skills, experience, and education</p>
            </div>
            <Link to="/candidate/profile">
              <Button size="sm" variant="outline" className="border-amber-600 text-amber-700 hover:bg-amber-100">
                Complete Profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.applications || 0}</p>
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
              <p className="text-2xl font-bold">{stats?.interviews?.total || 0}</p>
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
              <p className="text-2xl font-bold">{stats?.skills?.total || 0}</p>
              <p className="text-xs text-muted-foreground">Skills {stats?.skills?.verified ? `(${stats.skills.verified} verified)` : ''}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
              <Star className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.omniscore?.total_score || '—'}</p>
              <p className="text-xs text-muted-foreground">OmniScore</p>
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
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
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
                    <p className="text-xs text-muted-foreground">{job.company}</p>
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
