import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Video, Phone, MapPin, Clock, CheckCircle, XCircle, AlertCircle,
  Calendar, Briefcase, Building2, User, RefreshCw, ExternalLink,
  Lightbulb, BookOpen, Target, MessageSquare,
} from 'lucide-react'

interface Interview {
  id: number
  scheduled_at: string
  duration_minutes: number
  interview_type: string
  meeting_link: string | null
  notes: string | null
  status: string
  outcome: string | null
  feedback: any | null
  created_at: string
  job_title: string
  job_id: number
  company_name: string
  company_full_name: string | null
  recruiter_name: string
  recruiter_email: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; icon: React.ElementType }> = {
  scheduled: { label: 'Scheduled', variant: 'warning', icon: Clock },
  confirmed: { label: 'Confirmed', variant: 'success', icon: CheckCircle },
  completed: { label: 'Completed', variant: 'default', icon: CheckCircle },
  cancelled: { label: 'Cancelled', variant: 'destructive', icon: XCircle },
  declined: { label: 'Declined', variant: 'secondary', icon: XCircle },
  reschedule_requested: { label: 'Reschedule Requested', variant: 'warning', icon: RefreshCw },
  no_show: { label: 'No Show', variant: 'destructive', icon: AlertCircle },
}

const typeConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  video: { label: 'Video Call', icon: Video, color: 'bg-blue-100 text-blue-700' },
  phone: { label: 'Phone', icon: Phone, color: 'bg-green-100 text-green-700' },
  'in-person': { label: 'In Person', icon: MapPin, color: 'bg-purple-100 text-purple-700' },
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
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

function getTimeUntil(d: string) {
  const ms = new Date(d).getTime() - Date.now()
  if (ms < 0) return 'Past'
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `in ${days}d ${hours}h`
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `in ${hours}h ${mins}m`
  return `in ${mins}m`
}

const INTERVIEW_TIPS = [
  { icon: Target, title: 'Research the Company', desc: 'Review the job description and company website before the interview.' },
  { icon: Lightbulb, title: 'Prepare STAR Answers', desc: 'Use Situation, Task, Action, Result format for behavioral questions.' },
  { icon: BookOpen, title: 'Review Your Resume', desc: 'Be ready to discuss any experience or skill listed on your resume.' },
  { icon: MessageSquare, title: 'Prepare Questions', desc: 'Have 3-5 thoughtful questions ready for the interviewer.' },
  { icon: Video, title: 'Test Your Tech', desc: 'For video interviews, test camera, mic, and internet beforehand.' },
]

