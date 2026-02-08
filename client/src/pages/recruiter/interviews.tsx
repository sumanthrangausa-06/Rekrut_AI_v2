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

  // Feedback form
  const [fbOutcome, setFbOutcome] = useState('')
  const [fbRating, setFbRating] = useState('3')
  const [fbStrengths, setFbStrengths] = useState('')
  const [fbWeaknesses, setFbWeaknesses] = useState('')
  const [fbNotes, setFbNotes] = useState('')

  // Calendar view
  const [calMonth, setCalMonth] = useState(new Date())

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [intRes, appRes] = await Promise.all([
        apiCall<{ interviews: Interview[] }>('/recruiter/interviews?upcoming_only=false'),
        apiCall<{ applications: Application[] }>('/recruiter/applications?status=reviewing'),
      ])
      setInterviews(intRes.interviews || [])
      setApplications(appRes.applications || [])
    } catch (err) {
      console.error('Load error:', err)
    } finally {
      setLoading(false)
    }
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
          <p className="text-muted-foreground text-sm">Schedule and manage candidate interviews</p>
        </div>
        <Button onClick={() => setShowSchedule(true)}>
          <Plus className="h-4 w-4 mr-2" /> Schedule Interview
        </Button>
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
              <div className="p-2 rounded-lg bg-orange-100 text-orange-700">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{interviews.filter(i => i.status === 'reschedule_requested').length}</p>
                <p className="text-xs text-muted-foreground">Reschedule Req.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
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
                />
              ))}
            </div>
          )}
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
                  isPast
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Schedule dialog */}
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
              <p className="text-xs text-muted-foreground mt-1">No applicants in "Reviewing" status. Update an application status to "Reviewing" first.</p>
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
    </div>
  )
}

function InterviewCard({
  interview,
  onCancel,
  onFeedback,
  onConfirm,
  isPast,
}: {
  interview: Interview
  onCancel: () => void
  onFeedback: () => void
  onConfirm?: () => void
  isPast?: boolean
}) {
  const config = statusConfig[interview.status] || statusConfig.scheduled
  const StatusIcon = config.icon
  const TypeIcon = typeIcons[interview.interview_type] || Video
  const isUpcoming = isFuture(interview.scheduled_at) && ['scheduled', 'confirmed'].includes(interview.status)
  const isNow = isToday(interview.scheduled_at) && ['scheduled', 'confirmed'].includes(interview.status)
  const needsFeedback = !interview.feedback && (isPast || interview.status === 'completed')
  const feedback = typeof interview.feedback === 'string' ? JSON.parse(interview.feedback) : interview.feedback

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
