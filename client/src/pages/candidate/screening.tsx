import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Clock, CheckCircle, AlertCircle, Briefcase, Building2,
  ChevronRight, Send, Loader2, Shield, Brain, Star
} from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''

interface ScreeningQuestion {
  id: number
  text: string
  type: string
  follow_up?: string
  time_limit_minutes?: number
}

interface ScreeningData {
  session_id: number
  job_title: string
  company_name: string
  questions: ScreeningQuestion[]
  time_limit_minutes: number
  status: string
  started_at?: string
  expires_at?: string
  responses?: { question_id: number; answer: string }[]
}

function formatTimeRemaining(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours}h ${mins}m remaining`
  return `${mins}m remaining`
}

export function CandidateScreeningPage() {
  const { token } = useParams<{ token: string }>()
  const [screening, setScreening] = useState<ScreeningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    loadScreening()
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [token])

  useEffect(() => {
    if (screening?.expires_at && screening.status === 'in_progress') {
      timerRef.current = setInterval(() => {
        setTimeRemaining(formatTimeRemaining(screening.expires_at!))
        if (new Date(screening.expires_at!).getTime() <= Date.now()) {
          if (timerRef.current) clearInterval(timerRef.current)
          setError('This screening session has expired.')
        }
      }, 1000)
    }
  }, [screening?.expires_at, screening?.status])

  async function loadScreening() {
    try {
      const res = await fetch(`${API_URL}/api/interviews/screening/session/${token}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load screening')
      setScreening(data)
      if (data.status === 'completed') setCompleted(true)
      // Restore any existing answers
      if (data.responses?.length) {
        const restored: Record<number, string> = {}
        data.responses.forEach((r: any) => { restored[r.question_id] = r.answer })
        setAnswers(restored)
        setCurrentQuestion(Math.min(data.responses.length, (data.questions?.length || 1) - 1))
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load screening session')
    } finally {
      setLoading(false)
    }
  }

  async function startScreening() {
    if (!screening) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/interviews/screening/session/${token}/start`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start')
      setScreening({ ...screening, status: 'in_progress', started_at: new Date().toISOString(), expires_at: data.expires_at })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function submitAnswer(questionId: number) {
    const answer = answers[questionId]
    if (!answer?.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/interviews/screening/session/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, answer: answer.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit')
      // Move to next question
      if (currentQuestion < (screening?.questions?.length || 0) - 1) {
        setCurrentQuestion(prev => prev + 1)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function completeScreening() {
    setCompleting(true)
    try {
      const res = await fetch(`${API_URL}/api/interviews/screening/session/${token}/complete`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to complete')
      setCompleted(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCompleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <p className="text-slate-600">Loading screening interview...</p>
        </div>
      </div>
    )
  }

  if (error && !screening) {
    return (
      <div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-red-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-semibold text-slate-900">Unable to Load Screening</h2>
            <p className="text-slate-600">{error}</p>
            <p className="text-sm text-slate-500">
              This link may have expired or is invalid. Please contact the recruiter for a new invite.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!screening) return null

  // Completed state
  if (completed) {
    return (
      <div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-green-50 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Screening Complete!</h2>
              <p className="text-slate-600">
                Thank you for completing the screening for <strong>{screening.job_title}</strong> at{' '}
                <strong>{screening.company_name}</strong>.
              </p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 text-left space-y-2">
              <div className="flex items-center gap-2 text-blue-700 font-medium">
                <Brain className="w-4 h-4" />
                What happens next?
              </div>
              <ul className="text-sm text-blue-600 space-y-1 ml-6 list-disc">
                <li>Our AI is analyzing your responses right now</li>
                <li>The recruiter will review your screening results</li>
                <li>You'll hear back within 3-5 business days</li>
                <li>Your OmniScore will be updated based on your performance</li>
              </ul>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Shield className="w-4 h-4" />
              Powered by HireLoop AI
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Invited - not started yet
  if (screening.status === 'invited') {
    return (
      <div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                <Brain className="w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">AI Screening Interview</h2>
              <p className="text-slate-600">
                You've been invited to complete a screening for:
              </p>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Briefcase className="w-5 h-5 text-slate-500" />
                <div>
                  <p className="font-medium text-slate-900">{screening.job_title}</p>
                  <p className="text-sm text-slate-500">{screening.company_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-slate-500" />
                <p className="text-sm text-slate-600">
                  {screening.questions?.length || 0} questions &middot; ~{screening.time_limit_minutes} min time limit
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
              <p className="font-medium text-amber-800 text-sm">Before you start:</p>
              <ul className="text-sm text-amber-700 space-y-1 ml-4 list-disc">
                <li>Find a quiet place with good internet</li>
                <li>The timer starts once you begin</li>
                <li>Answer each question thoughtfully — quality matters</li>
                <li>You can't pause once started</li>
              </ul>
            </div>

            <Button onClick={startScreening} className="w-full" size="lg">
              Start Screening Interview
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>

            <p className="text-xs text-center text-slate-400">
              By starting, you agree to our screening process. Your responses will be evaluated by AI.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // In Progress - answering questions
  const questions = screening.questions || []
  const question = questions[currentQuestion]
  const answeredCount = Object.keys(answers).filter(k => answers[Number(k)]?.trim()).length
  const allAnswered = answeredCount >= questions.length
  const isLastQuestion = currentQuestion === questions.length - 1

  return (
    <div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Top bar */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-blue-600" />
            <div>
              <p className="font-medium text-sm text-slate-900">{screening.job_title}</p>
              <p className="text-xs text-slate-500">{screening.company_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {screening.expires_at && (
              <Badge variant={timeRemaining.includes('Expired') ? 'destructive' : 'secondary'}>
                <Clock className="w-3 h-3 mr-1" />
                {timeRemaining || formatTimeRemaining(screening.expires_at)}
              </Badge>
            )}
            <Badge variant="default">
              {answeredCount}/{questions.length} answered
            </Badge>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b">
        <div className="max-w-3xl mx-auto">
          <div className="h-1 bg-slate-100">
            <div
              className="h-full bg-blue-600 transition-all duration-500"
              style={{ width: `${((currentQuestion + (answers[question?.id] ? 1 : 0)) / questions.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Question navigation pills */}
        <div className="flex gap-2 flex-wrap">
          {questions.map((q: ScreeningQuestion, i: number) => (
            <button
              key={q.id}
              onClick={() => setCurrentQuestion(i)}
              className={`w-8 h-8 rounded-full text-xs font-medium transition-all ${
                i === currentQuestion
                  ? 'bg-blue-600 text-white shadow-md'
                  : answers[q.id]?.trim()
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-white text-slate-500 border border-slate-200 hover:border-blue-300'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {/* Current question */}
        {question && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <Badge variant="secondary" className="text-xs">
                  Question {currentQuestion + 1} of {questions.length}
                </Badge>
                {question.type && (
                  <Badge variant="default" className="text-xs capitalize">
                    {question.type}
                  </Badge>
                )}
              </div>

              <h3 className="text-lg font-medium text-slate-900 leading-relaxed">
                {question.text}
              </h3>

              {question.follow_up && (
                <p className="text-sm text-slate-500 italic">
                  Follow-up: {question.follow_up}
                </p>
              )}

              <Textarea
                value={answers[question.id] || ''}
                onChange={(e) => setAnswers(prev => ({ ...prev, [question.id]: e.target.value }))}
                placeholder="Type your answer here... Be thorough and specific."
                className="min-h-[180px] text-base leading-relaxed"
                disabled={submitting}
              />

              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  {(answers[question.id] || '').length} characters
                </p>
                <div className="flex gap-2">
                  {currentQuestion > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setCurrentQuestion(prev => prev - 1)}
                    >
                      Previous
                    </Button>
                  )}
                  <Button
                    onClick={() => submitAnswer(question.id)}
                    disabled={submitting || !answers[question.id]?.trim()}
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    {isLastQuestion ? 'Submit Answer' : 'Save & Next'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Complete button */}
        {allAnswered && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-6 text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-green-700">
                <Star className="w-5 h-5" />
                <p className="font-medium">All questions answered!</p>
              </div>
              <p className="text-sm text-green-600">
                Review your answers above, then submit your screening when ready.
              </p>
              <Button
                onClick={completeScreening}
                disabled={completing}
                className="bg-green-600 hover:bg-green-700"
                size="lg"
              >
                {completing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Submitting & Generating AI Report...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Submit Screening
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tips */}
        <div className="bg-white/60 rounded-lg p-4 space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tips for a great screening</p>
          <ul className="text-xs text-slate-500 space-y-1">
            <li>&bull; Use specific examples from your experience</li>
            <li>&bull; Structure your answers clearly (situation, action, result)</li>
            <li>&bull; Be concise but thorough — aim for 3-5 sentences per answer</li>
            <li>&bull; Show your thought process, not just the final answer</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
