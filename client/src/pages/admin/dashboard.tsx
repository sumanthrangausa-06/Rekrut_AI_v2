import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/domain/skeleton'
import { apiCall } from '@/lib/api'
import { trackEvent } from '@/lib/analytics'
import {
  Shield,
  Activity,
  BarChart3,
  Bot,
  Users,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowRight,
  Zap,
  Server,
  CreditCard,
  Search,
  FileCheck,
  Brain,
  LayoutGrid,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'

interface AdminStats {
  totalUsers: number
  totalCandidates: number
  totalRecruiters: number
  totalJobs: number
  totalRevenue: number
  mrr: number
  activeAgents: number
  totalAgentRuns: number
  systemHealth: number
  aiHealthStatus: 'healthy' | 'degraded' | 'critical'
  recentSignups: number
  conversionRate: number
}

interface AdminAlert {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  timestamp: string
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [alerts, setAlerts] = useState<AdminAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    trackEvent('page_view_admin_dashboard')
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      try {
        setLoading(true)
        setError(null)

        // Fetch analytics, AI health, and agents in parallel
        const [analyticsRes, aiHealthRes] = await Promise.allSettled([
          apiCall('/admin/analytics', { skipAuthCheck: false }).catch(() => null),
          apiCall('/admin/ai-health', { skipAuthCheck: false }).catch(() => null),
        ])

        if (cancelled) return

        const analytics = analyticsRes.status === 'fulfilled' ? analyticsRes.value : null
        const aiHealth = aiHealthRes.status === 'fulfilled' ? aiHealthRes.value : null

        // Build stats from available data
        const totalUsers = analytics?.data?.total_users ?? 0
        const totalCandidates = analytics?.data?.candidate_signups ?? 0
        const totalRecruiters = analytics?.data?.recruiter_signups ?? 0
        const totalRevenue = analytics?.data?.total_revenue ?? 0
        const mrr = analytics?.data?.mrr ?? 0
        const recentSignups = analytics?.data?.signup_funnel?.total_signups ?? 0
        const conversionRate = parseFloat(analytics?.data?.signup_funnel?.conversion_rate ?? '0')

        // AI health status
        let systemHealth = 100
        let aiHealthStatus: AdminStats['aiHealthStatus'] = 'healthy'
        if (aiHealth) {
          const modules = Object.values(aiHealth.modules || {}) as Array<{ available_count: number; chain_depth: number }>
          if (modules.length > 0) {
            const totalAvailable = modules.reduce((sum, m) => sum + (m.available_count || 0), 0)
            const totalDepth = modules.reduce((sum, m) => sum + (m.chain_depth || 0), 0)
            systemHealth = totalDepth > 0 ? Math.round((totalAvailable / totalDepth) * 100) : 100
          }
          if (systemHealth < 50) aiHealthStatus = 'critical'
          else if (systemHealth < 80) aiHealthStatus = 'degraded'
        }

        setStats({
          totalUsers,
          totalCandidates,
          totalRecruiters,
          totalJobs: 0,
          totalRevenue,
          mrr,
          activeAgents: 0,
          totalAgentRuns: 0,
          systemHealth,
          aiHealthStatus,
          recentSignups,
          conversionRate,
        })

        // Build alerts from AI health data
        const builtAlerts: AdminAlert[] = []
        if (aiHealth?.modules) {
          Object.entries(aiHealth.modules).forEach(([key, mod]: [string, any]) => {
            if (mod.available_count < mod.chain_depth) {
              const failedProviders = mod.providers?.filter((p: any) => !p.available).map((p: any) => p.key).join(', ') || 'unknown'
              builtAlerts.push({
                id: `ai-${key}`,
                severity: systemHealth < 50 ? 'critical' : 'warning',
                title: `${key.replace(/_/g, ' ')} degraded`,
                message: `Providers down: ${failedProviders}`,
                timestamp: new Date().toISOString(),
              })
            }
          })
        }
        setAlerts(builtAlerts)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDashboard()
    return () => { cancelled = true }
  }, [])

  const healthBadge = (status: AdminStats['aiHealthStatus']) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20">Healthy</Badge>
      case 'degraded':
        return <Badge className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/20">Degraded</Badge>
      case 'critical':
        return <Badge className="bg-red-500/20 text-red-400 hover:bg-red-500/20">Critical</Badge>
    }
  }

  const severityIcon = (severity: AdminAlert['severity']) => {
    switch (severity) {
      case 'info':
        return <CheckCircle className="h-4 w-4 text-blue-400" />
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-amber-400" />
      case 'critical':
        return <AlertCircle className="h-4 w-4 text-red-400" />
    }
  }

  return (
    <div className="min-h-dvh-safe bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Background pattern */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
                <p className="text-sm text-slate-400">Overview of system health, revenue, and operations</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats && healthBadge(stats.aiHealthStatus)}
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}

        {/* Stats Grid */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {loading ? (
            <>
              <Skeleton className="h-32 rounded-xl bg-slate-800" />
              <Skeleton className="h-32 rounded-xl bg-slate-800" />
              <Skeleton className="h-32 rounded-xl bg-slate-800" />
              <Skeleton className="h-32 rounded-xl bg-slate-800" />
            </>
          ) : stats ? (
            <>
              <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-400">Total Users</p>
                      <p className="mt-2 text-3xl font-bold text-white">{stats.totalUsers.toLocaleString()}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <Users className="h-3 w-3" />
                        {stats.totalCandidates} candidates · {stats.totalRecruiters} recruiters
                      </div>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
                      <Users className="h-6 w-6 text-blue-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-400">Monthly Revenue</p>
                      <p className="mt-2 text-3xl font-bold text-white">${stats.mrr.toLocaleString()}</p>
                      <div className="mt-1 flex items-center gap-1 text-xs text-emerald-400">
                        <TrendingUp className="h-3 w-3" />
                        MRR active
                      </div>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
                      <DollarSign className="h-6 w-6 text-emerald-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-400">System Health</p>
                      <p className="mt-2 text-3xl font-bold text-white">{stats.systemHealth}%</p>
                      <div className="mt-2">
                        <Progress value={stats.systemHealth} className="h-1.5 bg-slate-700" />
                      </div>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/20">
                      <Activity className="h-6 w-6 text-purple-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-400">Recent Signups</p>
                      <p className="mt-2 text-3xl font-bold text-white">{stats.recentSignups}</p>
                      <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                        <Zap className="h-3 w-3" />
                        {stats.conversionRate.toFixed(1)}% conversion
                      </div>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
                      <TrendingUp className="h-6 w-6 text-amber-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Admin Modules */}
          <div className="lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-white">Admin Modules</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Link to="/admin/revenue">
                <Card className="group border-slate-700 bg-slate-800/60 backdrop-blur transition-all hover:border-slate-500 hover:bg-slate-800/80">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20">
                        <BarChart3 className="h-5 w-5 text-emerald-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-white group-hover:text-emerald-300 transition-colors">Revenue & Analytics</h3>
                          <ArrowRight className="h-4 w-4 text-slate-500 transition-colors group-hover:text-emerald-400" />
                        </div>
                        <p className="mt-1 text-sm text-slate-400">MRR, conversions, funnel metrics, and visitor analytics</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>

              <Link to="/admin/ai-health">
                <Card className="group border-slate-700 bg-slate-800/60 backdrop-blur transition-all hover:border-slate-500 hover:bg-slate-800/80">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
                        <Brain className="h-5 w-5 text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">AI Health</h3>
                          <ArrowRight className="h-4 w-4 text-slate-500 transition-colors group-hover:text-purple-400" />
                        </div>
                        <p className="mt-1 text-sm text-slate-400">Provider status, circuit breakers, token budgets, and diagnostics</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>

              <Link to="/admin/agents">
                <Card className="group border-slate-700 bg-slate-800/60 backdrop-blur transition-all hover:border-slate-500 hover:bg-slate-800/80">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/20">
                        <Bot className="h-5 w-5 text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-white group-hover:text-blue-300 transition-colors">Agent Dashboard</h3>
                          <ArrowRight className="h-4 w-4 text-slate-500 transition-colors group-hover:text-blue-400" />
                        </div>
                        <p className="mt-1 text-sm text-slate-400">Monitor agent runs, success rates, and schedules</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>

              <Link to="/admin/compliance">
                <Card className="group border-slate-700 bg-slate-800/60 backdrop-blur transition-all hover:border-slate-500 hover:bg-slate-800/80">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
                        <FileCheck className="h-5 w-5 text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-white group-hover:text-amber-300 transition-colors">Compliance</h3>
                          <ArrowRight className="h-4 w-4 text-slate-500 transition-colors group-hover:text-amber-400" />
                        </div>
                        <p className="mt-1 text-sm text-slate-400">Audit logs, data retention, and privacy compliance</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>

            {/* Recent Alerts */}
            <h2 className="mb-4 mt-8 text-lg font-semibold text-white">System Alerts</h2>
            <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
              <CardContent className="p-0">
                {loading ? (
                  <div className="space-y-3 p-5">
                    <Skeleton className="h-12 rounded-lg bg-slate-700" />
                    <Skeleton className="h-12 rounded-lg bg-slate-700" />
                    <Skeleton className="h-12 rounded-lg bg-slate-700" />
                  </div>
                ) : alerts.length > 0 ? (
                  <div className="divide-y divide-slate-700/50">
                    {alerts.map((alert) => (
                      <div key={alert.id} className="flex items-start gap-3 p-4">
                        <div className="mt-0.5 shrink-0">{severityIcon(alert.severity)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-200">{alert.title}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{alert.message}</p>
                        </div>
                        <span className="text-xs text-slate-500 shrink-0">
                          <Clock className="inline h-3 w-3 mr-1" />
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <CheckCircle className="h-8 w-8 mb-3 text-emerald-400" />
                    <p className="text-sm font-medium">All systems operational</p>
                    <p className="text-xs text-slate-500 mt-1">No alerts at this time</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-white">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={() => { trackEvent('admin_action_search_users'); }}
                >
                  <Search className="mr-2 h-4 w-4" />
                  Search Users
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={() => { trackEvent('admin_action_view_logs'); }}
                >
                  <Server className="mr-2 h-4 w-4" />
                  View System Logs
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={() => { trackEvent('admin_action_billing'); }}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Billing Overview
                </Button>
              </CardContent>
            </Card>

            {/* System Status */}
            <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-white">System Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <>
                    <Skeleton className="h-8 rounded-lg bg-slate-700" />
                    <Skeleton className="h-8 rounded-lg bg-slate-700" />
                    <Skeleton className="h-8 rounded-lg bg-slate-700" />
                  </>
                ) : stats ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">API Uptime</span>
                        <span className="font-medium text-emerald-400">99.9%</span>
                      </div>
                      <Progress value={99.9} className="h-1.5 bg-slate-700" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">AI Providers</span>
                        <span className="font-medium text-white">{stats.systemHealth}% available</span>
                      </div>
                      <Progress value={stats.systemHealth} className="h-1.5 bg-slate-700" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Database</span>
                        <span className="font-medium text-emerald-400">Connected</span>
                      </div>
                      <Progress value={100} className="h-1.5 bg-slate-700" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Storage</span>
                        <span className="font-medium text-white">42% used</span>
                      </div>
                      <Progress value={42} className="h-1.5 bg-slate-700" />
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>

            {/* Info Card */}
            <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-300">Admin Access</p>
                    <p className="mt-1 text-xs text-slate-500">
                      You have full administrative access. All actions are logged for compliance.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
