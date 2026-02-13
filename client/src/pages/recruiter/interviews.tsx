import { useEffect, useState } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Calendar, Plus, Video, Phone, MapPin, Clock, User, Briefcase,
  CheckCircle, XCircle, AlertCircle, MessageSquare, Edit2,
  ChevronLeft, ChevronRight, Trash2, RefreshCw, Star,
  Sparkles, Send, FileText, Brain, Zap, ClipboardList,
} from 'lucide-react'

interface Interview {
  id: number
  company_id: number
  job_id: number
  candidate_id: number
  recruiter_id: number
  scheduled_at: string
  duration_minutes: number
  interview_type: string
  meeting_link: string | null
  notes: string | null
  status: string
  outcome: string | null
  feedback: any | null
  ai_evaluation: any | null
  ai_composite_score: number | null
  created_at: string
  updated_at: string
  candidate_name: string
  candidate_email: string
  job_title: string
}

interface Application {
  id: number
  candidate_id: number
  candidate_name: string
  candidate_email: string
  job_id: number
  job_title: string
  status: string
  screening_status?: string
  screening_score?: number
}

interface ScreeningTemplate {
  id: number
  job_id: number
  title: string
  questions: any[]
  sessions_count: number
  completed_count: number
  job_title: string
  auto_send_on_apply: boolean
}

interface ScreeningSession {
  id: number
  candidate_name: string
  candidate_email: string
  job_title: string
  status: string
  overall_score: number | null
  started_at: string | null
  completed_at: string | null
}

interface SlotSuggestion {
  start: string
  end: string
  duration_minutes: number
  day: string
  date: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; icon: React.ElementType }> = {
  scheduled: { label: 'Scheduled', variant: 'warning', icon: Clock },
  confirmed: { label: 'Confirmed', variant: 'success', icon: CheckCircle },
  completed: { label: 'Completed', variant: 'default', icon: CheckCircle },
  cancelled: { label: 'Cancelled', variant: 'destructive', icon: XCircle },
  declined: { label: 'Declined', variant: 'destructive', icon: XCircle },
  reschedule_requested: { label: 'Reschedule Req.', variant: 'warning', icon: RefreshCw },
  no_show: { label: 'No Show', variant: 'destructive', icon: AlertCircle },
}

