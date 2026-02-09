import { useEffect, useState, useCallback, useRef } from 'react'
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
  Clock, Star, Zap, Video, VideoOff, Mic, MicOff, Camera, Eye,
  Volume2, AlertCircle, ChevronDown, ChevronUp, Play, Square,
  Timer, User, Monitor,
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

interface CategoryScoreDetail {
  score: number
  feedback: string
}

interface VideoCoaching {
  overall_score: number
  content: {
    score: number
    strengths: string[]
    improvements: string[]
    covered_points: string[]
    missed_points: string[]
    detailed_feedback: string
    improved_response: string
    specific_tips: string[]
    common_mistake: string
    practice_prompt: string
  }
  communication: {
    score: number
    word_count: number
    words_per_minute: number
    duration_seconds: number
    filler_words: Record<string, number>
    total_fillers: number
    filler_rate: number
    pace: { assessment: string; wpm: number; feedback: string }
    tips: string[]
  }
  presentation: {
    score: number
    eye_contact: CategoryScoreDetail
    facial_expressions: CategoryScoreDetail
    body_language: CategoryScoreDetail
    professional_appearance: CategoryScoreDetail
    summary: string
    timestamped_notes: { frame: number; note: string }[]
  }
}

// Legacy text coaching (kept for fallback)
interface TextCoaching {
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

// Score color helper
function scoreColor(score: number): string {
  if (score >= 8) return 'text-green-600'
  if (score >= 6) return 'text-amber-600'
  return 'text-red-600'
}

function scoreBg(score: number): string {
  if (score >= 8) return 'bg-green-50 border-green-200'
  if (score >= 6) return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

function scoreLabel(score: number): string {
  if (score >= 9) return 'Excellent'
  if (score >= 8) return 'Great'
  if (score >= 7) return 'Good'
  if (score >= 6) return 'Decent'
  if (score >= 5) return 'Average'
  return 'Needs Work'
}

// Score bar component
function ScoreBar({ score, label, icon: Icon }: { score: number; label: string; icon: React.ElementType }) {
  const pct = (score / 10) * 100
  const barColor = score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
        </span>
        <span className={`font-bold ${scoreColor(score)}`}>{score}/10</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function AiCoachingPage() {
  const [tab, setTab] = useState('practice')
  const [stats, setStats] = useState<PracticeStats | null>(null)
  const [questions, setQuestions] = useState<PracticeQuestion[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  // Practice modal state
  const [practiceQuestion, setPracticeQuestion] = useState<PracticeQuestion | null>(null)
  const [responseMode, setResponseMode] = useState<'select' | 'video' | 'text'>('select')
  const [responseText, setResponseText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [coaching, setCoaching] = useState<VideoCoaching | null>(null)
  const [textCoaching, setTextCoaching] = useState<TextCoaching | null>(null)

  // Video recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [transcription, setTranscription] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [capturedFrames, setCapturedFrames] = useState<string[]>([])
  const [recordingDone, setRecordingDone] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recognitionRef = useRef<any>(null)

  // Feedback detail sections
  const [expandedSection, setExpandedSection] = useState<string | null>('content')

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
      if (timerRef.current) clearInterval(timerRef.current)
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    }
  }, [])

  function openPractice(q: PracticeQuestion) {
    setPracticeQuestion(q)
    setResponseMode('select')
    setResponseText('')
    setCoaching(null)
    setTextCoaching(null)
    setSubmitting(false)
    setRecordingDone(false)
    setTranscription('')
    setCapturedFrames([])
    setRecordingTime(0)
    setCameraError(null)
    setExpandedSection('content')
  }

  function closePractice() {
    stopCamera()
    stopRecording()
    setPracticeQuestion(null)
    setResponseMode('select')
    setResponseText('')
    setCoaching(null)
    setTextCoaching(null)
    setSubmitting(false)
    setRecordingDone(false)
    setTranscription('')
    setCapturedFrames([])
    setRecordingTime(0)
    setCameraError(null)
    setCountdown(null)
  }

  // Camera management — universal cross-browser implementation.
  // IMPORTANT: This must ONLY be called from a direct user gesture (click/tap)
  // to ensure the browser shows the permission prompt on all platforms.
  // Do NOT call from useEffect or setTimeout — that breaks the gesture chain
  // on Chrome iOS, Firefox, and other mobile browsers.
  async function startCamera() {
    try {
      setCameraError(null)

      // Check if mediaDevices API is available (requires HTTPS)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera not available. Make sure you\'re using HTTPS and a modern browser.')
        return
      }

      // Progressive constraints — try ideal first, fall back to simpler ones.
      // This handles devices that don't support specific resolutions or facingMode.
      const constraintOptions = [
        { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: true },
        { video: { facingMode: 'user' }, audio: true },
        { video: true, audio: true },
      ]

      let stream: MediaStream | null = null
      let lastError: any = null

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch (e: any) {
          lastError = e
          // Permission denied or no device — don't retry, these won't change
          if (e.name === 'NotAllowedError' || e.name === 'NotFoundError') {
            break
          }
          // OverconstrainedError or other — try next constraint set
          continue
        }
      }

      if (!stream) {
        throw lastError || new Error('Could not access camera')
      }

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        try {
          await videoRef.current.play()
        } catch (playErr) {
          // Stream is still active even if autoplay policy blocks play()
          console.warn('Video play() blocked by autoplay policy:', playErr)
        }
      }
      setCameraReady(true)
    } catch (err: any) {
      console.error('Camera error:', err)

      // Universal error messages — no browser sniffing.
      // Each browser has its own settings path, so we give general guidance.
      if (err.name === 'NotAllowedError') {
        setCameraError(
          'Camera access denied.\n\n' +
          'To fix this:\n' +
          '1. Check your browser\'s camera permissions for this site\n' +
          '2. On mobile: Open your device Settings → find your browser → allow Camera & Microphone\n' +
          '3. Tap Retry below'
        )
      } else if (err.name === 'NotFoundError') {
        setCameraError('No camera found. Please connect a camera or webcam and tap Retry.')
      } else if (err.name === 'OverconstrainedError') {
        setCameraError('Camera settings not supported on this device. Tap Retry to try with default settings.')
      } else if (err.name === 'NotReadableError') {
        setCameraError(
          'Camera is in use by another app. Close other apps using the camera, then tap Retry.'
        )
      } else {
        setCameraError('Could not access camera. Check your device settings and tap Retry.')
      }
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraReady(false)
  }

