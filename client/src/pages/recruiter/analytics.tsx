import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiCall } from '@/lib/api'
import {
  Eye,
  FileText,
  Target,
  Clock,
  Briefcase,
} from 'lucide-react'

interface AnalyticsData {
  job_stats: {
    total_views: number
    active_jobs: number
    paused_jobs: number
    closed_jobs: number
  }
  application_stats: {
    total_applications: number
    new_applications: number
    reviewed: number
    interviewed: number
    offered: number
    hired: number
  }
  avg_time_to_hire: number | null
  jobs: Array<{
    id: number
    title: string
    status: string
    application_count: number
    views: number
  }>
  score_distribution?: {
    '900': number
    '800': number
    '700': number
    '600': number
    below: number
  }
  source_breakdown?: Array<{
    name: string
    count: number
    percentage: number
  }>
}

export function RecruiterAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('30')

  useEffect(() => {
    async function loadAnalytics() {
      setLoading(true)
      try {
        // Fetch dashboard data and jobs in parallel
        const [dashboardData, jobsData] = await Promise.all([
          apiCall<AnalyticsData>('/recruiter/dashboard'),
          apiCall<{ jobs: AnalyticsData['jobs'] }>('/recruiter/jobs'),
        ])

        setData({
          ...dashboardData,
          jobs: jobsData.jobs || [],
        })
      } catch (err) {
        console.error('Failed to load analytics:', err)
      } finally {
        setLoading(false)
      }
    }
    loadAnalytics()
  }, [timeRange])

  // Calculate metrics
  const stats = data ? {
    jobViews: data.job_stats?.total_views || 0,
    applications: data.application_stats?.total_applications || 0,
    conversionRate: data.job_stats?.total_views
      ? ((data.application_stats?.total_applications || 0) / data.job_stats.total_views) * 100
      : 0,
    timeToHire: data.avg_time_to_hire || 0,
  } : { jobViews: 0, applications: 0, conversionRate: 0, timeToHire: 0 }

  // Funnel steps
  const funnelSteps = [
    { label: 'Job Views', value: data?.job_stats?.total_views || 0, color: 'bg-slate-500' },
    { label: 'Applied', value: data?.application_stats?.total_applications || 0, color: 'bg-purple-500' },
    { label: 'Screened', value: data?.application_stats?.reviewed || 0, color: 'bg-purple-600' },
    { label: 'Interviewed', value: data?.application_stats?.interviewed || 0, color: 'bg-purple-700' },
    { label: 'Offered', value: data?.application_stats?.offered || 0, color: 'bg-emerald-500' },
    { label: 'Hired', value: data?.application_stats?.hired || 0, color: 'bg-emerald-600' },
  ]

  const maxFunnelValue = Math.max(...funnelSteps.map(s => s.value), 1)

  // Default source breakdown (would come from API in production)
  const sourceBreakdown = data?.source_breakdown || [
    { name: 'Direct', count: 45, percentage: 45 },
    { name: 'LinkedIn', count: 30, percentage: 30 },
    { name: 'Indeed', count: 15, percentage: 15 },
    { name: 'Referral', count: 10, percentage: 10 },
  ]

  // Score distribution with defaults
  const scoreDist = data?.score_distribution || {
    '900': 0,
    '800': 0,
    '700': 0,
    '600': 0,
    below: 0,
  }
  const totalScores = Object.values(scoreDist).reduce((a, b) => a + b, 0) || 1

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Hiring Analytics</h1>
          <p className="text-muted-foreground">Track your recruitment performance and insights</p>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-[180px]"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 shrink-0">
              <Eye className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{stats.jobViews.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Job Views</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 shrink-0">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{stats.applications.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Applications</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 shrink-0">
              <Target className="h-5 w-5 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{stats.conversionRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Conversion Rate</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-200 shrink-0">
              <Clock className="h-5 w-5 text-purple-700" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold">{stats.timeToHire || '—'}</p>
              <p className="text-xs text-muted-foreground">Avg Days to Hire</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hiring Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Hiring Funnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {funnelSteps.map((step, index) => {
            const width = Math.max((step.value / maxFunnelValue) * 100, 5)
            return (
              <div key={step.label} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-muted-foreground">{step.label}</span>
                <div className="relative flex-1 h-8 rounded-md bg-muted overflow-hidden">
                  <div
                    className={`h-full ${step.color} rounded-md transition-all duration-500 flex items-center px-3`}
                    style={{ width: `${width}%` }}
                  >
                    <span className="text-sm font-semibold text-white">{step.value}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Two-column grid for jobs and sources */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Performing Jobs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Performing Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.jobs?.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Briefcase className="mx-auto mb-2 h-8 w-8 opacity-50" />
                No job data yet. Post a job to see performance metrics.
              </div>
            ) : (
              <div className="space-y-3">
                {data.jobs.slice(0, 5).map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">{job.title}</p>
                      <Badge
                        variant={
                          job.status === 'active'
                            ? 'default'
                            : job.status === 'paused'
                            ? 'secondary'
                            : 'outline'
                        }
                        className="mt-1"
                      >
                        {job.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-center">
                        <p className="font-semibold">{job.application_count || 0}</p>
                        <p className="text-xs text-muted-foreground">Apps</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold">{job.views || 0}</p>
                        <p className="text-xs text-muted-foreground">Views</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Application Sources */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Application Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sourceBreakdown.map((source) => (
              <div key={source.name} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-muted-foreground">{source.name}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500"
                    style={{ width: `${source.percentage}%` }}
                  />
                </div>
                <span className="w-12 text-right text-sm font-medium">{source.percentage}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* OmniScore Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Candidate Quality (OmniScore Distribution)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { range: '900+', key: '900' as const, color: 'from-amber-400 to-amber-500', label: 'Elite' },
            { range: '800-899', key: '800' as const, color: 'from-purple-500 to-purple-600', label: 'Excellent' },
            { range: '700-799', key: '700' as const, color: 'from-emerald-500 to-emerald-600', label: 'Good' },
            { range: '600-699', key: '600' as const, color: 'from-blue-500 to-blue-600', label: 'Average' },
            { range: '<600', key: 'below' as const, color: 'from-slate-400 to-slate-500', label: 'Below' },
          ].map(({ range, key, color, label }) => {
            const count = scoreDist[key] || 0
            const percentage = (count / totalScores) * 100
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-muted-foreground">{range}</span>
                <div className="flex-1 h-6 rounded-md bg-muted overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${color} rounded-md transition-all duration-500 flex items-center justify-end px-2`}
                    style={{ width: `${Math.max(percentage, 2)}%` }}
                  >
                    {percentage > 10 && (
                      <span className="text-xs font-medium text-white">{percentage.toFixed(0)}%</span>
                    )}
                  </div>
                </div>
                <span className="w-12 text-right text-sm font-semibold">{count}</span>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
