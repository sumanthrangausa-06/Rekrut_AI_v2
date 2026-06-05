import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Users, Clock, CheckCircle2, AlertCircle, Loader2, 
  Play, Pause, GitBranch, Server, Activity,
  RefreshCw, Circle, XCircle
} from 'lucide-react'
import { getToken } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────────────────

interface TeamMember {
  id: string
  name: string
  role: string
  status: 'active' | 'idle' | 'blocked'
  current_task: string
  task_status: 'todo' | 'in-progress' | 'review' | 'done' | 'blocked'
  progress: number
  started_at: string
  last_update: string
  eta: string
  blockers: string[]
  notes: string[]
}

interface Deployment {
  url: string
  status: 'live' | 'failed' | 'deploying'
  branch: string
  last_deploy: string
  health_check: string
  notes?: string
}

interface Commit {
  sha: string
  message: string
  author: string
  branch: string
  time: string
}

interface TeamData {
  team_members: TeamMember[]
  deployments: Record<string, Deployment>
  recent_commits: Commit[]
  stats: {
    total_members: number
    active: number
    idle: number
    blocked: number
    tasks_in_progress: number
    tasks_done: number
    deployments_live: number
    deployments_failed: number
  }
}

// ─── Status Config ───────────────────────────────────────────────────────

const memberStatusConfig = {
  'active': { label: 'Active', color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle2 },
  'idle': { label: 'Idle', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: Circle },
  'blocked': { label: 'Blocked', color: 'bg-red-100 text-red-700 border-red-200', icon: XCircle },
}

const taskStatusConfig = {
  'todo': { label: 'To Do', color: 'bg-slate-100 text-slate-600' },
  'in-progress': { label: 'In Progress', color: 'bg-blue-100 text-blue-600' },
  'review': { label: 'Review', color: 'bg-amber-100 text-amber-600' },
  'done': { label: 'Done', color: 'bg-green-100 text-green-600' },
  'blocked': { label: 'Blocked', color: 'bg-red-100 text-red-600' },
}

