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
  Sparkles, Target, Zap, Star,
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
  // Match fields (from recommended endpoint)
  weighted_score?: number
  match_level?: string
  skill_match_pct?: number
  matching_skills?: string[]
  missing_skills?: string[]
  success_prediction?: string
  similarity_score?: number
}

function matchColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-amber-600'
  return 'text-red-500'
}

function matchBg(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-700 border-green-200'
  if (score >= 60) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-600 border-red-200'
}

function matchLevelLabel(level: string): string {
  if (level === 'excellent') return 'Excellent Match'
  if (level === 'good') return 'Good Match'
  if (level === 'fair') return 'Fair Match'
  return ''
}

export function CandidateJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [recommendedJobs, setRecommendedJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [showRecommended, setShowRecommended] = useState(true)

  useEffect(() => {
    loadJobs()
  }, [])

  async function loadJobs() {
    try {
      // Load both: all jobs + recommended (with match scores)
      const [allData, recData] = await Promise.allSettled([
        apiCall<{ jobs: Job[] }>('/jobs?status=active&limit=100'),
        apiCall<{ recommended_jobs: Job[] }>('/candidate/jobs/recommended'),
      ])

      const allJobs = allData.status === 'fulfilled' ? allData.value.jobs || [] : []
      const recJobs = recData.status === 'fulfilled' ? recData.value.recommended_jobs || [] : []

      // Merge match scores into all jobs
      const recMap = new Map<number, Job>()
      for (const rj of recJobs) {
        recMap.set(rj.job_id ?? rj.id, rj)
      }

      const enriched = allJobs.map(j => {
        const rec = recMap.get(j.id)
        if (rec) {
          return {
            ...j,
            weighted_score: rec.weighted_score,
            match_level: rec.match_level,
            skill_match_pct: rec.skill_match_pct,
            matching_skills: rec.matching_skills,
            missing_skills: rec.missing_skills,
            success_prediction: rec.success_prediction,
            similarity_score: rec.similarity_score,
          }
        }
        return j
      })

      setJobs(enriched)
      setRecommendedJobs(recJobs.slice(0, 5))
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

      {/* Recommended jobs section */}
      {showRecommended && recommendedJobs.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Recommended for You</h2>
            <Badge variant="secondary" className="text-[10px]">{recommendedJobs.length} matches</Badge>
            <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => setShowRecommended(false)}>
              Hide
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recommendedJobs.map(rj => {
              const jobId = (rj as any).job_id ?? rj.id
              const score = Math.round(rj.weighted_score || 0)
              return (
                <Link key={jobId} to={`/candidate/jobs/${jobId}`}>
                  <Card className="h-full transition-shadow hover:shadow-md cursor-pointer border-primary/20">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm truncate">{rj.title}</h3>
                          <p className="text-xs text-muted-foreground">{rj.company}</p>
                        </div>
                        <div className={`text-center rounded-lg border px-2 py-0.5 shrink-0 ${matchBg(score)}`}>
                          <div className="text-sm font-bold">{score}%</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground mb-2">
                        {rj.location && <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" />{rj.location}</span>}
                        {rj.job_type && <Badge variant="secondary" className="text-[9px] h-4">{rj.job_type}</Badge>}
                      </div>
                      {rj.match_level && (
                        <div className="flex items-center gap-1">
                          {rj.match_level === 'excellent' && <Zap className="h-3 w-3 text-green-500" />}
                          <span className={`text-[10px] font-medium ${matchColor(score)}`}>
                            {matchLevelLabel(rj.match_level)}
                          </span>
                          {rj.skill_match_pct != null && (
                            <span className="text-[10px] text-muted-foreground">
                              · {rj.skill_match_pct}% skills
                            </span>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}

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
          {filtered.map(job => {
            const score = job.weighted_score ? Math.round(job.weighted_score) : null
            return (
              <Link key={job.id} to={`/candidate/jobs/${job.id}`}>
                <Card className="transition-shadow hover:shadow-md cursor-pointer">
                  <CardContent className="p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-base truncate">{job.title}</h3>
                          {job.match_level === 'excellent' && (
                            <Badge variant="outline" className="text-[10px] gap-0.5 text-green-600 border-green-200 bg-green-50 shrink-0">
                              <Zap className="h-2.5 w-2.5" /> Top Match
                            </Badge>
                          )}
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
                              <MapPin className="h-3.5 w-3.5" /> {job.location}
                            </span>
                          )}
                          {job.salary_range && (
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3.5 w-3.5" /> {job.salary_range}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {job.description?.substring(0, 200)}
                        </p>
                        {/* Skills match inline */}
                        {job.matching_skills && job.matching_skills.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-2">
                            <Target className="h-3 w-3 text-green-500 shrink-0" />
                            {job.matching_skills.slice(0, 4).map(s => (
                              <span key={s} className="text-[10px] bg-green-50 text-green-700 rounded px-1.5 py-0.5 border border-green-100">{s}</span>
                            ))}
                            {job.matching_skills.length > 4 && (
                              <span className="text-[10px] text-green-600">+{job.matching_skills.length - 4} more</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex flex-col items-end gap-1">
                          {score != null && (
                            <div className={`text-center rounded-lg border px-2.5 py-1 ${matchBg(score)}`}>
                              <div className="text-lg font-bold leading-tight">{score}%</div>
                              <div className="text-[9px] uppercase font-medium">Match</div>
                            </div>
                          )}
                          {job.job_type && <Badge variant="secondary" className="text-[10px]">{job.job_type}</Badge>}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" /> {timeAgo(job.created_at)}
                          </span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
