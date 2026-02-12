import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Cpu,
  Eye,
  Mic,
  Volume2,
  Database,
  ArrowUpDown,
  Shield,
  Zap,
  Clock,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Brain,
  Users,
  HardDrive,
  Timer,
  Gauge,
  Search,
  Filter,
  TrendingUp,
  AlertCircle,
  Server,
  Globe,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderInfo {
  key: string
  available: boolean
  circuitOpen: boolean
  failures: { count: number; lastFailure: string; error: string; status?: number } | null
}

interface ModalityInfo {
  active: string
  chain_depth: number
  providers: ProviderInfo[]
}

interface ModuleChainInfo {
  variant: string
  chain_depth: number
  available_count: number
  providers: string[]
}

interface TokenBudgetData {
  dailyBudget: number
  tokensUsed: number
  tokensRemaining: number
  percentUsed: number
  budgetExhausted: boolean
  exhaustedAt: string | null
  currentDay: string
  resetAt: string
  breakdown: Record<string, number>
  providerBreakdown: Record<string, number>
  history: Array<{
    date: string
    tokensUsed: number
    budget: number
    breakdown: Record<string, number>
    providerBreakdown?: Record<string, number>
  }>
  routingStatus: string
}

interface HealthData {
  status: string
  timestamp: string
  nim_configured: boolean
  total_models_registered: number
  stats: {
    totalCalls: number
    totalFailovers: number
    providerCalls: Record<string, number>
  }
  token_budget?: TokenBudgetData
  modalities: Record<string, ModalityInfo>
  module_chains: Record<string, Record<string, ModuleChainInfo>>
  recent_logs: Array<{
    timestamp?: string
    time?: string
    event: string
    modality: string
    from: string
    to: string
    reason?: string
    provider?: string
    error?: string
  }>
}

interface MetricsData {
  timestamp: string
  server: {
    uptime: number
    uptimeFormatted: string
    activeConnections: number
    cpu: { usage: number; cores: number; model: string }
    memory: {
      heapUsedMB: number; rssMB: number
      systemUsedPct: string
    }
    platform: { node: string; os: string }
  }
  database: {
    sizeMB: string
    activeConnections: number
    poolTotal: number
    poolIdle: number
    poolWaiting: number
    poolUtilization: string
    totalQueries: number
    slowQueries: number
    queriesPerMinute: number
    tables: Array<{ name: string; rows: number }>
  }
  api: {
    hourly: { requests: number; errors: number; errorRate: string }
    cumulative: { totalRequests: number; totalErrors: number; errorRate: string }
    latency: { p50: number; p95: number; p99: number; avg: number }
    requestsPerMinute: number
    topEndpoints: Array<{ path: string; total: number; errors: number; errorRate: string; p50: number; p95: number; p99: number }>
  }
  users: {
    total: number; candidates: number; recruiters: number; activeToday: number
  }
  interviews: {
    total: number; completed: number; active: number; today: number
    abandoned: number; practice: number; mock: number
  }
  activeSessions: number
}

interface ActivityEvent {
  id: number
  event_type: string
  category: string
  severity: string
  user_id: number | null
  user_email: string | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODALITY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  llm: { label: 'LLM', icon: Brain, color: 'blue' },
  vision: { label: 'Vision', icon: Eye, color: 'purple' },
  tts: { label: 'Text-to-Speech', icon: Volume2, color: 'green' },
  asr: { label: 'Speech-to-Text', icon: Mic, color: 'orange' },
  embedding: { label: 'Embedding', icon: Database, color: 'cyan' },
  reranking: { label: 'Reranking', icon: ArrowUpDown, color: 'pink' },
  safety: { label: 'Safety', icon: Shield, color: 'red' },
}