const deployStatusConfig = {
  'live': { label: 'Live', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  'failed': { label: 'Failed', color: 'bg-red-100 text-red-700', icon: XCircle },
  'deploying': { label: 'Deploying', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
}

// ─── API ─────────────────────────────────────────────────────────────────

const API_URL = '/api/admin/team-status'
const POLL_INTERVAL = 30000 // 30 seconds

// ─── Components ──────────────────────────────────────────────────────────

function TeamMemberCard({ member }: { member: TeamMember }) {
  const status = memberStatusConfig[member.status]
  const taskStatus = taskStatusConfig[member.task_status]
  const StatusIcon = status.icon

  return (
    <Card className="border shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm">{member.name}</p>
            <p className="text-xs text-muted-foreground">{member.role}</p>
          </div>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${status.color}`}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {status.label}
          </Badge>
        </div>

        {/* Current Task */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Current Task</p>
          <p className="text-sm">{member.current_task}</p>
          <Badge variant="secondary" className={`text-[10px] ${taskStatus.color}`}>
            {taskStatus.label}
          </Badge>
        </div>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">{member.progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div 
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${member.progress}%` }}
            />
          </div>
        </div>

        {/* Blockers */}
        {member.blockers.length > 0 && (
          <div className="rounded-md bg-red-50 border border-red-100 p-2 space-y-1">
            <div className="flex items-center gap-1 text-xs text-red-700 font-medium">
              <AlertCircle className="h-3 w-3" />
              Blockers
            </div>
            {member.blockers.map((blocker, i) => (
              <p key={i} className="text-xs text-red-600">• {blocker}</p>
            ))}
          </div>
        )}

        {/* Notes */}
        {member.notes.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Recent Updates</p>
            <ul className="space-y-0.5">
              {member.notes.slice(0, 3).map((note, i) => (
                <li key={i} className="text-xs text-muted-foreground">• {note}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>ETA: {member.eta}</span>
          </div>
          <div className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            <span>Updated: {new Date(member.last_update).toLocaleTimeString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DeploymentCard({ name, deployment }: { name: string; deployment: Deployment }) {
  const status = deployStatusConfig[deployment.status]
  const StatusIcon = status.icon

  return (
    <Card className="border shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm capitalize">{name}</span>
          </div>
          <Badge variant="outline" className={`text-[10px] ${status.color}`}>
            <StatusIcon className={`h-3 w-3 mr-1 ${deployment.status === 'deploying' ? 'animate-spin' : ''}`} />
            {status.label}
          </Badge>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">URL</p>
          <a 
            href={deployment.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline break-all"
          >
            {deployment.url}
          </a>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Branch</p>
            <p className="font-medium">{deployment.branch}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Health</p>
            <p className="font-medium">{deployment.health_check}</p>
          </div>
        </div>

        {deployment.notes && (
          <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100">
            {deployment.notes}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────

export function TeamStatusPage() {
  const [data, setData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const fetchData = useCallback(async () => {
    try {
      const token = getToken()
      const res = await fetch(API_URL, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      })
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      
      const json = await res.json()
      
      if (json.success && json.data) {
        setData(json.data)
        setLastUpdated(new Date())
        setError(null)
      } else {
        throw new Error('Invalid response format')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch team status')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + polling
  useEffect(() => {
    fetchData()
    
    if (!autoRefresh) return
    
    const interval = setInterval(fetchData, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchData, autoRefresh])

  const stats = data?.stats || {
    total_members: 0,
    active: 0,
    idle: 0,
    blocked: 0,
    tasks_in_progress: 0,
    tasks_done: 0,
    deployments_live: 0,
    deployments_failed: 0
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Team Status</h1>
          <p className="text-muted-foreground">
            Real-time team progress and deployment status
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1.5"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {autoRefresh ? 'Pause' : 'Resume'}
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1.5"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span className="font-medium">Error loading team status:</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-2xl font-bold">{stats.total_members}</span>
            </div>
            <p className="text-xs text-muted-foreground">Team Members</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold">{stats.active}</span>
            </div>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
              <span className="text-2xl font-bold">{stats.tasks_in_progress}</span>
            </div>
            <p className="text-xs text-muted-foreground">Tasks In Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold">{stats.tasks_done}</span>
            </div>
            <p className="text-xs text-muted-foreground">Tasks Done</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-2xl font-bold">{stats.blocked}</span>
            </div>
            <p className="text-xs text-muted-foreground">Blocked</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              <span className="text-2xl font-bold">{stats.deployments_live}</span>
            </div>
            <p className="text-xs text-muted-foreground">Live Deployments</p>
          </CardContent>
        </Card>
      </div>

      {/* Deployments */}
      <div className="space-y-3">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Server className="h-5 w-5" />
          Deployments
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data && Object.entries(data.deployments).map(([name, deployment]) => (
            <DeploymentCard key={name} name={name} deployment={deployment} />
          ))}
          {!data && Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border shadow-sm animate-pulse">
              <CardContent className="p-4 h-32" />
            </Card>
          ))}
        </div>
      </div>

      {/* Team Members */}
      <div className="space-y-3">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Team Members
          <span className="text-xs text-muted-foreground ml-auto">
            Last updated: {lastUpdated.toLocaleTimeString()}
            {autoRefresh && (
              <span className="ml-1 text-green-600">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              </span>
            )}
          </span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.team_members.map(member => (
            <TeamMemberCard key={member.id} member={member} />
          ))}
          {!data && Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border shadow-sm animate-pulse">
              <CardContent className="p-4 h-64" />
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Commits */}
      <div className="space-y-3">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          Recent Commits
        </h2>
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-48">
              <div className="divide-y">
                {data?.recent_commits.map((commit, i) => (
                  <div key={i} className="p-3 flex items-start gap-3">
                    <div className="p-1.5 rounded-md bg-primary/10 shrink-0">
                      <GitBranch className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{commit.message}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono bg-muted px-1 rounded">{commit.sha.slice(0, 7)}</span>
                        <span>{commit.author}</span>
                        <span>•</span>
                        <span>{commit.branch}</span>
                        <span>•</span>
                        <span>{new Date(commit.time).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {!data?.recent_commits?.length && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No recent commits
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
