import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import {
  Plus, Briefcase, MapPin, Users, Edit, Trash2, Search, Eye, EyeOff,
  BarChart3, Clock, TrendingUp, ArrowRight, ChevronRight, MoreHorizontal,
  Filter, Sparkles, CheckCircle2, XCircle, PauseCircle, PlayCircle,
  LayoutGrid, List, Kanban, Zap, MessageSquare, Video, FileText,
  GripVertical, MoveRight, ArrowUpRight, ArrowDownRight, Minus, X,
  ChevronLeft, ExternalLink, GraduationCap, DollarSign, Calendar,
} from 'lucide-react'

interface Job {
  id: number
  title: string
  company: string
  location: string
  salary_range: string
  job_type: string
  status: string
  created_at: string
  views?: number
  application_count?: number
  interviews?: number
  screening_questions?: string
  department?: string
  hired_count?: number
  offer_count?: number
  time_to_fill?: number
  source_quality?: number
}

const statusColors: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string; icon: React.ReactNode }> = {
  active: { variant: 'default', label: 'Active', icon: <CheckCircle2 className="h-3 w-3" /> },
  paused: { variant: 'secondary', label: 'Paused', icon: <PauseCircle className="h-3 w-3" /> },
  closed: { variant: 'outline', label: 'Closed', icon: <XCircle className="h-3 w-3" /> },
  draft: { variant: 'secondary', label: 'Draft', icon: <FileText className="h-3 w-3" /> },
}

const pipelineStages = [
  { id: 'applied', label: 'Applied', color: 'bg-blue-500' },
  { id: 'screening', label: 'Screening', color: 'bg-amber-500' },
  { id: 'interview', label: 'Interview', color: 'bg-purple-500' },
  { id: 'offer', label: 'Offer', color: 'bg-green-500' },
  { id: 'hired', label: 'Hired', color: 'bg-emerald-500' },
]

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  return `${Math.floor(days / 30)}mo ago`
}

