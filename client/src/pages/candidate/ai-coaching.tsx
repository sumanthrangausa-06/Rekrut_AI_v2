// AI Interview Coach — thin router / shell component
// Sub-components: QuickPractice, MockInterview, ProgressTab, HistoryTab
// Types in coaching-types.ts, utilities in coaching-utils.tsx

import { useEffect, useState, useCallback } from 'react'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Video, Target, TrendingUp, Flame, Star, Camera, Eye,
  Volume2, BookOpen, BarChart3, History,
} from 'lucide-react'

import type {
  PracticeQuestion, PracticeStats,
  CategoryProgress, RecentSession, HistorySession,
  MockSessionSummary,
} from './coaching-types'

import { QuickPractice } from './quick-practice'
import { MockInterview } from './mock-interview'
import { ProgressTab, HistoryTab } from './ai-coaching-progress'

export function AiCoachingPage() {
  const [tab, setTab] = useState('practice')
  const [stats, setStats] = useState<PracticeStats | null>(null)
  const [questions, setQuestions] = useState<PracticeQuestion[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  // Progress state
  const [categoryProgress, setCategoryProgress] = useState<CategoryProgress[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])

  // History state
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')

  // Mock Interview past sessions
  const [mockPastSessions, setMockPastSessions] = useState<MockSessionSummary[]>([])

  // ==================== DATA LOADING ====================

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

  const loadHistory = useCallback(async (category?: string) => {
    setHistoryLoading(true)
    try {
      const cat = category || historyFilter
      const res = await apiCall<{
        success: boolean; sessions: HistorySession[]; total: number; has_more: boolean
      }>(`/interviews/practice/sessions?limit=50&category=${cat}`)
      if (res.success) {
        setHistorySessions(res.sessions)
        setHistoryTotal(res.total)
      }
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setHistoryLoading(false)
    }
  }, [historyFilter])

  const loadMockSessions = useCallback(async () => {
    try {
      const res = await apiCall<{ success: boolean; sessions: MockSessionSummary[]; total: number }>('/interviews/mock/sessions?limit=10')
      if (res.success) setMockPastSessions(res.sessions)
    } catch (err) { console.error('Failed to load mock sessions:', err) }
  }, [])

  // ==================== EFFECTS ====================

  useEffect(() => {
    async function init() {
      setLoading(true)
      await Promise.all([loadStats(), loadQuestions(), loadProgress(), loadHistory(), loadMockSessions()])
      setLoading(false)
    }
    init()
  }, [loadStats, loadQuestions, loadProgress, loadHistory, loadMockSessions])

  // Refresh history when switching to history tab
  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab, loadHistory])

  // ==================== CALLBACKS FOR CHILDREN ====================

  /** Called by QuickPractice after a practice session completes */
  const refreshAfterPractice = useCallback(() => {
    loadStats()
    loadQuestions()
    loadProgress()
    loadHistory()
  }, [loadStats, loadQuestions, loadProgress, loadHistory])

  /** Called by MockInterview after a mock interview completes */
  const refreshAfterMock = useCallback(() => {
    loadStats()
    loadMockSessions()
    loadProgress()
  }, [loadStats, loadMockSessions, loadProgress])

  // ==================== LOADING STATE ====================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // ==================== RENDER ====================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Video className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">AI Interview Coach</h1>
            <p className="text-muted-foreground text-sm">Record video responses — get AI feedback on content, delivery, and body language</p>
          </div>
        </div>
      </div>

      {/* Feature Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-100">
          <Camera className="h-5 w-5 text-violet-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-violet-900">Video Recording</p>
            <p className="text-xs text-violet-600">Record yourself answering like a real interview</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-sky-50 border border-sky-100">
          <Eye className="h-5 w-5 text-sky-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-sky-900">Body Language AI</p>
            <p className="text-xs text-sky-600">Eye contact, expressions, posture analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
          <Volume2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-900">Speech Analysis</p>
            <p className="text-xs text-emerald-600">Pace, filler words, clarity scoring</p>
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
            <div className="text-xs text-muted-foreground">Sessions</div>
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
            <div className="text-xs text-muted-foreground">Avg Score</div>
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
          <TabsTrigger value="mock">
            <Video className="h-4 w-4 mr-1.5" /> Mock Interview
          </TabsTrigger>
          <TabsTrigger value="practice">
            <BookOpen className="h-4 w-4 mr-1.5" /> Quick Practice
          </TabsTrigger>
          <TabsTrigger value="progress">
            <BarChart3 className="h-4 w-4 mr-1.5" /> Progress
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-4 w-4 mr-1.5" /> History
          </TabsTrigger>
        </TabsList>

        {/* Mock Interview Tab */}
        <TabsContent value="mock">
          <MockInterview
            mockPastSessions={mockPastSessions}
            onSessionComplete={refreshAfterMock}
          />
        </TabsContent>

        {/* Quick Practice Tab */}
        <TabsContent value="practice">
          <QuickPractice
            questions={questions}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            onSessionComplete={refreshAfterPractice}
          />
        </TabsContent>

        {/* Progress Tab */}
        <TabsContent value="progress">
          <ProgressTab
            categoryProgress={categoryProgress}
            recentSessions={recentSessions}
          />
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <HistoryTab
            historySessions={historySessions}
            historyTotal={historyTotal}
            historyLoading={historyLoading}
            historyFilter={historyFilter}
            onFilterChange={(filter) => {
              setHistoryFilter(filter)
              loadHistory(filter)
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
