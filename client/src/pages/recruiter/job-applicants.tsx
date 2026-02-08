import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ArrowLeft, Users, Star, Calendar, Search,
  Mail, FileText, Send, CheckCircle, Clock, Gift, MessageSquare,
} from 'lucide-react'

interface JobInfo {
  id: number
  title: string
  screening_questions?: string | ScreeningQuestion[]
}

interface ScreeningQuestion {
  id?: string
  question: string
  type?: string
  required?: boolean
  category?: string
}

interface Applicant {
  id: number
  candidate_id: number
  job_id: number
  status: string
  candidate_name: string
  candidate_email: string
  applied_at: string
  updated_at: string
  match_score?: number
  omniscore_at_apply?: number
  current_omniscore?: number
  score_tier?: string
  cover_letter?: string
  screening_answers?: string
  recruiter_notes?: string
}

const statuses = ['applied', 'reviewing', 'shortlisted', 'interviewed', 'offered', 'hired', 'rejected']

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  applied: { label: 'New', variant: 'secondary' },
  reviewing: { label: 'Reviewing', variant: 'warning' },
  shortlisted: { label: 'Shortlisted', variant: 'default' },
  interviewed: { label: 'Interviewed', variant: 'default' },
  offered: { label: 'Offered', variant: 'success' },
  hired: { label: 'Hired', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
}