export function RecruiterJobsPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [showJobDetail, setShowJobDetail] = useState(false)

  const [showMobilePanel, setShowMobilePanel] = useState(false)

  useEffect(() => {
    loadJobs()
  }, [])

  async function loadJobs() {
    try {
      const data = await apiCall<{ jobs: Job[] }>('/recruiter/jobs')
      setJobs(data.jobs || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function toggleJobStatus(job: Job) {
    const newStatus = job.status === 'active' ? 'paused' : 'active'
    try {
      await apiCall(`/recruiter/jobs/${job.id}`, {
        method: 'PUT',
        body: { status: newStatus },
      })
      loadJobs()
    } catch {
      // silent
    }
  }

  async function deleteJob(id: number) {
    if (!confirm('Are you sure you want to delete this job posting?')) return
    setDeleting(id)
    try {
      await apiCall(`/jobs/${id}`, { method: 'DELETE' })
      loadJobs()
    } catch {
      // silent
    } finally {
      setDeleting(null)
    }
  }

  function openJobDetail(job: Job) {
    setSelectedJob(job)
    setShowJobDetail(true)
    setShowMobilePanel(true)
  }

  function closeJobDetail() {
    setShowJobDetail(false)
    setShowMobilePanel(false)
    setSelectedJob(null)
  }

  const filtered = jobs.filter(j => {
    const matchSearch = !search ||
      j.title?.toLowerCase().includes(search.toLowerCase()) ||
      j.location?.toLowerCase().includes(search.toLowerCase()) ||
      j.department?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || j.status === statusFilter
    return matchSearch && matchStatus
  })

  const activeJobs = jobs.filter(j => j.status === 'active')
  const totalApps = jobs.reduce((sum, j) => sum + (j.application_count || 0), 0)
  const totalHired = jobs.reduce((sum, j) => sum + (j.hired_count || 0), 0)
  const avgTimeToFill = jobs.length > 0
    ? Math.round(jobs.reduce((sum, j) => sum + (j.time_to_fill || 0), 0) / jobs.filter(j => j.time_to_fill).length)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Job Postings</h1>
          <p className="text-muted-foreground text-sm">Manage your active and past job listings</p>
        </div>
        <Link to="/recruiter/jobs/new">
          <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="h-4 w-4" /> Post New Job
          </Button>
        </Link>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-emerald-600">{activeJobs.length}</p>
                <p className="text-xs text-muted-foreground">Active Jobs</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{totalApps}</p>
                <p className="text-xs text-muted-foreground">Total Applications</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-purple-600">{totalHired}</p>
                <p className="text-xs text-muted-foreground">Hired</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                <Zap className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{avgTimeToFill || '—'}</p>
                <p className="text-xs text-muted-foreground">Avg Days to Fill</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters + View Toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs by title, location, or department..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
            <option value="draft">Draft</option>
          </select>
          <div className="flex rounded-md border overflow-hidden">
            <button
              className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-background text-muted-foreground'}`}
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              className={`px-3 py-2 text-sm ${viewMode === 'grid' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-background text-muted-foreground'}`}
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">No job postings yet</p>
            <Link to="/recruiter/jobs/new">
              <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4" /> Create Your First Job</Button>
            </Link>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 opacity-30" />
            <p className="text-muted-foreground">No jobs match your filters</p>
          </CardContent>
        </Card>
      ) : viewMode === 'list' ? (
        <div className="space-y-3">
          {filtered.map(job => {
            const status = statusColors[job.status] || statusColors.draft
            const totalPipeline = (job.application_count || 0) + (job.interviews || 0) + (job.offer_count || 0) + (job.hired_count || 0)
            return (
              <Card key={job.id} className="transition-shadow hover:shadow-md overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    {/* Left: Job info — clickable to open detail panel on mobile/tablet */}
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => openJobDetail(job)}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">{job.title}</h3>
                        <Badge variant={status.variant} className="gap-1">
                          {status.icon}
                          {status.label}
                        </Badge>
                        {job.status === 'active' && (
                          <Badge variant="outline" className="text-[10px] gap-1 bg-green-50 text-green-700 border-green-200">
                            <ArrowUpRight className="h-3 w-3" />
                            Live
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        {job.department && <span className="flex items-center gap-1 min-w-0"><Briefcase className="h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">{job.department}</span></span>}
                        {job.location && (
                          <span className="flex items-center gap-1 min-w-0">
                            <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">{job.location}</span>
                          </span>
                        )}
                        {job.job_type && <Badge variant="outline" className="text-[10px]">{job.job_type}</Badge>}
                        {job.salary_range && <Badge variant="outline" className="text-[10px]">{job.salary_range}</Badge>}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {timeAgo(job.created_at)}
                        </span>
                      </div>

                      {/* Pipeline mini bar */}
                      {totalPipeline > 0 && (
                        <div className="mt-3 flex items-center gap-2">
                          <div className="flex-1 flex items-center gap-1">
                            {pipelineStages.map(stage => {
                              const count = stage.id === 'applied' ? (job.application_count || 0) :
                                stage.id === 'screening' ? 0 :
                                stage.id === 'interview' ? (job.interviews || 0) :
                                stage.id === 'offer' ? (job.offer_count || 0) :
                                stage.id === 'hired' ? (job.hired_count || 0) : 0
                              if (count === 0) return null
                              return (
                                <div
                                  key={stage.id}
                                  className={`h-2 rounded-full ${stage.color}`}
                                  style={{ width: `${Math.max((count / totalPipeline) * 100, 4)}%` }}
                                  title={`${stage.label}: ${count}`}
                                />
                              )
                            })}
                          </div>
                          <span className="text-xs text-muted-foreground">{totalPipeline} in pipeline</span>
                        </div>
                      )}
                    </div>

                    {/* Right: Stats + Actions */}
                    <div className="flex flex-col gap-3 sm:items-end">
                      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                        <div className="text-center">
                          <p className="text-xl font-bold">{job.application_count || 0}</p>
                          <p className="text-[10px] text-muted-foreground">Applicants</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold">{job.views || 0}</p>
                          <p className="text-[10px] text-muted-foreground">Views</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold text-emerald-600">{job.hired_count || 0}</p>
                          <p className="text-[10px] text-muted-foreground">Hired</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/recruiter/jobs/${job.id}/applicants`)}
                          className="gap-1 min-h-[44px] min-w-[44px]"
                          title="View applicants"
                        >
                          <Users className="h-3.5 w-3.5" />
                          <span className="text-xs hidden sm:inline">Applicants</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/recruiter/jobs/${job.id}/edit`)}
                          className="gap-1 min-h-[44px] min-w-[44px]"
                          title="Edit job"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          <span className="text-xs hidden sm:inline">Edit</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleJobStatus(job)}
                          className="gap-1 min-h-[44px] min-w-[44px]"
                          title={job.status === 'active' ? 'Pause job' : 'Activate job'}
                        >
                          {job.status === 'active' ? (
                            <PauseCircle className="h-3.5 w-3.5" />
                          ) : (
                            <PlayCircle className="h-3.5 w-3.5" />
                          )}
                          <span className="text-xs hidden sm:inline">{job.status === 'active' ? 'Pause' : 'Activate'}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteJob(job.id)}
                          disabled={deleting === job.id}
                          className="text-destructive hover:text-destructive min-h-[44px] min-w-[44px]"
                          title="Delete job"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        /* Grid View */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(job => {
            const status = statusColors[job.status] || statusColors.draft
            return (
              <Card
                key={job.id}
                className="transition-shadow hover:shadow-md cursor-pointer"
                onClick={() => openJobDetail(job)}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <Badge variant={status.variant} className="gap-1">
                      {status.icon}
                      {status.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{timeAgo(job.created_at)}</span>
                  </div>
                  <h3 className="font-semibold text-base break-words min-w-0">{job.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {job.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {job.location}</span>}
                    {job.job_type && <span>{job.job_type}</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                    <div className="text-center">
                      <p className="font-bold">{job.application_count || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Apps</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{job.views || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Views</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-emerald-600">{job.hired_count || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Hired</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* === MOBILE JOB DETAIL DRAWER (Sheet) === */}
      <Sheet open={showMobilePanel} onOpenChange={setShowMobilePanel}>
        <SheetContent className="w-full overflow-x-hidden">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Job Details
            </SheetTitle>
            <SheetClose />
          </SheetHeader>
          {selectedJob && (
            <JobDetailPanel
              job={selectedJob}
              onClose={closeJobDetail}
              onViewApplicants={() => navigate(`/recruiter/jobs/${selectedJob.id}/applicants`)}
              onEdit={() => navigate(`/recruiter/jobs/${selectedJob.id}/edit`)}
              onToggleStatus={() => toggleJobStatus(selectedJob)}
              onDelete={() => deleteJob(selectedJob.id)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// === JOB DETAIL PANEL (Responsive for mobile & desktop) ===
function JobDetailPanel({
  job,
  onClose,
  onViewApplicants,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  job: Job
  onClose: () => void
  onViewApplicants: () => void
  onEdit: () => void
  onToggleStatus: () => void
  onDelete: () => void
}) {
  const status = statusColors[job.status] || statusColors.draft
  const totalPipeline =
    (job.application_count || 0) +
    (job.interviews || 0) +
    (job.offer_count || 0) +
    (job.hired_count || 0)

  return (
    <div className="space-y-5 max-w-full pb-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:flex-wrap">
          <h2 className="font-bold text-lg leading-tight min-w-0 break-words">{job.title}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={status.variant} className="gap-1 shrink-0">
              {status.icon}
              {status.label}
            </Badge>
            {job.status === 'active' && (
              <Badge variant="outline" className="text-xs gap-1 bg-green-50 text-green-700 border-green-200 shrink-0 max-w-full">
                <ArrowUpRight className="h-3 w-3" />
                Live
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {job.department && (
            <span className="flex items-center gap-1 max-w-full">
              <Briefcase className="h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{job.department}</span>
            </span>
          )}
          {job.location && (
            <span className="flex items-center gap-1 max-w-full">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{job.location}</span>
            </span>
          )}
          {job.job_type && <Badge variant="outline" className="text-xs max-w-full whitespace-normal">{job.job_type}</Badge>}
          {job.salary_range && <Badge variant="outline" className="text-xs max-w-full whitespace-normal">{job.salary_range}</Badge>}
          <span className="flex items-center gap-1 max-w-full">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="break-words">{timeAgo(job.created_at)}</span>
          </span>
        </div>
      </div>

      {/* Pipeline Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0 overflow-hidden">
          <p className="text-xl sm:text-2xl font-bold">{job.application_count || 0}</p>
          <p className="text-xs text-muted-foreground">Applicants</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0 overflow-hidden">
          <p className="text-xl sm:text-2xl font-bold">{job.views || 0}</p>
          <p className="text-xs text-muted-foreground">Views</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0 overflow-hidden">
          <p className="text-xl sm:text-2xl font-bold text-emerald-600">{job.hired_count || 0}</p>
          <p className="text-xs text-muted-foreground">Hired</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0 overflow-hidden">
          <p className="text-xl sm:text-2xl font-bold">{job.interviews || 0}</p>
          <p className="text-xs text-muted-foreground">Interviews</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0 overflow-hidden">
          <p className="text-xl sm:text-2xl font-bold text-amber-600">{job.offer_count || 0}</p>
          <p className="text-xs text-muted-foreground">Offers</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0 overflow-hidden">
          <p className="text-xl sm:text-2xl font-bold">{job.time_to_fill || '—'}</p>
          <p className="text-xs text-muted-foreground">Days to Fill</p>
        </div>
      </div>

      {/* Pipeline Progress Bar */}
      {totalPipeline > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Pipeline Progress</h4>
            <span className="text-xs text-muted-foreground">{totalPipeline} total</span>
          </div>
          <div className="flex items-center gap-1 overflow-hidden min-w-0">
            {pipelineStages.map(stage => {
              const count =
                stage.id === 'applied'
                  ? job.application_count || 0
                  : stage.id === 'screening'
                    ? 0
                    : stage.id === 'interview'
                      ? job.interviews || 0
                      : stage.id === 'offer'
                        ? job.offer_count || 0
                        : stage.id === 'hired'
                          ? job.hired_count || 0
                          : 0
              if (count === 0) return null
              return (
                <div
                  key={stage.id}
                  className={`h-3 rounded-full ${stage.color}`}
                  style={{ flexGrow: Math.max(count, 1), minWidth: '4%' }}
                  title={`${stage.label}: ${count}`}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            {pipelineStages.map(stage => {
              const count =
                stage.id === 'applied'
                  ? job.application_count || 0
                  : stage.id === 'screening'
                    ? 0
                    : stage.id === 'interview'
                      ? job.interviews || 0
                      : stage.id === 'offer'
                        ? job.offer_count || 0
                        : stage.id === 'hired'
                          ? job.hired_count || 0
                          : 0
              if (count === 0) return null
              return (
                <div key={stage.id} className="flex items-center gap-1 max-w-full">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${stage.color}`} />
                  <span className="text-xs text-muted-foreground break-words">
                    {stage.label}: {count}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Mobile-optimized action buttons */}
      <div className="space-y-2">
        <Button
          className="w-full gap-2 min-h-[48px] text-base"
          onClick={onViewApplicants}
        >
          <Users className="h-5 w-5" />
          View Applicants
        </Button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="gap-2 min-h-[48px]"
            onClick={onEdit}
          >
            <Edit className="h-4 w-4" />
            Edit Job
          </Button>
          <Button
            variant="outline"
            className="gap-2 min-h-[48px]"
            onClick={onToggleStatus}
          >
            {job.status === 'active' ? (
              <>
                <PauseCircle className="h-4 w-4" />
                Pause
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4" />
                Activate
              </>
            )}
          </Button>
        </div>

        <Button
          variant="ghost"
          className="w-full gap-2 text-destructive hover:text-destructive hover:bg-red-50 min-h-[48px]"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
          Delete Job
        </Button>
      </div>
    </div>
  )
}
