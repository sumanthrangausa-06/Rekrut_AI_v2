import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, Sparkles, CheckCircle, Loader2, Trophy, Users,
  BarChart3, Clock, Shield, GraduationCap, ChevronDown, Eye,
  ThumbsUp, ThumbsDown, AlertTriangle,
} from 'lucide-react'

interface Assessment {
  id: number
  job_id: number
  title: string
  description: string
  status: string
  difficulty_level: string
  question_count: number
  categories: string[]
  questions: Question[]
  stats: { total_attempts: number; completed: number; avg_score: number }
  published_at: string | null
  created_at: string
}

interface Question {
  id: number
  category: string
  question_type: string
  question_text: string
  options: string[] | null
  correct_answer: string | null
  rubric: string | null
  explanation: string | null
  difficulty_level: number
  points: number
  time_limit_seconds: number
  order_index: number
}

interface AttemptResult {
  id: number
  composite_score: number
  category_scores: Record<string, { score: number; earned: number; total: number }>
  ai_summary: { recommendation: string; summary: string; strengths: string[]; weaknesses: string[]; fit_notes: string; suggested_interview_focus: string[] } | null
  anti_cheat_score: number
  status: string
  completed_at: string
  scored_at: string
  time_spent_seconds: number
  candidate_name: string
  candidate_email: string
  candidate_id: number
}

const recColors: Record<string, string> = {
  strong_hire: 'bg-green-100 text-green-800 border-green-300',
  hire: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  maybe: 'bg-amber-100 text-amber-800 border-amber-300',
  no_hire: 'bg-red-100 text-red-800 border-red-300',
}