const typeIcons: Record<string, React.ElementType> = {
  video: Video,
  phone: Phone,
  'in-person': MapPin,
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function isToday(d: string) {
  const date = new Date(d)
  const today = new Date()
  return date.toDateString() === today.toDateString()
}

function isFuture(d: string) {
  return new Date(d) > new Date()
}

export function RecruiterInterviewsPage() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('upcoming')
  const [showSchedule, setShowSchedule] = useState(false)
  const [showFeedback, setShowFeedback] = useState<Interview | null>(null)
  const [saving, setSaving] = useState(false)

  // Schedule form
  const [appId, setAppId] = useState('')
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const [duration, setDuration] = useState('60')
  const [interviewType, setInterviewType] = useState('video')
  const [schedNotes, setSchedNotes] = useState('')

  // AI Smart Scheduling
  const [suggestedSlots, setSuggestedSlots] = useState<SlotSuggestion[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Screening
  const [screeningTemplates, setScreeningTemplates] = useState<ScreeningTemplate[]>([])
  const [showCreateTemplate, setShowCreateTemplate] = useState(false)
  const [templateJobId, setTemplateJobId] = useState('')
  const [templateTitle, setTemplateTitle] = useState('')
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [showScreeningReport, setShowScreeningReport] = useState<any>(null)

  // AI Evaluation
  const [evaluating, setEvaluating] = useState<number | null>(null)
  const [showAiScores, setShowAiScores] = useState<any>(null)

  // Feedback form
  const [fbOutcome, setFbOutcome] = useState('')
  const [fbRating, setFbRating] = useState('3')
  const [fbStrengths, setFbStrengths] = useState('')
  const [fbWeaknesses, setFbWeaknesses] = useState('')
  const [fbNotes, setFbNotes] = useState('')

  // Calendar view
  const [calMonth, setCalMonth] = useState(new Date())

  // Jobs for template creation
  const [jobs, setJobs] = useState<any[]>([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [intRes, appRes, templRes, jobsRes] = await Promise.all([
        apiCall<{ interviews: Interview[] }>('/recruiter/interviews?upcoming_only=false'),
        apiCall<{ applications: Application[] }>('/recruiter/applications'),
        apiCall<{ success: boolean; templates: ScreeningTemplate[] }>('/interviews/screening/templates').catch(() => ({ success: false, templates: [] })),
        apiCall<{ jobs: any[] }>('/recruiter/jobs').catch(() => ({ jobs: [] })),
      ])
      setInterviews(intRes.interviews || [])
      setApplications(appRes.applications || [])
      setScreeningTemplates(templRes.templates || [])
      setJobs(jobsRes.jobs || [])
    } catch (err) {
      console.error('Load error:', err)
    } finally {
      setLoading(false)
    }
  }

  // AI Smart Scheduling — suggest optimal slots
  async function findBestTime() {
    setLoadingSlots(true)
    setSuggestedSlots([])
    try {
      const res = await apiCall<{ success: boolean; slots: SlotSuggestion[] }>('/interviews/suggest-slots', {
        method: 'POST',
        body: { days_ahead: 7, slots_count: 6, duration_minutes: parseInt(duration) }
      })
      setSuggestedSlots(res.slots || [])
    } catch (err: any) {
      console.error('Smart scheduling error:', err)
    } finally {
      setLoadingSlots(false)
    }
  }

  function selectSlot(slot: SlotSuggestion) {
    const d = new Date(slot.start)
    setSchedDate(d.toISOString().split('T')[0])
    setSchedTime(d.toTimeString().slice(0, 5))
    setSuggestedSlots([])
  }

  async function scheduleInterview() {
    if (!appId || !schedDate || !schedTime) return
    setSaving(true)
    try {
      const scheduled_at = new Date(`${schedDate}T${schedTime}`).toISOString()
      await apiCall('/recruiter/interviews', {
        method: 'POST',
        body: {
          application_id: parseInt(appId),
          scheduled_at,
          duration: parseInt(duration),
          interview_type: interviewType,
          notes: schedNotes || undefined,
        },
      })
      setShowSchedule(false)
      resetScheduleForm()
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to schedule')
    } finally {
      setSaving(false)
    }
  }

  function resetScheduleForm() {
    setAppId('')
    setSchedDate('')
    setSchedTime('')
    setDuration('60')
    setInterviewType('video')
    setSchedNotes('')
    setSuggestedSlots([])
  }

  // Screening template
  async function createTemplate() {
    if (!templateJobId) return
    setCreatingTemplate(true)
    try {
      await apiCall('/interviews/screening/create-template', {
        method: 'POST',
        body: {
          job_id: parseInt(templateJobId),
          title: templateTitle || undefined,
        }
      })
      setShowCreateTemplate(false)
      setTemplateJobId('')
      setTemplateTitle('')
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to create template')
    } finally {
      setCreatingTemplate(false)
    }
  }

  // Send screening invite
  async function sendScreening(templateId: number, candidateId: number, applicationId: number, jobId: number) {
    try {
      await apiCall('/interviews/screening/send', {
        method: 'POST',
        body: { template_id: templateId, candidate_id: candidateId, application_id: applicationId, job_id: jobId }
      })
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to send screening')
    }
  }

  // View screening report
  async function viewScreeningReport(sessionId: number) {
    try {
      const res = await apiCall<any>(`/interviews/screening/${sessionId}/report`)
      setShowScreeningReport(res)
    } catch (err: any) {
      alert(err.message || 'Failed to load report')
    }
  }

  // AI Multi-Evaluator
  async function runAiEvaluation(interviewId: number) {
    setEvaluating(interviewId)
    try {
      const res = await apiCall<any>('/interviews/evaluate', {
        method: 'POST',
        body: { interview_id: interviewId }
      })
      setShowAiScores(res)
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to run AI evaluation')
    } finally {
      setEvaluating(null)
    }
  }

  async function submitFeedback() {
    if (!showFeedback) return
    setSaving(true)
    try {
      await apiCall(`/recruiter/interviews/${showFeedback.id}`, {
        method: 'PUT',
        body: {
          status: 'completed',
          outcome: fbOutcome || 'completed',
          feedback: {
            rating: parseInt(fbRating),
            strengths: fbStrengths,
            weaknesses: fbWeaknesses,
            notes: fbNotes,
          },
        },
      })
      setShowFeedback(null)
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to save feedback')
    } finally {
      setSaving(false)
    }
  }

  async function cancelInterview(id: number) {
    if (!confirm('Cancel this interview?')) return
    try {
      await apiCall(`/recruiter/interviews/${id}`, { method: 'DELETE' })
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to cancel')
    }
  }

  async function updateStatus(id: number, status: string) {
    try {
      await apiCall(`/recruiter/interviews/${id}`, {
        method: 'PUT',
        body: { status },
      })
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to update')
    }
  }

  const upcoming = interviews.filter(i => isFuture(i.scheduled_at) && ['scheduled', 'confirmed', 'reschedule_requested'].includes(i.status))
  const past = interviews.filter(i => !isFuture(i.scheduled_at) || ['completed', 'cancelled', 'declined', 'no_show'].includes(i.status))
  const todayInterviews = interviews.filter(i => isToday(i.scheduled_at) && ['scheduled', 'confirmed'].includes(i.status))

  // Calendar helpers
  function getDaysInMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }
  function getFirstDayOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  function getInterviewsForDay(day: number) {
    return interviews.filter(i => {
      const d = new Date(i.scheduled_at)
      return d.getFullYear() === calMonth.getFullYear()
        && d.getMonth() === calMonth.getMonth()
        && d.getDate() === day
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold">Interviews</h1>
          <p className="text-muted-foreground text-sm">Schedule, screen, and evaluate candidates with AI</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setShowCreateTemplate(true)}>
            <ClipboardList className="h-4 w-4 mr-2" /> Screening Templates
          </Button>
          <Button onClick={() => setShowSchedule(true)}>
            <Plus className="h-4 w-4 mr-2" /> Schedule Interview
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 text-yellow-700">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{todayInterviews.length}</p>
                <p className="text-xs text-muted-foreground">Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{upcoming.length}</p>
                <p className="text-xs text-muted-foreground">Upcoming</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 text-green-700">
                <CheckCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{interviews.filter(i => i.status === 'completed').length}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 text-purple-700">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{screeningTemplates.reduce((sum, t) => sum + (t.completed_count || 0), 0)}</p>
                <p className="text-xs text-muted-foreground">AI Screenings</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Screening Templates Banner */}
      {screeningTemplates.length > 0 && (
        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <h3 className="font-semibold text-purple-900">AI Screening Pipeline</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {screeningTemplates.map(t => (
                <div key={t.id} className="p-3 bg-white rounded-lg border border-purple-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm truncate">{t.title}</span>
                    <Badge variant="secondary" className="text-xs shrink-0">{t.questions.length} Qs</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{t.job_title}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {t.completed_count}/{t.sessions_count} completed
                    </span>
                    {t.auto_send_on_apply && (
                      <Badge variant="default" className="text-xs bg-purple-600">Auto-send</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="screening">Screening</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="past">Past ({past.length})</TabsTrigger>
        </TabsList>

        {/* Upcoming list */}
        <TabsContent value="upcoming">
          {upcoming.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold mb-1">No upcoming interviews</h3>
                <p className="text-sm text-muted-foreground mb-4">Schedule interviews with candidates from your applications</p>
                <Button onClick={() => setShowSchedule(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Schedule Interview
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {upcoming.map(interview => (
                <InterviewCard
                  key={interview.id}
                  interview={interview}
                  onCancel={() => cancelInterview(interview.id)}
                  onFeedback={() => {
                    setShowFeedback(interview)
                    setFbOutcome('')
                    setFbRating('3')
                    setFbStrengths('')
                    setFbWeaknesses('')
                    setFbNotes('')
                  }}
                  onConfirm={() => updateStatus(interview.id, 'confirmed')}
                  onAiEvaluate={() => runAiEvaluation(interview.id)}
                  evaluating={evaluating === interview.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Screening tab */}
        <TabsContent value="screening">
          <div className="space-y-4">
            {/* Screening-eligible applications */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Send className="h-4 w-4" /> Send AI Screening
                  </h3>
                </div>
                {applications.filter(a => !a.screening_status && screeningTemplates.length > 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {screeningTemplates.length === 0
                      ? 'Create a screening template first to start sending AI screenings.'
                      : 'All current applicants have been sent screenings or no new applicants available.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {applications.filter(a => !a.screening_status).slice(0, 10).map(app => {
                      const matchingTemplate = screeningTemplates.find(t => t.job_id === app.job_id)
                      return (
                        <div key={app.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div>
                            <span className="font-medium text-sm">{app.candidate_name}</span>
                            <span className="text-xs text-muted-foreground ml-2">{app.job_title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {app.screening_status && (
                              <Badge variant={app.screening_status === 'completed' ? 'success' : 'warning'} className="text-xs">
                                {app.screening_status === 'completed' ? `Score: ${app.screening_score}/100` : app.screening_status}
                              </Badge>
                            )}
                            {matchingTemplate && !app.screening_status && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => sendScreening(matchingTemplate.id, app.candidate_id, app.id, app.job_id)}
                              >
                                <Sparkles className="h-3.5 w-3.5 mr-1" /> Send Screening
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Completed screenings */}
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Screening Results
                </h3>
                {applications.filter(a => a.screening_status === 'completed').length === 0 ? (
                  <p className="text-sm text-muted-foreground">No completed screenings yet.</p>
                ) : (
                  <div className="space-y-2">
                    {applications.filter(a => a.screening_status === 'completed').map(app => (
                      <div key={app.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={`text-lg font-bold ${
                            (app.screening_score || 0) >= 70 ? 'text-green-600' :
                            (app.screening_score || 0) >= 50 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {app.screening_score || 0}
                          </div>
                          <div>
                            <span className="font-medium text-sm">{app.candidate_name}</span>
                            <p className="text-xs text-muted-foreground">{app.job_title}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => viewScreeningReport(app.id)}>
                          <FileText className="h-3.5 w-3.5 mr-1" /> View Report
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Calendar view */}
        <TabsContent value="calendar">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="sm" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <h3 className="font-semibold">
                  {calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-px bg-muted rounded-lg overflow-hidden">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="bg-background p-2 text-center text-xs font-medium text-muted-foreground">
                    {day}
                  </div>
                ))}
                {Array.from({ length: getFirstDayOfMonth(calMonth) }).map((_, i) => (
                  <div key={`empty-${i}`} className="bg-background p-2 min-h-[80px]" />
                ))}
                {Array.from({ length: getDaysInMonth(calMonth) }).map((_, i) => {
                  const day = i + 1
                  const dayInterviews = getInterviewsForDay(day)
                  const isCurrentDay = new Date().getDate() === day
                    && new Date().getMonth() === calMonth.getMonth()
                    && new Date().getFullYear() === calMonth.getFullYear()

                  return (
                    <div
                      key={day}
                      className={`bg-background p-2 min-h-[80px] ${isCurrentDay ? 'ring-2 ring-primary ring-inset' : ''}`}
                    >
                      <span className={`text-sm ${isCurrentDay ? 'font-bold text-primary' : ''}`}>{day}</span>
                      <div className="mt-1 space-y-1">
                        {dayInterviews.slice(0, 2).map(int => {
                          const TypeIcon = typeIcons[int.interview_type] || Video
                          return (
                            <div
                              key={int.id}
                              className="text-xs p-1 rounded bg-primary/10 text-primary truncate flex items-center gap-1"
                              title={`${formatTime(int.scheduled_at)} - ${int.candidate_name} (${int.job_title})`}
                            >
                              <TypeIcon className="h-3 w-3 shrink-0" />
                              <span className="truncate">{formatTime(int.scheduled_at)} {int.candidate_name.split(' ')[0]}</span>
                            </div>
                          )
                        })}
                        {dayInterviews.length > 2 && (
                          <div className="text-xs text-muted-foreground text-center">+{dayInterviews.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Past interviews */}
        <TabsContent value="past">
          {past.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No past interviews yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {past.map(interview => (
                <InterviewCard
                  key={interview.id}
                  interview={interview}
                  onCancel={() => cancelInterview(interview.id)}
                  onFeedback={() => {
                    setShowFeedback(interview)
                    setFbOutcome(interview.outcome || '')
                    setFbRating(interview.feedback?.rating?.toString() || '3')
                    setFbStrengths(interview.feedback?.strengths || '')
                    setFbWeaknesses(interview.feedback?.weaknesses || '')
                    setFbNotes(interview.feedback?.notes || '')
                  }}
                  onAiEvaluate={() => runAiEvaluation(interview.id)}
                  evaluating={evaluating === interview.id}
                  isPast
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Schedule dialog with AI Smart Scheduling */}
      <Dialog open={showSchedule} onClose={() => { setShowSchedule(false); resetScheduleForm() }}>
        <DialogHeader>
          <DialogTitle>Schedule Interview</DialogTitle>
          <DialogDescription>Select an applicant and set the interview details</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Applicant</Label>
            <Select value={appId} onChange={e => setAppId(e.target.value)}>
              <option value="">Select an applicant...</option>
              {applications.map(a => (
                <option key={a.id} value={a.id}>{a.candidate_name} — {a.job_title}</option>
              ))}
            </Select>
            {applications.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">No applicants available. Update an application status first.</p>
            )}
          </div>

          {/* AI Smart Scheduling */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-900 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" /> AI Smart Scheduling
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={findBestTime}
                disabled={loadingSlots}
                className="text-xs"
              >
                {loadingSlots ? 'Finding...' : '✨ Find Best Time'}
              </Button>
            </div>
            {suggestedSlots.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {suggestedSlots.map((slot, i) => (
                  <button
                    key={i}
                    onClick={() => selectSlot(slot)}
                    className="text-left p-2 bg-white rounded border border-blue-100 hover:border-blue-400 hover:bg-blue-50 transition-colors text-xs"
                  >
                    <div className="font-medium">{formatDate(slot.start)}</div>
                    <div className="text-muted-foreground">{formatTime(slot.start)} — {slot.duration_minutes}min</div>
                  </button>
                ))}
              </div>
            )}
            {suggestedSlots.length === 0 && !loadingSlots && (
              <p className="text-xs text-blue-700">Click "Find Best Time" to auto-suggest optimal interview slots based on your calendar.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date</Label>
              <Input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} />
            </div>
            <div>
              <Label>Time</Label>
              <Input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Duration</Label>
              <Select value={duration} onChange={e => setDuration(e.target.value)}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={interviewType} onChange={e => setInterviewType(e.target.value)}>
                <option value="video">Video Call</option>
                <option value="phone">Phone</option>
                <option value="in-person">In Person</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={schedNotes}
              onChange={e => setSchedNotes(e.target.value)}
              placeholder="Any instructions for the candidate..."
              rows={3}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setShowSchedule(false); resetScheduleForm() }}>Cancel</Button>
            <Button onClick={scheduleInterview} disabled={saving || !appId || !schedDate || !schedTime}>
              {saving ? 'Scheduling...' : 'Schedule Interview'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Create screening template dialog */}
      <Dialog open={showCreateTemplate} onClose={() => setShowCreateTemplate(false)}>
        <DialogHeader>
          <DialogTitle>Create Screening Template</DialogTitle>
          <DialogDescription>AI will auto-generate screening questions from the job description</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Job</Label>
            <Select value={templateJobId} onChange={e => setTemplateJobId(e.target.value)}>
              <option value="">Select a job...</option>
              {jobs.map((j: any) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Template Name (optional)</Label>
            <Input
              value={templateTitle}
              onChange={e => setTemplateTitle(e.target.value)}
              placeholder="Auto-generated from job title"
            />
          </div>
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
            <p className="text-xs text-purple-700 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              AI will analyze the job description and generate 6-8 tailored screening questions with evaluation criteria.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowCreateTemplate(false)}>Cancel</Button>
            <Button onClick={createTemplate} disabled={creatingTemplate || !templateJobId}>
              {creatingTemplate ? 'Creating...' : '✨ Create Template'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Feedback dialog */}
      <Dialog open={!!showFeedback} onClose={() => setShowFeedback(null)}>
        <DialogHeader>
          <DialogTitle>Interview Feedback</DialogTitle>
          <DialogDescription>
            {showFeedback && `${showFeedback.candidate_name} — ${showFeedback.job_title}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Outcome</Label>
            <Select value={fbOutcome} onChange={e => setFbOutcome(e.target.value)}>
              <option value="">Select outcome...</option>
              <option value="strong_hire">Strong Hire</option>
              <option value="hire">Hire</option>
              <option value="lean_hire">Lean Hire</option>
              <option value="lean_no_hire">Lean No Hire</option>
              <option value="no_hire">No Hire</option>
            </Select>
          </div>
          <div>
            <Label>Rating (1-5)</Label>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setFbRating(n.toString())}
                  className="p-1"
                >
                  <Star className={`h-6 w-6 ${parseInt(fbRating) >= n ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Strengths</Label>
            <Textarea
              value={fbStrengths}
              onChange={e => setFbStrengths(e.target.value)}
              placeholder="What went well..."
              rows={2}
            />
          </div>
          <div>
            <Label>Areas for Improvement</Label>
            <Textarea
              value={fbWeaknesses}
              onChange={e => setFbWeaknesses(e.target.value)}
              placeholder="What could be better..."
              rows={2}
            />
          </div>
          <div>
            <Label>Additional Notes</Label>
            <Textarea
              value={fbNotes}
              onChange={e => setFbNotes(e.target.value)}
              placeholder="Any other observations..."
              rows={2}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowFeedback(null)}>Cancel</Button>
            <Button onClick={submitFeedback} disabled={saving}>
              {saving ? 'Saving...' : 'Save Feedback'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* AI Evaluation Results Dialog */}
      <Dialog open={!!showAiScores} onClose={() => setShowAiScores(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" /> AI Multi-Evaluator Scores
          </DialogTitle>
          <DialogDescription>Three independent AI perspectives + composite recommendation</DialogDescription>
        </DialogHeader>
        {showAiScores && (
          <div className="space-y-4 mt-4">
            {/* Composite score */}
            {showAiScores.composite && (
              <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-lg">Composite Score</span>
                  <span className={`text-3xl font-bold ${
                    showAiScores.composite.composite_score >= 75 ? 'text-green-600' :
                    showAiScores.composite.composite_score >= 60 ? 'text-blue-600' :
                    showAiScores.composite.composite_score >= 45 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {showAiScores.composite.composite_score}/100
                  </span>
                </div>
                <Badge variant={
                  showAiScores.composite.recommendation === 'strong_hire' ? 'success' :
                  showAiScores.composite.recommendation === 'hire' ? 'default' :
                  showAiScores.composite.recommendation === 'consider' ? 'warning' : 'destructive'
                }>
                  {showAiScores.composite.recommendation?.replace('_', ' ').toUpperCase()}
                </Badge>
                <p className="text-sm text-muted-foreground mt-2">{showAiScores.composite.recommendation_reasoning}</p>
              </div>
            )}

            {/* Individual evaluator scores */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {showAiScores.evaluations && Object.entries(showAiScores.evaluations).map(([type, eval_]: [string, any]) => (
                <div key={type} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm capitalize">{type}</span>
                    <span className={`text-xl font-bold ${
                      eval_.score >= 75 ? 'text-green-600' :
                      eval_.score >= 60 ? 'text-blue-600' :
                      eval_.score >= 45 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {eval_.score}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{eval_.reasoning}</p>
                  {eval_.key_observations && (
                    <ul className="mt-2 space-y-1">
                      {eval_.key_observations.slice(0, 3).map((obs: string, i: number) => (
                        <li key={i} className="text-xs flex items-start gap-1">
                          <span className="text-muted-foreground">•</span> {obs}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowAiScores(null)}>Close</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Screening Report Dialog */}
      <Dialog open={!!showScreeningReport} onClose={() => setShowScreeningReport(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-600" /> Screening Report
          </DialogTitle>
          <DialogDescription>
            {showScreeningReport?.session && `${showScreeningReport.session.candidate_name} — ${showScreeningReport.session.job_title}`}
          </DialogDescription>
        </DialogHeader>
        {showScreeningReport?.report && (
          <div className="space-y-4 mt-4 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
              <div className={`text-3xl font-bold ${
                (showScreeningReport.report.overall_score || 0) >= 70 ? 'text-green-600' :
                (showScreeningReport.report.overall_score || 0) >= 50 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {showScreeningReport.report.overall_score || 0}/100
              </div>
              <div>
                <Badge variant={
                  showScreeningReport.report.recommendation === 'advance' ? 'success' :
                  showScreeningReport.report.recommendation === 'consider' ? 'warning' : 'destructive'
                }>
                  {showScreeningReport.report.recommendation?.toUpperCase()}
                </Badge>
                <p className="text-sm text-muted-foreground mt-1">{showScreeningReport.report.recommendation_reasoning}</p>
              </div>
            </div>

            {showScreeningReport.report.strengths && (
              <div>
                <h4 className="font-medium text-sm mb-1 text-green-700">Strengths</h4>
                <ul className="space-y-1">
                  {showScreeningReport.report.strengths.map((s: string, i: number) => (
                    <li key={i} className="text-sm flex items-start gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showScreeningReport.report.red_flags && showScreeningReport.report.red_flags.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-1 text-red-700">Red Flags</h4>
                <ul className="space-y-1">
                  {showScreeningReport.report.red_flags.map((f: string, i: number) => (
                    <li key={i} className="text-sm flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Multi-evaluator scores if available */}
            {showScreeningReport.composite && (
              <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                <h4 className="font-medium text-sm mb-2 flex items-center gap-1.5">
                  <Brain className="h-4 w-4 text-purple-600" /> AI Multi-Evaluator
                </h4>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-lg font-bold">{showScreeningReport.composite.technical_score}</div>
                    <div className="text-xs text-muted-foreground">Technical</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{showScreeningReport.composite.culture_score}</div>
                    <div className="text-xs text-muted-foreground">Culture</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{showScreeningReport.composite.experience_score}</div>
                    <div className="text-xs text-muted-foreground">Experience</div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowScreeningReport(null)}>Close</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

function InterviewCard({
  interview,
  onCancel,
  onFeedback,
  onConfirm,
  onAiEvaluate,
  evaluating,
  isPast,
}: {
  interview: Interview
  onCancel: () => void
  onFeedback: () => void
  onConfirm?: () => void
  onAiEvaluate?: () => void
  evaluating?: boolean
  isPast?: boolean
}) {
  const config = statusConfig[interview.status] || statusConfig.scheduled
  const StatusIcon = config.icon
  const TypeIcon = typeIcons[interview.interview_type] || Video
  const isUpcoming = isFuture(interview.scheduled_at) && ['scheduled', 'confirmed'].includes(interview.status)
  const isNow = isToday(interview.scheduled_at) && ['scheduled', 'confirmed'].includes(interview.status)
  const needsFeedback = !interview.feedback && (isPast || interview.status === 'completed')
  const feedback = typeof interview.feedback === 'string' ? JSON.parse(interview.feedback) : interview.feedback
  const hasAiScore = interview.ai_composite_score != null

  return (
    <Card className={isNow ? 'border-primary' : ''}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          {/* Date/time block */}
          <div className="flex-shrink-0 text-center min-w-[80px]">
            <div className={`text-2xl font-bold ${isNow ? 'text-primary' : ''}`}>
              {new Date(interview.scheduled_at).getDate()}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(interview.scheduled_at).toLocaleDateString('en-US', { month: 'short', weekday: 'short' })}
            </div>
            <div className="text-sm font-medium mt-1">
              {formatTime(interview.scheduled_at)}
            </div>
            <div className="text-xs text-muted-foreground">{interview.duration_minutes}min</div>
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{interview.candidate_name}</h3>
              <Badge variant={config.variant}>
                <StatusIcon className="h-3 w-3 mr-1" /> {config.label}
              </Badge>
              {isNow && <Badge variant="default" className="bg-primary">Live Today</Badge>}
              {hasAiScore && (
                <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700">
                  <Brain className="h-3 w-3 mr-1" /> AI: {interview.ai_composite_score}/100
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {interview.job_title}</span>
              <span className="flex items-center gap-1"><TypeIcon className="h-3.5 w-3.5" /> {interview.interview_type}</span>
              <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {interview.candidate_email}</span>
            </div>
            {interview.notes && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{interview.notes}</p>
            )}
            {feedback && (
              <div className="mt-2 p-2 bg-muted rounded-lg text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Feedback:</span>
                  {feedback.rating && (
                    <span className="flex items-center gap-0.5">
                      {Array.from({ length: feedback.rating }).map((_, i) => (
                        <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      ))}
                    </span>
                  )}
                  {interview.outcome && <Badge variant="secondary" className="text-xs">{interview.outcome.replace('_', ' ')}</Badge>}
                </div>
                {feedback.strengths && <p className="mt-1 text-muted-foreground">{feedback.strengths}</p>}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 sm:flex-col">
            {interview.meeting_link && isUpcoming && (
              <a href={interview.meeting_link} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="w-full"><Video className="h-3.5 w-3.5 mr-1" /> Join</Button>
              </a>
            )}
            {interview.status === 'reschedule_requested' && (
              <Button size="sm" variant="outline" onClick={onConfirm}>
                <CheckCircle className="h-3.5 w-3.5 mr-1" /> Confirm
              </Button>
            )}
            {onAiEvaluate && (isPast || interview.status === 'completed') && !hasAiScore && (
              <Button size="sm" variant="outline" onClick={onAiEvaluate} disabled={evaluating} className="text-purple-700 border-purple-200 hover:bg-purple-50">
                {evaluating ? (
                  <><div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-purple-600 mr-1" /> Evaluating...</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5 mr-1" /> AI Evaluate</>
                )}
              </Button>
            )}
            {needsFeedback && (
              <Button size="sm" variant="outline" onClick={onFeedback}>
                <MessageSquare className="h-3.5 w-3.5 mr-1" /> Feedback
              </Button>
            )}
            {!isPast && feedback && (
              <Button size="sm" variant="ghost" onClick={onFeedback}>
                <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
            )}
            {isUpcoming && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onCancel}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