const MODULE_META: Record<string, { label: string; description: string }> = {
  'mock-interview': { label: 'Mock Interview', description: 'AI-powered interview practice' },
  'coaching': { label: 'AI Coaching', description: 'Career coaching assistant' },
  'resume-parsing': { label: 'Resume Parsing', description: 'OCR + extraction pipeline' },
  'job-matching': { label: 'Job Matching', description: 'Semantic match & ranking' },
  'onboarding': { label: 'Onboarding', description: 'New hire workflows' },
  'assessments': { label: 'Assessments', description: 'Skill evaluation engine' },
  'offer-management': { label: 'Offer Management', description: 'Offer letter generation' },
  'payroll': { label: 'Payroll', description: 'Compensation calculations' },
  'scheduling': { label: 'Scheduling', description: 'Interview scheduling' },
  'profile': { label: 'Profile', description: 'Profile analysis & search' },
  'safety': { label: 'Safety', description: 'Content moderation' },
}

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; dot: string; light: string }> = {
  blue:   { bg: 'bg-blue-500',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-400',   light: 'bg-blue-50' },
  purple: { bg: 'bg-purple-500', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-400', light: 'bg-purple-50' },
  green:  { bg: 'bg-green-500',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-400',  light: 'bg-green-50' },
  orange: { bg: 'bg-orange-500', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-400', light: 'bg-orange-50' },
  cyan:   { bg: 'bg-cyan-500',   text: 'text-cyan-700',   border: 'border-cyan-200',   dot: 'bg-cyan-400',   light: 'bg-cyan-50' },
  pink:   { bg: 'bg-pink-500',   text: 'text-pink-700',   border: 'border-pink-200',   dot: 'bg-pink-400',   light: 'bg-pink-50' },
  red:    { bg: 'bg-red-500',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-400',    light: 'bg-red-50' },
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  user:       { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  ai:         { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  auth:       { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  system:     { bg: 'bg-slate-50',   text: 'text-slate-700',   border: 'border-slate-200' },
  recruiter:  { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200' },
  interview:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200' },
  onboarding: { bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200' },
  error:      { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200' },
}

type TabId = 'overview' | 'ai' | 'activity'

function formatProviderName(key: string): string {
  return key
    .replace(/^nim_/, 'NIM ')
    .replace(/^openai_?/, 'OpenAI ')
    .replace('anthropic', 'Anthropic')
    .replace('browser_tts', 'Browser TTS')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

function formatModuleName(key: string): string {
  return MODULE_META[key]?.label || key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getOverallStatus(data: HealthData): 'operational' | 'degraded' | 'down' {
  const modalities = Object.values(data.modalities)
  const allDown = modalities.every(m => m.providers.every(p => !p.available || p.circuitOpen))
  const someDown = modalities.some(m => m.providers.some(p => !p.available || p.circuitOpen))
  if (allDown) return 'down'
  if (someDown) return 'degraded'
  return 'operational'
}

function getModalityStatus(modality: ModalityInfo): 'healthy' | 'degraded' | 'down' {
  const available = modality.providers.filter(p => p.available && !p.circuitOpen)
  if (available.length === 0) return 'down'
  if (available.length < modality.providers.length) return 'degraded'
  return 'healthy'
}

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ─── Token Budget Panel ─────────────────────────────────────────────────────

function TokenBudgetPanel({ budget }: { budget: TokenBudgetData }) {
  const pct = Math.min(100, budget.percentUsed)
  const barColor = budget.budgetExhausted
    ? 'bg-red-500'
    : pct > 80 ? 'bg-amber-500' : pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500'

  const breakdownEntries = Object.entries(budget.breakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])

  return (
    <Card className={cn(
      'relative overflow-hidden',
      budget.budgetExhausted && 'border-red-300 ring-2 ring-red-200',
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">OpenAI Token Budget</CardTitle>
          </div>
          {budget.budgetExhausted ? (
            <Badge variant="destructive" className="animate-pulse">
              BUDGET EXHAUSTED — NIM ACTIVE
            </Badge>
          ) : (
            <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
              OpenAI Primary
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-2xl font-bold tabular-nums">
              {budget.tokensUsed.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">
              / {budget.dailyBudget.toLocaleString()} tokens
            </span>
          </div>
          <div className="h-4 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', barColor)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-muted-foreground">
              {budget.tokensRemaining.toLocaleString()} remaining
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {pct.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Provider breakdown */}
        {budget.providerBreakdown && Object.values(budget.providerBreakdown).some(v => v > 0) && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">By Provider</p>
            <div className="flex gap-2">
              {Object.entries(budget.providerBreakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([prov, tokens]) => (
                <div key={prov} className={cn(
                  'flex-1 rounded-lg px-3 py-2 text-center',
                  prov === 'openai' ? 'bg-emerald-50 border border-emerald-200' :
                  prov === 'nim' ? 'bg-purple-50 border border-purple-200' : 'bg-muted/50',
                )}>
                  <p className={cn(
                    'text-xs font-semibold uppercase',
                    prov === 'openai' ? 'text-emerald-700' : prov === 'nim' ? 'text-purple-700' : 'text-muted-foreground',
                  )}>{prov}</p>
                  <p className="text-lg font-bold tabular-nums">{tokens.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modality breakdown */}
        {breakdownEntries.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">By Modality</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {breakdownEntries.map(([mod, tokens]) => (
                <div key={mod} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
                  <span className="text-xs font-medium capitalize">{mod}</span>
                  <span className="text-xs text-muted-foreground ml-auto tabular-nums">{tokens.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reset info */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
          <span>Day: {budget.currentDay}</span>
          <span>Resets: {new Date(budget.resetAt).toLocaleTimeString()}</span>
          {budget.exhaustedAt && (
            <span className="text-red-600 font-medium">
              Exhausted at: {new Date(budget.exhaustedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* History sparkline */}
        {budget.history && budget.history.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Last 7 Days</p>
            <div className="flex items-end gap-1 h-12">
              {budget.history.map((day, i) => {
                const h = Math.max(4, (day.tokensUsed / day.budget) * 100)
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex-1 rounded-t-sm transition-all',
                      day.tokensUsed >= day.budget ? 'bg-red-400' : 'bg-primary/60',
                    )}
                    style={{ height: `${Math.min(100, h)}%` }}
                    title={`${day.date}: ${day.tokensUsed.toLocaleString()} tokens`}
                  />
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Metrics Overview Panel ─────────────────────────────────────────────────

function MetricsOverview({ metrics }: { metrics: MetricsData }) {
  const poolUtil = Number(metrics.database.poolUtilization || 0)
  return (
    <div className="space-y-4">
      {/* Key stats cards — top row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Timer} label="Uptime" value={metrics.server.uptimeFormatted} color="emerald" />
        <StatCard icon={Cpu} label="CPU" value={`${metrics.server.cpu.usage}%`} color={Number(metrics.server.cpu.usage) > 80 ? 'red' : 'blue'} />
        <StatCard icon={HardDrive} label="Memory" value={`${metrics.server.memory.rssMB} MB`} sub={`${metrics.server.memory.systemUsedPct}% system`} color="purple" />
        <StatCard icon={Database} label="DB Size" value={`${metrics.database.sizeMB} MB`} sub={`${metrics.database.totalQueries.toLocaleString()} queries`} color="cyan" />
        <StatCard icon={Users} label="Users" value={String(metrics.users.total)} sub={`${metrics.users.candidates} cand · ${metrics.users.recruiters} rec`} color="blue" />
        <StatCard icon={Zap} label="Active Sessions" value={String(metrics.activeSessions || 0)} sub={`${metrics.users.activeToday} active today`} color="green" />
      </div>

      {/* Second row — real-time request + connection stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Globe} label="Req/min" value={String(metrics.api.requestsPerMinute || 0)} sub={`${metrics.api.hourly.requests.toLocaleString()} /hr`} color="blue" />
        <StatCard icon={Activity} label="HTTP Conns" value={String(metrics.server.activeConnections || 0)} color="emerald" />
        <StatCard
          icon={AlertCircle}
          label="Error Rate"
          value={`${metrics.api.hourly.errorRate}%`}
          sub={`${metrics.api.cumulative.totalErrors} total errors`}
          color={Number(metrics.api.hourly.errorRate) > 5 ? 'red' : 'emerald'}
        />
        <StatCard icon={MessageSquare} label="Interviews Today" value={String(metrics.interviews.today)} sub={`${metrics.interviews.practice} practice · ${metrics.interviews.mock} mock`} color="green" />
      </div>

      {/* Interview breakdown card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Interview Metrics</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold tabular-nums">{metrics.interviews.total}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3 text-center">
              <p className="text-xs text-emerald-600">Completed</p>
              <p className="text-xl font-bold tabular-nums text-emerald-700">{metrics.interviews.completed}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center">
              <p className="text-xs text-blue-600">Active</p>
              <p className="text-xl font-bold tabular-nums text-blue-700">{metrics.interviews.active}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 text-center">
              <p className="text-xs text-red-600">Abandoned</p>
              <p className="text-xl font-bold tabular-nums text-red-700">{metrics.interviews.abandoned || 0}</p>
            </div>
            <div className="rounded-lg bg-indigo-50 p-3 text-center">
              <p className="text-xs text-indigo-600">Practice</p>
              <p className="text-xl font-bold tabular-nums text-indigo-700">{metrics.interviews.practice || 0}</p>
            </div>
            <div className="rounded-lg bg-purple-50 p-3 text-center">
              <p className="text-xs text-purple-600">Mock</p>
              <p className="text-xl font-bold tabular-nums text-purple-700">{metrics.interviews.mock || 0}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 text-center">
              <p className="text-xs text-amber-600">Today</p>
              <p className="text-xl font-bold tabular-nums text-amber-700">{metrics.interviews.today}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API & DB Details */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* API Metrics */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">API Performance</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Requests (1h)</p>
                <p className="text-xl font-bold tabular-nums">{metrics.api.hourly.requests.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Req/min</p>
                <p className="text-xl font-bold tabular-nums">{metrics.api.requestsPerMinute || 0}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Error Rate</p>
                <p className={cn(
                  'text-xl font-bold tabular-nums',
                  Number(metrics.api.hourly.errorRate) > 5 ? 'text-red-600' : 'text-emerald-600',
                )}>
                  {metrics.api.hourly.errorRate}%
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Latency Percentiles</p>
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-xs text-muted-foreground">p50</p>
                  <p className="text-sm font-bold tabular-nums">{metrics.api.latency.p50}ms</p>
                </div>
                <div className="flex-1 rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-xs text-muted-foreground">p95</p>
                  <p className="text-sm font-bold tabular-nums">{metrics.api.latency.p95}ms</p>
                </div>
                <div className="flex-1 rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-xs text-muted-foreground">p99</p>
                  <p className="text-sm font-bold tabular-nums">{metrics.api.latency.p99}ms</p>
                </div>
                <div className="flex-1 rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-xs text-muted-foreground">avg</p>
                  <p className="text-sm font-bold tabular-nums">{metrics.api.latency.avg}ms</p>
                </div>
              </div>
            </div>
            {metrics.api.topEndpoints.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Top Endpoints</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {metrics.api.topEndpoints.slice(0, 10).map((ep, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="font-mono truncate flex-1 text-muted-foreground">{ep.path}</span>
                      <span className="font-semibold tabular-nums shrink-0">{ep.total}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{ep.p50}ms</span>
                      {Number(ep.errorRate) > 0 && (
                        <span className="text-red-500 tabular-nums shrink-0">{ep.errorRate}% err</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Database Metrics */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Database</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">DB Connections</p>
                <p className="text-xl font-bold tabular-nums">{metrics.database.activeConnections}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Pool Util</p>
                <p className={cn(
                  'text-xl font-bold tabular-nums',
                  poolUtil > 80 ? 'text-red-600' : poolUtil > 50 ? 'text-amber-600' : 'text-emerald-600',
                )}>
                  {metrics.database.poolUtilization || '0.0'}%
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Queries/min</p>
                <p className="text-xl font-bold tabular-nums">{metrics.database.queriesPerMinute || 0}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Total Queries</p>
                <p className="text-lg font-bold tabular-nums">{(metrics.database.totalQueries || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Slow (&gt;200ms)</p>
                <p className={cn(
                  'text-lg font-bold tabular-nums',
                  (metrics.database.slowQueries || 0) > 10 ? 'text-red-600' : 'text-emerald-600',
                )}>
                  {metrics.database.slowQueries || 0}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Pool (total/idle/wait)</p>
                <p className="text-sm font-bold tabular-nums">
                  {metrics.database.poolTotal}/{metrics.database.poolIdle}/{metrics.database.poolWaiting}
                </p>
              </div>
            </div>
            {metrics.database.tables && metrics.database.tables.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Table Row Counts</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {metrics.database.tables.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{t.name}</span>
                      <span className="font-semibold tabular-nums">{t.rows.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="text-xs text-muted-foreground pt-2 border-t flex gap-4 flex-wrap">
              <span>Node: {metrics.server.platform.node}</span>
              <span>CPU: {metrics.server.cpu.cores} cores · {metrics.server.cpu.model?.split(' ')[0]}</span>
              <span>Mem: {metrics.server.memory.systemUsedPct}% system</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color = 'blue' }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: string
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    green: 'bg-green-50 text-green-600',
    cyan: 'bg-cyan-50 text-cyan-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={cn('rounded-md p-1', colorClasses[color] || colorClasses.blue)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </Card>
  )
}

// ─── Activity Feed Panel ────────────────────────────────────────────────────

function ActivityFeed({ events, loading, onRefresh, filter, setFilter, onDateRangeChange }: {
  events: ActivityEvent[]
  loading: boolean
  onRefresh: () => void
  filter: string
  setFilter: (f: string) => void
  onDateRangeChange?: (startDate: string, endDate: string) => void
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [dateRange, setDateRange] = useState<'live' | '1h' | '24h' | '7d'>('live')

  const categories = ['all', 'user', 'ai', 'auth', 'system', 'error', 'recruiter', 'interview', 'onboarding']

  const filtered = events.filter(e => {
    if (filter !== 'all' && e.category !== filter) return false
    if (searchTerm && !e.event_type.includes(searchTerm) && !e.user_email?.includes(searchTerm) && !JSON.stringify(e.details).includes(searchTerm)) return false
    return true
  })

  const handleDateRange = (range: typeof dateRange) => {
    setDateRange(range)
    if (range === 'live') {
      onRefresh()
      return
    }
    const now = new Date()
    let startDate = new Date()
    if (range === '1h') startDate = new Date(now.getTime() - 60 * 60 * 1000)
    else if (range === '24h') startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    else if (range === '7d') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    onDateRangeChange?.(startDate.toISOString(), now.toISOString())
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Live Activity Feed</CardTitle>
            <span className="text-xs text-muted-foreground">({filtered.length} events)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 bg-muted rounded-md p-0.5">
              {(['live', '1h', '24h', '7d'] as const).map(range => (
                <button
                  key={range}
                  onClick={() => handleDateRange(range)}
                  className={cn(
                    'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                    dateRange === range
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {range === 'live' ? '⚡ Live' : range}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1.5">
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search events..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-xs rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={cn(
                  'px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider transition-colors',
                  filter === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No events matching filters.</p>
          ) : (
            filtered.map((event, i) => {
              const catColors = CATEGORY_COLORS[event.category] || CATEGORY_COLORS.system
              const isError = event.severity === 'error'
              const isWarning = event.severity === 'warning'
              return (
                <div
                  key={event.id || i}
                  className={cn(
                    'flex items-start gap-3 text-xs rounded-lg px-3 py-2 transition-colors',
                    isError ? 'bg-red-50/50 border-l-2 border-red-400' :
                    isWarning ? 'bg-amber-50/30 border-l-2 border-amber-400' :
                    'hover:bg-muted/30 border-l-2 border-transparent',
                  )}
                >
                  <div className="shrink-0 mt-0.5">
                    {isError ? <AlertCircle className="h-3.5 w-3.5 text-red-500" /> :
                     isWarning ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> :
                     <Activity className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={cn('text-[9px] px-1.5 py-0', catColors.bg, catColors.text, catColors.border)}>
                        {event.category}
                      </Badge>
                      <span className="font-medium font-mono">{event.event_type}</span>
                      {event.user_email && (
                        <span className="text-muted-foreground truncate max-w-[150px]">{event.user_email}</span>
                      )}
                    </div>
                    {event.details && Object.keys(event.details).length > 0 && (
                      <p className="text-muted-foreground mt-0.5 truncate">
                        {Object.entries(event.details)
                          .filter(([k]) => !['method', 'statusCode'].includes(k))
                          .slice(0, 4)
                          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                    {event.created_at ? timeAgo(event.created_at) : ''}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Existing AI Health Components ──────────────────────────────────────────

function StatusBanner({ data }: { data: HealthData }) {
  const status = getOverallStatus(data)
  const budget = data.token_budget
  const config = {
    operational: {
      icon: CheckCircle2,
      label: 'All Systems Operational',
      bg: 'from-emerald-500 to-green-600',
      pulse: 'bg-emerald-300',
    },
    degraded: {
      icon: AlertTriangle,
      label: 'Degraded Performance',
      bg: 'from-amber-500 to-yellow-600',
      pulse: 'bg-amber-300',
    },
    down: {
      icon: XCircle,
      label: 'Systems Down',
      bg: 'from-red-500 to-rose-600',
      pulse: 'bg-red-300',
    },
  }[status]

  const Icon = config.icon

  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-r p-6 text-white shadow-lg', config.bg)}>
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <div className="absolute -right-4 bottom-0 h-20 w-20 rounded-full bg-white/5" />
      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className={cn('absolute inset-0 animate-ping rounded-full opacity-75', config.pulse)} />
            <div className="relative rounded-full bg-white/20 p-3">
              <Icon className="h-8 w-8" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold font-heading">{config.label}</h1>
            <p className="text-sm text-white/80 mt-1">
              {data.total_models_registered} models &middot; NIM {data.nim_configured ? 'on' : 'off'}
              {budget && (
                <> &middot; OpenAI: {budget.budgetExhausted ? (
                  <span className="font-bold text-red-200">BUDGET EXHAUSTED</span>
                ) : (
                  <span>{budget.tokensUsed.toLocaleString()}/{budget.dailyBudget.toLocaleString()} tokens</span>
                )}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end text-right">
            <span className="text-2xl font-bold tabular-nums">{data.stats.totalCalls.toLocaleString()}</span>
            <span className="text-xs text-white/70">API Calls</span>
          </div>
          <div className="h-10 w-px bg-white/20" />
          <div className="flex flex-col items-end text-right">
            <span className="text-2xl font-bold tabular-nums">{data.stats.totalFailovers}</span>
            <span className="text-xs text-white/70">Failovers</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModalityCard({ name, modality }: { name: string; modality: ModalityInfo }) {
  const meta = MODALITY_META[name] || { label: name, icon: Zap, color: 'blue' }
  const colors = COLOR_MAP[meta.color] || COLOR_MAP.blue
  const status = getModalityStatus(modality)
  const Icon = meta.icon
  const availableCount = modality.providers.filter(p => p.available && !p.circuitOpen).length

  return (
    <Card className={cn(
      'relative overflow-hidden transition-all hover:shadow-md',
      status === 'down' && 'border-red-300 bg-red-50/50',
      status === 'degraded' && 'border-amber-300 bg-amber-50/30',
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('rounded-lg p-2', colors.light)}>
              <Icon className={cn('h-5 w-5', colors.text)} />
            </div>
            <div>
              <CardTitle className="text-base">{meta.label}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {availableCount}/{modality.chain_depth} providers
              </p>
            </div>
          </div>
          <Badge
            variant={status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'destructive'}
            className="text-[10px] uppercase tracking-wider"
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {modality.providers.map((provider, i) => {
          const isActive = modality.active === provider.key
          const isAvailable = provider.available && !provider.circuitOpen
          return (
            <div
              key={provider.key}
              className={cn(
                'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                isActive ? cn(colors.light, 'ring-1', colors.border) : 'bg-muted/50',
                !isAvailable && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn(
                  'h-2 w-2 rounded-full shrink-0',
                  isAvailable ? 'bg-emerald-500' : 'bg-red-400',
                )} />
                <span className="font-medium truncate">{formatProviderName(provider.key)}</span>
                {isActive && (
                  <Badge variant="default" className="text-[9px] ml-1 px-1.5 py-0">
                    ACTIVE
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {provider.circuitOpen && (
                  <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                    CIRCUIT OPEN
                  </Badge>
                )}
                {provider.failures && provider.failures.count > 0 && (
                  <span className="text-[10px] text-red-500 font-medium">
                    {provider.failures.count} fail{provider.failures.count > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function ModuleChainRow({ name, chains, allModalities }: {
  name: string
  chains: Record<string, ModuleChainInfo>
  allModalities: Record<string, ModalityInfo>
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = MODULE_META[name] || { label: formatModuleName(name), description: '' }
  const modalityKeys = Object.keys(chains)
  const totalAvailable = Object.values(chains).reduce((sum, c) => sum + c.available_count, 0)
  const totalDepth = Object.values(chains).reduce((sum, c) => sum + c.chain_depth, 0)
  const healthPct = totalDepth > 0 ? Math.round((totalAvailable / totalDepth) * 100) : 0
  const status = healthPct === 100 ? 'healthy' : healthPct > 50 ? 'degraded' : healthPct > 0 ? 'warning' : 'down'

  return (
    <div className="border rounded-xl overflow-hidden transition-all hover:shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="font-medium text-sm">{meta.label}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">{meta.description}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5">
            {modalityKeys.map(mod => {
              const modMeta = MODALITY_META[mod]
              const chain = chains[mod]
              const isHealthy = chain.available_count === chain.chain_depth
              return (
                <div
                  key={mod}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    isHealthy ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                  )}
                >
                  {modMeta?.label || mod}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  status === 'healthy' ? 'bg-emerald-500' :
                  status === 'degraded' ? 'bg-amber-500' :
                  status === 'warning' ? 'bg-orange-500' : 'bg-red-500',
                )}
                style={{ width: `${healthPct}%` }}
              />
            </div>
            <span className={cn(
              'text-xs font-semibold tabular-nums w-8 text-right',
              status === 'healthy' ? 'text-emerald-600' :
              status === 'degraded' ? 'text-amber-600' :
              status === 'warning' ? 'text-orange-600' : 'text-red-600',
            )}>
              {healthPct}%
            </span>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t bg-muted/10">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modalityKeys.map(mod => {
              const modMeta = MODALITY_META[mod]
              const chain = chains[mod]
              const colors = COLOR_MAP[modMeta?.color || 'blue'] || COLOR_MAP.blue
              const ModIcon = modMeta?.icon || Zap
              return (
                <div key={mod} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ModIcon className={cn('h-3.5 w-3.5', colors.text)} />
                      <span className="text-xs font-semibold">{modMeta?.label || mod}</span>
                    </div>
                    <Badge variant="outline" className="text-[9px] font-mono">
                      {chain.variant}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {chain.providers.map((providerKey, i) => {
                      const modalityData = allModalities[mod]
                      const providerData = modalityData?.providers.find(p => p.key === providerKey)
                      const isAvailable = providerData ? (providerData.available && !providerData.circuitOpen) : false
                      const isActive = modalityData?.active === providerKey
                      return (
                        <div key={providerKey} className="flex items-center gap-2 text-[11px]">
                          <div className={cn(
                            'h-1.5 w-1.5 rounded-full shrink-0',
                            isAvailable ? 'bg-emerald-500' : 'bg-red-400',
                          )} />
                          <span className={cn(
                            'truncate',
                            isActive && 'font-semibold',
                            !isAvailable && 'text-muted-foreground line-through',
                          )}>
                            {formatProviderName(providerKey)}
                          </span>
                          {isActive && <span className="text-[9px] text-primary font-bold shrink-0">ACTIVE</span>}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    {chain.available_count}/{chain.chain_depth} available
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ProviderCallsTable({ providerCalls }: { providerCalls: Record<string, number> }) {
  const sorted = Object.entries(providerCalls).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return <p className="text-sm text-muted-foreground">No calls recorded yet.</p>
  const max = sorted[0][1]

  return (
    <div className="space-y-2">
      {sorted.map(([key, count]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-xs font-medium w-36 truncate" title={formatProviderName(key)}>
            {formatProviderName(key)}
          </span>
          <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/70 transition-all"
              style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums w-12 text-right">{count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function RecentLogs({ logs }: { logs: HealthData['recent_logs'] }) {
  if (!logs || logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No recent failover events.</p>
  }

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {[...logs].reverse().map((log, i) => (
        <div key={i} className="flex items-start gap-3 text-xs border-l-2 border-amber-400 pl-3 py-1">
          <Clock className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[9px]">{log.modality || 'unknown'}</Badge>
              <span className="font-medium">
                {formatProviderName(log.from || log.provider || '?')} &rarr; {formatProviderName(log.to || '?')}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 truncate">{log.error || log.reason || log.event || 'Failover'}</p>
            {(log.timestamp || log.time) && (
              <p className="text-muted-foreground/70 mt-0.5">{new Date(log.timestamp || log.time || '').toLocaleString()}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function AiHealthPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<HealthData | null>(null)
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [activityLoading, setActivityLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [countdown, setCountdown] = useState(30)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [activityFilter, setActivityFilter] = useState('all')

  const handleLogout = useCallback(async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' })
    navigate('/admin/login', { replace: true })
  }, [navigate])

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-health', { credentials: 'include' })
      if (res.status === 401) {
        navigate('/admin/login?returnTo=/admin/ai-health', { replace: true })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
      setCountdown(30)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }, [navigate])

  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true)
    try {
      const res = await fetch('/api/admin/metrics', { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setMetrics(json)
      }
    } catch {
      // Metrics are optional — don't block the dashboard
    } finally {
      setMetricsLoading(false)
    }
  }, [])

  const fetchActivity = useCallback(async (startDate?: string, endDate?: string) => {
    setActivityLoading(true)
    try {
      const params = new URLSearchParams()
      if (startDate && endDate) {
        params.set('start_date', startDate)
        params.set('end_date', endDate)
        params.set('limit', '200')
      } else {
        params.set('realtime', 'true')
        params.set('limit', '100')
      }
      const res = await fetch(`/api/admin/activity?${params}`, { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setActivity(json.events || [])
      }
    } catch {
      // Activity feed is optional
    } finally {
      setActivityLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial load
    fetchHealth()
    fetchMetrics()
    fetchActivity()

    // Auto-refresh: health + metrics every 30s, activity every 10s
    const healthInterval = setInterval(() => {
      fetchHealth()
      fetchMetrics()
    }, 30000)
    const activityInterval = setInterval(() => fetchActivity(), 10000)

    return () => {
      clearInterval(healthInterval)
      clearInterval(activityInterval)
    }
  }, [fetchHealth, fetchMetrics, fetchActivity])

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => (prev > 0 ? prev - 1 : 30))
    }, 1000)
    return () => clearInterval(timer)
  }, [lastRefresh])

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading Admin Dashboard...</p>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="p-8 text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">Connection Error</h2>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={fetchHealth}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) return null

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: Server },
    { id: 'ai', label: 'AI Providers', icon: Brain },
    { id: 'activity', label: 'Activity Feed', icon: Activity },
  ]

  const modalityEntries = Object.entries(data.modalities)
  const moduleEntries = Object.entries(data.module_chains)

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header bar */}
      <div className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-1.5">
              <Activity className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-heading text-lg font-bold">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">HireLoop Monitoring & Control</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
              {countdown}s
            </span>
            <Button variant="outline" size="sm" onClick={() => { fetchHealth(); fetchMetrics(); fetchActivity() }} className="gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
        {/* Tab navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1 -mb-px">
            {tabs.map(tab => {
              const TabIcon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/20',
                  )}
                >
                  <TabIcon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Status Banner (always visible) */}
        <StatusBanner data={data} />

        {/* ─── OVERVIEW TAB ─── */}
        {activeTab === 'overview' && (
          <>
            {/* Token Budget */}
            {data.token_budget && (
              <TokenBudgetPanel budget={data.token_budget} />
            )}

            {/* System Metrics */}
            {metrics && <MetricsOverview metrics={metrics} />}

            {/* Stats & Logs */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Provider Call Distribution</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <ProviderCallsTable providerCalls={data.stats.providerCalls} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <CardTitle>Recent Failover Events</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <RecentLogs logs={data.recent_logs} />
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* ─── AI PROVIDERS TAB ─── */}
        {activeTab === 'ai' && (
          <>
            {/* Modality Status Cards */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-heading text-lg font-semibold">Provider Status by Modality</h2>
                <span className="text-xs text-muted-foreground">({modalityEntries.length} modalities)</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {modalityEntries.map(([name, modality]) => (
                  <ModalityCard key={name} name={name} modality={modality} />
                ))}
              </div>
            </div>

            {/* Module Chains */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-heading text-lg font-semibold">Module Chain Health</h2>
                <span className="text-xs text-muted-foreground">({moduleEntries.length} modules)</span>
              </div>
              <div className="space-y-2">
                {moduleEntries.map(([name, chains]) => (
                  <ModuleChainRow key={name} name={name} chains={chains} allModalities={data.modalities} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* ─── ACTIVITY FEED TAB ─── */}
        {activeTab === 'activity' && (
          <ActivityFeed
            events={activity}
            loading={activityLoading}
            onRefresh={() => fetchActivity()}
            filter={activityFilter}
            setFilter={setActivityFilter}
            onDateRangeChange={(start, end) => fetchActivity(start, end)}
          />
        )}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pb-4">
          HireLoop Admin Dashboard &middot; Metrics refresh every 30s &middot; Activity feed every 10s &middot; {lastRefresh.toLocaleString()}
        </div>
      </div>
    </div>
  )
}
