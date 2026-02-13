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
  ArrowLeft, Users, Star, Calendar, Search, LayoutGrid, List,
  Mail, FileText, Send, CheckCircle, Clock, Gift, MessageSquare,
  ChevronRight, Zap, Target, AlertCircle, Sparkles, Loader2, X,
  ThumbsUp, ThumbsDown, BarChart3, Briefcase, GraduationCap, MapPin, DollarSign,
  GitCompare, Settings2, Sliders,
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
  matching_skills?: string[] | string
  missing_skills?: string[] | string
  similarity_score?: number
  match_explanation?: string | Record<string, string>
}

// Aligned with backend PIPELINE_STAGES
const statuses = ['applied', 'screening', 'shortlisted', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected', 'withdrawn']
const kanbanStages = ['applied', 'screening', 'shortlisted', 'reviewing', 'interviewed', 'offered', 'hired']

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; color: string }> = {
  applied: { label: 'New', variant: 'secondary', color: 'border-blue-300 bg-blue-50' },
  screening: { label: 'Screening', variant: 'default', color: 'border-purple-300 bg-purple-50' },
  shortlisted: { label: 'Shortlisted', variant: 'default', color: 'border-indigo-300 bg-indigo-50' },
  reviewing: { label: 'Reviewing', variant: 'warning', color: 'border-amber-300 bg-amber-50' },
  interviewed: { label: 'Interviewed', variant: 'default', color: 'border-cyan-300 bg-cyan-50' },
  offered: { label: 'Offered', variant: 'success', color: 'border-emerald-300 bg-emerald-50' },
  hired: { label: 'Hired', variant: 'success', color: 'border-green-300 bg-green-50' },
  rejected: { label: 'Rejected', variant: 'destructive', color: 'border-red-300 bg-red-50' },
  withdrawn: { label: 'Withdrawn', variant: 'secondary', color: 'border-gray-300 bg-gray-50' },
}

function matchScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-amber-600'
  return 'text-red-500'
}

