import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Clock, AlertTriangle, CheckCircle, ArrowRight, Trophy,
  MessageSquare, Send, Loader2, Sparkles, BarChart3, Shield,
} from 'lucide-react'

interface Question {
  id: number
  category: string
  type: string
  text: string
  options?: string[]
  timeLimit: number
  points: number
  difficulty: number
}

interface Progress {
  current: number
  total: number
}

interface ConversationMessage {
  role: 'candidate' | 'ai'
  text: string
}

export function JobAssessmentTakePage() {
  const { id: assessmentId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [attemptId, setAttemptId] = useState<number | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [progress, setProgress] = useState<Progress>({ current: 1, total: 15 })
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [textAnswer, setTextAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [completed, setCompleted] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [scoring, setScoring] = useState(false)

  // Conversational mode
  const [conversationMode, setConversationMode] = useState(false)
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const [convoInput, setConvoInput] = useState('')
  const [convoLoading, setConvoLoading] = useState(false)
  const [convoQuestionId, setConvoQuestionId] = useState<number | null>(null)

  const startTimeRef = useRef(Date.now())

  useEffect(() => {
    startAssessment()
  }, [assessmentId])

  // Timer
  useEffect(() => {
    if (timeLeft <= 0 || completed) return
    const t = setInterval(() => setTimeLeft(p => Math.max(0, p - 1)), 1000)
    return () => clearInterval(t)
  }, [timeLeft, completed])

  // Anti-cheat: detect tab switches
  useEffect(() => {
    if (!attemptId) return
    const handler = () => {
      if (document.hidden) {
        apiCall(`/assessments/job-assessment/${assessmentId}/event`, {
          method: 'POST',
          body: { attemptId, eventType: 'tab_switch' },
        }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [attemptId, assessmentId])

  async function startAssessment() {
    try {
      const applicationId = searchParams.get('applicationId')
      const data = await apiCall<{
        attemptId: number
        resumed: boolean
        progress: Progress
        question: Question | null
      }>(`/assessments/job-assessment/${assessmentId}/start`, {
        method: 'POST',
        body: { applicationId: applicationId ? Number(applicationId) : undefined },
      })

      setAttemptId(data.attemptId)
      setProgress(data.progress)
      if (data.question) {
        setQuestion(data.question)
        setTimeLeft(data.question.timeLimit || 120)
        startTimeRef.current = Date.now()
      }
    } catch (e: any) {
      console.error('Failed to start assessment:', e)
    } finally {
      setLoading(false)
    }
  }

  async function submitAnswer() {
    if (!attemptId || !question) return
    setSubmitting(true)
    setFeedback(null)

    const answer = question.type === 'multiple_choice' ? selectedAnswer : textAnswer
    const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000)

    try {
      const data = await apiCall<{
        completed: boolean
        feedback?: string
        quickScore?: number
        progress: Progress
        nextQuestion?: Question
      }>(`/assessments/job-assessment/${assessmentId}/answer`, {
        method: 'POST',
        body: { attemptId, questionId: question.id, answer, timeTaken },
      })

      if (data.feedback) setFeedback(data.feedback)

      if (data.completed) {
        setCompleted(true)
        setScoring(true)
        setTimeout(() => setScoring(false), 5000)
        return
      }

      // Show feedback briefly then move to next
      setTimeout(() => {
        setFeedback(null)
        setSelectedAnswer('')
        setTextAnswer('')
        setConversationMode(false)
        setConversation([])
        setConvoQuestionId(null)

        if (data.nextQuestion) {
          setQuestion(data.nextQuestion)
          setProgress(data.progress)
          setTimeLeft(data.nextQuestion.timeLimit || 120)
          startTimeRef.current = Date.now()
        }
      }, data.feedback ? 1500 : 0)
    } catch (e: any) {
      console.error('Submit failed:', e)
    } finally {
      setSubmitting(false)
    }
  }

  async function sendConvoMessage() {
    if (!convoInput.trim() || !attemptId || !convoQuestionId) return
    setConvoLoading(true)
    const msg = convoInput.trim()
    setConvoInput('')
    setConversation(prev => [...prev, { role: 'candidate', text: msg }])

    try {
      const data = await apiCall<{ reply: string; done: boolean; followUpCount: number }>(
        `/assessments/job-assessment/${assessmentId}/converse`,
        {
          method: 'POST',
          body: { attemptId, questionId: convoQuestionId, message: msg },
        }
      )
      setConversation(prev => [...prev, { role: 'ai', text: data.reply }])
      if (data.done) {
        setTimeout(() => setConversationMode(false), 2000)
      }
    } catch {
      setConversation(prev => [...prev, { role: 'ai', text: 'Sorry, I had trouble processing that. Please continue to the next question.' }])
    } finally {
      setConvoLoading(false)
    }
  }

  function startConversation() {
    if (!question) return
    setConversationMode(true)
    setConvoQuestionId(question.id)
    setConversation([{
      role: 'ai',
      text: `Let's discuss your answer in more depth. I'd like to understand your approach better. Can you elaborate on your response?`
    }])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading assessment...</p>
        </div>
      </div>
    )
  }

  if (completed) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 py-8">
        <Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <Trophy className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Assessment Complete!</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              {scoring
                ? 'Your answers are being scored by AI. Results will be available shortly.'
                : 'Your assessment has been submitted and scored. The recruiter will review your results.'}
            </p>
            {scoring && (
              <div className="flex items-center justify-center gap-2 text-violet-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm font-medium">AI is scoring your answers...</span>
              </div>
            )}
            <div className="pt-4">
              <Button onClick={() => navigate('/candidate/applications')} className="gap-2">
                <ArrowRight className="h-4 w-4" /> Back to Applications
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold">No Questions Available</h2>
        <p className="text-muted-foreground">This assessment doesn't have any questions yet.</p>
        <Button variant="outline" onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    )
  }

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const isLowTime = timeLeft < 30
  const isTextType = question.type !== 'multiple_choice'

  return (
    <div className="max-w-3xl mx-auto space-y-5 py-4">
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Question {progress.current} of {progress.total}</span>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="capitalize">{question.category.replace('_', ' ')}</Badge>
            <span className="text-xs text-muted-foreground">
              {question.points} pts &middot; Difficulty {question.difficulty}/5
            </span>
            <span className={`flex items-center gap-1 font-mono text-sm ${isLowTime ? 'text-red-600 font-bold' : 'text-muted-foreground'}`}>
              <Clock className={`h-3.5 w-3.5 ${isLowTime ? 'animate-pulse' : ''}`} />
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <Card className="border-2">
        <CardContent className="pt-6 space-y-5">
          {/* Feedback banner */}
          {feedback && (
            <div className={`rounded-lg p-3 text-sm ${feedback.startsWith('Correct') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              {feedback}
            </div>
          )}

          <p className="text-lg font-medium leading-relaxed">{question.text}</p>

          {/* Multiple choice */}
          {question.type === 'multiple_choice' && question.options && (
            <div className="space-y-2">
              {question.options.map((opt, i) => (
                <button
                  key={i}
                  className={`w-full text-left rounded-lg border-2 p-3.5 transition-all ${
                    selectedAnswer === opt
                      ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-200'
                      : 'border-border hover:border-violet-300 hover:bg-violet-50/50'
                  }`}
                  onClick={() => setSelectedAnswer(opt)}
                  disabled={submitting}
                >
                  <span className="text-sm">{opt}</span>
                </button>
              ))}
            </div>
          )}

          {/* Free text / scenario / code challenge */}
          {isTextType && !conversationMode && (
            <Textarea
              placeholder={
                question.type === 'code_challenge'
                  ? 'Write your solution here...'
                  : question.type === 'scenario_response'
                  ? 'Describe how you would handle this scenario...'
                  : 'Type your answer here...'
              }
              value={textAnswer}
              onChange={e => setTextAnswer(e.target.value)}
              rows={question.type === 'code_challenge' ? 10 : 6}
              className={question.type === 'code_challenge' ? 'font-mono text-sm' : ''}
              disabled={submitting}
            />
          )}

          {/* Conversational mode */}
          {conversationMode && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-violet-700">
                <MessageSquare className="h-4 w-4" />
                AI Follow-up Discussion
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {conversation.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${
                      msg.role === 'candidate' ? 'bg-violet-100 text-violet-900' : 'bg-white border'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {convoLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                  placeholder="Type your response..."
                  value={convoInput}
                  onChange={e => setConvoInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendConvoMessage()}
                  disabled={convoLoading}
                />
                <Button size="sm" onClick={sendConvoMessage} disabled={convoLoading || !convoInput.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex gap-2">
              {isTextType && !conversationMode && textAnswer.length > 20 && (
                <Button variant="outline" size="sm" onClick={startConversation} className="gap-1.5 text-violet-600">
                  <MessageSquare className="h-3.5 w-3.5" /> Discuss with AI
                </Button>
              )}
            </div>
            <Button
              onClick={submitAnswer}
              disabled={
                submitting ||
                (question.type === 'multiple_choice' && !selectedAnswer) ||
                (isTextType && !textAnswer.trim() && !conversationMode)
              }
              className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
              ) : progress.current >= progress.total ? (
                <><CheckCircle className="h-4 w-4" /> Finish Assessment</>
              ) : (
                <><ArrowRight className="h-4 w-4" /> Next Question</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info footer */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Anti-cheat monitored</span>
        <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> AI-scored</span>
        <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> Adaptive difficulty</span>
      </div>
    </div>
  )
}
