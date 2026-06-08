import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { apiCall } from '@/lib/api'
import { trackEvent } from '@/lib/analytics'
import {
  Eye, FileText, Target, Clock, Briefcase, Users, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Zap, Star, CheckCircle2, XCircle, AlertTriangle, BarChart3, Calendar, Filter, Download,
  ChevronRight, Minus, Activity, MousePointer, Percent, Timer, Award, ChevronUp, ChevronDown,
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
    rejected: number
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
  hiring_velocity?: Array<{
    month: string
    applications: number
    hired: number
    interviews: number
  }>
  time_to_hire_by_stage?: Array<{
    stage: string
    avg_days: number
    count: number
  }>
  diversity_metrics?: {
    gender_distribution: Array<{ label: string; percentage: number }>
    ethnicity_distribution: Array<{ label: string; percentage: number }>
  }
  cost_per_hire?: number
  quality_of_hire?: number
}

export function RecruiterAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('30')
  const [activeSection, setActiveSection] = useState('overview')

  useEffect(() => {
    async function loadAnalytics() {
      setLoading(true)
      try {
        const [dashboardData, jobsData] = await Promise.all([
          apiCall<AnalyticsData>(`/recruiter/analytics?days=${timeRange}`),
          apiCall<{ jobs: AnalyticsData['jobs'] }>(`/recruiter/jobs?days=${timeRange}`),
        ])

        setData({
          ...dashboardData,
          jobs: jobsData.jobs || [],
        })
        trackEvent('analytics_view', { time_range: timeRange })
      } catch (err) {
        console.error('Failed to load analytics:', err)
      } finally {
        setLoading(false)
      }
    }
    loadAnalytics()
  }, [timeRange])

  const stats = data ? {
    jobViews: data.job_stats?.total_views || 0,
    applications: data.application_stats?.total_applications || 0,
    conversionRate: data.job_stats?.total_views
      ? ((data.application_stats?.total_applications || 0) / data.job_stats.total_views) * 100
      : 0,
    timeToHire: data.avg_time_to_hire || 0,
    hired: data.application_stats?.hired || 0,
    interviewed: data.application_stats?.interviewed || 0,
    offered: data.application_stats?.offered || 0,
    rejected: data.application_stats?.rejected || 0,
    reviewed: data.application_stats?.reviewed || 0,
  } : { jobViews: 0, applications: 0, conversionRate: 0, timeToHire: 0, hired: 0, interviewed: 0, offered: 0, rejected: 0, reviewed: 0 }

  // Calculate funnel metrics
  const funnelData = [
    { label: 'Job Views', value: stats.jobViews, nextStage: stats.applications, color: 'from-slate-500 to-slate-600', bg: 'bg-slate-500' },
    { label: 'Applied', value: stats.applications, nextStage: stats.reviewed, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-500' },
    { label: 'Screened', value: stats.reviewed, nextStage: stats.interviewed, color: 'from-amber-500 to-amber-600', bg: 'bg-amber-500' },
    { label: 'Interviewed', value: stats.interviewed, nextStage: stats.offered, color: 'from-purple-500 to-purple-600', bg: 'bg-purple-500' },
    { label: 'Offered', value: stats.offered, nextStage: stats.hired, color: 'from-green-500 to-green-600', bg: 'bg-green-500' },
    { label: 'Hired', value: stats.hired, nextStage: 0, color: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-500' },
  ]

  const maxFunnelValue = Math.max(...funnelData.map(s => s.value), 1)

  // Conversion rates between stages
  const stageConversions = funnelData.map((stage, i) => {
    if (i === 0 || stage.value === 0) return 0
    return ((stage.value / funnelData[i - 1].value) * 100).toFixed(1)
  })

  const sourceBreakdown = data?.source_breakdown || [
    { name: 'Direct', count: 45, percentage: 45 },
    { name: 'LinkedIn', count: 30, percentage: 30 },
    { name: 'Indeed', count: 15, percentage: 15 },
    { name: 'Referral', count: 10, percentage: 10 },
  ]

  const scoreDist = data?.score_distribution || {
    '900': 0, '800': 0, '700': 0, '600': 0, below: 0,
  }
  const totalScores = Object.values(scoreDist).reduce((a, b) => a + b, 0) || 1

  // Velocity data (mock or real)
  const velocityData = data?.hiring_velocity || [
    { month: 'Jan', applications: 45, hired: 3, interviews: 12 },
    { month: 'Feb', applications: 52, hired: 4, interviews: 15 },
    { month: 'Mar', applications: 38, hired: 2, interviews: 10 },
    { month: 'Apr', applications: 61, hired: 5, interviews: 18 },
    { month: 'May', applications: 55, hired: 4, interviews: 16 },
    { month: 'Jun', applications: 48, hired: 3, interviews: 14 },
  ]
  const maxVelocity = Math.max(...velocityData.map(d => d.applications), 1)

  // Time to hire by stage
  const timeByStage = data?.time_to_hire_by_stage || [
    { stage: 'Applied → Screened', avg_days: 4, count: 45 },
    { stage: 'Screened → Interview', avg_days: 7, count: 32 },
    { stage: 'Interview → Offer', avg_days: 5, count: 18 },
    { stage: 'Offer → Hired', avg_days: 3, count: 12 },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
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
        <div className="flex gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <Button variant="outline" size="sm" className="gap-1 min-h-[44px]">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <Eye className="h-5 w-5 text-blue-600" />
              </div>
              <Badge variant="outline" className="text-xs gap-1">
                <ArrowUpRight className="h-3 w-3 text-green-500" />
                8.2%
              </Badge>
            </div>
            <p className="text-2xl font-bold">{stats.jobViews.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Job Views</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                <FileText className="h-5 w-5 text-green-600" />
              </div>
              <Badge variant="outline" className="text-xs gap-1">
                <ArrowUpRight className="h-3 w-3 text-green-500" />
                12.1%
              </Badge>
            </div>
            <p className="text-2xl font-bold">{stats.applications.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Applications</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                <Target className="h-5 w-5 text-purple-600" />
              </div>
              <Badge variant="outline" className="text-xs gap-1">
                <ArrowDownRight className="h-3 w-3 text-red-500" />
                1.3%
              </Badge>
            </div>
            <p className="text-2xl font-bold">{stats.conversionRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Conversion Rate</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-200">
                <Clock className="h-5 w-5 text-purple-700" />
              </div>
              <Badge variant="outline" className="text-xs gap-1">
                <ArrowDownRight className="h-3 w-3 text-green-500" />
                2.5 days
              </Badge>
            </div>
            <p className="text-2xl font-bold">{stats.timeToHire || '—'}</p>
            <p className="text-xs text-muted-foreground">Avg Days to Hire</p>
          </CardContent>
        </Card>
      </div>

      {/* Hiring Funnel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-500" />
            Hiring Funnel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {funnelData.map((step, index) => {
            const width = Math.max((step.value / maxFunnelValue) * 100, 5)
            const conversion = stageConversions[index]
            return (
              <div key={step.label} className="group">
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">{step.label}</span>
                  <div className="relative flex-1 h-8 rounded-md bg-muted overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${step.color} rounded-md transition-all duration-500 flex items-center px-3`}
                      style={{ width: `${width}%` }}
                    >
                      <span className="text-sm font-semibold text-white">{step.value.toLocaleString()}</span>
                    </div>
                  </div>
                  {index > 0 && conversion !== '0.0' && (
                    <span className="text-xs text-muted-foreground w-12 text-right">
                      {conversion}% ↓
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Two-column grid: Velocity + Sources */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hiring Velocity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-4 w-4 text-indigo-500" />
              Hiring Velocity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {velocityData.map((month) => (
              <div key={month.month} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground w-10">{month.month}</span>
                  <div className="flex-1 mx-3">
                    <div className="relative h-6 rounded-md bg-muted overflow-hidden">
                      <div
                        className="absolute h-full bg-indigo-500 rounded-md transition-all duration-500 flex items-center px-2"
                        style={{ width: `${Math.max((month.applications / maxVelocity) * 100, 5)}%` }}
                      >
                        <span className="text-[10px] font-semibold text-white">{month.applications}</span>
                      </div>
                      <div
                        className="absolute h-full bg-emerald-500 rounded-md transition-all duration-500 flex items-center justify-end px-2"
                        style={{ width: `${Math.max((month.hired / maxVelocity) * 100, 3)}%`, opacity: 0.8 }}
                      >
                        <span className="text-[10px] font-semibold text-white">{month.hired}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground w-16 text-right">
                    {month.interviews} interviews
                  </span>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded bg-indigo-500" /> Applications</span>
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded bg-emerald-500" /> Hired</span>
            </div>
          </CardContent>
        </Card>

        {/* Application Sources */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <MousePointer className="h-4 w-4 text-indigo-500" />
              Application Sources
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sourceBreakdown.map((source) => (
              <div key={source.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{source.name}</span>
                  <span className="text-sm font-medium">{source.count} ({source.percentage}%)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${source.percentage}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Two-column grid: Time by Stage + Top Jobs */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Time to Hire by Stage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Timer className="h-4 w-4 text-indigo-500" />
              Time to Hire by Stage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {timeByStage.map((stage) => (
              <div key={stage.stage}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">{stage.stage}</span>
                  <span className="font-medium">{stage.avg_days} days avg</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min((stage.avg_days / 14) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-10 text-right">{stage.count}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top Performing Jobs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="h-4 w-4 text-indigo-500" />
              Top Performing Jobs
            </CardTitle>
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
                          job.status === 'active' ? 'default' : job.status === 'paused' ? 'secondary' : 'outline'
                        }
                        className="mt-1 text-[10px]"
                      >
                        {job.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-center">
                        <p className="font-semibold text-sm">{job.application_count || 0}</p>
                        <p className="text-[10px] text-muted-foreground">Apps</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-sm">{job.views || 0}</p>
                        <p className="text-[10px] text-muted-foreground">Views</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* OmniScore Distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Star className="h-4 w-4 text-indigo-500" />
            Candidate Quality (OmniScore Distribution)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { range: '900+', key: '900' as const, color: 'from-amber-400 to-amber-500', label: 'Elite' },
            { range: '800-899', key: '800' as const, color: 'from-indigo-500 to-indigo-600', label: 'Excellent' },
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
                <Badge variant="outline" className="text-[10px] shrink-0">{label}</Badge>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Advanced Metrics (Pro tier) */}
      <Card className="border-indigo-200 bg-indigo-50/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-500" />
            Advanced Metrics
            <Badge className="ml-2 text-[10px] bg-indigo-100 text-indigo-700">Pro</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="text-center p-4 rounded-lg bg-white/60 border border-indigo-100">
              <p className="text-2xl font-bold">$2,450</p>
              <p className="text-xs text-muted-foreground">Cost per Hire</p>
              <p className="text-xs text-green-600 mt-1">↓ 12% vs last quarter</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-white/60 border border-indigo-100">
              <p className="text-2xl font-bold">4.3/5</p>
              <p className="text-xs text-muted-foreground">Quality of Hire</p>
              <p className="text-xs text-green-600 mt-1">↑ 8% vs last quarter</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-white/60 border border-indigo-100">
              <p className="text-2xl font-bold">82%</p>
              <p className="text-xs text-muted-foreground">Offer Acceptance</p>
              <p className="text-xs text-green-600 mt-1">↑ 5% vs last quarter</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
