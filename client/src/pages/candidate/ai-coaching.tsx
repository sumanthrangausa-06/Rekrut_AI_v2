import { useEffect, useState, useCallback } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Brain, Target, Lightbulb, MessageSquare, Trophy, TrendingUp,
  Flame, BookOpen, CheckCircle, ArrowRight, Sparkles, BarChart3,
  Clock, Star, Zap,
} from 'lucide-react'

// Types
interface PracticeQuestion {
  id: string
  category: string
  difficulty: string
  question: string
  key_points: string[]
  times_practiced: number
  last_score: number | null
  avg_score: number | null
  last_practiced: string | null
}

interface PracticeStats {
  total_questions: number
  average_score: number | null
  improvement: number | null
  day_streak: number
  last_practice: string | null
}

interface CoachingResult {
  score: number
  strengths: string[]
  improvements: string[]
  specific_tips?: string[]
  improved_response?: string
  common_mistake?: string
  body_language_tips?: string[]
  practice_prompt?: string
}

interface CategoryProgress {
  category: string
  count: number
  average_score: number
}

interface RecentSession {
  question: string
  category: string
  score: number
  improvements: string[]
  created_at: string
}

const categoryConfig: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  behavioral: { label: 'Behavioral', icon: Brain, color: 'text-violet-700', bg: 'bg-violet-100' },
  technical: { label: 'Technical', icon: Zap, color: 'text-rose-700', bg: 'bg-rose-100' },
  situational: { label: 'Situational', icon: Lightbulb, color: 'text-sky-700', bg: 'bg-sky-100' },
}

const difficultyColors: Record<string, string> = {
  Easy: 'bg-green-100 text-green-700',
  Medium: 'bg-amber-100 text-amber-700',
  Hard: 'bg-red-100 text-red-700',
}

