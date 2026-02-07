import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Clock, AlertTriangle, CheckCircle, ArrowRight, Trophy, XCircle,
} from 'lucide-react'

interface Question {
  id: number
  text: string
  type: string
  options?: string[]
  timeLimit: number
  questionNumber: number
  totalQuestions: number
}

interface AnswerResult {
  completed: boolean
  feedback: string
  explanation: string
  aiFeedback?: string
  score?: number
  nextQuestion?: Question
}

export function AssessmentTakePage() {
  const { id: sessionId } = useParams()
  const navigate = useNavigate()
  const [question, setQuestion] = useState<Question | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [shortAnswer, setShortAnswer] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [finalScore, setFinalScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [skillName, setSkillName] = useState('')
  const startTimeRef = useRef(Date.now())

  // Load the session - the session was started from the assessments page
  // The first question is returned in the start response, but since we navigate here,
  // we need to handle the case where we need to fetch the current state
  useEffect(() => {
    // The session was just started and question was passed via the start API
    // Since we navigate here after starting, we'll need to check session
    checkSession()
  }, [sessionId])

  async function checkSession() {
    try {
      // Try to get session info - if no question loaded, session might be from URL
      // The start API already returned the first question before navigation
      // We'll store it in sessionStorage for the transition
      const stored = sessionStorage.getItem(`assessment_${sessionId}`)
      if (stored) {
        const data = JSON.parse(stored)
        setQuestion(data.question)
        setSkillName(data.skillName || '')
        sessionStorage.removeItem(`assessment_${sessionId}`)
        setTimeLeft(data.question.timeLimit || 120)
        startTimeRef.current = Date.now()
      } else {
        // Fallback: start a fresh check
        // If session is already complete, redirect to results
        try {
          const result = await apiCall<{ result: { score: number } }>(`/assessments/session/${sessionId}`)
          if (result.result) {
            setCompleted(true)
            setFinalScore(result.result.score || 0)
          }
        } catch {
          // Session might not have results yet, that's ok
          navigate('/candidate/assessments')
        }
      }
    } catch {
      navigate('/candidate/assessments')
    } finally {
      setLoading(false)
    }
  }

  // Timer countdown
  useEffect(() => {
    if (!question || completed || timeLeft <= 0) return
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          // Auto-submit on time up
          handleSubmit(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [question, completed])

  // Track tab switches
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden && sessionId) {
        apiCall('/assessments/event', {
          method: 'POST',
          body: { sessionId: Number(sessionId), eventType: 'tab_switch', eventData: { timestamp: new Date() } },
        }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [sessionId])

  const handleSubmit = useCallback(async (timedOut = false) => {
    if (!question || submitting) return
    setSubmitting(true)
    const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000)
    const answer = question.type === 'multiple_choice' ? selectedAnswer : shortAnswer

    if (!answer && !timedOut) {
      setSubmitting(false)
      return
    }

    try {
      const result = await apiCall<AnswerResult>('/assessments/answer', {
        method: 'POST',
        body: {
          sessionId: Number(sessionId),
          questionId: question.id,
          answer: answer || '(no answer)',
          timeTaken,
        },
      })

      if (result.completed) {
        setCompleted(true)
        setFinalScore(result.score || 0)
      } else if (result.nextQuestion) {
        setQuestion(result.nextQuestion)
        setSelectedAnswer('')
        setShortAnswer('')
        setTimeLeft(result.nextQuestion.timeLimit || 120)
        startTimeRef.current = Date.now()
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to submit answer')
    } finally {
      setSubmitting(false)
    }
  }, [question, selectedAnswer, shortAnswer, sessionId, submitting])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  // Completed view
  if (completed) {
    const passed = finalScore >= 60
    return (
      <div className="max-w-lg mx-auto py-8">
        <Card>
          <CardContent className="p-8 text-center">
            {passed ? (
              <Trophy className="mx-auto h-16 w-16 text-emerald-500 mb-4" />
            ) : (
              <XCircle className="mx-auto h-16 w-16 text-destructive mb-4" />
            )}
            <h2 className="font-heading text-2xl font-bold mb-2">
              {passed ? 'Assessment Passed!' : 'Assessment Complete'}
            </h2>
            <p className="text-muted-foreground mb-6">
              {skillName && `${skillName} - `}
              {passed
                ? 'Great job! Your skill has been verified.'
                : 'Keep practicing and try again.'}
            </p>
            <div className="text-5xl font-bold mb-6">
              <span className={passed ? 'text-emerald-600' : 'text-destructive'}>
                {finalScore}
              </span>
              <span className="text-muted-foreground text-lg">/100</span>
            </div>
            <Badge variant={passed ? 'success' : 'destructive'} className="text-sm mb-6">
              {passed ? 'PASSED' : 'NOT PASSED'} (60 required)
            </Badge>
            <div className="flex gap-2 justify-center">
              <Button onClick={() => navigate('/candidate/assessments')}>
                Back to Assessments
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Assessment session not found</p>
        <Button className="mt-4" onClick={() => navigate('/candidate/assessments')}>
          Back to Assessments
        </Button>
      </div>
    )
  }

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const isLowTime = timeLeft < 30

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">
            Question {question.questionNumber} of {question.totalQuestions}
          </span>
          {skillName && (
            <span className="text-sm text-muted-foreground ml-2">- {skillName}</span>
          )}
        </div>
        <Badge variant={isLowTime ? 'destructive' : 'secondary'} className="gap-1 font-mono">
          <Clock className="h-3 w-3" />
          {minutes}:{seconds.toString().padStart(2, '0')}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 rounded-full"
          style={{ width: `${(question.questionNumber / question.totalQuestions) * 100}%` }}
        />
      </div>

      {/* Question */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base leading-relaxed">{question.text}</CardTitle>
        </CardHeader>
        <CardContent>
          {question.type === 'multiple_choice' && question.options ? (
            <div className="space-y-2">
              {question.options.map((option, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedAnswer(option)}
                  className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                    selectedAnswer === option
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-muted'
                  }`}
                >
                  <span className="font-medium text-muted-foreground mr-2">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <Textarea
              value={shortAnswer}
              onChange={e => setShortAnswer(e.target.value)}
              placeholder="Type your answer here..."
              rows={6}
              className="font-mono text-sm"
            />
          )}
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          onClick={() => handleSubmit(false)}
          disabled={submitting || (!selectedAnswer && !shortAnswer)}
          className="gap-2"
        >
          {submitting ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : question.questionNumber === question.totalQuestions ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {question.questionNumber === question.totalQuestions ? 'Finish' : 'Next'}
        </Button>
      </div>

      {isLowTime && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Time is running out! Answer will be auto-submitted when time expires.
        </div>
      )}
    </div>
  )
}
