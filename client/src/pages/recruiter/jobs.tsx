import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Plus, Briefcase, MapPin, Users, Eye, Edit, Trash2, MoreHorizontal,
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

export function RecruiterJobsPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<number | null>(null)

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

  const activeJobs = jobs.filter(j => j.status === 'active')
  const otherJobs = jobs.filter(j => j.status !== 'active')

  const statusColors: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
    active: 'success',
    paused: 'warning',
    closed: 'secondary',
    draft: 'secondary',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Job Postings</h1>
          <p className="text-muted-foreground">Manage your job listings</p>
        </div>
        <Link to="/recruiter/jobs/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Post New Job
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
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
            <p className="text-2xl font-bold text-blue-600">
              {jobs.reduce((sum, j) => sum + (j.application_count || 0), 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total Applications</p>
          </CardContent>
        </Card>
      </div>

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
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <Card key={job.id}>
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
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/recruiter/jobs/${job.id}/applicants`)}
                      className="gap-1"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {job.application_count || 0}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/recruiter/jobs/${job.id}/edit`)}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleJobStatus(job)}
                      className="text-xs"
                    >
                      {job.status === 'active' ? 'Pause' : 'Activate'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteJob(job.id)}
                      disabled={deleting === job.id}
                      className="text-destructive hover:text-destructive"
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
