import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  FileText, Users, Star, Calendar, MessageSquare, Eye,
  GraduationCap, Gift, Briefcase, Filter, X,
} from 'lucide-react'

interface Application {
  id: number
  candidate_id: number
  job_id: number
  status: string
  candidate_name: string
  candidate_email: string
  job_title: string
  applied_at: string
  updated_at: string
  match_score?: number
  omniscore_at_apply?: number
  current_omniscore?: number
  score_tier?: string
  cover_letter?: string
  screening_answers?: string
  screening_questions?: string
  recruiter_notes?: string
  verified_skills_count?: number
  best_interview_score?: number
  completed_interviews?: number
}

interface Job {
  id: number
  title: string
  status: string
  application_count?: number
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

export function RecruiterApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [applications, setApplications] = useState<Application[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<Application | null>(null)
  const [updating, setUpdating] = useState(false)
  const [notes, setNotes] = useState('')

  const jobFilter = searchParams.get('job') || ''

  useEffect(() => {
    loadData()
  }, [jobFilter])

  async function loadData() {
    try {
      const [appsPromise, jobsPromise] = await Promise.allSettled([
        (async () => {
          let url = '/recruiter/applications?limit=200'
          if (jobFilter) url += `&job_id=${jobFilter}`
          return apiCall<{ applications: Application[] }>(url)
        })(),
        apiCall<{ jobs: Job[] }>('/recruiter/jobs'),
      ])

      if (appsPromise.status === 'fulfilled') {
        setApplications(appsPromise.value.applications || [])
      }
      if (jobsPromise.status === 'fulfilled') {
        setJobs(jobsPromise.value.jobs || [])
      }
    } catch {
      // silent
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
      // Update local state
      setApplications(prev =>
        prev.map(a => a.id === appId ? { ...a, status: newStatus } : a)
      )
      if (selected?.id === appId) {
        setSelected(prev => prev ? { ...prev, status: newStatus } : null)
      }
    } catch {
      // silent
    } finally {
      setUpdating(false)
    }
  }

  async function saveNotes() {
    if (!selected) return
    setUpdating(true)
    try {
      await apiCall(`/recruiter/applications/${selected.id}`, {
        method: 'PUT',
        body: { recruiter_notes: notes },
      })
      setApplications(prev =>
        prev.map(a => a.id === selected.id ? { ...a, recruiter_notes: notes } : a)
      )
    } catch {
      // silent
    } finally {
      setUpdating(false)
    }
  }

  function setJobFilter(jId: string) {
    if (jId) {
      setSearchParams({ job: jId }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
  }

  const filtered = applications.filter(a => !statusFilter || a.status === statusFilter)

  // Group counts
  const statusCounts = statuses.reduce((acc, s) => {
    acc[s] = applications.filter(a => a.status === s).length
    return acc
  }, {} as Record<string, number>)

  const selectedJob = jobs.find(j => j.id === Number(jobFilter))

  function openDetail(app: Application) {
    setSelected(app)
    setNotes(app.recruiter_notes || '')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Applications</h1>
          <p className="text-muted-foreground">
            Review and manage candidate applications
          </p>
        </div>
        {/* Job filter dropdown */}
        <div className="shrink-0 w-56">
          <Select
            value={jobFilter}
            onChange={e => setJobFilter(e.target.value)}
            className="text-sm"
          >
            <option value="">All Jobs</option>
            {jobs.map(j => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Active job filter banner */}
      {jobFilter && selectedJob && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-4 py-2">
          <Briefcase className="h-4 w-4 text-primary" />
          <span className="text-sm">
            Showing applications for: <strong>{selectedJob.title}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setJobFilter('')}
            className="ml-auto gap-1 h-7"
          >
            <X className="h-3 w-3" /> Clear
          </Button>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{applications.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {applications.filter(a => a.status === 'applied').length}
            </p>
            <p className="text-xs text-muted-foreground">New</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">
              {applications.filter(a => ['reviewing', 'shortlisted', 'interviewed'].includes(a.status)).length}
            </p>
            <p className="text-xs text-muted-foreground">In Pipeline</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">
              {applications.filter(a => ['offered', 'hired'].includes(a.status)).length}
            </p>
            <p className="text-xs text-muted-foreground">Offered / Hired</p>
          </CardContent>
        </Card>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={!statusFilter ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('')}
        >
          All ({applications.length})
        </Button>
        {statuses.map(s => (
          statusCounts[s] > 0 && (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {statusConfig[s]?.label || s} ({statusCounts[s]})
            </Button>
          )
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground">
              {applications.length === 0 ? 'No applications yet' : 'No applications match this filter'}
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
                onClick={() => openDetail(app)}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">{app.candidate_name || 'Unknown'}</h3>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3" />
                          {app.job_title}
                        </span>
                        <span>{app.candidate_email}</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(app.applied_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {app.match_score && (
                        <div className="text-center">
                          <div className="text-lg font-bold text-primary">{app.match_score}%</div>
                          <div className="text-[10px] text-muted-foreground">Match</div>
                        </div>
                      )}
                      {app.verified_skills_count !== undefined && app.verified_skills_count > 0 && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <GraduationCap className="h-3 w-3" /> {app.verified_skills_count} verified
                        </Badge>
                      )}
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

      {/* Application detail dialog */}
      {selected && (
        <Dialog open={true} onClose={() => setSelected(null)} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Application: {selected.candidate_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Position</p>
                <p className="font-medium">{selected.job_title}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="font-medium text-sm">{selected.candidate_email}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Applied</p>
                <p className="font-medium">{new Date(selected.applied_at).toLocaleDateString()}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Match Score</p>
                <p className="font-medium">{selected.match_score ? `${selected.match_score}%` : 'N/A'}</p>
              </div>
            </div>

            {/* Cover letter */}
            {selected.cover_letter && (
              <div>
                <h4 className="font-medium text-sm mb-1">Cover Letter</h4>
                <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {selected.cover_letter}
                </div>
              </div>
            )}

            {/* Screening answers */}
            {selected.screening_answers && (() => {
              try {
                const answers = typeof selected.screening_answers === 'string'
                  ? JSON.parse(selected.screening_answers)
                  : selected.screening_answers
                const questions = selected.screening_questions
                  ? (typeof selected.screening_questions === 'string'
                    ? JSON.parse(selected.screening_questions)
                    : selected.screening_questions)
                  : []
                if (!answers || Object.keys(answers).length === 0) return null
                return (
                  <div>
                    <h4 className="font-medium text-sm mb-2">Screening Answers</h4>
                    <div className="space-y-2">
                      {Object.entries(answers).map(([key, value], i) => {
                        const q = questions[i]
                        return (
                          <div key={key} className="rounded-lg bg-muted/50 p-3">
                            <p className="text-xs text-muted-foreground mb-1">
                              {q?.question || q || `Question ${i + 1}`}
                            </p>
                            <p className="text-sm">{String(value)}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              } catch {
                return null
              }
            })()}

            {/* Candidate stats */}
            <div className="flex flex-wrap gap-2">
              {selected.verified_skills_count !== undefined && selected.verified_skills_count > 0 && (
                <Badge variant="outline" className="gap-1">
                  <GraduationCap className="h-3 w-3" /> {selected.verified_skills_count} verified skills
                </Badge>
              )}
              {selected.completed_interviews !== undefined && selected.completed_interviews > 0 && (
                <Badge variant="outline" className="gap-1">
                  <MessageSquare className="h-3 w-3" /> {selected.completed_interviews} interviews done
                </Badge>
              )}
              {selected.current_omniscore && (
                <Badge variant="outline" className="gap-1">
                  <Star className="h-3 w-3" /> OmniScore: {selected.current_omniscore}
                </Badge>
              )}
            </div>

            {/* Notes */}
            <div>
              <h4 className="font-medium text-sm mb-1">Recruiter Notes</h4>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes about this candidate..."
                rows={3}
              />
            </div>

            {/* Status change + actions */}
            <div className="flex items-center gap-3 pt-2">
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
                variant="outline"
                onClick={() => {
                  saveNotes()
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
                  navigate(`/recruiter/offers?create=1&candidateId=${selected.candidate_id}&jobId=${selected.job_id}`)
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