export function AiCoachingPage() {
  const [tab, setTab] = useState('practice')
  const [stats, setStats] = useState<PracticeStats | null>(null)
  const [questions, setQuestions] = useState<PracticeQuestion[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  // Practice modal state
  const [practiceQuestion, setPracticeQuestion] = useState<PracticeQuestion | null>(null)
  const [responseText, setResponseText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [coaching, setCoaching] = useState<CoachingResult | null>(null)

  // Progress state
  const [categoryProgress, setCategoryProgress] = useState<CategoryProgress[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])

  const loadStats = useCallback(async () => {
    try {
      const res = await apiCall<{ success: boolean; stats: PracticeStats }>('/interviews/practice/stats')
      if (res.success) setStats(res.stats)
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }, [])

  const loadQuestions = useCallback(async () => {
    try {
      const res = await apiCall<{ success: boolean; questions: PracticeQuestion[] }>('/interviews/practice/library')
      if (res.success) setQuestions(res.questions)
    } catch (err) {
      console.error('Failed to load questions:', err)
    }
  }, [])

  const loadProgress = useCallback(async () => {
    try {
      const res = await apiCall<{
        success: boolean
        progress: { by_category: CategoryProgress[]; recent_sessions: RecentSession[] }
      }>('/interviews/practice/progress')
      if (res.success) {
        setCategoryProgress(res.progress.by_category)
        setRecentSessions(res.progress.recent_sessions)
      }
    } catch (err) {
      console.error('Failed to load progress:', err)
    }
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      await Promise.all([loadStats(), loadQuestions(), loadProgress()])
      setLoading(false)
    }
    init()
  }, [loadStats, loadQuestions, loadProgress])

  function openPractice(q: PracticeQuestion) {
    setPracticeQuestion(q)
    setResponseText('')
    setCoaching(null)
    setSubmitting(false)
  }

  function closePractice() {
    setPracticeQuestion(null)
    setResponseText('')
    setCoaching(null)
    setSubmitting(false)
  }

  async function submitResponse() {
    if (!practiceQuestion) return
    if (responseText.trim().length < 50) {
      alert('Please write at least 50 characters for a meaningful response.')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiCall<{ success: boolean; coaching: CoachingResult }>('/interviews/practice/submit', {
        method: 'POST',
        body: {
          question_id: practiceQuestion.id,
          question: practiceQuestion.question,
          category: practiceQuestion.category,
          response_text: responseText,
        },
      })

      if (res.success) {
        setCoaching(res.coaching)
        // Refresh stats and questions in background
        loadStats()
        loadQuestions()
        loadProgress()
      }
    } catch (err: any) {
      alert(err.message || 'Failed to get AI coaching. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function practiceAnother() {
    setCoaching(null)
    setResponseText('')
    setPracticeQuestion(null)
  }

  const filteredQuestions =
    categoryFilter === 'all' ? questions : questions.filter(q => q.category === categoryFilter)

  const categoryCounts = questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.category] = (acc[q.category] || 0) + 1
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">AI Interview Coach</h1>
            <p className="text-muted-foreground text-sm">Practice with AI-powered feedback and track your improvement</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="inline-flex p-2 rounded-lg bg-primary/10 mb-2">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div className="text-2xl font-bold">{stats?.total_questions || 0}</div>
            <div className="text-xs text-muted-foreground">Questions Practiced</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="inline-flex p-2 rounded-lg bg-amber-100 mb-2">
              <Star className="h-5 w-5 text-amber-600" />
            </div>
            <div className="text-2xl font-bold">
              {stats?.average_score != null ? `${Math.round(stats.average_score * 10) / 10}/10` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Average Score</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="inline-flex p-2 rounded-lg bg-green-100 mb-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div className="text-2xl font-bold">
              {stats?.improvement != null ? `${stats.improvement > 0 ? '+' : ''}${Math.round(stats.improvement)}%` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Improvement</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="inline-flex p-2 rounded-lg bg-orange-100 mb-2">
              <Flame className="h-5 w-5 text-orange-600" />
            </div>
            <div className="text-2xl font-bold">{stats?.day_streak || 0}</div>
            <div className="text-xs text-muted-foreground">Day Streak</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="practice">
            <BookOpen className="h-4 w-4 mr-1.5" /> Practice
          </TabsTrigger>
          <TabsTrigger value="progress">
            <BarChart3 className="h-4 w-4 mr-1.5" /> Progress
          </TabsTrigger>
        </TabsList>

        {/* Practice Tab */}
        <TabsContent value="practice">
          {/* Category Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              size="sm"
              variant={categoryFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setCategoryFilter('all')}
            >
              All ({questions.length})
            </Button>
            {Object.entries(categoryConfig).map(([key, cfg]) => {
              const Icon = cfg.icon
              return (
                <Button
                  key={key}
                  size="sm"
                  variant={categoryFilter === key ? 'default' : 'outline'}
                  onClick={() => setCategoryFilter(key)}
                >
                  <Icon className="h-3.5 w-3.5 mr-1" /> {cfg.label} ({categoryCounts[key] || 0})
                </Button>
              )
            })}
          </div>

          {/* Question Cards */}
          <div className="grid gap-3">
            {filteredQuestions.map(q => {
              const catCfg = categoryConfig[q.category] || categoryConfig.behavioral
              const CatIcon = catCfg.icon
              return (
                <Card
                  key={q.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => openPractice(q)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={`p-2 rounded-lg ${catCfg.bg} shrink-0`}>
                        <CatIcon className={`h-4 w-4 ${catCfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="secondary" className={catCfg.bg + ' ' + catCfg.color + ' border-0'}>
                            {catCfg.label}
                          </Badge>
                          <Badge variant="secondary" className={difficultyColors[q.difficulty] + ' border-0'}>
                            {q.difficulty}
                          </Badge>
                          {q.times_practiced > 0 && (
                            <Badge variant="outline" className="text-xs">
                              Practiced {q.times_practiced}x
                            </Badge>
                          )}
                          {q.last_score != null && (
                            <Badge variant="outline" className="text-xs">
                              Best: {q.last_score}/10
                            </Badge>
                          )}
                        </div>
                        <p className="font-medium text-sm">{q.question}</p>
                        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                          <span>Key topics: {q.key_points.join(', ')}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        {/* Progress Tab */}
        <TabsContent value="progress">
          <div className="space-y-6">
            {/* Category Breakdown */}
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Performance by Category
                </h3>
                {categoryProgress.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No practice sessions yet. Start practicing to see your progress!
                  </p>
                ) : (
                  <div className="space-y-4">
                    {categoryProgress.map(cp => {
                      const catCfg = categoryConfig[cp.category] || categoryConfig.behavioral
                      const CatIcon = catCfg.icon
                      const avgScore = parseFloat(String(cp.average_score)) || 0
                      const pct = (avgScore / 10) * 100
                      return (
                        <div key={cp.category} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 font-medium">
                              <CatIcon className={`h-4 w-4 ${catCfg.color}`} />
                              {catCfg.label}
                            </span>
                            <span className="text-muted-foreground">
                              {Math.round(avgScore * 10) / 10}/10 ({cp.count} sessions)
                            </span>
                          </div>
                          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Sessions */}
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Recent Practice Sessions
                </h3>
                {recentSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No practice sessions yet. Pick a question and start practicing!
                  </p>
                ) : (
                  <div className="space-y-3">
                    {recentSessions.map((s, i) => {
                      const catCfg = categoryConfig[s.category] || categoryConfig.behavioral
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                        >
                          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
                            {s.score}/10
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium line-clamp-1">{s.question}</p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <Badge variant="secondary" className={catCfg.bg + ' ' + catCfg.color + ' text-xs border-0'}>
                                {catCfg.label}
                              </Badge>
                              <span>{new Date(s.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Practice Dialog */}
      <Dialog open={!!practiceQuestion} onClose={closePractice}>
        <div className="max-h-[80vh] overflow-y-auto">
          {practiceQuestion && !coaching && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  Practice Question
                </DialogTitle>
                <DialogDescription>
                  Write your response as if you were in a real interview
                </DialogDescription>
              </DialogHeader>

              {/* Question display */}
              <div className="mt-4 p-4 rounded-xl bg-primary/5 border border-primary/10">
                <div className="flex items-center gap-2 mb-2">
                  {(() => {
                    const catCfg = categoryConfig[practiceQuestion.category] || categoryConfig.behavioral
                    return (
                      <>
                        <Badge variant="secondary" className={catCfg.bg + ' ' + catCfg.color + ' border-0'}>
                          {catCfg.label}
                        </Badge>
                        <Badge variant="secondary" className={difficultyColors[practiceQuestion.difficulty] + ' border-0'}>
                          {practiceQuestion.difficulty}
                        </Badge>
                      </>
                    )
                  })()}
                </div>
                <p className="font-semibold text-sm leading-relaxed">{practiceQuestion.question}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {practiceQuestion.key_points.map((kp, i) => (
                    <span key={i} className="inline-flex items-center text-xs bg-white/60 px-2 py-0.5 rounded">
                      {kp}
                    </span>
                  ))}
                </div>
              </div>

              {/* Response area */}
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium">Your Response</label>
                <Textarea
                  value={responseText}
                  onChange={e => setResponseText(e.target.value)}
                  placeholder="Take your time to craft a thoughtful response. Use the STAR method (Situation, Task, Action, Result) for behavioral questions..."
                  rows={8}
                  className="resize-y"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{responseText.length} characters {responseText.length < 50 && '(minimum 50)'}</span>
                  {responseText.length >= 50 && <CheckCircle className="h-3.5 w-3.5 text-green-500" />}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Button variant="outline" onClick={closePractice} className="flex-1">
                  Cancel
                </Button>
                <Button
                  onClick={submitResponse}
                  disabled={submitting || responseText.trim().length < 50}
                  className="flex-1"
                >
                  {submitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1.5" />
                      Get AI Coaching
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* Coaching Results */}
          {practiceQuestion && coaching && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  AI Coaching Feedback
                </DialogTitle>
              </DialogHeader>

              {/* Score */}
              <div className="mt-4 text-center p-5 rounded-xl bg-primary/5 border border-primary/10">
                <div className="text-4xl font-bold text-primary">{coaching.score}/10</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {coaching.score >= 8 ? 'Excellent response!' : coaching.score >= 6 ? 'Good effort! Room to improve.' : 'Keep practicing — you\'ll get there!'}
                </div>
              </div>

              {/* Strengths */}
              {coaching.strengths && coaching.strengths.length > 0 && (
                <div className="mt-4 p-4 rounded-lg bg-green-50 border border-green-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-green-800 mb-2">
                    <CheckCircle className="h-4 w-4" /> Strengths
                  </h4>
                  <ul className="space-y-1.5">
                    {coaching.strengths.map((s, i) => (
                      <li key={i} className="text-sm text-green-700 flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Areas for Improvement */}
              {coaching.improvements && coaching.improvements.length > 0 && (
                <div className="mt-3 p-4 rounded-lg bg-amber-50 border border-amber-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-amber-800 mb-2">
                    <TrendingUp className="h-4 w-4" /> Areas for Improvement
                  </h4>
                  <ul className="space-y-1.5">
                    {coaching.improvements.map((imp, i) => (
                      <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        {imp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Specific Tips */}
              {coaching.specific_tips && coaching.specific_tips.length > 0 && (
                <div className="mt-3 p-4 rounded-lg bg-blue-50 border border-blue-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-blue-800 mb-2">
                    <Target className="h-4 w-4" /> Specific Tips
                  </h4>
                  <ul className="space-y-1.5">
                    {coaching.specific_tips.map((tip, i) => (
                      <li key={i} className="text-sm text-blue-700 flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Example Strong Response */}
              {coaching.improved_response && (
                <div className="mt-3 p-4 rounded-lg bg-purple-50 border border-purple-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-purple-800 mb-2">
                    <Sparkles className="h-4 w-4" /> Example Strong Response
                  </h4>
                  <p className="text-sm text-purple-700 italic leading-relaxed">
                    "{coaching.improved_response}"
                  </p>
                </div>
              )}

              {/* Common Mistake */}
              {coaching.common_mistake && (
                <div className="mt-3 p-4 rounded-lg bg-red-50 border border-red-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-red-800 mb-2">
                    ⚠️ Common Mistake to Avoid
                  </h4>
                  <p className="text-sm text-red-700">{coaching.common_mistake}</p>
                </div>
              )}

              {/* Delivery Tips */}
              {coaching.body_language_tips && coaching.body_language_tips.length > 0 && (
                <div className="mt-3 p-4 rounded-lg bg-muted">
                  <h4 className="font-semibold text-sm mb-2">🗣️ Delivery Tips</h4>
                  <ul className="space-y-1.5">
                    {coaching.body_language_tips.map((tip, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-foreground/30 shrink-0" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="mt-5 flex gap-2">
                <Button variant="outline" onClick={closePractice} className="flex-1">
                  Close
                </Button>
                <Button onClick={practiceAnother} className="flex-1">
                  <ArrowRight className="h-4 w-4 mr-1.5" />
                  Practice Another
                </Button>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </div>
  )
}
