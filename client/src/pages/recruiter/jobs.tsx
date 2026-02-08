import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Plus, Briefcase, MapPin, Users, Edit, Trash2, Search, Eye, EyeOff,
  BarChart3, Clock,
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
}

const statusColors: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  active: 'success',
  paused: 'warning',
  closed: 'secondary',
  draft: 'secondary',
}

export function RecruiterJobsPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

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

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return '1 day ago'
    if (days < 30) return `${days} days ago`
    return `${Math.floor(days / 30)}mo ago`
  }

  const filtered = jobs.filter(j => {
    const matchSearch = !search ||
      j.title?.toLowerCase().includes(search.toLowerCase()) ||
      j.location?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || j.status === statusFilter
    return matchSearch && matchStatus
  })

  const activeJobs = jobs.filter(j => j.status === 'active')
  const totalApps = jobs.reduce((sum, j) => sum + (j.application_count || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Job Postings</h1>
          <p className="text-muted-foreground text-sm">Manage your job listings</p>
        </div>
        <Link to="/recruiter/jobs/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Post New Job
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{activeJobs.length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{jobs.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{totalApps}</p>
            <p className="text-xs text-muted-foreground">Applications</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      {jobs.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search jobs by title or location..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="sm:w-36"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
            <option value="draft">Draft</option>
          </Select>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground mb-4">No job postings yet</p>
            <Link to="/recruiter/jobs/new">
              <Button className="gap-2"><Plus className="h-4 w-4" /> Create Your First Job</Button>
            </Link>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 opacity-30" />
            <p className="text-muted-foreground">No jobs match your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(job => (
            <Card key={job.id} className="transition-shadow hover:shadow-sm">
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold truncate">{job.title}</h3>
                      <Badge variant={statusColors[job.status] || 'secondary'}>
                        {job.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      {job.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {job.location}
                        </span>
                      )}
                      {job.job_type && <span>{job.job_type}</span>}
                      {job.salary_range && <span>{job.salary_range}</span>}
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> {job.application_count || 0} applicants
                      </span>
                      <span className="flex items-center gap-1 text-xs">
                        <Clock className="h-3 w-3" /> {timeAgo(job.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/recruiter/jobs/${job.id}/applicants`)}
                      className="gap-1"
                      title="View applicants"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="text-xs">{job.application_count || 0}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/recruiter/jobs/${job.id}/edit`)}
                      title="Edit job"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleJobStatus(job)}
                      title={job.status === 'active' ? 'Pause job' : 'Activate job'}
                    >
                      {job.status === 'active' ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteJob(job.id)}
                      disabled={deleting === job.id}
                      className="text-destructive hover:text-destructive"
                      title="Delete job"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
