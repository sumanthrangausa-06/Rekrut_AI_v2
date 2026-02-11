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
  modalities: Record<string, ModalityInfo>
  module_chains: Record<string, Record<string, ModuleChainInfo>>
  recent_logs: Array<{
    time: string
    event: string
    modality: string
    from: string
    to: string
    reason: string
  }>
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

// ─── Components ──────────────────────────────────────────────────────────────

function StatusBanner({ data }: { data: HealthData }) {
  const status = getOverallStatus(data)
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
              {data.total_models_registered} models registered &middot; NIM {data.nim_configured ? 'enabled' : 'disabled'} &middot; Updated {new Date(data.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end text-right">
            <span className="text-2xl font-bold tabular-nums">{data.stats.totalCalls.toLocaleString()}</span>
            <span className="text-xs text-white/70">Total API Calls</span>
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
                {availableCount}/{modality.chain_depth} providers available
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
                {i === 0 && !isActive && (
                  <span className="text-[10px] text-muted-foreground ml-1">primary</span>
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

  // Calculate health: all chains healthy?
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
          <div className="min-w-0">
            <span className="font-medium text-sm">{meta.label}</span>
            <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{meta.description}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Modality pills */}
          <div className="hidden sm:flex items-center gap-1.5">
            {modalityKeys.map(mod => {
              const modMeta = MODALITY_META[mod]
              const chain = chains[mod]
              const isHealthy = chain.available_count === chain.chain_depth
              return (
                <div
                  key={mod}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    isHealthy ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                  )}
                  title={`${modMeta?.label || mod}: ${chain.available_count}/${chain.chain_depth} (${chain.variant})`}
                >
                  {modMeta?.label || mod}
                </div>
              )
            })}
          </div>
          {/* Health bar */}
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
                          {i < chain.providers.length - 1 && (
                            <span className="text-muted-foreground/50 ml-auto shrink-0">&rarr;</span>
                          )}
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
          <div className="shrink-0">
            <Clock className="h-3 w-3 text-muted-foreground mt-0.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[9px]">{log.modality || 'unknown'}</Badge>
              <span className="font-medium">
                {formatProviderName(log.from || '?')} &rarr; {formatProviderName(log.to || '?')}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 truncate">{log.reason || log.event || 'Failover'}</p>
            {log.time && (
              <p className="text-muted-foreground/70 mt-0.5">{new Date(log.time).toLocaleString()}</p>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [countdown, setCountdown] = useState(30)

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

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [fetchHealth])

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
          <p className="text-sm text-muted-foreground">Loading AI Health Dashboard...</p>
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
              <h1 className="font-heading text-lg font-bold">AI Health Dashboard</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">HireLoop Provider Status & Fallback Chains</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
              Refreshing in {countdown}s
            </span>
            <Button variant="outline" size="sm" onClick={fetchHealth} className="gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Status Banner */}
        <StatusBanner data={data} />

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

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pb-4">
          HireLoop AI Health Dashboard &middot; Auto-refreshes every 30 seconds &middot; Last update: {lastRefresh.toLocaleString()}
        </div>
      </div>
    </div>
  )
}
