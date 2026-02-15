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
  FileText,
  Briefcase,
  Send,
  DollarSign,
  ClipboardCheck,
  UserCircle,
  GraduationCap,
  Building2,
  LayoutGrid,
  ShieldCheck,
  FileSearch,
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
  graceful_degradation?: string | null
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
  groq_configured: boolean
  cerebras_configured: boolean
  deepgram_configured: boolean
  selfhosted_stt: boolean
  selfhosted_tts: boolean
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

interface ModulesData {
  timestamp: string
  applications: {
    total: number; pending: number; reviewing: number; accepted: number
    rejected: number; withdrawn: number; today: number; thisWeek: number
    recent: Array<{ id: number; status: string; applied_at: string; candidate_email: string; job_title: string }>
  }
  recruiter: {
    activeRecruiters: number; totalJobs: number; activeJobs: number
    closedJobs: number; draftJobs: number; jobsPostedThisWeek: number; totalCompanies: number
  }
  offers: {
    total: number; pending: number; accepted: number; rejected: number
    expired: number; thisWeek: number
  }
  payroll: {
    totalRuns: number; processed: number; pending: number; errors: number
    totalGross: number; totalNet: number; totalPaychecks: number
  }
  interviews: {
    total: number; completed: number; active: number; abandoned: number
    practice: number; mock: number; today: number; thisWeek: number
    practiceSessions: number; mockSessions: number
  }
  onboarding: {
    totalSessions: number; completed: number; inProgress: number; notStarted: number
    totalDocuments: number; completedDocuments: number; pendingDocuments: number; aiGenerated: number
  }
  assessments: {
    total: number; completed: number; inProgress: number; abandoned: number
    avgScore: number | null; thisWeek: number
  }
  profiles: {
    totalCandidateProfiles: number; withHeadline: number; withResume: number
    withLinkedIn: number; completenessRate: number
  }
  compliance: {
    totalConsents: number; consented: number; declined: number
    dataRequests: number; dataRequestsPending: number; dataRequestsProcessed: number
    fairnessAudits: number; auditsCompleted: number; fairnessScore: number
    issuesFound: number; auditLogEntries: number
  }
  docVerification: {
    totalVerifications: number; avgAuthScore: number; highRisk: number
    lowRisk: number; duplicates: number; totalDocuments: number
    docsVerified: number; docsPending: number; credentials: number
    credentialsVerified: number; credentialsPending: number
  }
  // ─── Architecture-documented domain groups ───
  usersAuth?: {
    totalUsers: number; candidates: number; recruiters: number; admins: number
    registeredToday: number; registeredThisWeek: number; activeToday: number
    activeSessions: number; oauthConnections: number
  }
  scoring?: {
    omniScoreTotal: number; omniScoreAvg: number | null; omniScoreThisWeek: number
    trustScoreTotal: number; trustScoreAvg: number | null; trustScoreThisWeek: number
    appealsTotal: number; appealsPending: number; appealsApproved: number; appealsRejected: number
  }
  communications?: {
    totalMessages: number; sent: number; pending: number; thisWeek: number
    templates: number; sequenceEnrollments: number; activeSequences: number; completedSequences: number
  }
  matching?: {
    totalMatches: number; avgMatchScore: number | null; matchesThisWeek: number; mutualMatches: number
  }
  screening?: {
    templates: number; totalSessions: number; completed: number; active: number; thisWeek: number
  }
  system?: {
    userMemoryEntries: number; ttsCacheEntries: number; systemEvents: number; agentDataEntries: number
  }
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
  // New underscore-style module names (current)
  'mock_interview': { label: 'Mock Interview', description: 'AI-powered interview practice' },
  'resume_parsing': { label: 'Resume Parsing', description: 'OCR + extraction pipeline' },
  'resume_tools': { label: 'Resume Tools', description: 'Resume optimization & cover letters' },
  'matching': { label: 'Job Matching', description: 'Semantic match & ranking' },
  'smart_search': { label: 'Smart Search', description: 'AI-powered job search' },
  'screening': { label: 'Screening', description: 'Auto-fill screening questions' },
  'omniscore': { label: 'OmniScore', description: 'Resume quality scoring' },
  'recruiter_tools': { label: 'Recruiter Tools', description: 'AI assessments & comparisons' },
  'job_optimizer': { label: 'Job Optimizer', description: 'Job posting optimization' },
  'communication_hub': { label: 'Communication Hub', description: 'AI message generation' },
  'application_review': { label: 'Application Review', description: 'Application readiness check' },
  'health_verify': { label: 'Health Verify', description: 'Provider health checks' },
  'admin': { label: 'Admin', description: 'AI dashboard queries' },
  'onboarding': { label: 'Onboarding', description: 'New hire workflows' },
  'assessments': { label: 'Assessments', description: 'Skill evaluation engine' },
  'safety': { label: 'Safety', description: 'Content moderation' },
  // Legacy hyphenated names (for historical data)
  'mock-interview': { label: 'Mock Interview', description: 'AI-powered interview practice' },
  'coaching': { label: 'AI Coaching', description: 'Career coaching assistant' },
  'resume-parsing': { label: 'Resume Parsing', description: 'OCR + extraction pipeline' },
  'job-matching': { label: 'Job Matching', description: 'Semantic match & ranking' },
  'offer-management': { label: 'Offer Management', description: 'Offer letter generation' },
  'payroll': { label: 'Payroll', description: 'Compensation calculations' },
  'scheduling': { label: 'Scheduling', description: 'Interview scheduling' },
  'profile': { label: 'Profile', description: 'Profile analysis & search' },
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

type TabId = 'overview' | 'ai' | 'monitoring' | 'prompts' | 'activity' | 'routes'

interface RouteFileInfo { file: string; domain: string; endpoints: number }
interface TrackedEndpoint { path: string; total: number; errors: number; errorRate: string; p50: number; p95: number; p99: number }
interface RoutesData {
  summary: { totalArchEndpoints: number; totalTrackedEndpoints: number; routeFiles: number; api: MetricsData['api'] }
  routeFiles: RouteFileInfo[]
  trackedEndpoints: TrackedEndpoint[]
}

// ─── AI Monitoring Types ────────────────────────────────────────────────────

interface AiUsageData {
  summary: { totalCalls: number; totalTokens: number; totalCost: number; avgLatency: number; failures: number; successRate: number }
  models: Record<string, { calls: number; totalTokens: number; avgTokens: number; avgLatencyMs: number; successRate: number; failures: number; cost: number; lastUsed: string | null }>
  modules: Record<string, { calls: number; totalTokens: number; cost: number; failures: number }>
  hourly: Array<{ hour: string; label: string; calls: number; tokens: number; cost: number }>
  budget: TokenBudgetData
}

interface BudgetPrediction {
  exhausted: boolean
  burnRatePerMinute: number
  prediction: string
  exhaustsAt: string | null
  minutesRemaining: number | null
}

interface BudgetData extends TokenBudgetData {
  prediction: BudgetPrediction
  moduleBreakdown: Record<string, { calls: number; totalTokens: number; cost: number; failures: number }>
  throttleStatus: Array<{ module: string; priority: string; throttled: boolean }>
}

interface AiCallLog {
  id: number
  module: string
  feature: string
  modality: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  latency_ms: number
  success: boolean
  error_message: string | null
  cost_estimate: number
  fallback_chain: string[] | null
  created_at: string
  // In-memory fields
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  latencyMs?: number
  errorMessage?: string
  costEstimate?: number
  fallbackChain?: string[] | null
  createdAt?: string
}

interface PromptData {
  id: number
  slug: string
  name: string
  module: string
  feature: string
  description: string
  current_version: number
  model: string
  avg_tokens: number
  avg_latency_ms: number
  success_rate: number
  total_calls: number
  is_active: boolean
  created_at: string
  updated_at: string
}

function formatProviderName(key: string): string {
  // Self-hosted providers get descriptive names
  if (key === 'selfhosted_tts') return 'Piper TTS (Self-hosted)';
  if (key === 'selfhosted_stt') return 'Whisper.cpp (Self-hosted)';
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
  // FIX (Feb 15, 2026 — Task #32795): Also check verifyFailed status
  // The banner showed "All Systems Operational" even when 5 providers were returning 429 errors
  // because it only checked API key availability and circuit breaker state.
  // Now it also checks whether the provider's last verification failed.
  const isProviderDown = (p: any) => !p.available || p.circuitOpen || p.verifyFailed
  const allDown = modalities.every(m => m.providers.length > 0 && m.providers.every(isProviderDown))
  const someDown = modalities.some(m => m.providers.some(isProviderDown))
  if (allDown) return 'down'
  if (someDown) return 'degraded'
  return 'operational'
}

function getModalityStatus(modality: ModalityInfo): 'healthy' | 'degraded' | 'down' | 'passthrough' {
  // Modalities with graceful degradation and no providers = passthrough (not "down")
  if (modality.chain_depth === 0 && modality.graceful_degradation) return 'passthrough'
  // FIX (Feb 15, 2026 — Task #32795): Include verifyFailed in availability check
  const available = modality.providers.filter(p => p.available && !p.circuitOpen && !p.verifyFailed)
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
            <div className="flex flex-wrap gap-2">
              {Object.entries(budget.providerBreakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([prov, tokens]) => (
                <div key={prov} className={cn(
                  'flex-1 min-w-[80px] rounded-lg px-3 py-2 text-center',
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

        {/* History sparkline — includes today + uses relative scaling */}
        {(() => {
          const allDays = [
            ...(budget.history || []),
            { date: budget.currentDay || 'Today', tokensUsed: budget.tokensUsed, budget: budget.dailyBudget },
          ]
          if (allDays.length === 0 || allDays.every(d => d.tokensUsed === 0)) return null
          const maxTokens = Math.max(...allDays.map(d => d.tokensUsed), 1)
          return (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Last 7 Days</p>
              <div className="flex items-end gap-1 h-12">
                {allDays.map((day, i) => {
                  const h = day.tokensUsed > 0 ? Math.max(8, (day.tokensUsed / maxTokens) * 100) : 4
                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex-1 rounded-t-sm transition-all',
                        i === allDays.length - 1 ? 'bg-primary' :
                        day.tokensUsed >= day.budget ? 'bg-red-400' : 'bg-primary/60',
                      )}
                      style={{ height: `${Math.min(100, h)}%` }}
                      title={`${day.date}: ${day.tokensUsed.toLocaleString()} / ${(day.budget || budget.dailyBudget).toLocaleString()} tokens`}
                    />
                  )
                })}
              </div>
            </div>
          )
        })()}
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
    <div className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-r p-4 sm:p-6 text-white shadow-lg', config.bg)}>
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <div className="absolute -right-4 bottom-0 h-20 w-20 rounded-full bg-white/5" />
      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="relative shrink-0">
            <div className={cn('absolute inset-0 animate-ping rounded-full opacity-75', config.pulse)} />
            <div className="relative rounded-full bg-white/20 p-2 sm:p-3">
              <Icon className="h-6 w-6 sm:h-8 sm:w-8" />
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold font-heading">{config.label}</h1>
            <p className="text-xs sm:text-sm text-white/80 mt-1 leading-relaxed">
              {data.total_models_registered} models &middot; NIM {data.nim_configured ? 'on' : 'off'} &middot; Groq {data.groq_configured ? 'on' : 'off'} &middot; Cerebras {data.cerebras_configured ? 'on' : 'off'} &middot; Deepgram {data.deepgram_configured ? 'on' : 'off'}
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
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end text-right">
            <span className="text-xl sm:text-2xl font-bold tabular-nums">{data.stats.totalCalls.toLocaleString()}</span>
            <span className="text-[10px] sm:text-xs text-white/70">API Calls</span>
          </div>
          <div className="h-8 sm:h-10 w-px bg-white/20" />
          <div className="flex flex-col items-end text-right">
            <span className="text-xl sm:text-2xl font-bold tabular-nums">{data.stats.totalFailovers}</span>
            <span className="text-[10px] sm:text-xs text-white/70">Failovers</span>
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
      status === 'passthrough' && 'border-slate-300 bg-slate-50/30',
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
                {status === 'passthrough' ? 'Passthrough mode' : `${availableCount}/${modality.chain_depth} providers`}
              </p>
            </div>
          </div>
          <Badge
            variant={status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : status === 'passthrough' ? 'secondary' : 'destructive'}
            className="text-[10px] uppercase tracking-wider"
          >
            {status === 'passthrough' ? 'PASSTHROUGH' : status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {status === 'passthrough' && modality.graceful_degradation && (
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            {modality.graceful_degradation}
          </div>
        )}
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
                {(name === 'tts' || name === 'asr') && (
                  <span className="text-[9px] font-mono text-muted-foreground bg-muted rounded px-1">L{i+1}</span>
                )}
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

// ─── Module Metric Cards ─────────────────────────────────────────────────────

function ModuleMetricCard({ icon: Icon, title, color, metrics }: {
  icon: React.ElementType
  title: string
  color: string
  metrics: Array<{ label: string; value: string | number; highlight?: boolean }>
}) {
  const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    border: 'border-blue-200' },
    green:   { bg: 'bg-green-50',   text: 'text-green-600',   border: 'border-green-200' },
    purple:  { bg: 'bg-purple-50',  text: 'text-purple-600',  border: 'border-purple-200' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200' },
    red:     { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200' },
    teal:    { bg: 'bg-teal-50',    text: 'text-teal-600',    border: 'border-teal-200' },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  border: 'border-indigo-200' },
    cyan:    { bg: 'bg-cyan-50',    text: 'text-cyan-600',    border: 'border-cyan-200' },
    pink:    { bg: 'bg-pink-50',    text: 'text-pink-600',    border: 'border-pink-200' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    border: 'border-rose-200' },
    orange:  { bg: 'bg-orange-50',  text: 'text-orange-600',  border: 'border-orange-200' },
  }
  const c = colorClasses[color] || colorClasses.blue
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className={cn('rounded-lg p-1.5', c.bg)}>
            <Icon className={cn('h-4 w-4', c.text)} />
          </div>
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {metrics.map((m, i) => (
            <div key={i} className="flex justify-between items-baseline">
              <span className="text-[11px] text-muted-foreground">{m.label}</span>
              <span className={cn(
                'text-sm font-bold tabular-nums',
                m.highlight && parseInt(String(m.value)) > 0 ? c.text : '',
              )}>
                {typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ModuleCards({ modules }: { modules: ModulesData }) {
  const a = modules.applications
  const r = modules.recruiter
  const o = modules.offers
  const p = modules.payroll
  const iv = modules.interviews
  const ob = modules.onboarding
  const as_ = modules.assessments
  const pr = modules.profiles
  const co = modules.compliance
  const dv = modules.docVerification
  const ua = modules.usersAuth
  const sc = modules.scoring
  const cm = modules.communications
  const mt = modules.matching
  const sr = modules.screening
  const sy = modules.system

  const moduleCount = 10 + (ua ? 1 : 0) + (sc ? 1 : 0) + (cm ? 1 : 0) + (mt ? 1 : 0) + (sr ? 1 : 0) + (sy ? 1 : 0)

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <LayoutGrid className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-heading text-lg font-semibold">Platform Modules</h2>
        <span className="text-xs text-muted-foreground">({moduleCount} modules — all 16 architecture domain groups)</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* ─── Users & Auth (Domain Group 1) ─── */}
        {ua && (
          <ModuleMetricCard
            icon={Users}
            title="Users & Auth"
            color="blue"
            metrics={[
              { label: 'Total Users', value: ua.totalUsers },
              { label: 'Candidates', value: ua.candidates },
              { label: 'Recruiters', value: ua.recruiters },
              { label: 'Active Today', value: ua.activeToday, highlight: true },
              { label: 'Sessions', value: ua.activeSessions },
              { label: 'New /wk', value: ua.registeredThisWeek },
            ]}
          />
        )}
        <ModuleMetricCard
          icon={FileText}
          title="Applications"
          color="blue"
          metrics={[
            { label: 'Total', value: a.total },
            { label: 'Pending', value: a.pending, highlight: true },
            { label: 'Reviewing', value: a.reviewing },
            { label: 'Accepted', value: a.accepted },
            { label: 'Rejected', value: a.rejected },
            { label: 'Today', value: a.today, highlight: true },
          ]}
        />
        <ModuleMetricCard
          icon={Briefcase}
          title="Recruiter Dashboard"
          color="teal"
          metrics={[
            { label: 'Recruiters', value: r.activeRecruiters },
            { label: 'Active Jobs', value: r.activeJobs, highlight: true },
            { label: 'Total Jobs', value: r.totalJobs },
            { label: 'Draft', value: r.draftJobs },
            { label: 'Companies', value: r.totalCompanies },
            { label: 'Posted /wk', value: r.jobsPostedThisWeek },
          ]}
        />
        <ModuleMetricCard
          icon={Send}
          title="Offers"
          color="purple"
          metrics={[
            { label: 'Total', value: o.total },
            { label: 'Pending', value: o.pending, highlight: true },
            { label: 'Accepted', value: o.accepted },
            { label: 'Rejected', value: o.rejected },
            { label: 'Expired', value: o.expired },
            { label: 'This Week', value: o.thisWeek },
          ]}
        />
        <ModuleMetricCard
          icon={DollarSign}
          title="Payroll"
          color="emerald"
          metrics={[
            { label: 'Runs', value: p.totalRuns },
            { label: 'Processed', value: p.processed },
            { label: 'Pending', value: p.pending, highlight: true },
            { label: 'Errors', value: p.errors, highlight: true },
            { label: 'Paychecks', value: p.totalPaychecks },
            { label: 'Gross $', value: p.totalGross > 0 ? `$${(p.totalGross / 1000).toFixed(1)}k` : '$0' },
          ]}
        />
        <ModuleMetricCard
          icon={MessageSquare}
          title="Interviews"
          color="indigo"
          metrics={[
            { label: 'Total', value: iv.total },
            { label: 'Completed', value: iv.completed },
            { label: 'Active', value: iv.active, highlight: true },
            { label: 'Abandoned', value: iv.abandoned },
            { label: 'Practice', value: iv.practice },
            { label: 'Mock', value: iv.mock },
          ]}
        />
        {/* ─── Screening (Domain Group 6 — separate from assessments) ─── */}
        {sr && (
          <ModuleMetricCard
            icon={Filter}
            title="Screening"
            color="teal"
            metrics={[
              { label: 'Templates', value: sr.templates },
              { label: 'Sessions', value: sr.totalSessions },
              { label: 'Completed', value: sr.completed },
              { label: 'Active', value: sr.active, highlight: true },
              { label: 'This Week', value: sr.thisWeek },
              { label: '', value: '' },
            ]}
          />
        )}
        <ModuleMetricCard
          icon={ClipboardCheck}
          title="AI Onboarding"
          color="green"
          metrics={[
            { label: 'Sessions', value: ob.totalSessions },
            { label: 'Completed', value: ob.completed },
            { label: 'In Progress', value: ob.inProgress, highlight: true },
            { label: 'Documents', value: ob.totalDocuments },
            { label: 'AI Generated', value: ob.aiGenerated },
            { label: 'Pending Docs', value: ob.pendingDocuments },
          ]}
        />
        <ModuleMetricCard
          icon={GraduationCap}
          title="Assessments"
          color="amber"
          metrics={[
            { label: 'Total', value: as_.total },
            { label: 'Completed', value: as_.completed },
            { label: 'In Progress', value: as_.inProgress, highlight: true },
            { label: 'Abandoned', value: as_.abandoned },
            { label: 'Avg Score', value: as_.avgScore !== null ? `${as_.avgScore}%` : 'N/A' },
            { label: 'This Week', value: as_.thisWeek },
          ]}
        />
        {/* ─── Scoring & Trust (Domain Group 7) ─── */}
        {sc && (
          <ModuleMetricCard
            icon={TrendingUp}
            title="Scoring & Trust"
            color="amber"
            metrics={[
              { label: 'OmniScores', value: sc.omniScoreTotal },
              { label: 'Avg Omni', value: sc.omniScoreAvg !== null ? `${sc.omniScoreAvg}` : 'N/A' },
              { label: 'TrustScores', value: sc.trustScoreTotal },
              { label: 'Avg Trust', value: sc.trustScoreAvg !== null ? `${sc.trustScoreAvg}` : 'N/A' },
              { label: 'Appeals', value: sc.appealsTotal },
              { label: 'Pending', value: sc.appealsPending, highlight: true },
            ]}
          />
        )}
        <ModuleMetricCard
          icon={UserCircle}
          title="Profiles"
          color="cyan"
          metrics={[
            { label: 'Candidates', value: pr.totalCandidateProfiles },
            { label: 'w/ Resume', value: pr.withResume },
            { label: 'w/ Headline', value: pr.withHeadline },
            { label: 'w/ LinkedIn', value: pr.withLinkedIn },
            { label: 'Completeness', value: `${pr.completenessRate}%` },
            { label: '', value: '' },
          ]}
        />
        {/* ─── Communications (Domain Group 9) ─── */}
        {cm && (
          <ModuleMetricCard
            icon={Send}
            title="Communications"
            color="cyan"
            metrics={[
              { label: 'Messages', value: cm.totalMessages },
              { label: 'Sent', value: cm.sent },
              { label: 'Pending', value: cm.pending, highlight: true },
              { label: 'Templates', value: cm.templates },
              { label: 'Sequences', value: cm.sequenceEnrollments },
              { label: 'This Week', value: cm.thisWeek },
            ]}
          />
        )}
        {/* ─── Matching (Domain Group 14) ─── */}
        {mt && (
          <ModuleMetricCard
            icon={ArrowUpDown}
            title="Matching"
            color="indigo"
            metrics={[
              { label: 'Total', value: mt.totalMatches },
              { label: 'Avg Score', value: mt.avgMatchScore !== null ? `${mt.avgMatchScore}%` : 'N/A' },
              { label: 'Mutual', value: mt.mutualMatches },
              { label: 'This Week', value: mt.matchesThisWeek },
              { label: '', value: '' },
              { label: '', value: '' },
            ]}
          />
        )}
        <ModuleMetricCard
          icon={ShieldCheck}
          title="Compliance"
          color="rose"
          metrics={[
            { label: 'Consents', value: co.totalConsents },
            { label: 'Data Requests', value: co.dataRequests },
            { label: 'Pending', value: co.dataRequestsPending, highlight: true },
            { label: 'Audits', value: co.fairnessAudits },
            { label: 'Issues', value: co.issuesFound, highlight: true },
            { label: 'Audit Log', value: co.auditLogEntries },
          ]}
        />
        <ModuleMetricCard
          icon={FileSearch}
          title="Doc Verification"
          color="orange"
          metrics={[
            { label: 'Verifications', value: dv.totalVerifications },
            { label: 'Avg Score', value: dv.avgAuthScore ? `${dv.avgAuthScore}%` : 'N/A' },
            { label: 'High Risk', value: dv.highRisk, highlight: true },
            { label: 'Documents', value: dv.totalDocuments },
            { label: 'Credentials', value: dv.credentials },
            { label: 'Pending', value: dv.docsPending, highlight: true },
          ]}
        />
        {/* ─── Memory & System (Domain Groups 15+16) ─── */}
        {sy && (
          <ModuleMetricCard
            icon={HardDrive}
            title="System & Memory"
            color="slate"
            metrics={[
              { label: 'Memory', value: sy.userMemoryEntries },
              { label: 'TTS Cache', value: sy.ttsCacheEntries },
              { label: 'Events', value: sy.systemEvents },
              { label: 'Agent Data', value: sy.agentDataEntries },
              { label: '', value: '' },
              { label: '', value: '' },
            ]}
          />
        )}
      </div>
    </div>
  )
}

// ─── AI Monitoring Tab Components ────────────────────────────────────────────

function BudgetPredictionPanel({ budget }: { budget: BudgetData }) {
  const pred = budget.prediction
  const pct = Math.min(100, budget.percentUsed)
  const barColor = budget.budgetExhausted ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500'

  return (
    <Card className={cn(budget.budgetExhausted && 'border-red-300 ring-2 ring-red-200')}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Budget & Predictions</CardTitle>
          </div>
          {budget.budgetExhausted ? (
            <Badge variant="destructive" className="animate-pulse">EXHAUSTED</Badge>
          ) : pct > 80 ? (
            <Badge className="bg-amber-100 text-amber-800 border-amber-300">Warning</Badge>
          ) : (
            <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">Healthy</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-baseline">
          <span className="text-3xl font-bold tabular-nums">{budget.tokensUsed.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">/ {budget.dailyBudget.toLocaleString()}</span>
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden">
          <div className={cn('h-full rounded-full transition-all duration-500', barColor)} style={{ width: `${pct}%` }} />
        </div>
        {/* Prediction */}
        <div className="rounded-lg bg-muted/50 p-3 space-y-1">
          <p className="text-sm font-medium">{pred.prediction}</p>
          {pred.burnRatePerMinute > 0 && (
            <p className="text-xs text-muted-foreground">Burn rate: ~{pred.burnRatePerMinute.toLocaleString()} tokens/min</p>
          )}
        </div>
        {/* Throttle status */}
        {budget.throttleStatus.some(t => t.throttled) && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Throttled Modules</p>
            <div className="flex flex-wrap gap-1.5">
              {budget.throttleStatus.filter(t => t.throttled).map(t => (
                <Badge key={t.module} variant="destructive" className="text-xs">
                  {formatModuleName(t.module)}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {/* Priority legend */}
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /> Critical</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> High</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" /> Medium</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> Low</span>
        </div>
      </CardContent>
    </Card>
  )
}

function ModelPerformanceTable({ models }: { models: AiUsageData['models'] }) {
  const entries = Object.entries(models).sort((a, b) => b[1].calls - a[1].calls)
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No AI calls yet — metrics will appear as calls are made</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 font-medium">Model</th>
            <th className="pb-2 font-medium text-right">Calls</th>
            <th className="pb-2 font-medium text-right">Avg Tokens</th>
            <th className="pb-2 font-medium text-right">Avg Latency</th>
            <th className="pb-2 font-medium text-right">Success</th>
            <th className="pb-2 font-medium text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([model, m]) => (
            <tr key={model} className="border-b border-muted/50 hover:bg-muted/30">
              <td className="py-2 font-mono text-xs max-w-[200px] truncate" title={model}>
                {formatProviderName(model)}
              </td>
              <td className="py-2 text-right tabular-nums">{m.calls}</td>
              <td className="py-2 text-right tabular-nums">{m.avgTokens.toLocaleString()}</td>
              <td className="py-2 text-right tabular-nums">
                <span className={cn(m.avgLatencyMs > 5000 ? 'text-red-600' : m.avgLatencyMs > 2000 ? 'text-amber-600' : '')}>
                  {m.avgLatencyMs.toLocaleString()}ms
                </span>
              </td>
              <td className="py-2 text-right tabular-nums">
                <span className={cn(m.successRate < 90 ? 'text-red-600' : m.successRate < 99 ? 'text-amber-600' : 'text-emerald-600')}>
                  {m.successRate}%
                </span>
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">${m.cost.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ModuleCostBreakdown({ modules }: { modules: AiUsageData['modules'] }) {
  const entries = Object.entries(modules).sort((a, b) => b[1].totalTokens - a[1].totalTokens)
  if (entries.length === 0) return null
  const maxTokens = Math.max(...entries.map(([, m]) => m.totalTokens))

  return (
    <div className="space-y-2">
      {entries.map(([mod, m]) => {
        const pct = maxTokens > 0 ? (m.totalTokens / maxTokens) * 100 : 0
        return (
          <div key={mod} className="flex items-center gap-3">
            <span className="text-xs font-medium w-28 truncate" title={mod}>{formatModuleName(mod)}</span>
            <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{m.totalTokens.toLocaleString()}</span>
            <span className="text-xs tabular-nums text-muted-foreground w-16 text-right">${m.cost.toFixed(4)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Daily Token Breakdown Table (per-module) ────────────────────────────────
interface DailyBreakdownData {
  date: string
  total_tokens: number
  total_calls: number
  daily_budget: number
  budget_used_pct: number
  modules: Array<{
    module: string
    call_count: number
    total_tokens: number
    total_cost: number
    failures: number
    pct_of_daily: number
    pct_of_budget: number
  }>
}

function DailyTokenBreakdown() {
  const [data, setData] = useState<DailyBreakdownData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ai-health/daily-breakdown', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-xs text-muted-foreground animate-pulse">Loading daily breakdown...</p>
  if (!data || data.modules.length === 0) return <p className="text-xs text-muted-foreground">No AI calls recorded today</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Daily Token Budget: {data.budget_used_pct}% used ({data.total_tokens.toLocaleString()} / {data.daily_budget.toLocaleString()})
        </p>
        <Badge variant={data.budget_used_pct > 80 ? 'destructive' : data.budget_used_pct > 50 ? 'secondary' : 'outline'}>
          {data.date}
        </Badge>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', data.budget_used_pct > 80 ? 'bg-red-500' : data.budget_used_pct > 50 ? 'bg-amber-500' : 'bg-emerald-500')}
          style={{ width: `${Math.min(100, data.budget_used_pct)}%` }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-2 font-semibold text-muted-foreground">Module</th>
              <th className="text-right py-2 px-2 font-semibold text-muted-foreground">Calls</th>
              <th className="text-right py-2 px-2 font-semibold text-muted-foreground">Tokens</th>
              <th className="text-right py-2 px-2 font-semibold text-muted-foreground">% of Daily</th>
              <th className="text-right py-2 px-2 font-semibold text-muted-foreground">% of Budget</th>
              <th className="text-right py-2 px-2 font-semibold text-muted-foreground">Cost</th>
              <th className="text-right py-2 px-2 font-semibold text-muted-foreground">Errors</th>
            </tr>
          </thead>
          <tbody>
            {data.modules.map(m => (
              <tr key={m.module} className={cn('border-b border-muted/50 hover:bg-muted/30', m.module === 'unknown' && 'bg-red-500/10')}>
                <td className="py-1.5 px-2 font-medium">
                  {formatModuleName(m.module)}
                  {m.module === 'unknown' && <span className="ml-1 text-red-500 text-[10px]">⚠ untagged</span>}
                </td>
                <td className="text-right py-1.5 px-2 tabular-nums">{m.call_count.toLocaleString()}</td>
                <td className="text-right py-1.5 px-2 tabular-nums font-medium">{m.total_tokens.toLocaleString()}</td>
                <td className="text-right py-1.5 px-2 tabular-nums">{m.pct_of_daily}%</td>
                <td className="text-right py-1.5 px-2 tabular-nums">
                  <span className={cn(m.pct_of_budget > 30 ? 'text-amber-600 font-medium' : '')}>{m.pct_of_budget}%</span>
                </td>
                <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">${m.total_cost.toFixed(4)}</td>
                <td className="text-right py-1.5 px-2 tabular-nums">
                  {m.failures > 0 ? <span className="text-red-500">{m.failures}</span> : <span className="text-muted-foreground">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="py-1.5 px-2">Total</td>
              <td className="text-right py-1.5 px-2 tabular-nums">{data.total_calls.toLocaleString()}</td>
              <td className="text-right py-1.5 px-2 tabular-nums">{data.total_tokens.toLocaleString()}</td>
              <td className="text-right py-1.5 px-2 tabular-nums">100%</td>
              <td className="text-right py-1.5 px-2 tabular-nums">{data.budget_used_pct}%</td>
              <td className="text-right py-1.5 px-2 tabular-nums">${data.modules.reduce((s, m) => s + m.total_cost, 0).toFixed(4)}</td>
              <td className="text-right py-1.5 px-2 tabular-nums">{data.modules.reduce((s, m) => s + m.failures, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function HourlyUsageChart({ hourly }: { hourly: AiUsageData['hourly'] }) {
  if (!hourly || hourly.length === 0) return null

  // FIX (Feb 15, 2026 — Task #32795): Show call counts as fallback when all tokens are 0
  // NIM providers were logging 0 tokens, making the chart appear completely empty.
  // Fall back to showing call volume when token data is unavailable.
  const totalTokens = hourly.reduce((s, h) => s + h.tokens, 0)
  const totalCalls = hourly.reduce((s, h) => s + h.calls, 0)
  const useCallsFallback = totalTokens === 0 && totalCalls > 0
  const metric = useCallsFallback ? 'calls' : 'tokens'
  const maxVal = Math.max(...hourly.map(h => h[metric]), 1)

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
        {useCallsFallback ? 'API Calls (Last 24h)' : 'Token Usage (Last 24h)'}
      </p>
      <div className="flex items-end gap-0.5 h-24">
        {hourly.map((h, i) => {
          const val = h[metric]
          const height = Math.max(2, (val / maxVal) * 100)
          return (
            <div
              key={i}
              className={cn('flex-1 rounded-t-sm', val > 0 ? 'bg-primary/60 hover:bg-primary/80' : 'bg-muted/30')}
              style={{ height: `${height}%` }}
              title={`${h.label}: ${h.tokens.toLocaleString()} tokens, ${h.calls} calls`}
            />
          )
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">{hourly[0]?.label}</span>
        <span className="text-[10px] text-muted-foreground">{hourly[hourly.length - 1]?.label}</span>
      </div>
    </div>
  )
}

function AiCallLogTable({ logs }: { logs: AiCallLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No AI calls logged yet</p>
  }
  return (
    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-left">
            <th className="pb-2 font-medium">Time</th>
            <th className="pb-2 font-medium">Module</th>
            <th className="pb-2 font-medium">Modality</th>
            <th className="pb-2 font-medium">Provider</th>
            <th className="pb-2 font-medium text-right">Tokens</th>
            <th className="pb-2 font-medium text-right">Latency</th>
            <th className="pb-2 font-medium text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => {
            const ts = log.created_at || log.createdAt || ''
            const tokens = log.total_tokens || log.totalTokens || 0
            const latency = log.latency_ms || log.latencyMs || 0
            const ok = log.success !== false
            return (
              <tr key={log.id || i} className="border-b border-muted/30 hover:bg-muted/20">
                <td className="py-1.5 text-muted-foreground tabular-nums">{ts ? timeAgo(ts) : '-'}</td>
                <td className="py-1.5">{formatModuleName(log.module)}</td>
                <td className="py-1.5 capitalize">{log.modality}</td>
                <td className="py-1.5 font-mono truncate max-w-[120px]" title={log.model || log.provider}>
                  {formatProviderName(log.provider)}
                </td>
                <td className="py-1.5 text-right tabular-nums">{tokens.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums">{latency}ms</td>
                <td className="py-1.5 text-center">
                  {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" /> : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NlQueryPanel() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [querying, setQuerying] = useState(false)

  const handleQuery = async () => {
    if (!question.trim()) return
    setQuerying(true)
    setAnswer('')
    try {
      const res = await fetch('/api/ai-health/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ question }),
      })
      if (res.ok) {
        const json = await res.json()
        setAnswer(json.answer || 'No answer generated')
      } else {
        setAnswer('Query failed — check console')
      }
    } catch {
      setAnswer('Connection error')
    } finally {
      setQuerying(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Ask About AI Usage</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g., Which AI features cost the most?"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleQuery()}
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <Button size="sm" onClick={handleQuery} disabled={querying || !question.trim()}>
            {querying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['Show me token usage by module', "What's our OpenAI vs NIM split?", 'Which module had the most failures?'].map(q => (
            <button key={q} onClick={() => { setQuestion(q); }} className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground">
              {q}
            </button>
          ))}
        </div>
        {answer && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">{answer}</div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Prompts Tab Components ─────────────────────────────────────────────────

function PromptsPanel({ prompts }: { prompts: PromptData[] }) {
  if (prompts.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No prompts registered yet</p>
          <p className="text-xs text-muted-foreground mt-1">Prompts will appear here as AI features register them</p>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      {prompts.map(prompt => (
        <Card key={prompt.id} className="hover:border-primary/30 transition-colors">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-sm">{prompt.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{prompt.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{formatModuleName(prompt.module)}</Badge>
                <Badge variant="outline" className="text-xs">v{prompt.current_version}</Badge>
                {prompt.is_active ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Active</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Inactive</Badge>
                )}
              </div>
            </div>
            {prompt.description && (
              <p className="text-xs text-muted-foreground mt-2">{prompt.description}</p>
            )}
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span>Calls: <strong className="text-foreground">{prompt.total_calls}</strong></span>
              <span>Avg Tokens: <strong className="text-foreground">{Math.round(Number(prompt.avg_tokens) || 0)}</strong></span>
              <span>Avg Latency: <strong className="text-foreground">{Math.round(Number(prompt.avg_latency_ms) || 0)}ms</strong></span>
              <span>Success: <strong className={cn(
                Number(prompt.success_rate) < 90 ? 'text-red-600' : 'text-emerald-600',
              )}>{Number(prompt.success_rate || 100).toFixed(1)}%</strong></span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function AiHealthPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<HealthData | null>(null)
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [modules, setModules] = useState<ModulesData | null>(null)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [activityLoading, setActivityLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [countdown, setCountdown] = useState(30)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [activityFilter, setActivityFilter] = useState('all')
  // AI monitoring state
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null)
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null)
  const [aiLogs, setAiLogs] = useState<AiCallLog[]>([])
  const [prompts, setPrompts] = useState<PromptData[]>([])
  // Routes monitoring state
  const [routesData, setRoutesData] = useState<RoutesData | null>(null)
  // Verification state
  const [verifyStatus, setVerifyStatus] = useState<{
    verified: boolean
    ageMinutes?: number
    stale?: boolean
    timestamp?: string
    totalTested?: number
    totalWorking?: number
    totalDead?: number
    results?: Array<{
      modality: string
      key: string
      model: string
      status: string
      ms: number
      note?: string
      error?: string
    }>
  } | null>(null)
  const [verifying, setVerifying] = useState(false)

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

  const fetchModules = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/modules', { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setModules(json)
      }
    } catch {
      // Modules are optional — don't block the dashboard
    }
  }, [])

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/routes', { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setRoutesData(json)
      }
    } catch {
      // Routes are optional
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

  const fetchAiUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-health/usage', { credentials: 'include' })
      if (res.ok) setAiUsage(await res.json())
    } catch { /* optional */ }
  }, [])

  const fetchBudget = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-health/budget', { credentials: 'include' })
      if (res.ok) setBudgetData(await res.json())
    } catch { /* optional */ }
  }, [])

  const fetchAiLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-health/logs?realtime=true&limit=100', { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setAiLogs(json.logs || [])
      }
    } catch { /* optional */ }
  }, [])

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-health/prompts', { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setPrompts(json.prompts || [])
      }
    } catch { /* optional */ }
  }, [])

  const fetchVerifyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-health/verify-status', { credentials: 'include' })
      if (res.ok) setVerifyStatus(await res.json())
    } catch { /* optional */ }
  }, [])

  const triggerVerify = useCallback(async () => {
    setVerifying(true)
    try {
      const res = await fetch('/api/ai-health/verify', { method: 'POST', credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setVerifyStatus({ verified: true, ageMinutes: 0, stale: false, ...json })
      }
    } catch { /* optional */ }
    finally { setVerifying(false) }
  }, [])

  useEffect(() => {
    // Initial load
    fetchHealth()
    fetchMetrics()
    fetchModules()
    fetchRoutes()
    fetchActivity()
    fetchAiUsage()
    fetchBudget()
    fetchAiLogs()
    fetchPrompts()
    fetchVerifyStatus()

    // Auto-refresh: health + metrics + modules every 30s, AI monitoring every 15s, activity every 10s
    const healthInterval = setInterval(() => {
      fetchHealth()
      fetchMetrics()
      fetchModules()
      fetchRoutes()
    }, 30000)
    const aiInterval = setInterval(() => {
      fetchAiUsage()
      fetchBudget()
      fetchAiLogs()
    }, 15000)
    const activityInterval = setInterval(() => fetchActivity(), 10000)

    return () => {
      clearInterval(healthInterval)
      clearInterval(aiInterval)
      clearInterval(activityInterval)
    }
  }, [fetchHealth, fetchMetrics, fetchModules, fetchRoutes, fetchActivity, fetchAiUsage, fetchBudget, fetchAiLogs, fetchPrompts, fetchVerifyStatus])

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
    { id: 'monitoring', label: 'AI Monitoring', icon: TrendingUp },
    { id: 'ai', label: 'AI Providers', icon: Brain },
    { id: 'routes', label: 'Routes', icon: Globe },
    { id: 'prompts', label: 'Prompts', icon: FileText },
    { id: 'activity', label: 'Activity Feed', icon: Activity },
  ]

  const modalityEntries = Object.entries(data.modalities)
  const moduleEntries = Object.entries(data.module_chains)

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header bar */}
      <div className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="rounded-lg bg-primary p-1.5 shrink-0">
              <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="font-heading text-base sm:text-lg font-bold truncate">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">HireLoop Monitoring & Control</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
              {countdown}s
            </span>
            <Button variant="outline" size="sm" onClick={() => { fetchHealth(); fetchMetrics(); fetchModules(); fetchRoutes(); fetchActivity(); fetchAiUsage(); fetchBudget(); fetchAiLogs(); fetchPrompts() }} className="gap-1.5 min-h-[44px] px-2 sm:px-3">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground gap-1.5 min-h-[44px] px-2 sm:px-3">
              <Shield className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
        {/* Tab navigation — scrollable on mobile */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1 -mb-px overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
            {tabs.map(tab => {
              const TabIcon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap min-h-[44px] shrink-0',
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/20',
                  )}
                >
                  <TabIcon className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Status Banner (always visible) */}
        <StatusBanner data={data} />

        {/* ─── OVERVIEW TAB ─── */}
        {activeTab === 'overview' && (
          <>
            {/* Platform Module Cards — THE BIG VIEW */}
            {modules && <ModuleCards modules={modules} />}

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
            {/* Verification Banner */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium">
                        Real-Time Provider Verification
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {verifyStatus?.verified
                          ? <>Last verified: <span className={cn('font-medium', verifyStatus.stale ? 'text-amber-600' : 'text-emerald-600')}>{verifyStatus.ageMinutes}m ago</span> · {verifyStatus.totalWorking}/{verifyStatus.totalTested} providers working</>
                          : 'No verification yet — click "Verify Now" to test all providers with real API calls'
                        }
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={triggerVerify}
                    disabled={verifying}
                    className="gap-1.5 shrink-0"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', verifying && 'animate-spin')} />
                    {verifying ? 'Verifying...' : 'Verify Now'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Verification Results Table */}
            {verifyStatus?.verified && verifyStatus.results && verifyStatus.results.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <CardTitle className="text-base">Verification Results</CardTitle>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {verifyStatus.timestamp ? new Date(verifyStatus.timestamp).toLocaleTimeString() : ''}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 font-medium text-muted-foreground">Modality</th>
                          <th className="pb-2 font-medium text-muted-foreground">Provider</th>
                          <th className="pb-2 font-medium text-muted-foreground">Model</th>
                          <th className="pb-2 font-medium text-muted-foreground text-center">Status</th>
                          <th className="pb-2 font-medium text-muted-foreground text-right">Response</th>
                          <th className="pb-2 font-medium text-muted-foreground">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verifyStatus.results.map((r, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2">
                              <Badge variant="outline" className="text-[10px]">
                                {r.modality.toUpperCase()}
                              </Badge>
                            </td>
                            <td className="py-2 font-mono text-xs">{r.key}</td>
                            <td className="py-2 text-xs text-muted-foreground max-w-[200px] truncate">{r.model}</td>
                            <td className="py-2 text-center">
                              {r.status === 'working' ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500 inline-block" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500 inline-block" />
                              )}
                            </td>
                            <td className="py-2 text-right tabular-nums text-xs">
                              <span className={cn(
                                'font-medium',
                                r.ms < 500 ? 'text-emerald-600' : r.ms < 2000 ? 'text-amber-600' : 'text-red-600',
                              )}>
                                {r.ms}ms
                              </span>
                            </td>
                            <td className="py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                              {r.note || r.error || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

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

        {/* ─── AI MONITORING TAB ─── */}
        {activeTab === 'monitoring' && (
          <>
            {/* Budget Prediction + NL Query */}
            <div className="grid gap-4 lg:grid-cols-2">
              {budgetData && <BudgetPredictionPanel budget={budgetData} />}
              <NlQueryPanel />
            </div>

            {/* Usage Summary Cards */}
            {aiUsage && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Card>
                  <CardContent className="p-3 sm:p-4 text-center">
                    <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Total Calls</p>
                    <p className="text-lg sm:text-2xl font-bold tabular-nums">{aiUsage.summary.totalCalls.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 sm:p-4 text-center">
                    <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Total Tokens</p>
                    <p className="text-lg sm:text-2xl font-bold tabular-nums">{aiUsage.summary.totalTokens.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 sm:p-4 text-center">
                    <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Avg Latency</p>
                    <p className="text-lg sm:text-2xl font-bold tabular-nums">{aiUsage.summary.avgLatency}ms</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 sm:p-4 text-center">
                    <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Success Rate</p>
                    <p className={cn('text-lg sm:text-2xl font-bold tabular-nums', aiUsage.summary.successRate < 95 ? 'text-amber-600' : 'text-emerald-600')}>{aiUsage.summary.successRate}%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 sm:p-4 text-center">
                    <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Est. Cost</p>
                    <p className="text-lg sm:text-2xl font-bold tabular-nums">${aiUsage.summary.totalCost.toFixed(4)}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Hourly Chart + Module Breakdown */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">Hourly Usage</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {aiUsage && <HourlyUsageChart hourly={aiUsage.hourly} />}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">Module Cost Breakdown</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {aiUsage && <ModuleCostBreakdown modules={aiUsage.modules} />}
                </CardContent>
              </Card>
            </div>

            {/* Daily Token Breakdown Table */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Daily Token Breakdown by Module</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <DailyTokenBreakdown />
              </CardContent>
            </Card>

            {/* Model Performance Table */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Model Performance Comparison</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {aiUsage && <ModelPerformanceTable models={aiUsage.models} />}
              </CardContent>
            </Card>

            {/* AI Call Log */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">AI Call Log</CardTitle>
                  </div>
                  <Button variant="ghost" size="sm" onClick={fetchAiLogs}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <AiCallLogTable logs={aiLogs} />
              </CardContent>
            </Card>
          </>
        )}

        {/* ─── PROMPTS TAB ─── */}
        {activeTab === 'prompts' && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-heading text-lg font-semibold">Prompt Registry</h2>
                <span className="text-xs text-muted-foreground">({prompts.length} prompts)</span>
              </div>
              <Button variant="outline" size="sm" onClick={fetchPrompts}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
              </Button>
            </div>
            <PromptsPanel prompts={prompts} />
          </>
        )}

        {/* ─── ROUTES TAB ─── */}
        {activeTab === 'routes' && (
          <>
            {routesData ? (
              <>
                {/* Route Summary Cards */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Card>
                    <CardContent className="p-3 sm:p-4 text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Arch Endpoints</p>
                      <p className="text-lg sm:text-2xl font-bold tabular-nums">{routesData.summary.totalArchEndpoints}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 sm:p-4 text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Tracked</p>
                      <p className="text-lg sm:text-2xl font-bold tabular-nums">{routesData.summary.totalTrackedEndpoints}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 sm:p-4 text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Route Files</p>
                      <p className="text-lg sm:text-2xl font-bold tabular-nums">{routesData.summary.routeFiles}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 sm:p-4 text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Req/min</p>
                      <p className="text-lg sm:text-2xl font-bold tabular-nums">{routesData.summary.api?.requestsPerMinute || 0}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* API Latency Overview */}
                {routesData.summary.api?.latency && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Timer className="h-5 w-5 text-muted-foreground" />
                        <CardTitle className="text-base">API Latency Percentiles</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          { label: 'p50', value: routesData.summary.api.latency.p50 },
                          { label: 'p95', value: routesData.summary.api.latency.p95 },
                          { label: 'p99', value: routesData.summary.api.latency.p99 },
                          { label: 'avg', value: routesData.summary.api.latency.avg },
                        ].map(item => (
                          <div key={item.label} className="rounded-lg bg-muted/50 p-3 text-center">
                            <p className="text-xs font-semibold text-muted-foreground uppercase">{item.label}</p>
                            <p className={cn('text-lg sm:text-xl font-bold tabular-nums', item.value > 2000 ? 'text-red-600' : item.value > 500 ? 'text-amber-600' : 'text-emerald-600')}>
                              {item.value}ms
                            </p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Route Files Breakdown */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Globe className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-base">Route Files ({routesData.routeFiles.length} files, {routesData.summary.totalArchEndpoints} endpoints)</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 font-medium text-muted-foreground">File</th>
                            <th className="pb-2 font-medium text-muted-foreground">Domain</th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">Endpoints</th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">% of Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {routesData.routeFiles.sort((a, b) => b.endpoints - a.endpoints).map((rf) => (
                            <tr key={rf.file} className="border-b border-muted/50 hover:bg-muted/30">
                              <td className="py-2 font-mono text-xs">{rf.file}</td>
                              <td className="py-2">{rf.domain}</td>
                              <td className="py-2 text-right tabular-nums font-medium">{rf.endpoints}</td>
                              <td className="py-2 text-right tabular-nums text-muted-foreground">
                                {((rf.endpoints / routesData.summary.totalArchEndpoints) * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Tracked Endpoint Performance */}
                {routesData.trackedEndpoints.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Activity className="h-5 w-5 text-muted-foreground" />
                        <CardTitle className="text-base">Endpoint Performance ({routesData.trackedEndpoints.length} tracked)</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-2 font-medium text-muted-foreground">Endpoint</th>
                              <th className="pb-2 font-medium text-muted-foreground text-right">Requests</th>
                              <th className="pb-2 font-medium text-muted-foreground text-right">Errors</th>
                              <th className="pb-2 font-medium text-muted-foreground text-right">Error %</th>
                              <th className="pb-2 font-medium text-muted-foreground text-right">p50</th>
                              <th className="pb-2 font-medium text-muted-foreground text-right">p95</th>
                              <th className="pb-2 font-medium text-muted-foreground text-right">p99</th>
                            </tr>
                          </thead>
                          <tbody>
                            {routesData.trackedEndpoints.map((ep) => (
                              <tr key={ep.path} className="border-b border-muted/50 hover:bg-muted/30">
                                <td className="py-2 font-mono text-xs max-w-[300px] truncate" title={ep.path}>{ep.path}</td>
                                <td className="py-2 text-right tabular-nums">{ep.total}</td>
                                <td className="py-2 text-right tabular-nums">{ep.errors}</td>
                                <td className="py-2 text-right tabular-nums">
                                  <span className={cn(
                                    parseFloat(ep.errorRate) > 10 ? 'text-red-600 font-semibold' :
                                    parseFloat(ep.errorRate) > 1 ? 'text-amber-600' : 'text-muted-foreground'
                                  )}>
                                    {ep.errorRate}
                                  </span>
                                </td>
                                <td className="py-2 text-right tabular-nums">{ep.p50}ms</td>
                                <td className="py-2 text-right tabular-nums">
                                  <span className={cn(ep.p95 > 2000 ? 'text-red-600' : ep.p95 > 500 ? 'text-amber-600' : '')}>
                                    {ep.p95}ms
                                  </span>
                                </td>
                                <td className="py-2 text-right tabular-nums">
                                  <span className={cn(ep.p99 > 5000 ? 'text-red-600' : ep.p99 > 2000 ? 'text-amber-600' : '')}>
                                    {ep.p99}ms
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Loading route metrics...</p>
                </CardContent>
              </Card>
            )}
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
