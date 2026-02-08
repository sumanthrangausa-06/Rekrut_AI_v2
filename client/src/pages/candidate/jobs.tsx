import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import {
  Briefcase, MapPin, DollarSign, Clock, Search, Building2, ArrowRight,
} from 'lucide-react'

interface Job {
  id: number
  title: string
  company: string
  poster_company?: string
  description: string
  requirements: string
  location: string
  salary_range: string
  job_type: string
  status: string
  created_at: string
  screening_questions?: string
}

export function CandidateJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')

  useEffect(() => {
    loadJobs()
  }, [])

  async function loadJobs() {
    try {
      const data = await apiCall<{ jobs: Job[] }>('/jobs?status=active&limit=100')
      setJobs(data.jobs || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  const filtered = jobs.filter(j => {
    const matchSearch = !search ||
      j.title?.toLowerCase().includes(search.toLowerCase()) ||
      j.company?.toLowerCase().includes(search.toLowerCase()) ||
      j.description?.toLowerCase().includes(search.toLowerCase())
    const matchType = !typeFilter || j.job_type === typeFilter
    const matchLocation = !locationFilter || j.location?.toLowerCase().includes(locationFilter.toLowerCase())
    return matchSearch && matchType && matchLocation
  })

  const jobTypes = [...new Set(jobs.map(j => j.job_type).filter(Boolean))]

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return '1 day ago'
    if (days < 30) return `${days} days ago`
    return `${Math.floor(days / 30)} months ago`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">Job Board</h1>
        <p className="text-muted-foreground">Find your next opportunity</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search jobs by title, company, or keywords..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="sm:w-40">
              <option value="">All Types</option>
              {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Input
              placeholder="Location..."
              value={locationFilter}
              onChange={e => setLocationFilter(e.target.value)}
              className="sm:w-40"
            />
          </div>
        </CardContent>
      </Card>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">{filtered.length} jobs found</p>

      {/* Job list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-muted-foreground">No jobs found matching your criteria</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(job => (
            <Link key={job.id} to={`/candidate/jobs/${job.id}`}>
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-base truncate">{job.title}</h3>
                        {(() => {
                          try {
                            return job.screening_questions && JSON.parse(job.screening_questions).length > 0
                          } catch { return false }
                        })() && (
                          <Badge variant="outline" className="text-[10px] shrink-0">Screening</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-2">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          {job.company || job.poster_company || 'Company'}
                        </span>
                        {job.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {job.location}
                          </span>
                        )}
                        {job.salary_range && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3.5 w-3.5" />
                            {job.salary_range}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {job.description?.substring(0, 200)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col items-end gap-1">
                        {job.job_type && <Badge variant="secondary">{job.job_type}</Badge>}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {timeAgo(job.created_at)}
                        </span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
