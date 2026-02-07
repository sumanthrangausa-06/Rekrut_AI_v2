import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft, MapPin, DollarSign, Building2, Clock, Briefcase, Send, CheckCircle,
} from 'lucide-react'

interface Job {
  id: number
  title: string
  company: string
  poster_company?: string
  poster_name?: string
  description: string
  requirements: string
  location: string
  salary_range: string
  job_type: string
  screening_questions?: string
  created_at: string
}

interface ScreeningQuestion {
  question: string
  required?: boolean
}

export function CandidateJobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [showApplyForm, setShowApplyForm] = useState(false)
  const [coverLetter, setCoverLetter] = useState('')
  const [screeningAnswers, setScreeningAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    loadJob()
    checkIfApplied()
  }, [id])

  async function loadJob() {
    try {
      const data = await apiCall<{ job: Job }>(`/jobs/${id}`)
      setJob(data.job)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function checkIfApplied() {
    try {
      const data = await apiCall<{ success: boolean; applications: { job_id: number }[] }>('/candidate/applications')
      if (data.applications?.some(a => a.job_id === Number(id))) {
        setApplied(true)
      }
    } catch {
      // silent - not critical
    }
  }

  const screeningQuestions: ScreeningQuestion[] = job?.screening_questions
    ? (typeof job.screening_questions === 'string'
      ? JSON.parse(job.screening_questions)
      : job.screening_questions)
    : []

  async function handleApply() {
    if (!job) return
    setApplying(true)
    try {
      await apiCall(`/candidate/jobs/${job.id}/apply`, {
        method: 'POST',
        body: {
          cover_letter: coverLetter,
          screening_answers: screeningAnswers,
        },
      })
      setApplied(true)
      setShowApplyForm(false)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to apply')
    } finally {
      setApplying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Job not found</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/candidate/jobs')}>
          Back to jobs
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/candidate/jobs')} className="gap-1">
        <ArrowLeft className="h-4 w-4" /> Back to jobs
      </Button>

      {/* Job header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-heading text-2xl font-bold mb-2">{job.title}</h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Building2 className="h-4 w-4" />
                  {job.company || job.poster_company || 'Company'}
                </span>
                {job.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {job.location}
                  </span>
                )}
                {job.salary_range && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    {job.salary_range}
                  </span>
                )}
                {job.job_type && (
                  <Badge variant="secondary">{job.job_type}</Badge>
                )}
              </div>
            </div>
            {applied ? (
              <Badge variant="success" className="gap-1 text-sm py-1.5 px-3">
                <CheckCircle className="h-3.5 w-3.5" /> Applied
              </Badge>
            ) : (
              <Button onClick={() => setShowApplyForm(!showApplyForm)} className="gap-2 shrink-0">
                <Send className="h-4 w-4" /> Apply Now
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Apply form */}
      {showApplyForm && !applied && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>Apply for {job.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Cover Letter (optional)</Label>
              <Textarea
                placeholder="Tell the employer why you're a great fit..."
                value={coverLetter}
                onChange={e => setCoverLetter(e.target.value)}
                rows={4}
                className="mt-1"
              />
            </div>

            {screeningQuestions.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Pre-screening Questions</h4>
                {screeningQuestions.map((q, i) => (
                  <div key={i}>
                    <Label className="text-sm">
                      {q.question || (typeof q === 'string' ? q : '')}
                      {q.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    <Input
                      value={screeningAnswers[`q${i}`] || ''}
                      onChange={e => setScreeningAnswers(prev => ({ ...prev, [`q${i}`]: e.target.value }))}
                      className="mt-1"
                      placeholder="Your answer..."
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleApply} disabled={applying} className="gap-2">
                {applying ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit Application
              </Button>
              <Button variant="outline" onClick={() => setShowApplyForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" /> Job Description
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
            {job.description || 'No description provided.'}
          </div>
        </CardContent>
      </Card>

      {/* Requirements */}
      {job.requirements && (
        <Card>
          <CardHeader>
            <CardTitle>Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
              {job.requirements}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        <Clock className="inline h-3 w-3 mr-1" />
        Posted {new Date(job.created_at).toLocaleDateString()}
      </p>
    </div>
  )
}
