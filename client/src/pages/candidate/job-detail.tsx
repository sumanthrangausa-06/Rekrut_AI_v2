import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  ArrowLeft, MapPin, DollarSign, Building2, Clock, Briefcase, Send,
  CheckCircle, AlertCircle, FileText, ListChecks,
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
  screening_questions?: string | ScreeningQuestion[]
  created_at: string
}

interface ScreeningQuestion {
  id?: string
  question: string
  type?: 'text' | 'yes_no' | 'select'
  required?: boolean
  options?: string[]
  placeholder?: string
  category?: string
}

export function CandidateJobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [showApplyForm, setShowApplyForm] = useState(false)
  const [coverLetter, setCoverLetter] = useState('')
  const [screeningAnswers, setScreeningAnswers] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    loadJob()
    if (user) checkIfApplied()
  }, [id, user])

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
      // not critical
    }
  }

  const screeningQuestions: ScreeningQuestion[] = (() => {
    if (!job?.screening_questions) return []
    try {
      const raw = typeof job.screening_questions === 'string'
        ? JSON.parse(job.screening_questions)
        : job.screening_questions
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })()

  function validateForm(): boolean {
    const newErrors: Record<string, string> = {}
    screeningQuestions.forEach((q, i) => {
      const key = q.id || `q${i}`
      if (q.required && !screeningAnswers[key]?.trim()) {
        newErrors[key] = 'This question is required'
      }
    })
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleApply() {
    if (!job) return
    if (!validateForm()) return

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

  function updateAnswer(key: string, value: string) {
    setScreeningAnswers(prev => ({ ...prev, [key]: value }))
    if (errors[key]) {
      setErrors(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  function renderScreeningInput(q: ScreeningQuestion, index: number) {
    const key = q.id || `q${index}`
    const value = screeningAnswers[key] || ''
    const error = errors[key]
    const type = q.type || 'text'

    if (type === 'yes_no') {
      return (
        <div className="space-y-1">
          <div className="flex gap-2 mt-1">
            <Button
              type="button"
              variant={value === 'Yes' ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateAnswer(key, 'Yes')}
              className="flex-1"
            >
              Yes
            </Button>
            <Button
              type="button"
              variant={value === 'No' ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateAnswer(key, 'No')}
              className="flex-1"
            >
              No
            </Button>
          </div>
          {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" />{error}</p>}
        </div>
      )
    }

    if (type === 'select' && q.options?.length) {
      return (
        <div className="space-y-1">
          <Select
            value={value}
            onChange={e => updateAnswer(key, e.target.value)}
            className="mt-1"
          >
            <option value="">Select an option...</option>
            {q.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
          {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" />{error}</p>}
        </div>
      )
    }

    // Default: text input
    return (
      <div className="space-y-1">
        <Input
          value={value}
          onChange={e => updateAnswer(key, e.target.value)}
          className="mt-1"
          placeholder={q.placeholder || 'Your answer...'}
        />
        {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" />{error}</p>}
      </div>
    )
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return '1 day ago'
    if (days < 30) return `${days} days ago`
    return `${Math.floor(days / 30)} months ago`
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
        <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" />
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
                <span className="flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  Posted {timeAgo(job.created_at)}
                </span>
              </div>
            </div>
            {applied ? (
              <Badge variant="success" className="gap-1 text-sm py-1.5 px-3 shrink-0">
                <CheckCircle className="h-3.5 w-3.5" /> Applied
              </Badge>
            ) : user ? (
              <Button onClick={() => setShowApplyForm(!showApplyForm)} className="gap-2 shrink-0">
                <Send className="h-4 w-4" /> Apply Now
              </Button>
            ) : (
              <Button onClick={() => navigate('/login')} className="gap-2 shrink-0">
                Sign in to Apply
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Apply form */}
      {showApplyForm && !applied && (
        <Card className="border-primary/30 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Apply for {job.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label>Cover Letter <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                placeholder="Tell the employer why you're a great fit for this role..."
                value={coverLetter}
                onChange={e => setCoverLetter(e.target.value)}
                rows={4}
                className="mt-1"
              />
            </div>

            {screeningQuestions.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" />
                  <h4 className="font-medium text-sm">Pre-screening Questions</h4>
                </div>
                {screeningQuestions.map((q, i) => (
                  <div key={q.id || i} className="rounded-lg border p-4 space-y-1">
                    <Label className="text-sm font-medium">
                      {q.question || (typeof q === 'string' ? String(q) : '')}
                      {q.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    {q.category && (
                      <p className="text-xs text-muted-foreground capitalize">{q.category.replace(/_/g, ' ')}</p>
                    )}
                    {renderScreeningInput(q, i)}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t">
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
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Requirements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
              {job.requirements}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Screening info */}
      {screeningQuestions.length > 0 && !showApplyForm && !applied && (
        <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground flex items-center gap-2">
          <ListChecks className="h-4 w-4 shrink-0" />
          This job has {screeningQuestions.length} pre-screening question{screeningQuestions.length > 1 ? 's' : ''} you'll need to answer when applying.
        </div>
      )}
    </div>
  )
}
