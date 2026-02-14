import { useEffect, useState, useRef } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  CheckCircle, Circle, Clock, Sparkles, Send, Loader2,
  ListChecks, MessageCircle, TrendingUp, AlertTriangle,
  ChevronDown, ChevronUp, User, Bot, Rocket, Target,
  CalendarCheck, Users, Briefcase, ArrowRight,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────

interface OnboardingTask {
  id: number
  title: string
  description: string
  phase: string
  day_range: string
  category: string
  assigned_to: string
  is_required: boolean
  sort_order: number
  status: string
  completed_at: string | null
  notes: string | null
}

interface PlanData {
  plan_summary?: string
  milestones?: Array<{ day: number; title: string; description: string }>
}

interface OnboardingPlan {
  id: number
  role_title: string
  department: string | null
  plan_data: PlanData
  status: string
  progress_pct: number
  total_tasks: number
  completed_tasks: number
  target_completion: string | null
  started_at: string | null
  created_at: string
  completed_count?: number
  total_count?: number
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

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

// ─── Phase Labels ───────────────────────────────────────────────────────

const PHASE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  day_1: { label: 'Day 1 — Welcome & Setup', icon: Rocket, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  week_1: { label: 'Week 1 — Learning & Integration', icon: Users, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  month_1: { label: 'Month 1 — Contribution & Growth', icon: Target, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
}

const CATEGORY_ICONS: Record<string, string> = {
  paperwork: '📋', setup: '⚙️', introductions: '🤝', training: '📚',
  project: '🚀', review: '📊', general: '📌',
}

// ─── Component ──────────────────────────────────────────────────────────

export function AiOnboardingDashboard() {
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<OnboardingPlan[]>([])
  const [activePlan, setActivePlan] = useState<ProgressData | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [error, setError] = useState('')

  // Chatbot state
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Task completion
  const [completingTask, setCompletingTask] = useState<number | null>(null)

  // Expanded phases
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(['day_1']))

  useEffect(() => {
    loadPlans()
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  async function loadPlans() {
    try {
      setLoading(true)
      const data = await apiCall<OnboardingPlan[]>('/onboarding/plans/mine')
      setPlans(data)
      // Auto-load the first active plan
      if (data.length > 0) {
        const activePlanItem = data.find(p => p.status === 'active') || data[0]
        await loadPlanProgress(activePlanItem.id)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPlanProgress(planId: number) {
    try {
      setLoadingPlan(true)
      const data = await apiCall<ProgressData>(`/onboarding/${planId}/progress`)
      setActivePlan(data)
      // Expand the first phase with pending tasks
      const firstPending = data.phase_progress.find(p => p.completed < p.total)
      if (firstPending) {
        setExpandedPhases(new Set([firstPending.phase]))
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingPlan(false)
    }
  }

  async function completeTask(taskId: number) {
    try {
      setCompletingTask(taskId)
      await apiCall(`/onboarding/tasks/${taskId}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      // Reload plan progress
      if (activePlan) {
        await loadPlanProgress(activePlan.plan.id)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCompletingTask(null)
    }
  }

  async function sendChatMessage() {
    if (!chatInput.trim() || chatLoading) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date().toISOString() }])
    setChatLoading(true)

    try {
      const data = await apiCall<{ response: string }>('/onboarding/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: userMsg,
          plan_id: activePlan?.plan.id || null,
        }),
      })
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response, timestamp: new Date().toISOString() }])
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble processing that. Please try again.', timestamp: new Date().toISOString() }])
    } finally {
      setChatLoading(false)
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
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading your onboarding plan...</p>
      </div>
    )
  }

  // ─── No Plan ──────────────────────────────────────────────────────────
  if (plans.length === 0 && !activePlan) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">No AI Onboarding Plan Yet</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Your employer will generate a personalized AI onboarding plan for you.
              Once it's ready, you'll see your tasks, timeline, and an AI assistant to guide you through every step.
            </p>
          </CardContent>
        </Card>

        {/* Still show the chatbot for general questions */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <MessageCircle className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">AI Onboarding Assistant</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Have questions about the onboarding process? Ask the AI assistant.
            </p>
            <ChatWidget
              messages={chatMessages}
              input={chatInput}
              loading={chatLoading}
              onInputChange={setChatInput}
              onSend={sendChatMessage}
              chatEndRef={chatEndRef}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Plan Dashboard ───────────────────────────────────────────────────
  const progress = activePlan
  const plan = progress?.plan
  const planData = plan?.plan_data as PlanData | undefined

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Progress Overview */}
      {progress && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {plan?.role_title} Onboarding
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {planData?.plan_summary || `Your personalized onboarding plan${plan?.department ? ` for ${plan.department}` : ''}`}
              </p>
            </div>
            <Badge
              variant={progress.is_on_track ? 'success' : 'warning'}
              className="text-sm px-3 py-1 w-fit"
            >
              {progress.is_on_track ? (
                <><CheckCircle className="h-4 w-4 mr-1" /> On Track</>
              ) : (
                <><AlertTriangle className="h-4 w-4 mr-1" /> Needs Attention</>
              )}
            </Badge>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-blue-700" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{progress.overall_progress}%</p>
                    <p className="text-xs text-muted-foreground">Overall Progress</p>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden mt-3">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      progress.overall_progress === 100 ? 'bg-green-500' : 'bg-primary'
                    }`}
                    style={{ width: `${progress.overall_progress}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <CheckCircle className="h-5 w-5 text-green-700" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{progress.completed_tasks}/{progress.total_tasks}</p>
                    <p className="text-xs text-muted-foreground">Tasks Done</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                    <CalendarCheck className="h-5 w-5 text-amber-700" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">Day {progress.days_since_start + 1}</p>
                    <p className="text-xs text-muted-foreground">of Onboarding</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-red-700" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{progress.overdue_tasks.length}</p>
                    <p className="text-xs text-muted-foreground">Overdue Tasks</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Next Actions */}
          {progress.next_actions.length > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-5">
                <h3 className="font-semibold flex items-center gap-2 mb-3">
                  <ArrowRight className="h-4 w-4 text-primary" />
                  Your Next Steps
                </h3>
                <div className="space-y-2">
                  {progress.next_actions.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background border">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg">{CATEGORY_ICONS[task.category] || '📌'}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => completeTask(task.id)}
                        disabled={completingTask === task.id}
                        className="shrink-0"
                      >
                        {completingTask === task.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <><CheckCircle className="h-4 w-4 mr-1" /> Done</>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Overdue Tasks Warning */}
          {progress.overdue_tasks.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-5">
                <h3 className="font-semibold flex items-center gap-2 mb-3 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Overdue Tasks
                </h3>
                <div className="space-y-2">
                  {progress.overdue_tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background border border-destructive/20">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg">{CATEGORY_ICONS[task.category] || '⚠️'}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{task.title}</p>
                          <p className="text-xs text-muted-foreground">{task.phase === 'day_1' ? 'Due Day 1' : 'Due Week 1'}</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => completeTask(task.id)}
                        disabled={completingTask === task.id}
                        className="shrink-0"
                      >
                        {completingTask === task.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <><CheckCircle className="h-4 w-4 mr-1" /> Done</>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Phase Breakdown */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              Onboarding Checklist
            </h3>
            {progress.phase_progress.map((phase) => {
              const config = PHASE_CONFIG[phase.phase] || { label: phase.phase, icon: Briefcase, color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' }
              const PhaseIcon = config.icon
              const isExpanded = expandedPhases.has(phase.phase)

              return (
                <Card key={phase.phase} className={`border ${phase.progress_pct === 100 ? 'border-green-200 bg-green-50/30' : ''}`}>
                  <CardContent className="p-0">
                    {/* Phase Header */}
                    <button
                      onClick={() => togglePhase(phase.phase)}
                      className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors rounded-t-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-lg ${config.bg} border flex items-center justify-center`}>
                          <PhaseIcon className={`h-4 w-4 ${config.color}`} />
                        </div>
                        <div className="text-left">
                          <p className="font-medium text-sm">{config.label}</p>
                          <p className="text-xs text-muted-foreground">{phase.completed}/{phase.total} tasks complete</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${phase.progress_pct === 100 ? 'bg-green-500' : 'bg-primary'}`}
                            style={{ width: `${phase.progress_pct}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-10 text-right">{phase.progress_pct}%</span>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>

                    {/* Phase Tasks */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 space-y-2 pt-3">
                        {phase.tasks.map((task) => (
                          <div
                            key={task.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                              task.status === 'completed' ? 'bg-green-50/50 border-green-200' : 'bg-background hover:bg-muted/30'
                            }`}
                          >
                            {task.status === 'completed' ? (
                              <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                            ) : task.status === 'in_progress' ? (
                              <Clock className="h-5 w-5 text-amber-500 shrink-0" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                                {CATEGORY_ICONS[task.category] || ''} {task.title}
                              </p>
                              {task.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>
                              )}
                              <div className="flex gap-2 mt-1">
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {task.assigned_to === 'new_hire' ? 'You' : task.assigned_to}
                                </Badge>
                                {task.is_required && (
                                  <Badge variant="default" className="text-[10px] px-1.5 py-0">Required</Badge>
                                )}
                              </div>
                            </div>
                            {task.status !== 'completed' && task.assigned_to === 'new_hire' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => completeTask(task.id)}
                                disabled={completingTask === task.id}
                                className="shrink-0"
                              >
                                {completingTask === task.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  'Mark Done'
                                )}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Milestones */}
          {planData?.milestones && planData.milestones.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Target className="h-5 w-5 text-primary" />
                  Milestones
                </h3>
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-muted" />
                  <div className="space-y-4">
                    {planData.milestones.map((m, i) => {
                      const reached = progress.days_since_start >= m.day
                      return (
                        <div key={i} className="flex items-start gap-4 relative">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10 ${
                            reached ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            {reached ? <CheckCircle className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{m.title}</p>
                            <p className="text-xs text-muted-foreground">{m.description}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Day {m.day}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* AI Chatbot */}
      <Card>
        <CardContent className="p-5">
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <MessageCircle className="h-4 w-4 text-white" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-sm">AI Onboarding Assistant</h3>
                <p className="text-xs text-muted-foreground">Ask about tasks, policies, or who to contact</p>
              </div>
            </div>
            {chatOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {chatOpen && (
            <div className="mt-4 border-t pt-4">
              <ChatWidget
                messages={chatMessages}
                input={chatInput}
                loading={chatLoading}
                onInputChange={setChatInput}
                onSend={sendChatMessage}
                chatEndRef={chatEndRef}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Chat Widget ────────────────────────────────────────────────────────

function ChatWidget({
  messages,
  input,
  loading,
  onInputChange,
  onSend,
  chatEndRef,
}: {
  messages: ChatMessage[]
  input: string
  loading: boolean
  onInputChange: (v: string) => void
  onSend: () => void
  chatEndRef: React.RefObject<HTMLDivElement>
}) {
  return (
    <div>
      {/* Messages */}
      <div className="min-h-[120px] max-h-[400px] overflow-y-auto space-y-3 mb-4 p-3 rounded-lg bg-muted/30 border">
        {messages.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Bot className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p>Hi! I'm your onboarding assistant.</p>
            <p className="text-xs mt-1">Ask me about your tasks, company policies, or who to talk to.</p>
            <div className="flex flex-wrap gap-2 justify-center mt-3">
              {['What should I do today?', 'Who is my manager?', 'What documents do I need?'].map((q) => (
                <button
                  key={q}
                  onClick={() => { onInputChange(q); setTimeout(onSend, 50) }}
                  className="text-xs px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background border'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
            {msg.role === 'user' && (
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
              <Bot className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="bg-background border rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Ask me anything about your onboarding..."
          className="min-h-[40px] max-h-[100px] resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
        />
        <Button
          onClick={onSend}
          disabled={!input.trim() || loading}
          size="sm"
          className="h-10 w-10 shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
