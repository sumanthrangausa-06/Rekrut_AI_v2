import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  Sparkles, Loader2, CheckCircle, Circle, Clock, AlertTriangle,
  User, ChevronRight, ArrowLeft, Target, Rocket, Users as UsersIcon,
  ListChecks, TrendingUp, Briefcase, CalendarCheck, ChevronDown, ChevronUp,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────

interface OnboardingPlan {
  id: number
  role_title: string
  department: string | null
  status: string
  progress_pct: number
  total_tasks: number
  completed_tasks: number
  target_completion: string | null
  started_at: string | null
  created_at: string
  candidate_name?: string
  candidate_email?: string
  completed_count?: number
  total_count?: number
}

interface OnboardingTask {
  id: number
  title: string
  description: string
  phase: string
  category: string
  assigned_to: string
  status: string
  sort_order: number
}

interface PhaseProgress {
  phase: string
  total: number
  completed: number
  progress_pct: number
  tasks: OnboardingTask[]
}

interface ProgressData {
  plan: OnboardingPlan
  overall_progress: number
  total_tasks: number
  completed_tasks: number
  days_since_start: number
  phase_progress: PhaseProgress[]
  next_actions: OnboardingTask[]
  overdue_tasks: OnboardingTask[]
  is_on_track: boolean
}

interface Candidate {
  id: number
  name: string
  email: string
}

interface Job {
  id: number
  title: string
  department?: string
}

// ─── Phase Config ───────────────────────────────────────────────────────