  // Frame capture
  function captureFrame(): string | null {
    if (!videoRef.current || !canvasRef.current) return null
    const canvas = canvasRef.current
    const video = videoRef.current
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, 320, 240)
    return canvas.toDataURL('image/jpeg', 0.7)
  }

  // Speech Recognition
  function startSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('Speech recognition not supported')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let finalTranscript = ''

    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' '
        } else {
          interim = result[0].transcript
        }
      }
      setTranscription(finalTranscript + interim)
      setIsTranscribing(true)
    }

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error)
      if (event.error === 'no-speech') {
        // Restart
        try { recognition.start() } catch (_) {}
      }
    }

    recognition.onend = () => {
      setIsTranscribing(false)
      // Restart if still recording
      if (isRecording) {
        try { recognition.start() } catch (_) {}
      }
    }

    recognition.start()
    recognitionRef.current = recognition
    setIsTranscribing(true)
  }

  function stopSpeechRecognition() {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch (_) {}
      recognitionRef.current = null
    }
    setIsTranscribing(false)
  }

  // Recording
  function startCountdownThenRecord() {
    setCountdown(3)
    let count = 3
    const interval = setInterval(() => {
      count--
      if (count <= 0) {
        clearInterval(interval)
        setCountdown(null)
        startRecording()
      } else {
        setCountdown(count)
      }
    }, 1000)
  }

  function startRecording() {
    if (!streamRef.current) return

    setIsRecording(true)
    setRecordingTime(0)
    setTranscription('')
    setCapturedFrames([])
    setRecordingDone(false)

    // Start timer
    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1)
    }, 1000)

    // Start frame capture (every 4 seconds)
    frameIntervalRef.current = setInterval(() => {
      const frame = captureFrame()
      if (frame) {
        setCapturedFrames(prev => [...prev, frame])
      }
    }, 4000)

    // Capture first frame immediately
    setTimeout(() => {
      const frame = captureFrame()
      if (frame) setCapturedFrames(prev => [...prev, frame])
    }, 500)

    // Start speech recognition
    startSpeechRecognition()
  }

  function stopRecording() {
    setIsRecording(false)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current)
      frameIntervalRef.current = null
    }

    // Capture final frame
    const frame = captureFrame()
    if (frame) setCapturedFrames(prev => [...prev, frame])

    stopSpeechRecognition()
    setRecordingDone(true)
  }

  // Submit video response
  async function submitVideoResponse() {
    if (!practiceQuestion) return

    const finalTranscription = transcription.trim()
    if (finalTranscription.length < 20) {
      alert('Your response was too short. Please try recording again and speak for at least 15-20 seconds.')
      return
    }

    if (capturedFrames.length === 0) {
      alert('No video frames were captured. Please try again with camera enabled.')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiCall<{ success: boolean; coaching: VideoCoaching }>('/interviews/practice/submit-video', {
        method: 'POST',
        body: {
          question_id: practiceQuestion.id,
          question: practiceQuestion.question,
          category: practiceQuestion.category,
          transcription: finalTranscription,
          frames: capturedFrames,
          duration_seconds: recordingTime,
        },
      })

      if (res.success) {
        setCoaching(res.coaching)
        stopCamera()
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

  // Submit text response (fallback)
  async function submitTextResponse() {
    if (!practiceQuestion) return
    if (responseText.trim().length < 50) {
      alert('Please write at least 50 characters for a meaningful response.')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiCall<{ success: boolean; coaching: TextCoaching }>('/interviews/practice/submit', {
        method: 'POST',
        body: {
          question_id: practiceQuestion.id,
          question: practiceQuestion.question,
          category: practiceQuestion.category,
          response_text: responseText,
        },
      })

      if (res.success) {
        setTextCoaching(res.coaching)
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
    setTextCoaching(null)
    setResponseText('')
    setTranscription('')
    setCapturedFrames([])
    setRecordingDone(false)
    setRecordingTime(0)
    setPracticeQuestion(null)
    setResponseMode('select')
    stopCamera()
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
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
          <TabsTrigger value="practice">
            <BookOpen className="h-4 w-4 mr-1.5" /> Practice
          </TabsTrigger>
          <TabsTrigger value="progress">
            <BarChart3 className="h-4 w-4 mr-1.5" /> Progress
          </TabsTrigger>
        </TabsList>

        {/* Practice Tab */}
        <TabsContent value="practice">
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
                      <div className="flex items-center gap-1 shrink-0">
                        <Video className="h-4 w-4 text-muted-foreground" />
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
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
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
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

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ==================== Practice Dialog ==================== */}
      <Dialog open={!!practiceQuestion} onClose={closePractice} className="max-w-2xl">
        <div className="max-h-[85vh] overflow-y-auto">
          {practiceQuestion && !coaching && !textCoaching && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Mock Interview
                </DialogTitle>
                <DialogDescription>
                  Answer as if you're in a real interview — AI analyzes everything
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
              </div>

              {/* Mode Selection */}
              {responseMode === 'select' && (
                <div className="mt-5 space-y-3">
                  <p className="text-sm font-medium text-center text-muted-foreground">How would you like to respond?</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      onClick={() => setResponseMode('video')}
                      className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-primary/20 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                    >
                      <div className="p-3 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                        <Video className="h-6 w-6 text-primary" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-sm">Record Video</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          AI analyzes body language, eye contact, speech pace & content
                        </p>
                      </div>
                      <Badge className="bg-primary/10 text-primary border-0">Recommended</Badge>
                    </button>

                    <button
                      onClick={() => setResponseMode('text')}
                      className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-muted hover:border-muted-foreground/30 hover:bg-muted/50 transition-all group"
                    >
                      <div className="p-3 rounded-full bg-muted group-hover:bg-muted-foreground/10 transition-colors">
                        <MessageSquare className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-sm">Type Response</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          AI analyzes answer content & structure only
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">Text only</Badge>
                    </button>
                  </div>
                </div>
              )}

              {/* Video Recording Mode */}
              {responseMode === 'video' && (
                <div className="mt-4 space-y-4">
                  {/* Camera Preview */}
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover mirror"
                      style={{ transform: 'scaleX(-1)' }}
                    />

                    {/* Enable Camera prompt — shown before camera is started.
                        getUserMedia MUST be called from a direct user gesture (tap/click)
                        for reliable cross-browser permission prompts. */}
                    {!cameraReady && !cameraError && (
                      <div className="absolute inset-0 bg-black/90 flex items-center justify-center p-4">
                        <div className="text-center text-white max-w-xs">
                          <div className="p-4 rounded-full bg-white/10 inline-flex mb-3">
                            <Camera className="h-8 w-8 text-white" />
                          </div>
                          <p className="font-medium mb-1">Camera & Microphone</p>
                          <p className="text-xs text-white/70 mb-4">
                            Tap below to enable your camera. Your browser will ask for permission.
                          </p>
                          <Button
                            onClick={() => startCamera()}
                            className="bg-white text-black hover:bg-white/90"
                          >
                            <Camera className="h-4 w-4 mr-2" />
                            Enable Camera
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Camera error overlay */}
                    {cameraError && (
                      <div className="absolute inset-0 bg-black/90 flex items-center justify-center p-4">
                        <div className="text-center text-white max-w-xs">
                          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-400" />
                          <p className="text-sm whitespace-pre-line">{cameraError}</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 text-white border-white/30"
                            onClick={() => {
                              setCameraError(null)
                              setCameraReady(false)
                              startCamera()
                            }}
                          >
                            Retry
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Countdown overlay */}
                    {countdown !== null && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="text-7xl font-bold text-white animate-pulse">{countdown}</div>
                      </div>
                    )}

                    {/* Recording indicator */}
                    {isRecording && (
                      <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full text-sm font-medium">
                        <div className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                        REC {formatTime(recordingTime)}
                      </div>
                    )}

                    {/* Frame count */}
                    {isRecording && (
                      <div className="absolute top-3 right-3 bg-black/60 text-white px-2 py-1 rounded text-xs">
                        {capturedFrames.length} frames
                      </div>
                    )}

                    {/* Transcription status */}
                    {isRecording && (
                      <div className="absolute bottom-3 left-3 right-3">
                        <div className="bg-black/70 rounded-lg p-2 text-white text-xs max-h-16 overflow-y-auto">
                          {isTranscribing && <Mic className="h-3 w-3 inline mr-1 text-green-400" />}
                          {transcription || 'Listening...'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Recording Controls */}
                  <div className="flex items-center justify-center gap-3">
                    {!isRecording && !recordingDone && (
                      <Button
                        onClick={startCountdownThenRecord}
                        disabled={!cameraReady || countdown !== null}
                        className="bg-red-600 hover:bg-red-700 text-white px-6"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {countdown !== null ? `Starting in ${countdown}...` : 'Start Recording'}
                      </Button>
                    )}

                    {isRecording && (
                      <Button
                        onClick={stopRecording}
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50 px-6"
                      >
                        <Square className="h-4 w-4 mr-2" />
                        Stop Recording ({formatTime(recordingTime)})
                      </Button>
                    )}

                    {recordingDone && !submitting && (
                      <div className="flex gap-2 w-full">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setRecordingDone(false)
                            setTranscription('')
                            setCapturedFrames([])
                            setRecordingTime(0)
                          }}
                          className="flex-1"
                        >
                          Re-record
                        </Button>
                        <Button
                          onClick={submitVideoResponse}
                          disabled={transcription.trim().length < 20}
                          className="flex-1"
                        >
                          <Sparkles className="h-4 w-4 mr-1.5" />
                          Get AI Coaching
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Recording summary when done */}
                  {recordingDone && (
                    <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Timer className="h-3.5 w-3.5" /> {formatTime(recordingTime)}
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Camera className="h-3.5 w-3.5" /> {capturedFrames.length} frames
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Volume2 className="h-3.5 w-3.5" /> {transcription.split(/\s+/).filter(w => w).length} words
                        </span>
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          View transcription
                        </summary>
                        <p className="mt-1 p-2 bg-white rounded border text-muted-foreground leading-relaxed">
                          {transcription || 'No speech detected'}
                        </p>
                      </details>
                    </div>
                  )}

                  {/* Submitting state */}
                  {submitting && (
                    <div className="text-center py-6 space-y-3">
                      <div className="animate-spin rounded-full h-10 w-10 border-3 border-primary border-t-transparent mx-auto" />
                      <div>
                        <p className="font-medium text-sm">Analyzing your interview...</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          AI is reviewing your body language, speech patterns, and answer content
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Tip */}
                  {!isRecording && !recordingDone && !submitting && cameraReady && (
                    <div className="text-center text-xs text-muted-foreground space-y-1">
                      <p>💡 Look at your camera as if it were the interviewer</p>
                      <p>Speak clearly and take your time — aim for 1-2 minutes</p>
                    </div>
                  )}

                  {/* Back to mode select */}
                  {!isRecording && !recordingDone && !submitting && (
                    <div className="text-center">
                      <button
                        onClick={() => { stopCamera(); setResponseMode('select'); setCameraError(null) }}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                      >
                        ← Back to mode selection
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Text Response Mode (fallback) */}
              {responseMode === 'text' && !submitting && (
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

                  <div className="flex gap-2 mt-3">
                    <Button variant="outline" onClick={() => setResponseMode('select')} className="flex-1">
                      Back
                    </Button>
                    <Button
                      onClick={submitTextResponse}
                      disabled={submitting || responseText.trim().length < 50}
                      className="flex-1"
                    >
                      <Sparkles className="h-4 w-4 mr-1.5" />
                      Get AI Coaching
                    </Button>
                  </div>
                </div>
              )}

              {responseMode === 'text' && submitting && (
                <div className="text-center py-8 space-y-3">
                  <div className="animate-spin rounded-full h-10 w-10 border-3 border-primary border-t-transparent mx-auto" />
                  <p className="font-medium text-sm">Analyzing your response...</p>
                </div>
              )}
            </>
          )}

          {/* ==================== Video Coaching Results ==================== */}
          {practiceQuestion && coaching && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  Interview Analysis
                </DialogTitle>
              </DialogHeader>

              {/* Overall Score */}
              <div className={`mt-4 text-center p-5 rounded-xl border ${scoreBg(coaching.overall_score)}`}>
                <div className={`text-5xl font-bold ${scoreColor(coaching.overall_score)}`}>
                  {coaching.overall_score}/10
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {scoreLabel(coaching.overall_score)} — Overall Interview Score
                </div>
              </div>

              {/* Category Score Bars */}
              <div className="mt-4 p-4 rounded-lg bg-muted/30 space-y-3">
                <ScoreBar score={coaching.content.score} label="Answer Content" icon={Brain} />
                <ScoreBar score={coaching.communication.score} label="Communication" icon={Volume2} />
                <ScoreBar score={coaching.presentation.score} label="Presentation" icon={Eye} />
              </div>

              {/* Expandable Detail Sections */}
              <div className="mt-4 space-y-2">

                {/* Content Analysis */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedSection(expandedSection === 'content' ? null : 'content')}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                  >
                    <span className="flex items-center gap-2 font-medium text-sm">
                      <Brain className="h-4 w-4 text-violet-600" />
                      Answer Content
                      <span className={`text-xs font-bold ${scoreColor(coaching.content.score)}`}>
                        {coaching.content.score}/10
                      </span>
                    </span>
                    {expandedSection === 'content' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedSection === 'content' && (
                    <div className="p-3 pt-0 space-y-3">
                      {coaching.content.strengths.length > 0 && (
                        <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                          <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                          <ul className="space-y-1">
                            {coaching.content.strengths.map((s, i) => (
                              <li key={i} className="text-xs text-green-700">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {coaching.content.improvements.length > 0 && (
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                          <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Improve</h5>
                          <ul className="space-y-1">
                            {coaching.content.improvements.map((s, i) => (
                              <li key={i} className="text-xs text-amber-700">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {coaching.content.specific_tips && coaching.content.specific_tips.length > 0 && (
                        <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                          <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Tips</h5>
                          <ul className="space-y-1">
                            {coaching.content.specific_tips.map((s, i) => (
                              <li key={i} className="text-xs text-blue-700">{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {coaching.content.improved_response && (
                        <div className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                          <h5 className="text-xs font-semibold text-purple-800 mb-1.5">⭐ Example Strong Response</h5>
                          <p className="text-xs text-purple-700 italic leading-relaxed">
                            "{coaching.content.improved_response}"
                          </p>
                        </div>
                      )}
                      {coaching.content.common_mistake && (
                        <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                          <h5 className="text-xs font-semibold text-red-800 mb-1.5">⚠️ Common Mistake</h5>
                          <p className="text-xs text-red-700">{coaching.content.common_mistake}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Communication Analysis */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedSection(expandedSection === 'communication' ? null : 'communication')}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                  >
                    <span className="flex items-center gap-2 font-medium text-sm">
                      <Volume2 className="h-4 w-4 text-sky-600" />
                      Communication & Speech
                      <span className={`text-xs font-bold ${scoreColor(coaching.communication.score)}`}>
                        {coaching.communication.score}/10
                      </span>
                    </span>
                    {expandedSection === 'communication' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedSection === 'communication' && (
                    <div className="p-3 pt-0 space-y-3">
                      {/* Speech metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="p-2 rounded bg-muted/50 text-center">
                          <div className="text-lg font-bold">{coaching.communication.words_per_minute}</div>
                          <div className="text-[10px] text-muted-foreground">Words/min</div>
                        </div>
                        <div className="p-2 rounded bg-muted/50 text-center">
                          <div className="text-lg font-bold">{coaching.communication.word_count}</div>
                          <div className="text-[10px] text-muted-foreground">Total Words</div>
                        </div>
                        <div className="p-2 rounded bg-muted/50 text-center">
                          <div className="text-lg font-bold">{coaching.communication.total_fillers}</div>
                          <div className="text-[10px] text-muted-foreground">Filler Words</div>
                        </div>
                        <div className="p-2 rounded bg-muted/50 text-center">
                          <div className="text-lg font-bold">{formatTime(coaching.communication.duration_seconds)}</div>
                          <div className="text-[10px] text-muted-foreground">Duration</div>
                        </div>
                      </div>

                      {/* Pace feedback */}
                      <div className={`p-3 rounded-lg ${
                        coaching.communication.pace.assessment === 'good' ? 'bg-green-50 border border-green-100' :
                        coaching.communication.pace.assessment.includes('slight') ? 'bg-amber-50 border border-amber-100' :
                        'bg-red-50 border border-red-100'
                      }`}>
                        <h5 className="text-xs font-semibold mb-1">🎙️ Speaking Pace</h5>
                        <p className="text-xs">{coaching.communication.pace.feedback}</p>
                      </div>

                      {/* Filler words breakdown */}
                      {coaching.communication.total_fillers > 0 && (
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                          <h5 className="text-xs font-semibold text-amber-800 mb-1.5">
                            Filler Words ({coaching.communication.filler_rate}% of speech)
                          </h5>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(coaching.communication.filler_words).map(([word, count]) => (
                              <Badge key={word} variant="outline" className="text-[10px] bg-white">
                                "{word}" × {count as number}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tips */}
                      {coaching.communication.tips.length > 0 && (
                        <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                          <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Speech Tips</h5>
                          <ul className="space-y-1">
                            {coaching.communication.tips.map((tip, i) => (
                              <li key={i} className="text-xs text-blue-700">{tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Presentation Analysis */}
                <div className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedSection(expandedSection === 'presentation' ? null : 'presentation')}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                  >
                    <span className="flex items-center gap-2 font-medium text-sm">
                      <Eye className="h-4 w-4 text-emerald-600" />
                      Body Language & Presentation
                      <span className={`text-xs font-bold ${scoreColor(coaching.presentation.score)}`}>
                        {coaching.presentation.score}/10
                      </span>
                    </span>
                    {expandedSection === 'presentation' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedSection === 'presentation' && (
                    <div className="p-3 pt-0 space-y-3">
                      {/* Sub-scores */}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { key: 'eye_contact', label: 'Eye Contact', icon: Eye },
                          { key: 'facial_expressions', label: 'Expressions', icon: User },
                          { key: 'body_language', label: 'Body Language', icon: User },
                          { key: 'professional_appearance', label: 'Appearance', icon: Monitor },
                        ].map(item => {
                          const data = (coaching.presentation as any)[item.key] as CategoryScoreDetail
                          return (
                            <div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-medium text-muted-foreground">{item.label}</span>
                                <span className={`text-sm font-bold ${scoreColor(data.score)}`}>{data.score}/10</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground leading-relaxed">{data.feedback}</p>
                            </div>
                          )
                        })}
                      </div>

                      {/* Summary */}
                      {coaching.presentation.summary && (
                        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                          <h5 className="text-xs font-semibold text-emerald-800 mb-1">📊 Overall Assessment</h5>
                          <p className="text-xs text-emerald-700">{coaching.presentation.summary}</p>
                        </div>
                      )}

                      {/* Timestamped notes */}
                      {coaching.presentation.timestamped_notes && coaching.presentation.timestamped_notes.length > 0 && (
                        <div className="p-3 rounded-lg bg-muted/50">
                          <h5 className="text-xs font-semibold mb-1.5">📝 Moment-by-Moment Notes</h5>
                          <ul className="space-y-1">
                            {coaching.presentation.timestamped_notes.map((note, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                <Badge variant="outline" className="text-[9px] shrink-0 mt-0.5">
                                  Frame {note.frame}
                                </Badge>
                                {note.note}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

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

          {/* ==================== Text Coaching Results (fallback) ==================== */}
          {practiceQuestion && textCoaching && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  AI Coaching Feedback
                </DialogTitle>
              </DialogHeader>

              <div className={`mt-4 text-center p-5 rounded-xl border ${scoreBg(textCoaching.score)}`}>
                <div className={`text-4xl font-bold ${scoreColor(textCoaching.score)}`}>{textCoaching.score}/10</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {textCoaching.score >= 8 ? 'Excellent response!' : textCoaching.score >= 6 ? 'Good effort!' : 'Keep practicing!'}
                </div>
              </div>

              {textCoaching.strengths && textCoaching.strengths.length > 0 && (
                <div className="mt-4 p-4 rounded-lg bg-green-50 border border-green-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-green-800 mb-2">
                    <CheckCircle className="h-4 w-4" /> Strengths
                  </h4>
                  <ul className="space-y-1.5">
                    {textCoaching.strengths.map((s, i) => (
                      <li key={i} className="text-sm text-green-700 flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {textCoaching.improvements && textCoaching.improvements.length > 0 && (
                <div className="mt-3 p-4 rounded-lg bg-amber-50 border border-amber-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-amber-800 mb-2">
                    <TrendingUp className="h-4 w-4" /> Areas for Improvement
                  </h4>
                  <ul className="space-y-1.5">
                    {textCoaching.improvements.map((imp, i) => (
                      <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        {imp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {textCoaching.specific_tips && textCoaching.specific_tips.length > 0 && (
                <div className="mt-3 p-4 rounded-lg bg-blue-50 border border-blue-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-blue-800 mb-2">
                    <Target className="h-4 w-4" /> Specific Tips
                  </h4>
                  <ul className="space-y-1.5">
                    {textCoaching.specific_tips.map((tip, i) => (
                      <li key={i} className="text-sm text-blue-700 flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {textCoaching.improved_response && (
                <div className="mt-3 p-4 rounded-lg bg-purple-50 border border-purple-100">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-purple-800 mb-2">
                    <Sparkles className="h-4 w-4" /> Example Strong Response
                  </h4>
                  <p className="text-sm text-purple-700 italic leading-relaxed">
                    "{textCoaching.improved_response}"
                  </p>
                </div>
              )}

              <div className="mt-3 p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground">
                  💡 Try <strong>video mode</strong> next time for body language, eye contact, and speech analysis!
                </p>
              </div>

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
