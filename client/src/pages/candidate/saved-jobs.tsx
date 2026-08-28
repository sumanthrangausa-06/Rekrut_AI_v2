import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SEO } from '@/components/SEO'
import {
  Bookmark,
  BookmarkX,
  Briefcase,
  MapPin,
  DollarSign,
  Clock,
  Building2,
  ExternalLink,
  Loader2,
  Search,
  Trash2,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiCall } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { cn } from '@/lib/utils'

interface SavedJob {
  job_id: number
  saved_at: string
  title: string
  company: string
  location: string
  salary_range: string
  job_type: string
  description: string
  status: string
  created_at: string
  company_logo?: string
  remote_type?: string
  experience_level?: string
  applicants_count?: number
  has_applied?: boolean
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  return `${Math.floor(days / 30)} months ago`
}

export function SavedJobsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<number | null>(null)

  useEffect(() => {
    loadSavedJobs()
  }, [])

  async function loadSavedJobs() {
    setLoading(true)
    try {
      const data = await apiCall<{ saved_jobs: SavedJob[] }>('/candidate/saved-jobs')
      setJobs(data.saved_jobs || [])
    } catch (err) {
      console.error('[saved-jobs] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  async function removeJob(jobId: number, e: React.MouseEvent) {
    e.stopPropagation()
    setRemovingId(jobId)
    try {
      await apiCall(`/candidate/saved-jobs/${jobId}`, { method: 'DELETE' })
      setJobs((prev) => prev.filter((j) => j.job_id !== jobId))
    } catch (err) {
      console.error('[saved-jobs] Failed to remove:', err)
    } finally {
      setRemovingId(null)
    }
  }

  const appliedJobs = jobs.filter((j) => j.has_applied)
  const notAppliedJobs = jobs.filter((j) => !j.has_applied)

  return (
    <div className="min-h-[calc(100dvh-4rem)] space-y-6 px-4 sm:px-6 py-6">
      <SEO
        title="Saved Jobs — Your Bookmarked Opportunities"
        description="View and manage your saved job opportunities on Rekrut AI."
        canonical="/candidate/saved-jobs"
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
            <Bookmark className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Saved Jobs</h1>
            <p className="text-sm text-muted-foreground">
              {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} bookmarked
            </p>
          </div>
        </div>
        <Button
          onClick={() => navigate('/candidate/jobs')}
          className="gap-2 min-h-[44px]"
        >
          <Search className="h-4 w-4" />
          Browse More Jobs
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptySavedJobs onBrowse={() => navigate('/candidate/jobs')} />
      ) : (
        <div className="space-y-8">
          {/* Not applied yet */}
          {notAppliedJobs.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                <Bookmark className="h-4 w-4" />
                Not Applied ({notAppliedJobs.length})
              </h2>
              <div className="space-y-3">
                {notAppliedJobs.map((job) => (
                  <SavedJobCard
                    key={job.job_id}
                    job={job}
                    onRemove={removeJob}
                    removing={removingId === job.job_id}
                    onClick={() => navigate(`/candidate/jobs/${job.job_id}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Already applied */}
          {appliedJobs.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                <Briefcase className="h-4 w-4" />
                Applied ({appliedJobs.length})
              </h2>
              <div className="space-y-3">
                {appliedJobs.map((job) => (
                  <SavedJobCard
                    key={job.job_id}
                    job={job}
                    onRemove={removeJob}
                    removing={removingId === job.job_id}
                    onClick={() => navigate(`/candidate/jobs/${job.job_id}`)}
                    applied
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function SavedJobCard({
  job,
  onRemove,
  removing,
  onClick,
  applied = false,
}: {
  job: SavedJob
  onRemove: (id: number, e: React.MouseEvent) => void
  removing: boolean
  onClick: () => void
  applied?: boolean
}) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md hover:border-primary/20',
        applied && 'opacity-75'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          {/* Company logo placeholder */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
            {job.company_logo ? (
              <img
                src={job.company_logo}
                alt={job.company}
                className="h-8 w-8 object-contain"
              />
            ) : (
              <Building2 className="h-6 w-6 text-muted-foreground" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-base truncate">{job.title}</h3>
                <p className="text-sm text-muted-foreground">{job.company}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {applied && (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                    Applied
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                  onClick={(e) => onRemove(job.job_id, e)}
                  disabled={removing}
                >
                  {removing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BookmarkX className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              {job.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {job.location}
                </span>
              )}
              {job.salary_range && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {job.salary_range}
                </span>
              )}
              {job.job_type && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {job.job_type}
                </Badge>
              )}
              {job.remote_type && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {job.remote_type}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Saved {timeAgo(job.saved_at)}
              </span>
            </div>

            {/* Description preview */}
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
              {job.description?.slice(0, 160)}...
            </p>

            {/* Footer */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                {job.experience_level && (
                  <span className="text-xs text-muted-foreground">
                    {job.experience_level}
                  </span>
                )}
                {job.applicants_count !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {job.applicants_count} applicants
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-primary h-8"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick()
                }}
              >
                View Job
                <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptySavedJobs({ onBrowse }: { onBrowse: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="p-4 rounded-full bg-indigo-50 dark:bg-indigo-900/20 mb-4">
          <Bookmark className="h-10 w-10 text-indigo-400" />
        </div>
        <h3 className="text-lg font-semibold">No saved jobs yet</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Save jobs you're interested in while browsing. They'll appear here so you can apply later.
        </p>
        <Button onClick={onBrowse} className="mt-6 gap-2 min-h-[44px]">
          <Sparkles className="h-4 w-4" />
          Find Jobs
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

export default SavedJobsPage