const PHASE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  day_1: { label: 'Day 1', icon: Rocket, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  week_1: { label: 'Week 1', icon: UsersIcon, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  month_1: { label: 'Month 1', icon: Target, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
}

// ─── Component ──────────────────────────────────────────────────────────

export function AiOnboardingRecruiter() {
  const [plans, setPlans] = useState<OnboardingPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Plan generation
  const [showGenerator, setShowGenerator] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [roleTitle, setRoleTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [jobId, setJobId] = useState('')

  // Plan detail view
  const [selectedPlan, setSelectedPlan] = useState<ProgressData | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set())

  // Available candidates and jobs
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    loadPlans()
    loadCandidatesAndJobs()
  }, [])

  async function loadPlans() {
    try {
      setLoading(true)
      const data = await apiCall<OnboardingPlan[]>('/onboarding/plans/list')
      setPlans(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadCandidatesAndJobs() {
    try {
      const [cands, jobsList] = await Promise.all([
        apiCall<Candidate[]>('/candidate/list').catch(() => []),
        apiCall<Job[]>('/jobs').catch(() => []),
      ])
      setCandidates(Array.isArray(cands) ? cands : [])
      setJobs(Array.isArray(jobsList) ? (jobsList as any).jobs || jobsList : [])
    } catch { /* non-fatal */ }
  }

  async function generatePlan() {
    if (!roleTitle.trim()) {
      setError('Role title is required')
      return
    }
    setGenerating(true)
    setError('')
    try {
      await apiCall('/onboarding/generate-plan', {
        method: 'POST',
        body: JSON.stringify({
          role_title: roleTitle.trim(),
          department: department.trim() || null,
          candidate_id: candidateId ? parseInt(candidateId) : null,
          job_id: jobId ? parseInt(jobId) : null,
        }),
      })
      setShowGenerator(false)
      setRoleTitle('')
      setDepartment('')
      setCandidateId('')
      setJobId('')
      await loadPlans()
    } catch (err: any) {
      setError(err.message || 'Failed to generate plan')
    } finally {
      setGenerating(false)
    }
  }

  async function viewPlanDetail(planId: number) {
    try {
      setLoadingPlan(true)
      const data = await apiCall<ProgressData>(`/onboarding/${planId}/progress`)
      setSelectedPlan(data)
      // Expand all phases by default
      const phases = data.phase_progress.map(p => p.phase)
      setExpandedPhases(new Set(phases))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingPlan(false)
    }
  }

  function togglePhase(phase: string) {
    setExpandedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  // ─── Loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading AI onboarding plans...</p>
      </div>
    )
  }

  // ─── Plan Detail View ─────────────────────────────────────────────────
  if (selectedPlan) {
    const p = selectedPlan
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setSelectedPlan(null)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to all plans
        </Button>

        {/* Plan Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {p.plan.role_title}
              {p.plan.department && <span className="text-muted-foreground font-normal text-base">· {p.plan.department}</span>}
            </h2>
            {p.plan.candidate_name && (
              <p className="text-sm text-muted-foreground mt-1">
                <User className="h-3 w-3 inline mr-1" />
                {p.plan.candidate_name} {p.plan.candidate_email ? `(${p.plan.candidate_email})` : ''}
              </p>
            )}
          </div>
          <Badge variant={p.is_on_track ? 'success' : 'warning'} className="w-fit">
            {p.is_on_track ? 'On Track' : `${p.overdue_tasks.length} Overdue`}
          </Badge>
        </div>

        {/* Progress Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{p.overall_progress}%</p>
              <p className="text-xs text-muted-foreground">Progress</p>
              <div className="h-2 rounded-full bg-muted overflow-hidden mt-2">
                <div className={`h-full rounded-full ${p.overall_progress === 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${p.overall_progress}%` }} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{p.completed_tasks}/{p.total_tasks}</p>
              <p className="text-xs text-muted-foreground">Tasks Done</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">Day {p.days_since_start + 1}</p>
              <p className="text-xs text-muted-foreground">of Onboarding</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className={`text-2xl font-bold ${p.overdue_tasks.length > 0 ? 'text-destructive' : 'text-green-600'}`}>
                {p.overdue_tasks.length}
              </p>
              <p className="text-xs text-muted-foreground">Overdue</p>
            </CardContent>
          </Card>
        </div>

        {/* Phase Breakdown */}
        <div className="space-y-3">
          {p.phase_progress.map((phase) => {
            const config = PHASE_CONFIG[phase.phase] || { label: phase.phase, icon: Briefcase, color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' }
            const PhaseIcon = config.icon
            const isExpanded = expandedPhases.has(phase.phase)

            return (
              <Card key={phase.phase}>
                <CardContent className="p-0">
                  <button
                    onClick={() => togglePhase(phase.phase)}
                    className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-lg ${config.bg} border flex items-center justify-center`}>
                        <PhaseIcon className={`h-4 w-4 ${config.color}`} />
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-sm">{config.label}</p>
                        <p className="text-xs text-muted-foreground">{phase.completed}/{phase.total} done</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${phase.progress_pct === 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${phase.progress_pct}%` }} />
                      </div>
                      <span className="text-xs font-medium w-8 text-right">{phase.progress_pct}%</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t px-4 pb-3 space-y-1.5 pt-2">
                      {phase.tasks.map((task) => (
                        <div key={task.id} className={`flex items-center gap-2 p-2.5 rounded-lg text-sm ${
                          task.status === 'completed' ? 'bg-green-50/50 text-muted-foreground' : 'bg-background'
                        }`}>
                          {task.status === 'completed' ? (
                            <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                          ) : task.status === 'in_progress' ? (
                            <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                          )}
                          <span className={task.status === 'completed' ? 'line-through' : ''}>{task.title}</span>
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 shrink-0">
                            {task.assigned_to}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    )
  }

  // ─── Main Plans List ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Header + Generate Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Onboarding Plans
          </h2>
          <p className="text-sm text-muted-foreground">
            Generate personalized onboarding plans for new hires
          </p>
        </div>
        <Button onClick={() => setShowGenerator(!showGenerator)} className="gap-2">
          <Sparkles className="h-4 w-4" />
          Generate New Plan
        </Button>
      </div>

      {/* Plan Generator Form */}
      {showGenerator && (
        <Card className="border-primary/30">
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Generate AI Onboarding Plan
            </h3>
            <p className="text-sm text-muted-foreground">
              AI will create a role-specific 30-day onboarding plan with tasks, milestones, and assignments.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Role Title *</Label>
                <Input
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g., Software Engineer, Sales Rep"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Department</Label>
                <Input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g., Engineering, Sales"
                  className="mt-1"
                />
              </div>
            </div>

            {(candidates.length > 0 || jobs.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {candidates.length > 0 && (
                  <div>
                    <Label>Assign to Candidate (optional)</Label>
                    <Select
                      value={candidateId}
                      onChange={(e) => setCandidateId(e.target.value)}
                      className="mt-1"
                    >
                      <option value="">None selected</option>
                      {candidates.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                      ))}
                    </Select>
                  </div>
                )}
                {jobs.length > 0 && (
                  <div>
                    <Label>Link to Job (optional)</Label>
                    <Select
                      value={jobId}
                      onChange={(e) => setJobId(e.target.value)}
                      className="mt-1"
                    >
                      <option value="">None selected</option>
                      {jobs.map(j => (
                        <option key={j.id} value={j.id}>{j.title}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowGenerator(false)}>Cancel</Button>
              <Button onClick={generatePlan} disabled={generating || !roleTitle.trim()} className="gap-2">
                {generating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Generate Plan</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plans List */}
      {plans.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <ListChecks className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No AI Plans Yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Click "Generate New Plan" to create a personalized 30-day onboarding plan for a new hire.
              AI will create role-specific tasks, milestones, and assignments.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => {
            const pct = plan.total_count && plan.total_count > 0
              ? Math.round(((plan.completed_count || 0) / plan.total_count) * 100)
              : plan.progress_pct || 0

            return (
              <Card
                key={plan.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => viewPlanDetail(plan.id)}
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Sparkles className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{plan.role_title}</h3>
                        {plan.department && (
                          <Badge variant="secondary" className="text-xs">{plan.department}</Badge>
                        )}
                        <Badge
                          variant={plan.status === 'active' ? 'success' : plan.status === 'completed' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {plan.status}
                        </Badge>
                      </div>
                      {plan.candidate_name && (
                        <p className="text-sm text-muted-foreground truncate">
                          <User className="h-3 w-3 inline mr-1" />
                          {plan.candidate_name}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Created {new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {plan.target_completion && (
                          <> · Target: {new Date(plan.target_completion).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                        )}
                      </p>
                    </div>

                    <div className="hidden sm:flex items-center gap-4">
                      <div className="w-28">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-medium">{pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-primary'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Mobile progress */}
                  <div className="sm:hidden mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {loadingPlan && (
        <div className="fixed inset-0 bg-background/50 flex items-center justify-center z-50">
          <div className="bg-background p-6 rounded-xl border shadow-lg flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>Loading plan details...</span>
          </div>
        </div>
      )}
    </div>
  )
}
