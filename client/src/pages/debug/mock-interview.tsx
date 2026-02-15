import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Activity, Clock, Brain,
  ChevronDown, ChevronRight, Database, Mic, Eye, Zap, MessageSquare
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface TestResult {
  level: string
  name: string
  status: 'pass' | 'fail' | 'warn' | 'info'
  details?: Record<string, any>
  error?: string
}

interface DebugData {
  tests: TestResult[]
  summary: {
    total: number
    passed: number
    failed: number
    warnings: number
    overall: 'healthy' | 'degraded' | 'broken'
    duration_ms: number
  }
}

interface PerQuestionData {
  session_id: number
  target_role: string
  status: string
  overall_score: number | null
  questions_asked: number
  total_candidate_turns: number
  per_question: Array<{
    question_number: number
    response_preview: string
    metadata: { word_count?: number; frame_count?: number; duration_seconds?: number; has_audio?: boolean }
    has_analysis: boolean
    analysis: any
  }>
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'pass': return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'fail': return <XCircle className="h-4 w-4 text-red-500" />
    case 'warn': return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    default: return <Activity className="h-4 w-4 text-blue-500" />
  }
}

const levelIcon = (level: string) => {
  switch (level) {
    case 'L1': return <Database className="h-4 w-4" />
    case 'L2': return <Zap className="h-4 w-4" />
    case 'L3': return <MessageSquare className="h-4 w-4" />
    case 'L4': return <Brain className="h-4 w-4" />
    case 'L5': return <Eye className="h-4 w-4" />
    default: return <Activity className="h-4 w-4" />
  }
}