export function RecruiterJobAssessmentPage() {
  const { id: jobId } = useParams()
  const navigate = useNavigate()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [results, setResults] = useState<AttemptResult[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [tab, setTab] = useState<'questions' | 'results'>('questions')
  const [expandedQ, setExpandedQ] = useState<number | null>(null)

  useEffect(() => { loadAssessment() }, [jobId])

  async function loadAssessment() {
    try {
      const data = await apiCall<{ assessment: Assessment | null }>(`/assessments/job/${jobId}`)
      setAssessment(data.assessment)
      if (data.assessment) {
        loadResults(data.assessment.id)
      }
    } catch { /* */ }
    finally { setLoading(false) }
  }

  async function loadResults(assessmentId: number) {
    try {
      const data = await apiCall<{ attempts: AttemptResult[] }>(`/assessments/job-assessment/${assessmentId}/results`)
      setResults(data.attempts || [])
    } catch { /* */ }
  }

  async function generateAssessment() {
    setGenerating(true)
    setGenError(null)
    try {
      const data = await apiCall<{ assessment: Assessment }>('/assessments/generate', {
        method: 'POST',
        body: { jobId: Number(jobId) },
      })
      setAssessment(data.assessment)
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        loadAssessment()
      } else {
        setGenError(e.message || 'Failed to generate assessment. Please try again.')
      }
    } finally { setGenerating(false) }
  }

  async function publishAssessment() {
    if (!assessment) return
    setPublishing(true)
    try {
      await apiCall(`/assessments/job-assessment/${assessment.id}/publish`, { method: 'POST' })
      setAssessment(prev => prev ? { ...prev, status: 'published' } : prev)
    } catch { /* */ }
    finally { setPublishing(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // No assessment yet — show generate CTA
  if (!assessment) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 py-8">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/recruiter/jobs/${jobId}/applicants`)} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Pipeline
        </Button>
        <Card className="border-2 border-dashed border-violet-200 bg-gradient-to-br from-violet-50/50 to-indigo-50/50">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mx-auto">
              <Sparkles className="h-8 w-8 text-violet-600" />
            </div>
            <h2 className="text-2xl font-bold">AI Assessment Generator</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Generate a custom skill assessment tailored to this job's requirements. AI will create technical, scenario-based, behavioral, and code challenge questions.
            </p>
            <Button
              onClick={generateAssessment}
              disabled={generating}
              size="lg"
              className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {generating ? 'Generating Assessment...' : '✨ Generate Assessment'}
            </Button>
            {generating && (
              <p className="text-sm text-muted-foreground animate-pulse">
                AI is analyzing job requirements and creating questions... This takes 10-20 seconds.
              </p>
            )}
            {genError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-md mx-auto">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{genError}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const categories = typeof assessment.categories === 'string' ? JSON.parse(assessment.categories) : (assessment.categories || [])
  const completedResults = results.filter(r => r.scored_at)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/recruiter/jobs/${jobId}/applicants`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-violet-600" />
            {assessment.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {assessment.description} &middot; {assessment.question_count || assessment.questions?.length} questions
          </p>
        </div>
        <Badge variant={assessment.status === 'published' ? 'success' : 'secondary'} className="text-sm">
          {assessment.status}
        </Badge>
        {assessment.status === 'draft' && (
          <Button onClick={publishAssessment} disabled={publishing} className="gap-1.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Publish
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{assessment.questions?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Questions</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{assessment.stats?.total_attempts || 0}</p>
          <p className="text-xs text-muted-foreground">Attempts</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{assessment.stats?.completed || 0}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{assessment.stats?.avg_score || '—'}%</p>
          <p className="text-xs text-muted-foreground">Avg Score</p>
        </CardContent></Card>
      </div>

      {/* Category badges */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat: string) => (
          <Badge key={cat} variant="secondary" className="text-xs capitalize">{cat.replace('_', ' ')}</Badge>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'questions' ? 'border-violet-600 text-violet-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('questions')}
        >
          Questions ({assessment.questions?.length || 0})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'results' ? 'border-violet-600 text-violet-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('results')}
        >
          Results ({completedResults.length})
        </button>
      </div>

      {/* Questions Tab */}
      {tab === 'questions' && (
        <div className="space-y-3">
          {(assessment.questions || []).map((q, i) => (
            <div key={q.id} className="rounded-lg border p-3 space-y-1.5 hover:bg-muted/30 transition-colors">
              <div className="flex items-start gap-2 cursor-pointer" onClick={() => setExpandedQ(expandedQ === i ? null : i)}>
                <span className="text-xs font-bold bg-muted rounded-full w-6 h-6 flex items-center justify-center shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-[10px] capitalize">{q.category}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{q.question_type.replace('_', ' ')}</Badge>
                    <span className="text-[10px] text-muted-foreground">D:{q.difficulty_level}/5</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{q.points} pts</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedQ === i ? 'rotate-180' : ''}`} />
                  </div>
                  <p className="text-sm">{q.question_text}</p>
                </div>
              </div>
              {expandedQ === i && (
                <div className="ml-8 space-y-2 pt-2 border-t">
                  {q.options && (
                    <div className="grid grid-cols-2 gap-1">
                      {(typeof q.options === 'string' ? JSON.parse(q.options) : q.options).map((opt: string, oi: number) => (
                        <span key={oi} className={`text-xs rounded px-2 py-1 border ${opt === q.correct_answer ? 'bg-green-50 border-green-200 text-green-700 font-medium' : 'bg-muted/50'}`}>
                          {opt}
                        </span>
                      ))}
                    </div>
                  )}
                  {q.rubric && <p className="text-xs text-muted-foreground"><strong>Rubric:</strong> {q.rubric}</p>}
                  {q.explanation && <p className="text-xs text-muted-foreground"><strong>Explanation:</strong> {q.explanation}</p>}
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span><Clock className="h-3 w-3 inline" /> {q.time_limit_seconds}s</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Results Tab */}
      {tab === 'results' && (
        <div className="space-y-3">
          {completedResults.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No completed attempts yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Results will appear here when candidates complete the assessment.</p>
              </CardContent>
            </Card>
          ) : completedResults.map(r => {
            const categoryScores = typeof r.category_scores === 'string' ? JSON.parse(r.category_scores) : (r.category_scores || {})
            const summary = typeof r.ai_summary === 'string' ? JSON.parse(r.ai_summary) : r.ai_summary
            const rec = summary?.recommendation || 'unknown'

            return (
              <Card key={r.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{r.candidate_name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">{r.candidate_email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className={`text-2xl font-bold ${(r.composite_score || 0) >= 70 ? 'text-green-600' : (r.composite_score || 0) >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                          {Math.round(r.composite_score || 0)}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">Composite Score</p>
                      </div>
                      {summary && (
                        <Badge className={`border ${recColors[rec] || 'bg-gray-100'}`}>
                          {rec.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Category breakdown */}
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(categoryScores).map(([cat, data]: [string, any]) => (
                      <div key={cat} className="rounded-lg bg-muted/50 p-2 text-center">
                        <p className="text-sm font-bold">{Math.round(data.score)}%</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{cat.replace('_', ' ')}</p>
                      </div>
                    ))}
                  </div>

                  {/* AI Summary */}
                  {summary && (
                    <div className="rounded-lg border bg-violet-50/50 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-violet-700">
                        <Sparkles className="h-4 w-4" /> AI Assessment Summary
                      </div>
                      <p className="text-sm">{summary.summary}</p>
                      {summary.strengths?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-green-700 mb-1">Strengths:</p>
                          <div className="flex flex-wrap gap-1">
                            {summary.strengths.map((s: string, si: number) => (
                              <span key={si} className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {summary.weaknesses?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-amber-700 mb-1">Areas of Concern:</p>
                          <div className="flex flex-wrap gap-1">
                            {summary.weaknesses.map((w: string, wi: number) => (
                              <span key={wi} className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{w}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {summary.fit_notes && <p className="text-xs text-muted-foreground">{summary.fit_notes}</p>}
                    </div>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span><Clock className="h-3 w-3 inline" /> {Math.round((r.time_spent_seconds || 0) / 60)} min</span>
                    <span><Shield className="h-3 w-3 inline" /> Integrity: {r.anti_cheat_score}%</span>
                    <span className="ml-auto">{r.scored_at ? new Date(r.scored_at).toLocaleDateString() : ''}</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