export function CandidateInterviewsPage() {
  const navigate = useNavigate()
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('upcoming')
  const [showDecline, setShowDecline] = useState<Interview | null>(null)
  const [showReschedule, setShowReschedule] = useState<Interview | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [rescheduleReason, setRescheduleReason] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadInterviews()
  }, [])

  async function loadInterviews() {
    setLoading(true)
    try {
      const res = await apiCall<{ success: boolean; interviews: Interview[] }>('/candidate/interviews/scheduled')
      setInterviews(res.interviews || [])
    } catch (err) {
      console.error('Load interviews error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function acceptInterview(id: number) {
    try {
      await apiCall(`/candidate/interviews/${id}/accept`, { method: 'PUT' })
      await loadInterviews()
    } catch (err: any) {
      alert(err.message || 'Failed to accept')
    }
  }

  async function declineInterview() {
    if (!showDecline) return
    setSaving(true)
    try {
      await apiCall(`/candidate/interviews/${showDecline.id}/decline`, {
        method: 'PUT',
        body: { reason: declineReason },
      })
      setShowDecline(null)
      setDeclineReason('')
      await loadInterviews()
    } catch (err: any) {
      alert(err.message || 'Failed to decline')
    } finally {
      setSaving(false)
    }
  }

  async function requestReschedule() {
    if (!showReschedule) return
    setSaving(true)
    try {
      await apiCall(`/candidate/interviews/${showReschedule.id}/reschedule`, {
        method: 'PUT',
        body: {
          reason: rescheduleReason,
          preferred_time: rescheduleTime || undefined,
        },
      })
      setShowReschedule(null)
      setRescheduleReason('')
      setRescheduleTime('')
      await loadInterviews()
    } catch (err: any) {
      alert(err.message || 'Failed to request reschedule')
    } finally {
      setSaving(false)
    }
  }

  const upcoming = interviews.filter(i => isFuture(i.scheduled_at) && ['scheduled', 'confirmed', 'reschedule_requested'].includes(i.status))
  const past = interviews.filter(i => !isFuture(i.scheduled_at) || ['completed', 'cancelled', 'declined', 'no_show'].includes(i.status))

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
      <div>
        <h1 className="text-2xl font-heading font-bold">My Interviews</h1>
        <p className="text-muted-foreground text-sm">View and manage your scheduled interviews</p>
      </div>

      {/* Next interview highlight */}
      {upcoming.length > 0 && (
        <NextInterviewCard
          interview={upcoming.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]}
        />
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Past ({past.length})</TabsTrigger>
          <TabsTrigger value="tips">Interview Tips</TabsTrigger>
        </TabsList>

        {/* Upcoming */}
        <TabsContent value="upcoming">
          {upcoming.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold mb-1">No upcoming interviews</h3>
                <p className="text-sm text-muted-foreground">When recruiters schedule interviews, they'll appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {upcoming
                .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
                .map(interview => (
                  <InterviewCard
                    key={interview.id}
                    interview={interview}
                    onAccept={() => acceptInterview(interview.id)}
                    onDecline={() => { setShowDecline(interview); setDeclineReason('') }}
                    onReschedule={() => { setShowReschedule(interview); setRescheduleReason(''); setRescheduleTime('') }}
                  />
                ))}
            </div>
          )}
        </TabsContent>

        {/* Past */}
        <TabsContent value="past">
          {past.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No past interviews.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {past.map(interview => (
                <InterviewCard key={interview.id} interview={interview} isPast />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tips */}
        <TabsContent value="tips">
          <div className="grid gap-4 sm:grid-cols-2">
            {INTERVIEW_TIPS.map((tip, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary h-fit">
                      <tip.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{tip.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{tip.desc}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Decline dialog */}
      <Dialog open={!!showDecline} onClose={() => setShowDecline(null)}>
        <DialogHeader>
          <DialogTitle>Decline Interview</DialogTitle>
          <DialogDescription>
            Are you sure you want to decline this interview?
            {showDecline && ` (${showDecline.job_title} at ${showDecline.company_name || showDecline.company_full_name})`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Reason (optional)</Label>
            <Textarea
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Let the recruiter know why..."
              rows={3}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowDecline(null)}>Cancel</Button>
            <Button variant="destructive" onClick={declineInterview} disabled={saving}>
              {saving ? 'Declining...' : 'Decline Interview'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Reschedule dialog */}
      <Dialog open={!!showReschedule} onClose={() => setShowReschedule(null)}>
        <DialogHeader>
          <DialogTitle>Request Reschedule</DialogTitle>
          <DialogDescription>
            Request a new time for this interview. The recruiter will review your request.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Reason</Label>
            <Textarea
              value={rescheduleReason}
              onChange={e => setRescheduleReason(e.target.value)}
              placeholder="Why do you need to reschedule?"
              rows={2}
            />
          </div>
          <div>
            <Label>Preferred Time (optional)</Label>
            <Input
              type="datetime-local"
              value={rescheduleTime}
              onChange={e => setRescheduleTime(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowReschedule(null)}>Cancel</Button>
            <Button onClick={requestReschedule} disabled={saving || !rescheduleReason}>
              {saving ? 'Requesting...' : 'Request Reschedule'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function NextInterviewCard({ interview }: { interview: Interview }) {
  const tConfig = typeConfig[interview.interview_type] || typeConfig.video
  const TypeIcon = tConfig.icon
  const isNow = isToday(interview.scheduled_at)
  const timeUntil = getTimeUntil(interview.scheduled_at)

  return (
    <Card className="border-primary bg-primary/5">
      <CardContent className="p-5">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className={`p-3 rounded-xl ${tConfig.color}`}>
            <TypeIcon className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-primary uppercase tracking-wide">Next Interview</span>
              {isNow && <Badge variant="default" className="bg-primary text-xs">Today!</Badge>}
              <span className="text-xs text-muted-foreground">{timeUntil}</span>
            </div>
            <h2 className="text-lg font-semibold mt-1">{interview.job_title}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" /> {interview.company_full_name || interview.company_name}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> {formatDate(interview.scheduled_at)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {formatTime(interview.scheduled_at)} ({interview.duration_minutes}min)
              </span>
            </div>
            {interview.recruiter_name && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                <User className="h-3.5 w-3.5" /> Interviewer: {interview.recruiter_name}
              </p>
            )}
          </div>
          {interview.meeting_link && (
            <a href={interview.meeting_link} target="_blank" rel="noopener noreferrer">
              <Button size="lg">
                <Video className="h-4 w-4 mr-2" /> Join Call
              </Button>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function InterviewCard({
  interview,
  onAccept,
  onDecline,
  onReschedule,
  isPast,
}: {
  interview: Interview
  onAccept?: () => void
  onDecline?: () => void
  onReschedule?: () => void
  isPast?: boolean
}) {
  const config = statusConfig[interview.status] || statusConfig.scheduled
  const StatusIcon = config.icon
  const tConfig = typeConfig[interview.interview_type] || typeConfig.video
  const TypeIcon = tConfig.icon
  const isUpcoming = isFuture(interview.scheduled_at) && ['scheduled', 'confirmed'].includes(interview.status)
  const canRespond = interview.status === 'scheduled'
  const feedback = typeof interview.feedback === 'string' ? (() => { try { return JSON.parse(interview.feedback) } catch { return null } })() : interview.feedback

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Type icon */}
          <div className={`p-2.5 rounded-xl ${tConfig.color} h-fit`}>
            <TypeIcon className="h-5 w-5" />
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{interview.job_title}</h3>
              <Badge variant={config.variant}>
                <StatusIcon className="h-3 w-3 mr-1" /> {config.label}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" /> {interview.company_full_name || interview.company_name}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> {formatDate(interview.scheduled_at)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {formatTime(interview.scheduled_at)} ({interview.duration_minutes}min)
              </span>
            </div>
            {interview.recruiter_name && (
              <p className="text-sm text-muted-foreground mt-1">
                Interviewer: {interview.recruiter_name}
              </p>
            )}
            {interview.notes && (
              <p className="text-sm text-muted-foreground mt-2 bg-muted p-2 rounded">{interview.notes}</p>
            )}
            {feedback && (
              <div className="mt-2 p-2 bg-muted rounded text-sm">
                <span className="font-medium">Result: </span>
                <span className="capitalize">{interview.outcome?.replace('_', ' ') || 'Completed'}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 sm:flex-col">
            {interview.meeting_link && isUpcoming && (
              <a href={interview.meeting_link} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="w-full">
                  <Video className="h-3.5 w-3.5 mr-1" /> Join Call
                </Button>
              </a>
            )}
            {canRespond && onAccept && (
              <Button size="sm" variant="outline" onClick={onAccept}>
                <CheckCircle className="h-3.5 w-3.5 mr-1" /> Accept
              </Button>
            )}
            {canRespond && onReschedule && (
              <Button size="sm" variant="outline" onClick={onReschedule}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reschedule
              </Button>
            )}
            {canRespond && onDecline && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onDecline}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Decline
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