export function MockInterviewDebugPage() {
  const navigate = useNavigate()
  const [debugData, setDebugData] = useState<DebugData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [perQuestionData, setPerQuestionData] = useState<PerQuestionData | null>(null)
  const [loadingPQ, setLoadingPQ] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)

  const getToken = useCallback(() => localStorage.getItem('rekrutai_token'), [])

  const runDiagnostics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = getToken()
      if (!token) { setError('Not authenticated. Please log in first.'); return }
      const res = await fetch('/api/interviews/mock/debug', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDebugData(data)
    } catch (err: any) {
      setError(err.message || 'Failed to run diagnostics')
    } finally {
      setLoading(false)
    }
  }, [getToken])

  const loadPerQuestion = useCallback(async (sessionId: number) => {
    setLoadingPQ(true)
    setSelectedSessionId(sessionId)
    try {
      const token = getToken()
      const res = await fetch(`/api/interviews/mock/sessions/${sessionId}/per-question`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setPerQuestionData(data)
    } catch (err: any) {
      console.error('Failed to load per-question data:', err)
    } finally {
      setLoadingPQ(false)
    }
  }, [getToken])

  useEffect(() => { runDiagnostics() }, [runDiagnostics])

  const toggleExpand = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  const overallBg = debugData?.summary.overall === 'healthy'
    ? 'bg-green-50 border-green-200'
    : debugData?.summary.overall === 'degraded'
      ? 'bg-yellow-50 border-yellow-200'
      : 'bg-red-50 border-red-200'

  return (
    <div className="min-h-dvh-safe bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Mock Interview Debug</h1>
            <p className="text-sm text-gray-500 mt-1">L1→L5 progressive diagnostics for the mock interview pipeline</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button size="sm" onClick={runDiagnostics} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} />
              {loading ? 'Running...' : 'Run Tests'}
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <p className="text-red-700 text-sm">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Summary Card */}
        {debugData && (
          <Card className={cn('border', overallBg)}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {debugData.summary.overall === 'healthy' && <CheckCircle2 className="h-6 w-6 text-green-600" />}
                  {debugData.summary.overall === 'degraded' && <AlertTriangle className="h-6 w-6 text-yellow-600" />}
                  {debugData.summary.overall === 'broken' && <XCircle className="h-6 w-6 text-red-600" />}
                  <div>
                    <p className="font-semibold text-lg capitalize">{debugData.summary.overall}</p>
                    <p className="text-sm text-gray-600">
                      {debugData.summary.passed}/{debugData.summary.total} passed
                      {debugData.summary.warnings > 0 && `, ${debugData.summary.warnings} warnings`}
                      {debugData.summary.failed > 0 && `, ${debugData.summary.failed} failed`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock className="h-3 w-3" />
                  {debugData.summary.duration_ms}ms
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Test Results */}
        {debugData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Test Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {debugData.tests.map((test, idx) => (
                <div key={idx} className="border rounded-lg">
                  <button
                    onClick={() => toggleExpand(idx)}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {statusIcon(test.status)}
                      <Badge variant="outline" className="text-xs font-mono">{test.level}</Badge>
                      {levelIcon(test.level)}
                      <span className="font-medium text-sm">{test.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={test.status === 'pass' ? 'default' : test.status === 'fail' ? 'destructive' : 'secondary'}>
                        {test.status}
                      </Badge>
                      {expanded.has(idx) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                  </button>
                  {expanded.has(idx) && (
                    <div className="px-3 pb-3 border-t">
                      {test.error && (
                        <p className="text-red-600 text-xs mt-2 font-mono">{test.error}</p>
                      )}
                      {test.details && (
                        <pre className="text-xs bg-gray-100 rounded p-2 mt-2 overflow-auto max-h-60">
                          {JSON.stringify(test.details, null, 2)}
                        </pre>
                      )}
                      {/* If L3 session history, add "Load Per-Q" buttons */}
                      {test.level === 'L3' && test.details?.recent_sessions && (
                        <div className="mt-2 space-y-1">
                          {(test.details.recent_sessions as any[]).filter(s => s.status === 'completed').map(s => (
                            <Button key={s.id} size="sm" variant="outline" onClick={() => loadPerQuestion(s.id)} disabled={loadingPQ}>
                              <Eye className="h-3 w-3 mr-1" />
                              Session {s.id}: Per-Question Analysis
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Per-Question Analysis View */}
        {perQuestionData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Per-Question Analysis — Session {perQuestionData.session_id}
                <Badge variant="outline">{perQuestionData.target_role}</Badge>
                <Badge>{perQuestionData.status}</Badge>
              </CardTitle>
              <p className="text-sm text-gray-500">
                {perQuestionData.total_candidate_turns} answers | Score: {perQuestionData.overall_score ?? 'N/A'}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {perQuestionData.per_question.length === 0 ? (
                <p className="text-sm text-gray-500">No candidate turns found in this session.</p>
              ) : perQuestionData.per_question.map((q, idx) => (
                <div key={idx} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">Q{q.question_number}</Badge>
                      <span className="text-sm font-medium">
                        {q.metadata.word_count || 0} words | {q.metadata.frame_count || 0} frames | {q.metadata.duration_seconds || 0}s
                      </span>
                      {q.metadata.has_audio && <Mic className="h-3 w-3 text-green-500" />}
                    </div>
                    {q.has_analysis
                      ? <Badge className="bg-green-100 text-green-800">Analyzed</Badge>
                      : <Badge variant="secondary">Pending</Badge>
                    }
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2">{q.response_preview}...</p>
                  {q.has_analysis && q.analysis && (
                    <details className="mt-1">
                      <summary className="text-xs text-blue-600 cursor-pointer">View analysis details</summary>
                      <pre className="text-xs bg-gray-100 rounded p-2 mt-1 overflow-auto max-h-40">
                        {JSON.stringify(q.analysis.analysis || q.analysis, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Legend */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-2">Test Levels</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs text-gray-600">
              <div><Badge variant="outline" className="font-mono mr-1">L1</Badge> Database & Schema</div>
              <div><Badge variant="outline" className="font-mono mr-1">L2</Badge> AI Providers & TTS</div>
              <div><Badge variant="outline" className="font-mono mr-1">L3</Badge> Session History</div>
              <div><Badge variant="outline" className="font-mono mr-1">L4</Badge> LLM Quality Chain</div>
              <div><Badge variant="outline" className="font-mono mr-1">L5</Badge> E2E Pipeline</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