export function RecruiterJobApplicantsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobInfo | null>(null)
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Applicant | null>(null)
  const [notes, setNotes] = useState('')
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    loadApplicants()
  }, [id])

  async function loadApplicants() {
    try {
      const data = await apiCall<{ job: JobInfo; applications: Applicant[] }>(
        `/recruiter/jobs/${id}/applications`
      )
      setJob(data.job)
      setApplicants(data.applications || [])
    } catch {
      navigate('/recruiter/jobs')
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(appId: number, newStatus: string) {
    setUpdating(true)
    try {
      await apiCall(`/recruiter/applications/${appId}`, {
        method: 'PUT',
        body: { status: newStatus, recruiter_notes: notes || undefined },
      })
      loadApplicants()
      if (selected?.id === appId) {
        setSelected(prev => prev ? { ...prev, status: newStatus } : null)
      }
    } catch {
      // silent
    } finally {
      setUpdating(false)
    }
  }

  // Parse screening questions from job to get labels
  const jobScreeningQuestions: ScreeningQuestion[] = (() => {
    if (!job?.screening_questions) return []
    try {
      const raw = typeof job.screening_questions === 'string'
        ? JSON.parse(job.screening_questions)
        : job.screening_questions
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })()

  // Get question label by key (e.g. "sq_default_1" or "q0")
  function getQuestionLabel(key: string, index: number): string {
    // Try matching by id
    const byId = jobScreeningQuestions.find(q => q.id === key)
    if (byId) return byId.question

    // Try matching by index (q0, q1...)
    const match = key.match(/^q(\d+)$/)
    if (match) {
      const qIndex = parseInt(match[1])
      if (jobScreeningQuestions[qIndex]) return jobScreeningQuestions[qIndex].question
    }

    return `Question ${index + 1}`
  }

  const filtered = applicants.filter(a => {
    const matchStatus = !statusFilter || a.status === statusFilter
    const matchSearch = !searchQuery ||
      a.candidate_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.candidate_email?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchStatus && matchSearch
  })

  const statusCounts = statuses.reduce((acc, s) => {
    acc[s] = applicants.filter(a => a.status === s).length
    return acc
  }, {} as Record<string, number>)

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return '1 day ago'
    if (days < 30) return `${days} days ago`
    return `${Math.floor(days / 30)} months ago`
  }

  function renderScreeningAnswers(answersRaw?: string) {
    if (!answersRaw) return null
    try {
      const answers = typeof answersRaw === 'string' ? JSON.parse(answersRaw) : answersRaw
      if (!answers || Object.keys(answers).length === 0) return null

      return (
        <div>
          <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
            <MessageSquare className="h-4 w-4" /> Screening Answers
          </h4>
          <div className="space-y-2">
            {Object.entries(answers).map(([key, value], i) => (
              <div key={key} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  {getQuestionLabel(key, i)}
                </p>
                <p className="text-sm">{String(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )
    } catch {
      return null
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/recruiter/jobs')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-bold">Applicants</h1>
          <p className="text-muted-foreground text-sm">
            {job?.title || 'Job'} &mdash; {applicants.length} applicant{applicants.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{applicants.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{statusCounts.applied || 0}</p>
            <p className="text-xs text-muted-foreground">New</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">
              {(statusCounts.reviewing || 0) + (statusCounts.shortlisted || 0)}
            </p>
            <p className="text-xs text-muted-foreground">In Review</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">
              {(statusCounts.offered || 0) + (statusCounts.hired || 0)}
            </p>
            <p className="text-xs text-muted-foreground">Offered/Hired</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search applicants by name or email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={!statusFilter ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('')}
        >
          All ({applicants.length})
        </Button>
        {statuses.map(s => (
          statusCounts[s] > 0 ? (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {statusConfig[s]?.label || s} ({statusCounts[s]})
            </Button>
          ) : null
        ))}
      </div>

      {/* Applicant list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground">
              {applicants.length === 0 ? 'No applicants yet for this job' : 'No applicants match your filters'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(app => {
            const config = statusConfig[app.status] || { label: app.status, variant: 'secondary' as const }
            return (
              <Card
                key={app.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => { setSelected(app); setNotes(app.recruiter_notes || '') }}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                          {(app.candidate_name || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm truncate">{app.candidate_name || 'Unknown'}</h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 shrink-0" /> {app.candidate_email}
                          </p>
                        </div>
                        <Badge variant={config.variant} className="ml-1 shrink-0">{config.label}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground ml-10">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Applied {timeAgo(app.applied_at)}
                        </span>
                        {app.match_score != null && (
                          <span className="flex items-center gap-1 text-primary font-medium">
                            <Star className="h-3 w-3" /> {app.match_score}% match
                          </span>
                        )}
                        {app.current_omniscore != null && (
                          <span className="flex items-center gap-1">
                            OmniScore: {app.current_omniscore}
                          </span>
                        )}
                        {app.cover_letter && (
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" /> Has cover letter
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={app.status}
                        onChange={e => {
                          e.stopPropagation()
                          updateStatus(app.id, e.target.value)
                        }}
                        onClick={e => e.stopPropagation()}
                        className="w-32 text-xs"
                      >
                        {statuses.map(s => (
                          <option key={s} value={s}>{statusConfig[s]?.label || s}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Detail dialog */}
      {selected && (
        <Dialog open={true} onClose={() => setSelected(null)} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                {(selected.candidate_name || '?')[0].toUpperCase()}
              </div>
              <div>
                <div>{selected.candidate_name}</div>
                <p className="text-sm text-muted-foreground font-normal">{selected.candidate_email}</p>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Applied</p>
                <p className="font-medium text-sm">{new Date(selected.applied_at).toLocaleDateString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={statusConfig[selected.status]?.variant || 'secondary'} className="mt-0.5">
                  {statusConfig[selected.status]?.label || selected.status}
                </Badge>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Match Score</p>
                <p className="font-medium text-sm">{selected.match_score != null ? `${selected.match_score}%` : 'N/A'}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">OmniScore</p>
                <p className="font-medium text-sm">{selected.current_omniscore || selected.omniscore_at_apply || 'N/A'}</p>
              </div>
            </div>

            {/* Cover letter */}
            {selected.cover_letter && (
              <div>
                <h4 className="font-medium text-sm mb-1 flex items-center gap-1">
                  <FileText className="h-4 w-4" /> Cover Letter
                </h4>
                <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap leading-relaxed">
                  {selected.cover_letter}
                </div>
              </div>
            )}

            {/* Screening answers - now with actual question labels */}
            {renderScreeningAnswers(selected.screening_answers)}

            {/* Recruiter notes */}
            <div>
              <h4 className="font-medium text-sm mb-1">Recruiter Notes</h4>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes about this candidate..."
                rows={3}
              />
            </div>

            {/* Status controls */}
            <div className="flex items-center gap-3 pt-2 border-t">
              <span className="text-sm font-medium">Status:</span>
              <Select
                value={selected.status}
                onChange={e => updateStatus(selected.id, e.target.value)}
                className="w-40"
                disabled={updating}
              >
                {statuses.map(s => (
                  <option key={s} value={s}>{statusConfig[s]?.label || s}</option>
                ))}
              </Select>
              <Button
                size="sm"
                onClick={() => {
                  updateStatus(selected.id, selected.status)
                  setSelected(null)
                }}
                disabled={updating}
              >
                Save & Close
              </Button>
            </div>

            {/* Make Offer button */}
            {!['rejected', 'offered', 'hired'].includes(selected.status) && (
              <Button
                className="w-full gap-2"
                onClick={() => {
                  navigate(`/recruiter/offers?create=1&candidateId=${selected.candidate_id}&jobId=${id}`)
                }}
              >
                <Gift className="h-4 w-4" /> Make Offer to {selected.candidate_name?.split(' ')[0] || 'Candidate'}
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}
