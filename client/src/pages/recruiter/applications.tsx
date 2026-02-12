import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  FileText, Users, Star, Calendar, MessageSquare, Eye,
  GraduationCap, Gift, Briefcase, Filter, X, Clock,
  ClipboardList, ChevronDown, ChevronUp, ArrowUpDown,
  Brain, TrendingUp, Sparkles, Video,
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

// Aligned with backend PIPELINE_STAGES
const statuses = ['applied', 'screening', 'shortlisted', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn']

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  applied: { label: 'New', variant: 'secondary' },
  screening: { label: 'Screening', variant: 'default' },
  shortlisted: { label: 'Shortlisted', variant: 'default' },
  reviewing: { label: 'Reviewing', variant: 'warning' },
  interviewed: { label: 'Interviewed', variant: 'default' },
  offered: { label: 'Offered', variant: 'success' },
  hired: { label: 'Hired', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  withdrawn: { label: 'Withdrawn', variant: 'secondary' },
}

type SortField = 'applied_at' | 'candidate_name' | 'match_score'
type SortDir = 'asc' | 'desc'

export function RecruiterApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [applications, setApplications] = useState<Application[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<Application | null>(null)
  const [updating, setUpdating] = useState(false)
  const [notes, setNotes] = useState('')
  const [sortField, setSortField] = useState<SortField>('applied_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [searchQuery, setSearchQuery] = useState('')

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

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  // Apply all filters
  const filtered = applications
    .filter(a => !statusFilter || a.status === statusFilter)
    .filter(a => {
      if (!dateFrom && !dateTo) return true
      const d = new Date(a.applied_at).getTime()
      if (dateFrom && d < new Date(dateFrom).getTime()) return false
      if (dateTo && d > new Date(dateTo + 'T23:59:59').getTime()) return false
      return true
    })
    .filter(a => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return (
        (a.candidate_name || '').toLowerCase().includes(q) ||
        (a.candidate_email || '').toLowerCase().includes(q) ||
        (a.job_title || '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortField === 'applied_at') {
        cmp = new Date(a.applied_at).getTime() - new Date(b.applied_at).getTime()
      } else if (sortField === 'candidate_name') {
        cmp = (a.candidate_name || '').localeCompare(b.candidate_name || '')
      } else if (sortField === 'match_score') {
        cmp = (a.match_score || 0) - (b.match_score || 0)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  // Group counts
  const statusCounts = statuses.reduce((acc, s) => {
    acc[s] = applications.filter(a => a.status === s).length
    return acc
  }, {} as Record<string, number>)

  const selectedJob = jobs.find(j => j.id === Number(jobFilter))
  const hasActiveFilters = statusFilter || dateFrom || dateTo || searchQuery

  function openDetail(app: Application) {
    setSelected(app)
    setNotes(app.recruiter_notes || '')
  }

  function clearAllFilters() {
    setStatusFilter('')
    setDateFrom('')
    setDateTo('')
    setSearchQuery('')
    setJobFilter('')
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

      {/* Filters section */}
      <div className="space-y-3">
        {/* Search + Date filters row */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Search</label>
            <Input
              placeholder="Search by name, email, or job..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">From Date</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">To Date</label>
            <Input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="text-sm"
            />
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-1 text-muted-foreground">
              <X className="h-3 w-3" /> Clear Filters
            </Button>
          )}
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
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium">Sort:</span>
        <SortButton field="applied_at" label="Date" current={sortField} dir={sortDir} onToggle={toggleSort} />
        <SortButton field="candidate_name" label="Name" current={sortField} dir={sortDir} onToggle={toggleSort} />
        <SortButton field="match_score" label="Match" current={sortField} dir={sortDir} onToggle={toggleSort} />
        <span className="ml-auto">{filtered.length} application{filtered.length !== 1 ? 's' : ''}</span>
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
              {applications.length === 0 ? 'No applications yet' : 'No applications match your filters'}
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearAllFilters} className="mt-3 gap-1">
                <X className="h-3 w-3" /> Clear Filters
              </Button>
            )}
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
                        {hasScreeningAnswers(app) && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <ClipboardList className="h-3 w-3" /> Screening
                          </Badge>
                        )}
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
            <ScreeningAnswersBlock app={selected} />

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

            {/* AI Coaching History */}
            <CandidateCoachingSection candidateId={selected.candidate_id} />

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

function hasScreeningAnswers(app: Application): boolean {
  try {
    const answers = typeof app.screening_answers === 'string'
      ? JSON.parse(app.screening_answers)
      : app.screening_answers
    return answers && Object.keys(answers).length > 0
  } catch {
    return false
  }
}

function ScreeningAnswersBlock({ app }: { app: Application }) {
  try {
    const answers = typeof app.screening_answers === 'string'
      ? JSON.parse(app.screening_answers)
      : app.screening_answers
    const questions = app.screening_questions
      ? (typeof app.screening_questions === 'string'
        ? JSON.parse(app.screening_questions)
        : app.screening_questions)
      : []
    if (!answers || Object.keys(answers).length === 0) return null
    return (
      <div>
        <h4 className="font-medium text-sm mb-2 flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4 text-primary" />
          Screening Answers
        </h4>
        <div className="space-y-2">
          {Object.entries(answers).map(([key, value], i) => {
            const q = questions[i]
            return (
              <div key={key} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1 font-medium">
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
}

function CandidateCoachingSection({ candidateId }: { candidateId: number }) {
  const [coaching, setCoaching] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [expandedSession, setExpandedSession] = useState<number | null>(null)

  useEffect(() => {
    if (!candidateId) return
    setLoading(true)
    apiCall<any>(`/recruiter/candidates/${candidateId}/coaching`)
      .then(res => { if (res.success) setCoaching(res) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [candidateId])

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading coaching data...</div>
  if (!coaching || coaching.stats?.total_sessions === 0) return null

  const stats = coaching.stats
  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 6 ? 'text-amber-600' : 'text-red-600'

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-1"
      >
        <h4 className="font-medium text-sm flex items-center gap-1.5">
          <Brain className="h-4 w-4 text-primary" />
          AI Coaching History
          <Badge variant="secondary" className="text-xs ml-1">{stats.total_sessions} sessions</Badge>
        </h4>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="p-2.5 rounded-lg bg-muted/50 text-center">
              <div className={`text-lg font-bold ${stats.average_score ? scoreColor(stats.average_score) : ''}`}>
                {stats.average_score ? `${Math.round(stats.average_score * 10) / 10}` : '-'}
              </div>
              <div className="text-[10px] text-muted-foreground">Avg Score</div>
            </div>
            <div className="p-2.5 rounded-lg bg-muted/50 text-center">
              <div className="text-lg font-bold">{stats.total_sessions}</div>
              <div className="text-[10px] text-muted-foreground">Sessions</div>
            </div>
            <div className="p-2.5 rounded-lg bg-muted/50 text-center">
              <div className={`text-lg font-bold ${stats.highest_score ? scoreColor(stats.highest_score) : ''}`}>
                {stats.highest_score || '-'}
              </div>
              <div className="text-[10px] text-muted-foreground">Best Score</div>
            </div>
            <div className="p-2.5 rounded-lg bg-muted/50 text-center">
              <div className={`text-lg font-bold ${
                stats.improvement_percent != null
                  ? stats.improvement_percent > 0 ? 'text-green-600' : stats.improvement_percent < 0 ? 'text-red-600' : ''
                  : ''
              }`}>
                {stats.improvement_percent != null ? `${stats.improvement_percent > 0 ? '+' : ''}${stats.improvement_percent}%` : '-'}
              </div>
              <div className="text-[10px] text-muted-foreground">Improvement</div>
            </div>
          </div>

          {/* Category breakdown */}
          {coaching.by_category?.length > 0 && (
            <div className="space-y-1.5">
              {coaching.by_category.map((cat: any) => {
                const avg = parseFloat(cat.avg_score) || 0
                const pct = (avg / 10) * 100
                return (
                  <div key={cat.category} className="flex items-center gap-2 text-xs">
                    <span className="w-20 font-medium capitalize">{cat.category}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${avg >= 8 ? 'bg-green-500' : avg >= 6 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`font-bold ${scoreColor(avg)}`}>{Math.round(avg * 10) / 10}</span>
                    <span className="text-muted-foreground">({cat.count})</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Recent sessions */}
          <div className="space-y-1.5">
            <h5 className="text-xs font-medium text-muted-foreground">Recent Sessions</h5>
            {coaching.sessions?.slice(0, 5).map((s: any) => {
              const cd = s.coaching_data
              const isExpanded = expandedSession === s.id
              return (
                <div key={s.id} className="rounded-lg border">
                  <button
                    onClick={() => setExpandedSession(isExpanded ? null : s.id)}
                    className="w-full flex items-center gap-2 p-2.5 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className={`text-sm font-bold ${scoreColor(s.score)}`}>{s.score}/10</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1">{s.question}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant="outline" className="text-[10px]">
                          {s.response_type === 'video' ? 'Video' : 'Text'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {isExpanded && cd && (
                    <div className="px-2.5 pb-2.5 space-y-2">
                      {/* Show key feedback */}
                      {(cd.content?.strengths || cd.strengths) && (
                        <div className="p-2 rounded bg-green-50 border border-green-100">
                          <h6 className="text-[10px] font-semibold text-green-800 mb-1">Strengths</h6>
                          <ul className="space-y-0.5">
                            {(cd.content?.strengths || cd.strengths || []).map((s: string, i: number) => (
                              <li key={i} className="text-[10px] text-green-700">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(cd.content?.improvements || cd.improvements) && (
                        <div className="p-2 rounded bg-amber-50 border border-amber-100">
                          <h6 className="text-[10px] font-semibold text-amber-800 mb-1">Areas to Improve</h6>
                          <ul className="space-y-0.5">
                            {(cd.content?.improvements || cd.improvements || []).map((s: string, i: number) => (
                              <li key={i} className="text-[10px] text-amber-700">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {cd.communication && (
                        <div className="flex gap-2 text-[10px]">
                          <span className="text-muted-foreground">WPM: <strong>{cd.communication.words_per_minute}</strong></span>
                          <span className="text-muted-foreground">Fillers: <strong>{cd.communication.total_fillers}</strong></span>
                          {cd.presentation && <span className="text-muted-foreground">Presentation: <strong className={scoreColor(cd.presentation.score)}>{cd.presentation.score}/10</strong></span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function SortButton({
  field,
  label,
  current,
  dir,
  onToggle,
}: {
  field: SortField
  label: string
  current: SortField
  dir: SortDir
  onToggle: (f: SortField) => void
}) {
  const isActive = current === field
  return (
    <button
      onClick={() => onToggle(field)}
      className={`flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors ${
        isActive ? 'text-foreground font-medium' : ''
      }`}
    >
      {label}
      {isActive ? (
        dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )
}
