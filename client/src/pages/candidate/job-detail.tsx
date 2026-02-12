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
  CheckCircle, AlertCircle, FileText, ListChecks, Sparkles, Loader2, Wand2, Zap,
} from 'lucide-react'

interface Job {
  id: number; title: string; company: string; poster_company?: string
  description: string; requirements: string; location: string
  salary_range: string; job_type: string
  screening_questions?: string | ScreeningQuestion[]
  created_at: string
}

interface ScreeningQuestion {
  id?: string; question: string; type?: 'text' | 'yes_no' | 'select'
  required?: boolean; options?: string[]; placeholder?: string; category?: string
}

interface AutoFillData {
  resume_url: string | null; cover_letter: string
  screening_answers: Record<string, { value: string; source: string }>
  profile: { name: string; email: string; phone: string; location: string }
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
  const [autoFill, setAutoFill] = useState<AutoFillData | null>(null)
  const [autoFillSources, setAutoFillSources] = useState<Record<string, string>>({})
  const [generatingCL, setGeneratingCL] = useState(false)
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false)

  useEffect(() => {
    loadJob()
    if (user) checkIfApplied()
  }, [id, user])

  async function loadJob() {
    try {
      const data = await apiCall<{ job: Job }>(`/jobs/${id}`)
      setJob(data.job)
    } catch {} finally { setLoading(false) }
  }

  async function checkIfApplied() {
    try {
      const data = await apiCall<{ success: boolean; applications: { job_id: number }[] }>('/candidate/applications')
      if (data.applications?.some(a => a.job_id === Number(id))) setApplied(true)
    } catch {}
  }

  // Auto-fill from stored profile data
  async function loadAutoFill() {
    if (!user || !id) return
    try {
      const data = await apiCall<{ success: boolean; auto_fill: AutoFillData }>(`/candidate/auto-fill/${id}`)
      if (data.auto_fill) {
        setAutoFill(data.auto_fill)
        // Pre-fill cover letter if available
        if (data.auto_fill.cover_letter && !coverLetter) {
          setCoverLetter(data.auto_fill.cover_letter)
        }
        // Pre-fill screening answers
        const newAnswers: Record<string, string> = { ...screeningAnswers }
        const sources: Record<string, string> = {}
        for (const [qId, info] of Object.entries(data.auto_fill.screening_answers || {})) {
          if (!newAnswers[qId] && info.value) {
            newAnswers[qId] = info.value
            sources[qId] = info.source
          }
        }
        setScreeningAnswers(newAnswers)
        setAutoFillSources(sources)
      }
    } catch {}
  }

  useEffect(() => {
    if (showApplyForm && user) loadAutoFill()
  }, [showApplyForm])

  const screeningQuestions: ScreeningQuestion[] = (() => {
    if (!job?.screening_questions) return []
    try {
      const raw = typeof job.screening_questions === 'string'
        ? JSON.parse(job.screening_questions) : job.screening_questions
      return Array.isArray(raw) ? raw : []
    } catch { return [] }
  })()

  function validateForm(): boolean {
    const newErrors: Record<string, string> = {}
    screeningQuestions.forEach((q, i) => {
      const key = q.id || `q${i}`
      if (q.required && !screeningAnswers[key]?.trim()) newErrors[key] = 'This question is required'
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
        body: { cover_letter: coverLetter, screening_answers: screeningAnswers },
      })
      setApplied(true)
      setShowApplyForm(false)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to apply')
    } finally { setApplying(false) }
  }

  // AI: Generate cover letter
  async function generateCoverLetter() {
    if (!job) return
    setGeneratingCL(true)
    try {
      const data = await apiCall<{ success: boolean; cover_letter: string }>('/candidate/ai/cover-letter', {
        method: 'POST', body: { job_id: job.id },
      })
      if (data.cover_letter) setCoverLetter(data.cover_letter)
    } catch (err: unknown) {
      alert('AI generation failed. Try again.')
    } finally { setGeneratingCL(false) }
  }

  // AI: Get screening answer suggestions
  async function getSuggestions() {
    if (!job || screeningQuestions.length === 0) return
    setGeneratingSuggestions(true)
    try {
      const data = await apiCall<{ success: boolean; suggestions: Array<{ question_id: string; suggested_answer: string; source: string; confidence: string }> }>(
        '/candidate/ai/screening-suggestions',
        { method: 'POST', body: { job_id: job.id, questions: screeningQuestions } }
      )
      if (data.suggestions?.length) {
        const newAnswers = { ...screeningAnswers }
        const sources = { ...autoFillSources }
        for (const s of data.suggestions) {
          const key = s.question_id || screeningQuestions.find(q => q.id === s.question_id)?.id
          if (key && !newAnswers[key]) {
            newAnswers[key] = s.suggested_answer
            sources[key] = `ai_${s.confidence}`
          }
        }
        setScreeningAnswers(newAnswers)
        setAutoFillSources(sources)
      }
    } catch {} finally { setGeneratingSuggestions(false) }
  }

  function updateAnswer(key: string, value: string) {
    setScreeningAnswers(prev => ({ ...prev, [key]: value }))
    // Clear source badge when user manually edits
    setAutoFillSources(prev => { const n = { ...prev }; delete n[key]; return n })
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  function sourceLabel(source: string) {
    if (source === 'previous_application') return 'From previous application'
    if (source === 'similar_question') return 'From similar question'
    if (source === 'profile') return 'From your profile'
    if (source.startsWith('ai_')) return '✨ AI suggestion'
    return null
  }

  function renderScreeningInput(q: ScreeningQuestion, index: number) {
    const key = q.id || `q${index}`
    const value = screeningAnswers[key] || ''
    const error = errors[key]
    const source = autoFillSources[key]
    const type = q.type || 'text'

    return (
      <div className="space-y-1">
        {source && (
          <Badge variant="outline" className="text-xs mb-1 gap-1">
            {source.startsWith('ai_') ? <Sparkles className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
            {sourceLabel(source)}
          </Badge>
        )}
        {type === 'yes_no' ? (
          <div className="flex gap-2 mt-1">
            <Button type="button" variant={value === 'Yes' ? 'default' : 'outline'} size="sm"
              onClick={() => updateAnswer(key, 'Yes')} className="flex-1">Yes</Button>
            <Button type="button" variant={value === 'No' ? 'default' : 'outline'} size="sm"
              onClick={() => updateAnswer(key, 'No')} className="flex-1">No</Button>
          </div>
        ) : type === 'select' && q.options?.length ? (
          <Select value={value} onChange={e => updateAnswer(key, e.target.value)} className="mt-1">
            <option value="">Select an option...</option>
            {q.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </Select>
        ) : (
          <Input value={value} onChange={e => updateAnswer(key, e.target.value)}
            className="mt-1" placeholder={q.placeholder || 'Your answer...'} />
        )}
        {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" />{error}</p>}
      </div>
    )
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'; if (days === 1) return '1 day ago'
    if (days < 30) return `${days} days ago`; return `${Math.floor(days / 30)} months ago`
  }

  if (loading) return <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
  if (!job) return <div className="py-16 text-center"><Briefcase className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="text-muted-foreground">Job not found</p><Button variant="ghost" className="mt-4" onClick={() => navigate('/candidate/jobs')}>Back to jobs</Button></div>

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
                <span className="flex items-center gap-1"><Building2 className="h-4 w-4" />{job.company || job.poster_company || 'Company'}</span>
                {job.location && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{job.location}</span>}
                {job.salary_range && <span className="flex items-center gap-1"><DollarSign className="h-4 w-4" />{job.salary_range}</span>}
                {job.job_type && <Badge variant="secondary">{job.job_type}</Badge>}
                <span className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />Posted {timeAgo(job.created_at)}</span>
              </div>
            </div>
            {applied ? (
              <Badge variant="success" className="gap-1 text-sm py-1.5 px-3 shrink-0"><CheckCircle className="h-3.5 w-3.5" /> Applied</Badge>
            ) : user ? (
              <Button onClick={() => setShowApplyForm(!showApplyForm)} className="gap-2 shrink-0"><Send className="h-4 w-4" /> Apply Now</Button>
            ) : (
              <Button onClick={() => navigate('/login')} className="gap-2 shrink-0">Sign in to Apply</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Apply form with AI features */}
      {showApplyForm && !applied && (
        <Card className="border-primary/30 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Apply for {job.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Auto-fill banner */}
            {autoFill && Object.keys(autoFillSources).length > 0 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 flex items-center gap-2">
                <Zap className="h-4 w-4 shrink-0" />
                Some fields were auto-filled from your profile and past applications. Review and update as needed.
              </div>
            )}

            {/* Cover letter */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Cover Letter <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Button variant="outline" size="sm" onClick={generateCoverLetter} disabled={generatingCL} className="gap-1 text-xs">
                  {generatingCL ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {generatingCL ? 'Generating...' : '✨ Generate with AI'}
                </Button>
              </div>
              <Textarea
                placeholder="Tell the employer why you're a great fit for this role..."
                value={coverLetter} onChange={e => setCoverLetter(e.target.value)}
                rows={6} className="mt-1"
              />
              {coverLetter && autoFill?.cover_letter && coverLetter === autoFill.cover_letter && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Zap className="h-3 w-3" /> From your last application — personalize it for this role
                </p>
              )}
            </div>

            {/* Screening questions */}
            {screeningQuestions.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-primary" />
                    <h4 className="font-medium text-sm">Pre-screening Questions</h4>
                  </div>
                  <Button variant="outline" size="sm" onClick={getSuggestions} disabled={generatingSuggestions} className="gap-1 text-xs">
                    {generatingSuggestions ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    {generatingSuggestions ? 'Suggesting...' : '✨ AI Suggest Answers'}
                  </Button>
                </div>
                {screeningQuestions.map((q, i) => (
                  <div key={q.id || i} className="rounded-lg border p-4 space-y-1">
                    <Label className="text-sm font-medium">
                      {q.question || ''}{q.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    {q.category && <p className="text-xs text-muted-foreground capitalize">{q.category.replace(/_/g, ' ')}</p>}
                    {renderScreeningInput(q, i)}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t">
              <Button onClick={handleApply} disabled={applying} className="gap-2">
                {applying ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Send className="h-4 w-4" />}
                Submit Application
              </Button>
              <Button variant="outline" onClick={() => setShowApplyForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Description */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5" /> Job Description</CardTitle></CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">{job.description || 'No description provided.'}</div>
        </CardContent>
      </Card>

      {/* Requirements */}
      {job.requirements && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Requirements</CardTitle></CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">{job.requirements}</div>
          </CardContent>
        </Card>
      )}

      {screeningQuestions.length > 0 && !showApplyForm && !applied && (
        <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground flex items-center gap-2">
          <ListChecks className="h-4 w-4 shrink-0" />
          This job has {screeningQuestions.length} pre-screening question{screeningQuestions.length > 1 ? 's' : ''} you'll need to answer when applying.
        </div>
      )}
    </div>
  )
}