function matchScoreBg(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-700 border-green-200'
  if (score >= 60) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-700 border-red-200'
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
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('kanban')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchUpdating, setBatchUpdating] = useState(false)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [matchBreakdown, setMatchBreakdown] = useState<any>(null)
  const [matchBreakdownLoading, setMatchBreakdownLoading] = useState(false)
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [comparisonResult, setComparisonResult] = useState<any>(null)
  const [showComparison, setShowComparison] = useState(false)
  const [showAutomation, setShowAutomation] = useState(false)
  const [automationRules, setAutomationRules] = useState<any>(null)
  const [automationLoading, setAutomationLoading] = useState(false)
  const [automationSaving, setAutomationSaving] = useState(false)

  useEffect(() => {
    loadApplicants()
  }, [id])

  async function loadMatchBreakdown(candidateId: number, jobId: number) {
    setMatchBreakdownLoading(true)
    try {
      const data = await apiCall<{ success: boolean; breakdown: any }>(`/memory/match-breakdown/${candidateId}/${jobId}`)
      setMatchBreakdown(data.breakdown || null)
    } catch { setMatchBreakdown(null) }
    finally { setMatchBreakdownLoading(false) }
  }

  async function sendFeedback(candidateId: number, feedbackType: 'positive' | 'negative') {
    setFeedbackSending(true)
    try {
      await apiCall('/memory/recruiter-feedback', {
        method: 'POST',
        body: { candidate_id: candidateId, job_id: Number(id), feedback_type: feedbackType }
      })
    } catch {} finally { setFeedbackSending(false) }
  }

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
      setApplicants(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a))
      if (selected?.id === appId) {
        setSelected(prev => prev ? { ...prev, status: newStatus } : null)
      }
    } catch {
      // silent
    } finally {
      setUpdating(false)
    }
  }

  async function batchUpdateStatus(newStatus: string) {
    if (selectedIds.size === 0) return
    setBatchUpdating(true)
    try {
      await apiCall('/recruiter/applications/batch-status', {
        method: 'PUT',
        body: { application_ids: Array.from(selectedIds), status: newStatus },
      })
      setApplicants(prev => prev.map(a => selectedIds.has(a.id) ? { ...a, status: newStatus } : a))
      setSelectedIds(new Set())
    } catch {
      // silent
    } finally {
      setBatchUpdating(false)
    }
  }

  async function generateAiSummary(applicationId: number) {
    setAiSummaryLoading(true)
    setAiSummary(null)
    try {
      const data = await apiCall<{ success: boolean; summary: { overall_assessment: string; strengths: string[]; concerns: string[]; recommendation: string; fit_score: number } }>('/recruiter/ai/candidate-summary', {
        method: 'POST',
        body: { application_id: applicationId },
      })
      if (data.summary) {
        const parts: string[] = []
        parts.push(`**Assessment:** ${data.summary.overall_assessment}`)
        if (data.summary.fit_score) parts.push(`**Fit Score:** ${data.summary.fit_score}/100`)
        if (data.summary.strengths?.length) parts.push(`**Strengths:** ${data.summary.strengths.join(', ')}`)
        if (data.summary.concerns?.length) parts.push(`**Concerns:** ${data.summary.concerns.join(', ')}`)
        if (data.summary.recommendation) parts.push(`**Recommendation:** ${data.summary.recommendation}`)
        setAiSummary(parts.join('\n\n'))
      }
    } catch {
      setAiSummary('AI summary could not be generated. The candidate may not have enough profile data.')
    } finally {
      setAiSummaryLoading(false)
    }
  }

  // AI Compare candidates
  async function compareCandidates() {
    if (selectedIds.size < 2) return
    setComparing(true)
    setShowComparison(true)
    try {
      const candidateIds = applicants
        .filter(a => selectedIds.has(a.id))
        .map(a => a.candidate_id)
      const data = await apiCall<{ success: boolean; comparison: any }>('/recruiter/ai/compare-candidates', {
        method: 'POST',
        body: { candidate_ids: candidateIds, job_id: Number(id) },
      })
      setComparisonResult(data.comparison || data)
    } catch {
      setComparisonResult({ error: 'Comparison failed. Ensure candidates have sufficient profile data.' })
    } finally { setComparing(false) }
  }

  // Pipeline automation
  async function loadAutomation() {
    setAutomationLoading(true)
    try {
      const data = await apiCall<{ success: boolean; rules: any }>(`/recruiter/pipeline/automation/${id}`)
      setAutomationRules(data.rules || { auto_advance: [], auto_reject: [] })
    } catch {
      setAutomationRules({ auto_advance: [], auto_reject: [] })
    } finally { setAutomationLoading(false) }
  }

  async function saveAutomation(rules: any) {
    setAutomationSaving(true)
    try {
      await apiCall(`/recruiter/pipeline/automation/${id}`, {
        method: 'PUT',
        body: { rules },
      })
    } catch {} finally { setAutomationSaving(false) }
  }

  async function runAutoCheck() {
    try {
      const data = await apiCall<{ success: boolean; actions: any[] }>(`/recruiter/pipeline/auto-check/${id}`, { method: 'POST' })
      if (data.actions?.length) {
        loadApplicants() // Refresh to show changes
      }
    } catch {}
  }

  function toggleSelect(appId: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  // Parse screening questions
  const jobScreeningQuestions: ScreeningQuestion[] = (() => {
    if (!job?.screening_questions) return []
    try {
      const raw = typeof job.screening_questions === 'string'
        ? JSON.parse(job.screening_questions) : job.screening_questions
      return Array.isArray(raw) ? raw : []
    } catch { return [] }
  })()

  function getQuestionLabel(key: string, index: number): string {
    const byId = jobScreeningQuestions.find(q => q.id === key)
    if (byId) return byId.question
    const match = key.match(/^q(\d+)$/)
    if (match) {
      const qIndex = parseInt(match[1])
      if (jobScreeningQuestions[qIndex]) return jobScreeningQuestions[qIndex].question
    }
    return `Question ${index + 1}`
  }

  function parseSkills(raw?: string[] | string): string[] {
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    try { return JSON.parse(raw) } catch { return [] }
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
    if (days === 1) return '1d ago'
    if (days < 30) return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/recruiter/jobs')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-bold">Pipeline</h1>
          <p className="text-muted-foreground text-sm">
            {job?.title || 'Job'} &mdash; {applicants.length} applicant{applicants.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/recruiter/jobs/${id}/assessment`)}
          className="gap-1 h-8 border-violet-200 text-violet-700 hover:bg-violet-50"
        >
          <GraduationCap className="h-3.5 w-3.5" /> ✨ Assessment
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setShowAutomation(true); loadAutomation() }}
          className="gap-1 h-8"
        >
          <Sliders className="h-3.5 w-3.5" /> Automation
        </Button>
        <div className="flex items-center gap-1 border rounded-lg p-0.5">
          <Button
            variant={viewMode === 'kanban' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('kanban')}
            className="gap-1 h-7 px-2"
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Board
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            className="gap-1 h-7 px-2"
          >
            <List className="h-3.5 w-3.5" /> List
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold">{applicants.length}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{statusCounts.applied || 0}</p>
          <p className="text-xs text-muted-foreground">New</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">
            {(statusCounts.screening || 0) + (statusCounts.shortlisted || 0) + (statusCounts.reviewing || 0)}
          </p>
          <p className="text-xs text-muted-foreground">In Pipeline</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">
            {(statusCounts.offered || 0) + (statusCounts.hired || 0)}
          </p>
          <p className="text-xs text-muted-foreground">Offered/Hired</p>
        </CardContent></Card>
      </div>

      {/* Search + bulk actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            {selectedIds.size >= 2 && (
              <Button variant="outline" size="sm" onClick={compareCandidates} disabled={comparing} className="gap-1 text-xs">
                <GitCompare className="h-3.5 w-3.5" /> {comparing ? 'Comparing...' : 'AI Compare'}
              </Button>
            )}
            <Select
              value=""
              onChange={e => { if (e.target.value) batchUpdateStatus(e.target.value) }}
              className="w-36 text-xs"
              disabled={batchUpdating}
            >
              <option value="">Bulk action...</option>
              {statuses.map(s => (
                <option key={s} value={s}>Move to {statusConfig[s]?.label || s}</option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        )}
      </div>

      {/* KANBAN VIEW */}
      {viewMode === 'kanban' ? (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-[900px]">
            {kanbanStages.map(stage => {
              const stageApps = applicants.filter(a => a.status === stage)
              const cfg = statusConfig[stage]
              return (
                <div key={stage} className="flex-1 min-w-[160px]">
                  <div className={`rounded-t-lg border-t-2 px-3 py-2 ${cfg.color} border-b`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{cfg.label}</span>
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{stageApps.length}</Badge>
                    </div>
                  </div>
                  <div className="space-y-2 pt-2 min-h-[120px]">
                    {stageApps.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground text-center py-6 italic">No candidates</p>
                    ) : stageApps.map(app => (
                      <div
                        key={app.id}
                        className="rounded-lg border bg-card p-2.5 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => { setSelected(app); setNotes(app.recruiter_notes || ''); setAiSummary(null); setMatchBreakdown(null); loadMatchBreakdown(app.candidate_id, Number(id)) }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[10px]">
                            {(app.candidate_name || '?')[0].toUpperCase()}
                          </div>
                          <span className="text-xs font-medium truncate">{app.candidate_name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {app.match_score != null && (
                            <span className={`font-bold ${matchScoreColor(app.match_score)}`}>
                              {app.match_score}%
                            </span>
                          )}
                          <span>{timeAgo(app.applied_at)}</span>
                          {app.cover_letter && <FileText className="h-2.5 w-2.5" />}
                        </div>
                        {/* Quick advance button */}
                        {stage !== 'hired' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full mt-1.5 h-6 text-[10px] gap-1 text-muted-foreground hover:text-primary"
                            onClick={e => {
                              e.stopPropagation()
                              const nextIdx = kanbanStages.indexOf(stage) + 1
                              if (nextIdx < kanbanStages.length) {
                                updateStatus(app.id, kanbanStages[nextIdx])
                              }
                            }}
                          >
                            <ChevronRight className="h-3 w-3" />
                            Advance
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {/* Rejected/Withdrawn counts */}
          {((statusCounts.rejected || 0) + (statusCounts.withdrawn || 0)) > 0 && (
            <div className="flex gap-3 mt-3 text-xs text-muted-foreground">
              {statusCounts.rejected > 0 && (
                <span className="flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 text-red-400" /> {statusCounts.rejected} rejected
                </span>
              )}
              {statusCounts.withdrawn > 0 && (
                <span className="flex items-center gap-1">{statusCounts.withdrawn} withdrawn</span>
              )}
            </div>
          )}
        </div>
      ) : (
        /* LIST VIEW */
        <>
          {/* Status filter pills */}
          <div className="flex flex-wrap gap-2">
            <Button variant={!statusFilter ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter('')}>
              All ({applicants.length})
            </Button>
            {statuses.map(s => (
              statusCounts[s] > 0 ? (
                <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
                  {statusConfig[s]?.label || s} ({statusCounts[s]})
                </Button>
              ) : null
            ))}
          </div>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="text-muted-foreground">
                  {applicants.length === 0 ? 'No applicants yet' : 'No matches'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map(app => {
                const config = statusConfig[app.status] || { label: app.status, variant: 'secondary' as const, color: '' }
                return (
                  <Card
                    key={app.id}
                    className={`cursor-pointer transition-shadow hover:shadow-md ${selectedIds.has(app.id) ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => { setSelected(app); setNotes(app.recruiter_notes || ''); setAiSummary(null); setMatchBreakdown(null); loadMatchBreakdown(app.candidate_id, Number(id)) }}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(app.id)}
                            onChange={e => { e.stopPropagation(); toggleSelect(app.id) }}
                            onClick={e => e.stopPropagation()}
                            className="h-4 w-4 rounded border-gray-300 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-xs">
                                {(app.candidate_name || '?')[0].toUpperCase()}
                              </div>
                              <h3 className="font-semibold text-sm truncate">{app.candidate_name || 'Unknown'}</h3>
                              <Badge variant={config.variant} className="shrink-0">{config.label}</Badge>
                              {app.match_score != null && app.match_score >= 80 && (
                                <Badge variant="outline" className="text-[10px] gap-0.5 text-green-600 border-green-200 bg-green-50 shrink-0">
                                  <Zap className="h-2.5 w-2.5" /> Top Match
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" /> {app.candidate_email}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {timeAgo(app.applied_at)}
                              </span>
                              {app.cover_letter && <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Cover letter</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {app.match_score != null && (
                            <div className={`text-center rounded-lg border px-2 py-1 ${matchScoreBg(app.match_score)}`}>
                              <div className="text-base font-bold">{app.match_score}%</div>
                              <div className="text-[9px] uppercase font-medium">Match</div>
                            </div>
                          )}
                          <Select
                            value={app.status}
                            onChange={e => { e.stopPropagation(); updateStatus(app.id, e.target.value) }}
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
        </>
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
                <p className={`font-bold text-lg ${selected.match_score != null ? matchScoreColor(selected.match_score) : ''}`}>
                  {selected.match_score != null ? `${selected.match_score}%` : 'N/A'}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">OmniScore</p>
                <p className="font-medium text-sm">{selected.current_omniscore || selected.omniscore_at_apply || 'N/A'}</p>
              </div>
            </div>

            {/* Skills breakdown */}
            <SkillsBreakdown
              matchingSkills={parseSkills(selected.matching_skills)}
              missingSkills={parseSkills(selected.missing_skills)}
            />

            {/* Match Score Breakdown Card */}
            {matchBreakdown && matchBreakdown.dimensions && (
              <div>
                <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
                  <BarChart3 className="h-4 w-4 text-primary" /> Match Score Breakdown
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(matchBreakdown.dimensions).map(([key, dim]: [string, any]) => {
                    if (dim.available === false && !dim.score) return null
                    const score = dim.score || 0
                    const barColor = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : score >= 40 ? 'bg-orange-400' : 'bg-red-400'
                    const icon = key === 'skills' ? <Briefcase className="h-3 w-3" /> :
                      key === 'experience' ? <Clock className="h-3 w-3" /> :
                      key === 'education' ? <GraduationCap className="h-3 w-3" /> :
                      key === 'salary_fit' ? <DollarSign className="h-3 w-3" /> :
                      key === 'location' ? <MapPin className="h-3 w-3" /> :
                      <Star className="h-3 w-3" />
                    return (
                      <div key={key} className="rounded-lg bg-muted/50 p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-medium flex items-center gap-1">{icon}{dim.label}</span>
                          <span className="text-xs font-bold">{score}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, score)}%` }} />
                        </div>
                        {dim.detail && <p className="text-[10px] text-muted-foreground mt-1 truncate">{dim.detail}</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {matchBreakdownLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading match breakdown...
              </div>
            )}

            {/* Recruiter Quick Feedback */}
            <div className="flex items-center gap-2 py-1">
              <span className="text-xs text-muted-foreground">Quick feedback:</span>
              <Button variant="outline" size="sm" onClick={() => sendFeedback(selected.candidate_id, 'positive')} disabled={feedbackSending}
                className="gap-1 text-xs h-7 text-green-600 border-green-200 hover:bg-green-50">
                <ThumbsUp className="h-3 w-3" /> Good Fit
              </Button>
              <Button variant="outline" size="sm" onClick={() => sendFeedback(selected.candidate_id, 'negative')} disabled={feedbackSending}
                className="gap-1 text-xs h-7 text-red-500 border-red-200 hover:bg-red-50">
                <ThumbsDown className="h-3 w-3" /> Not a Fit
              </Button>
            </div>

            {/* Cover letter */}
            {selected.cover_letter && (
              <div>
                <h4 className="font-medium text-sm mb-1 flex items-center gap-1">
                  <FileText className="h-4 w-4" /> Cover Letter
                </h4>
                <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                  {selected.cover_letter}
                </div>
              </div>
            )}

            {/* Screening answers */}
            {(() => {
              if (!selected.screening_answers) return null
              try {
                const answers = typeof selected.screening_answers === 'string' ? JSON.parse(selected.screening_answers) : selected.screening_answers
                if (!answers || Object.keys(answers).length === 0) return null
                return (
                  <div>
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" /> Screening Answers
                    </h4>
                    <div className="space-y-2">
                      {Object.entries(answers).map(([key, value], i) => (
                        <div key={key} className="rounded-lg bg-muted/50 p-3">
                          <p className="text-xs text-muted-foreground mb-1 font-medium">{getQuestionLabel(key, i)}</p>
                          <p className="text-sm">{String(value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              } catch { return null }
            })()}

            {/* AI Candidate Summary */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-sm flex items-center gap-1">
                  <Sparkles className="h-4 w-4 text-primary" /> AI Assessment
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => generateAiSummary(selected.id)}
                  disabled={aiSummaryLoading}
                  className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary hover:text-white"
                >
                  {aiSummaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {aiSummaryLoading ? 'Analyzing...' : aiSummary ? 'Refresh' : 'Generate Summary'}
                </Button>
              </div>
              {aiSummaryLoading && (
                <div className="flex items-center gap-2 text-sm text-primary py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI is analyzing this candidate's profile, skills, and application...
                </div>
              )}
              {aiSummary && !aiSummaryLoading && (
                <div className="rounded-lg bg-blue-50/50 border border-blue-100 p-3 space-y-2 text-sm">
                  {aiSummary.split('\n\n').map((paragraph, i) => {
                    const boldMatch = paragraph.match(/^\*\*(.+?):\*\*\s*(.+)$/)
                    if (boldMatch) {
                      return (
                        <div key={i}>
                          <span className="font-semibold text-blue-900">{boldMatch[1]}:</span>{' '}
                          <span className="text-blue-800">{boldMatch[2]}</span>
                        </div>
                      )
                    }
                    return <p key={i} className="text-blue-800">{paragraph}</p>
                  })}
                </div>
              )}
            </div>

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
            {!['rejected', 'offered', 'hired', 'withdrawn'].includes(selected.status) && (
              <Button
                className="w-full gap-2"
                onClick={() => navigate(`/recruiter/offers?create=1&candidateId=${selected.candidate_id}&jobId=${id}`)}
              >
                <Gift className="h-4 w-4" /> Make Offer to {selected.candidate_name?.split(' ')[0] || 'Candidate'}
              </Button>
            )}
          </div>
        </Dialog>
      )}

      {/* AI Comparison Dialog */}
      {showComparison && (
        <Dialog open={true} onClose={() => { setShowComparison(false); setComparisonResult(null) }} className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5 text-primary" /> AI Candidate Comparison
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {comparing ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">AI is comparing {selectedIds.size} candidates...</p>
              </div>
            ) : comparisonResult?.error ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{comparisonResult.error}</div>
            ) : comparisonResult ? (
              <>
                {/* Ranking */}
                {comparisonResult.ranking && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Ranking</h4>
                    {comparisonResult.ranking.map((r: any, i: number) => {
                      const app = applicants.find(a => a.candidate_id === r.candidate_id)
                      return (
                        <div key={r.candidate_id} className={`flex items-center gap-3 rounded-lg border p-3 ${i === 0 ? 'border-green-200 bg-green-50' : ''}`}>
                          <span className="text-lg font-bold text-muted-foreground">#{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{app?.candidate_name || `Candidate ${r.candidate_id}`}</p>
                            {r.reasoning && <p className="text-xs text-muted-foreground truncate">{r.reasoning}</p>}
                          </div>
                          {r.overall_score != null && (
                            <div className={`rounded-lg border px-2 py-1 text-center ${matchScoreBg(r.overall_score)}`}>
                              <span className="font-bold text-sm">{r.overall_score}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {/* Dimensions comparison */}
                {comparisonResult.dimensions && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Dimension Comparison</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 text-xs">Dimension</th>
                            {comparisonResult.ranking?.map((r: any) => {
                              const app = applicants.find(a => a.candidate_id === r.candidate_id)
                              return <th key={r.candidate_id} className="text-center py-2 text-xs">{app?.candidate_name?.split(' ')[0] || 'Candidate'}</th>
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(comparisonResult.dimensions).map(([dim, scores]: [string, any]) => (
                            <tr key={dim} className="border-b">
                              <td className="py-2 capitalize text-xs font-medium">{dim.replace(/_/g, ' ')}</td>
                              {comparisonResult.ranking?.map((r: any) => (
                                <td key={r.candidate_id} className="text-center py-2">
                                  <span className={`text-xs font-bold ${matchScoreColor(scores[r.candidate_id] || 0)}`}>
                                    {scores[r.candidate_id] ?? '-'}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {/* Key differentiators */}
                {comparisonResult.key_differentiators && (
                  <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800">
                    <p className="font-medium mb-1">Key Differentiators</p>
                    <p>{typeof comparisonResult.key_differentiators === 'string' ? comparisonResult.key_differentiators : JSON.stringify(comparisonResult.key_differentiators)}</p>
                  </div>
                )}
                {comparisonResult.recommendation && (
                  <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-sm text-green-800">
                    <p className="font-medium mb-1">Recommendation</p>
                    <p>{comparisonResult.recommendation}</p>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </Dialog>
      )}

      {/* Pipeline Automation Dialog */}
      {showAutomation && (
        <Dialog open={true} onClose={() => setShowAutomation(false)} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sliders className="h-5 w-5 text-primary" /> Pipeline Automation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {automationLoading ? (
              <div className="flex items-center gap-2 justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /> Loading rules...</div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Set up auto-advance and auto-reject rules based on OmniScore and match score thresholds. Candidates meeting criteria will be automatically moved in the pipeline.
                </p>
                <div className="space-y-3">
                  <div className="rounded-lg border p-4 space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-600" /> Auto-Advance</h4>
                    <p className="text-xs text-muted-foreground">Automatically advance candidates from Applied to Screening when their scores meet thresholds.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium">Min OmniScore</label>
                        <Input
                          type="number"
                          min={300}
                          max={850}
                          value={automationRules?.advance_omniscore_min || 600}
                          onChange={e => setAutomationRules((r: any) => ({ ...r, advance_omniscore_min: Number(e.target.value) }))}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium">Min Match Score</label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={automationRules?.advance_match_min || 70}
                          onChange={e => setAutomationRules((r: any) => ({ ...r, advance_match_min: Number(e.target.value) }))}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border p-4 space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-1.5"><AlertCircle className="h-4 w-4 text-red-500" /> Auto-Reject</h4>
                    <p className="text-xs text-muted-foreground">Automatically reject candidates who fall below minimum thresholds.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium">Max OmniScore (reject below)</label>
                        <Input
                          type="number"
                          min={300}
                          max={850}
                          value={automationRules?.reject_omniscore_max || 400}
                          onChange={e => setAutomationRules((r: any) => ({ ...r, reject_omniscore_max: Number(e.target.value) }))}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium">Max Match Score (reject below)</label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={automationRules?.reject_match_max || 30}
                          onChange={e => setAutomationRules((r: any) => ({ ...r, reject_match_max: Number(e.target.value) }))}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => saveAutomation(automationRules)} disabled={automationSaving} className="gap-1.5">
                    {automationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                    Save Rules
                  </Button>
                  <Button variant="outline" onClick={runAutoCheck} className="gap-1.5">
                    <Zap className="h-4 w-4" /> Run Now
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}

// Skills breakdown component (SmartRecruiters-style)
function SkillsBreakdown({ matchingSkills, missingSkills }: { matchingSkills: string[]; missingSkills: string[] }) {
  if (matchingSkills.length === 0 && missingSkills.length === 0) return null

  const total = matchingSkills.length + missingSkills.length
  const pct = total > 0 ? Math.round((matchingSkills.length / total) * 100) : 0

  return (
    <div>
      <h4 className="font-medium text-sm mb-2 flex items-center gap-1.5">
        <Target className="h-4 w-4 text-primary" />
        Skills Analysis
        <span className={`text-xs font-bold ${matchScoreColor(pct)}`}>({pct}% match)</span>
      </h4>
      {/* Progress bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {matchingSkills.length > 0 && (
          <div className="rounded-lg bg-green-50 border border-green-100 p-2.5">
            <p className="text-[10px] font-semibold text-green-700 mb-1.5 uppercase">Matching ({matchingSkills.length})</p>
            <div className="flex flex-wrap gap-1">
              {matchingSkills.slice(0, 8).map(s => (
                <span key={s} className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5">{s}</span>
              ))}
              {matchingSkills.length > 8 && (
                <span className="text-[10px] text-green-600">+{matchingSkills.length - 8} more</span>
              )}
            </div>
          </div>
        )}
        {missingSkills.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-2.5">
            <p className="text-[10px] font-semibold text-amber-700 mb-1.5 uppercase">Gaps ({missingSkills.length})</p>
            <div className="flex flex-wrap gap-1">
              {missingSkills.slice(0, 8).map(s => (
                <span key={s} className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{s}</span>
              ))}
              {missingSkills.length > 8 && (
                <span className="text-[10px] text-amber-600">+{missingSkills.length - 8} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
