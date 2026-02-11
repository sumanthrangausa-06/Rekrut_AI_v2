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
  Timer, User, Monitor, History, FileText, Calendar, Send, Briefcase,
  MessageCircle, Award, StopCircle, Loader2, Plus,
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
    voice_analysis?: {
      voice_confidence: { score: number; feedback: string }
      vocal_variety: { score: number; feedback: string }
      pacing_rhythm: { score: number; feedback: string }
      articulation: { score: number; feedback: string }
      energy: { score: number; feedback: string }
      overall_voice_score: number
      voice_summary: string
      voice_tips: string[]
    }
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

interface HistorySession {
  id: number
  question_id: string
  question: string
  category: string
  response_text: string
  score: number
  coaching_data: VideoCoaching | TextCoaching | any
  response_type: 'video' | 'text' | null
  transcription: string | null
  audio_analysis: any
  video_analysis: any
  duration_seconds: number | null
  created_at: string
}

// Mock Interview Session types
interface MockConversationTurn {
  role: 'interviewer' | 'candidate'
  text: string
  action?: string
  score_hint?: number
  notes?: string
  timestamp: string
}

interface MockSession {
  id: number
  target_role: string
  job_description: string | null
  status: 'in_progress' | 'completed'
  conversation: MockConversationTurn[]
  current_question_index: number
  overall_score: number | null
  overall_feedback: any
  questions_asked: number
  follow_ups_asked: number
  started_at: string
  completed_at: string | null
}

interface MockSessionSummary {
  id: number
  target_role: string
  status: string
  overall_score: number | null
  questions_asked: number
  follow_ups_asked: number
  started_at: string
  completed_at: string | null
  duration_minutes: number
}

interface SessionFeedback {
  overall_score: number
  interview_readiness: string
  summary: string
  strengths: string[]
  improvements: string[]
  question_scores: { question_summary: string; score: number; feedback: string }[]
  star_method_usage: { score: number; feedback: string }
  communication_quality: { score: number; feedback: string }
  technical_depth: { score: number; feedback: string }
  top_tip: string
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
  const [cameraStatus, setCameraStatus] = useState('')
  const [micActive, setMicActive] = useState(false)

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recognitionRef = useRef<any>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioDataRef = useRef<string | null>(null)

  // Feedback detail sections
  const [expandedSection, setExpandedSection] = useState<string | null>('content')

  // Progress state
  const [categoryProgress, setCategoryProgress] = useState<CategoryProgress[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])

  // History state
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')
  const [reviewSession, setReviewSession] = useState<HistorySession | null>(null)
  const [reviewExpanded, setReviewExpanded] = useState<string | null>('content')

  // Mock Interview state
  const [mockTargetRole, setMockTargetRole] = useState('')
  const [mockJobDescription, setMockJobDescription] = useState('')
  const [mockStarting, setMockStarting] = useState(false)
  const [mockSession, setMockSession] = useState<MockSession | null>(null)
  const [mockResponseText, setMockResponseText] = useState('')
  const [mockSending, setMockSending] = useState(false)
  const [mockEnding, setMockEnding] = useState(false)
  const [mockFeedback, setMockFeedback] = useState<SessionFeedback | null>(null)
  const [mockPastSessions, setMockPastSessions] = useState<MockSessionSummary[]>([])
  const [mockShowSetup, setMockShowSetup] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Voice interview state
  const [voiceMode, setVoiceMode] = useState(false)
  const [aiSpeaking, setAiSpeaking] = useState(false)
  const [candidateRecording, setCandidateRecording] = useState(false)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const [silenceTimer, setSilenceTimer] = useState<number>(0)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const aiAudioRef = useRef<HTMLAudioElement | null>(null)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceCountRef = useRef<number>(0)

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

  useEffect(() => {
    async function init() {
      setLoading(true)
      await Promise.all([loadStats(), loadQuestions(), loadProgress()])
      setLoading(false)
    }
    init()
  }, [loadStats, loadQuestions, loadProgress])

  // Load history when switching to history tab
  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab, loadHistory])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
      if (timerRef.current) clearInterval(timerRef.current)
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    }
  }, [])

  // NO deferred useEffect for stream attachment.
  // 13TH FIX: The key prop swap + deferred useEffect was the root cause of black screen.
  // Stream is now attached DIRECTLY in startCamera() — like the original working code.

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
    audioDataRef.current = null
    audioChunksRef.current = []
    setMicActive(false)
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

  // Detect iOS (all browsers on iOS use WebKit)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isChromeIOS = isIOS && /CriOS/.test(navigator.userAgent)
  const isSafari = isIOS && !isChromeIOS && /Safari/.test(navigator.userAgent)

  // Camera management — 13TH FIX (Feb 11 2026)
  //
  // ROOT CAUSE OF BLACK SCREEN (attempts 1-12): The key prop swap
  // (key={cameraReady ? 'cam-active' : 'cam-pending'}) DESTROYED the video
  // DOM element every time cameraReady changed. The deferred useEffect then
  // attached srcObject to a freshly-created element via 100ms setTimeout.
  // play() resolved but the browser never rendered frames to this new element.
  //
  // FIX: Return to the original working pattern from commit 01025bc:
  // 1. No key prop on <video> — element persists across renders
  // 2. Attach srcObject DIRECTLY in startCamera(), call play() immediately
  // 3. Set cameraReady=true AFTER stream is attached (removes overlay)
  // 4. Keep "Enable Camera" button for user gesture requirement

  async function startCamera() {
    try {
      setCameraError(null)
      setCameraReady(false)
      setCameraStatus('Requesting camera...')

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('not_supported')
        setCameraStatus('Camera not supported')
        return
      }

      // Request BOTH video + audio in a SINGLE getUserMedia call.
      // CRITICAL: Two separate calls broke iOS (the second killed the first track).
      // Fall back to video-only if combined call fails (e.g. mic permission denied).
      let videoStream: MediaStream | null = null
      const constraintSets: Array<{ video: MediaStreamConstraints['video'], audio: boolean, label: string }> = [
        { video: { facingMode: 'user' }, audio: true, label: 'av:user' },
        { video: true, audio: true, label: 'av:true' },
        { video: { facingMode: 'user' }, audio: false, label: 'v:user' },
        { video: true, audio: false, label: 'v:true' },
      ]

      for (const { video: vc, audio: ac, label } of constraintSets) {
        try {
          setCameraStatus(`Trying ${label}...`)
          videoStream = await navigator.mediaDevices.getUserMedia({ video: vc, ...(ac ? { audio: true } : {}) })

          const vt = videoStream.getVideoTracks()[0]
          if (!vt || vt.readyState !== 'live') {
            console.warn(`[camera] ${label}: no live video track`)
            videoStream.getTracks().forEach(t => t.stop())
            videoStream = null
            continue
          }

          const settings = vt.getSettings?.() || {}
          const at = videoStream.getAudioTracks()
          console.log(`[camera] ${label}: track=${vt.readyState} ${settings.width}x${settings.height} audio:${at.length}`)
          setCameraStatus(`Got ${label}: ${settings.width || '?'}x${settings.height || '?'} ${at.length > 0 ? '🎙' : ''}`)
          break // Live track — success
        } catch (err: any) {
          console.warn(`[camera] ${label} error: ${err?.name} ${err?.message}`)
          setCameraStatus(`${label}: ${err?.name}`)
          // Only give up if this is a video-only request that was denied
          if (err.name === 'NotAllowedError' && !ac) {
            setCameraError('denied')
            return
          }
          // For combined av requests or other errors, try next constraint
        }
      }

      if (!videoStream) {
        setCameraError('not_found')
        setCameraStatus('Camera not working — tap Retry')
        return
      }

      streamRef.current = videoStream

      // Check for audio tracks (mic)
      const audioTracks = videoStream.getAudioTracks()
      if (audioTracks.length > 0) {
        setMicActive(true)
        console.log(`[camera] mic active: ${audioTracks[0].label}`)
      } else {
        setMicActive(false)
        console.log('[camera] no audio track — mic not available')
      }

      // ATTACH STREAM DIRECTLY — this is what the original working code did.
      // Do NOT defer to useEffect. Do NOT use key prop swap.
      // The video element exists in the DOM (behind the overlay) and can receive the stream.
      const v = videoRef.current
      if (v) {
        v.srcObject = videoStream
        try {
          await v.play()
          console.log(`[camera] play() succeeded, readyState=${v.readyState}, videoWidth=${v.videoWidth}`)
        } catch (e: any) {
          console.warn('[camera] play() failed, retrying:', e?.message)
          // One retry for autoplay policy edge cases
          try { await v.play() } catch (_) {}
        }
      }

      const vt = videoStream.getVideoTracks()[0]
      const at2 = videoStream.getAudioTracks()
      const settings = vt?.getSettings?.() || {}
      setCameraStatus(`OK ${settings.width || '?'}x${settings.height || '?'} ${at2.length > 0 ? '🎙' : ''} ▶`)

      // Set cameraReady AFTER stream is attached — this removes the overlay
      // to reveal the already-playing video
      setCameraReady(true)

      // Monitor track ending (user revokes permission)
      if (vt) {
        vt.addEventListener('ended', () => {
          console.warn('[camera] video track ended')
          setCameraReady(false)
          setCameraError('denied')
          setCameraStatus('Track ended')
        })
      }
    } catch (err: any) {
      console.error('Camera access error:', err?.name, err?.message)
      setCameraStatus(`Error: ${err?.name} ${err?.message}`)

      if (err.name === 'NotAllowedError') {
        setCameraError('denied')
      } else if (err.name === 'NotFoundError') {
        setCameraError('not_found')
      } else {
        setCameraError('unknown')
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
    setCameraStatus('')
    setMicActive(false)
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

    // Start speech recognition (live preview)
    startSpeechRecognition()

    // Record audio via MediaRecorder for server-side voice analysis
    const stream = streamRef.current
    if (stream && stream.getAudioTracks().length > 0 && typeof MediaRecorder !== 'undefined') {
      try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm'
        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 })
        audioChunksRef.current = []
        audioDataRef.current = null

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data)
        }
        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: mimeType })
          const reader = new FileReader()
          reader.onloadend = () => { audioDataRef.current = reader.result as string }
          reader.readAsDataURL(blob)
        }
        recorder.start(1000)
        mediaRecorderRef.current = recorder
        console.log(`[audio] MediaRecorder started: ${mimeType}`)
      } catch (e) {
        console.warn('[audio] MediaRecorder init failed:', e)
      }
    }
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

    // Stop audio recording
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }

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
          audio_data: audioDataRef.current || undefined,
        },
      })

      if (res.success) {
        setCoaching(res.coaching)
        stopCamera()
        loadStats()
        loadQuestions()
        loadProgress()
        loadHistory()
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
        loadHistory()
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

  // ===== MOCK INTERVIEW FUNCTIONS =====
  const loadMockSessions = useCallback(async () => {
    try {
      const res = await apiCall<{ success: boolean; sessions: MockSessionSummary[]; total: number }>('/interviews/mock/sessions?limit=10')
      if (res.success) setMockPastSessions(res.sessions)
    } catch (err) { console.error('Failed to load mock sessions:', err) }
  }, [])

  async function startMockInterview() {
    if (!mockTargetRole.trim()) return
    setMockStarting(true)
    try {
      const res = await apiCall<{ success: boolean; session: MockSession; first_message: MockConversationTurn }>('/interviews/mock/start', {
        method: 'POST',
        body: { target_role: mockTargetRole.trim(), job_description: mockJobDescription.trim() || undefined }
      })
      if (res.success) {
        setMockSession(res.session)
        setMockShowSetup(false)
        setMockFeedback(null)
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
      }
    } catch (err: any) {
      alert(err.message || 'Failed to start interview')
    } finally {
      setMockStarting(false)
    }
  }

  async function sendMockResponse() {
    if (!mockSession || !mockResponseText.trim() || mockSending) return
    const text = mockResponseText.trim()
    setMockResponseText('')
    setMockSending(true)

    // Optimistically add candidate message
    const candidateMsg: MockConversationTurn = { role: 'candidate', text, timestamp: new Date().toISOString() }
    setMockSession(prev => prev ? { ...prev, conversation: [...prev.conversation, candidateMsg] } : null)
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      const res = await apiCall<{
        success: boolean; interviewer_message: MockConversationTurn; action: string; is_wrapping_up: boolean
      }>(`/interviews/mock/${mockSession.id}/respond`, {
        method: 'POST',
        body: { response_text: text }
      })
      if (res.success) {
        setMockSession(prev => prev ? {
          ...prev,
          conversation: [...prev.conversation, res.interviewer_message]
        } : null)
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
        // Play TTS if voice mode is on
        if (voiceMode && res.interviewer_message?.text) {
          playInterviewerAudio(res.interviewer_message.text)
        }
      }
    } catch (err: any) {
      alert(err.message || 'Failed to send response')
    } finally {
      setMockSending(false)
    }
  }

  async function endMockInterview() {
    if (!mockSession) return
    setMockEnding(true)

    // AI says goodbye via voice if in voice mode
    if (voiceMode) {
      try {
        const goodbyeText = `That's all my questions for today. Thank you for taking the time to practice your ${mockSession.target_role} interview. I'll prepare your detailed feedback now.`
        await playInterviewerAudio(goodbyeText)
      } catch (_) {
        // Non-fatal
      }
    }

    try {
      const res = await apiCall<{ success: boolean; feedback: SessionFeedback }>(`/interviews/mock/${mockSession.id}/end`, {
        method: 'POST'
      })
      if (res.success) {
        stopVoiceMode()
        setMockFeedback(res.feedback)
        setMockSession(prev => prev ? { ...prev, status: 'completed' } : null)
        loadMockSessions()
        loadStats()
      }
    } catch (err: any) {
      alert(err.message || 'Failed to end interview')
    } finally {
      setMockEnding(false)
    }
  }

  function resetMockInterview() {
    stopVoiceMode()
    setMockSession(null)
    setMockFeedback(null)
    setMockResponseText('')
    setMockTargetRole('')
    setMockJobDescription('')
    setMockShowSetup(false)
    setVoiceMode(false)
  }

  // ===== VOICE INTERVIEW FUNCTIONS =====

  // Play TTS audio for interviewer text
  async function playInterviewerAudio(text: string) {
    if (!voiceMode || !text) return
    setAiSpeaking(true)
    setVoiceError(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/interviews/mock/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text })
      })

      if (!response.ok) {
        console.error('TTS failed:', response.status)
        setAiSpeaking(false)
        return
      }

      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)

      // Create or reuse audio element
      if (aiAudioRef.current) {
        aiAudioRef.current.pause()
        URL.revokeObjectURL(aiAudioRef.current.src)
      }
      const audio = new Audio(audioUrl)
      aiAudioRef.current = audio

      audio.onended = () => {
        setAiSpeaking(false)
        URL.revokeObjectURL(audioUrl)
        // Auto-start recording after AI finishes speaking
        if (voiceMode && !candidateRecording) {
          startVoiceRecording()
        }
      }
      audio.onerror = () => {
        setAiSpeaking(false)
        URL.revokeObjectURL(audioUrl)
        console.error('Audio playback error')
      }

      await audio.play()
    } catch (err) {
      console.error('TTS playback error:', err)
      setAiSpeaking(false)
    }
  }

  // Start recording candidate's voice
  async function startVoiceRecording() {
    setVoiceError(null)
    try {
      // Get mic access
      if (!voiceStreamRef.current) {
        voiceStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      }

      voiceChunksRef.current = []

      // Set up silence detection using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioContext.createMediaStreamSource(voiceStreamRef.current)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser
      silenceCountRef.current = 0

      // Check for silence every 200ms — auto-stop after 3.5s of silence
      silenceIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        if (avg < 8) {
          silenceCountRef.current++
          setSilenceTimer(Math.round(silenceCountRef.current * 0.2))
          if (silenceCountRef.current >= 18) { // ~3.6 seconds of silence
            stopVoiceRecording()
          }
        } else {
          silenceCountRef.current = 0
          setSilenceTimer(0)
        }
      }, 200)

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm'

      const recorder = new MediaRecorder(voiceStreamRef.current, { mimeType })
      voiceRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        setCandidateRecording(false)
        if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current)
        setSilenceTimer(0)

        if (voiceChunksRef.current.length === 0) return

        setVoiceProcessing(true)
        try {
          const audioBlob = new Blob(voiceChunksRef.current, { type: mimeType })

          // Convert to base64
          const reader = new FileReader()
          const base64Promise = new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string)
          })
          reader.readAsDataURL(audioBlob)
          const audioBase64 = await base64Promise

          const token = localStorage.getItem('token')
          const res = await fetch(`/api/interviews/mock/${mockSession?.id}/voice-respond`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ audio_base64: audioBase64 })
          })

          const data = await res.json()

          if (data.success) {
            // Add candidate message with transcription
            const candidateMsg: MockConversationTurn = {
              role: 'candidate',
              text: data.transcribed_text,
              timestamp: new Date().toISOString()
            }
            setMockSession(prev => prev ? {
              ...prev,
              conversation: [...prev.conversation, candidateMsg, data.interviewer_message]
            } : null)
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)

            // Play AI response audio
            if (data.interviewer_audio_base64) {
              setAiSpeaking(true)
              const audioData = Uint8Array.from(atob(data.interviewer_audio_base64), c => c.charCodeAt(0))
              const blob = new Blob([audioData], { type: 'audio/mpeg' })
              const url = URL.createObjectURL(blob)
              if (aiAudioRef.current) {
                aiAudioRef.current.pause()
                URL.revokeObjectURL(aiAudioRef.current.src)
              }
              const audio = new Audio(url)
              aiAudioRef.current = audio
              audio.onended = () => {
                setAiSpeaking(false)
                URL.revokeObjectURL(url)
                if (voiceMode && !data.is_wrapping_up) startVoiceRecording()
              }
              audio.onerror = () => { setAiSpeaking(false); URL.revokeObjectURL(url) }
              await audio.play()
            } else {
              // No audio — try separate TTS call
              playInterviewerAudio(data.interviewer_message.text)
            }
          } else {
            setVoiceError(data.error || 'Failed to process your response')
          }
        } catch (err: any) {
          setVoiceError(err.message || 'Voice processing failed')
          console.error('Voice response error:', err)
        } finally {
          setVoiceProcessing(false)
        }
      }

      recorder.start(250)
      setCandidateRecording(true)
    } catch (err: any) {
      console.error('Mic access error:', err)
      setVoiceError('Microphone access denied. Please allow microphone access to use voice mode.')
      setCandidateRecording(false)
    }
  }

  function stopVoiceRecording() {
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      voiceRecorderRef.current.stop()
    }
    if (silenceIntervalRef.current) {
      clearInterval(silenceIntervalRef.current)
      silenceIntervalRef.current = null
    }
    setSilenceTimer(0)
    silenceCountRef.current = 0
  }

  function stopVoiceMode() {
    if (aiAudioRef.current) {
      aiAudioRef.current.pause()
      aiAudioRef.current = null
    }
    stopVoiceRecording()
    if (voiceStreamRef.current) {
      voiceStreamRef.current.getTracks().forEach(t => t.stop())
      voiceStreamRef.current = null
    }
    setAiSpeaking(false)
    setCandidateRecording(false)
    setVoiceProcessing(false)
    setSilenceTimer(0)
  }

  // When voice mode is enabled and a new session starts, play the first message
  useEffect(() => {
    if (voiceMode && mockSession && mockSession.status === 'in_progress' && mockSession.conversation.length > 0) {
      const lastMsg = mockSession.conversation[mockSession.conversation.length - 1]
      if (lastMsg.role === 'interviewer' && !aiSpeaking && !candidateRecording && !voiceProcessing) {
        // Only auto-play the opening message when session just started
        if (mockSession.conversation.length === 1) {
          playInterviewerAudio(lastMsg.text)
        }
      }
    }
  }, [voiceMode, mockSession?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup voice on unmount
  useEffect(() => {
    return () => { stopVoiceMode() }
  }, [])

  // Load mock sessions when switching to mock tab
  useEffect(() => {
    if (tab === 'mock') loadMockSessions()
  }, [tab, loadMockSessions])

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
          <TabsTrigger value="mock">
            <Volume2 className="h-4 w-4 mr-1.5" /> Mock Interview
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
          {/* Active interview session */}
          {mockSession && mockSession.status === 'in_progress' && !mockFeedback ? (
            <div className="space-y-4">
              {/* Session header */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-100 text-green-700 border-0">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-1.5" />
                    Live Interview
                  </Badge>
                  <span className="text-sm font-medium">{mockSession.target_role}</span>
                  {voiceMode && (
                    <Badge className="bg-violet-100 text-violet-700 border-0">
                      <Volume2 className="h-3 w-3 mr-1" /> Voice Mode
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Voice mode toggle */}
                  <Button
                    size="sm"
                    variant={voiceMode ? 'default' : 'outline'}
                    onClick={() => {
                      if (voiceMode) {
                        stopVoiceMode()
                        setVoiceMode(false)
                      } else {
                        setVoiceMode(true)
                        // Play the last interviewer message
                        const lastInterviewer = [...mockSession.conversation].reverse().find(t => t.role === 'interviewer')
                        if (lastInterviewer) setTimeout(() => playInterviewerAudio(lastInterviewer.text), 300)
                      }
                    }}
                    className={voiceMode ? 'bg-violet-600 hover:bg-violet-700' : ''}
                  >
                    {voiceMode ? <Volume2 className="h-3.5 w-3.5 mr-1.5" /> : <Mic className="h-3.5 w-3.5 mr-1.5" />}
                    {voiceMode ? 'Voice On' : 'Voice Mode'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { stopVoiceMode(); endMockInterview() }} disabled={mockEnding}
                    className="text-red-600 border-red-200 hover:bg-red-50">
                    {mockEnding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5 mr-1.5" />}
                    End Interview
                  </Button>
                </div>
              </div>

              {/* Progress indicator */}
              {(() => {
                const interviewerTurns = mockSession.conversation.filter(t => t.role === 'interviewer').length
                const candidateTurns = mockSession.conversation.filter(t => t.role === 'candidate').length
                const totalQuestions = mockSession.questions_asked || interviewerTurns
                const estTotal = 8 // typical number of questions
                const progress = Math.min(100, Math.round((candidateTurns / estTotal) * 100))
                return (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      Q{candidateTurns} of ~{estTotal}
                    </span>
                  </div>
                )
              })()}

              {/* Voice status bar */}
              {voiceMode && (
                <div className={`flex items-center justify-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  aiSpeaking ? 'bg-violet-50 border-violet-200' :
                  candidateRecording ? 'bg-green-50 border-green-200' :
                  voiceProcessing ? 'bg-amber-50 border-amber-200' :
                  'bg-muted/30 border-muted'
                }`}>
                  {aiSpeaking ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-end gap-0.5 h-5">
                          <div className="w-1 bg-violet-500 rounded-full animate-pulse" style={{height: '60%', animationDelay: '0ms'}} />
                          <div className="w-1 bg-violet-500 rounded-full animate-pulse" style={{height: '100%', animationDelay: '150ms'}} />
                          <div className="w-1 bg-violet-500 rounded-full animate-pulse" style={{height: '40%', animationDelay: '300ms'}} />
                          <div className="w-1 bg-violet-500 rounded-full animate-pulse" style={{height: '80%', animationDelay: '100ms'}} />
                          <div className="w-1 bg-violet-500 rounded-full animate-pulse" style={{height: '50%', animationDelay: '250ms'}} />
                        </div>
                        <span className="text-sm font-medium text-violet-700">AI Interviewer is speaking...</span>
                      </div>
                    </>
                  ) : candidateRecording ? (
                    <>
                      <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-sm font-medium text-green-700">Recording your answer...</span>
                      {silenceTimer > 0 && (
                        <span className="text-xs text-muted-foreground">
                          (auto-stop in {Math.max(0, Math.round(3.6 - silenceTimer))}s of silence)
                        </span>
                      )}
                      <Button size="sm" variant="outline" onClick={stopVoiceRecording}
                        className="ml-2 text-xs h-7">
                        <Square className="h-3 w-3 mr-1" /> Done
                      </Button>
                    </>
                  ) : voiceProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                      <span className="text-sm font-medium text-amber-700">Processing your response...</span>
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Voice mode active — waiting</span>
                    </>
                  )}
                </div>
              )}

              {voiceError && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {voiceError}
                  <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs" onClick={() => setVoiceError(null)}>Dismiss</Button>
                </div>
              )}

              {/* Chat window */}
              <Card className="border-2">
                <CardContent className="p-0">
                  <div className="h-[50vh] overflow-y-auto p-4 space-y-4">
                    {mockSession.conversation.map((turn, i) => (
                      <div key={i} className={`flex ${turn.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          turn.role === 'interviewer'
                            ? 'bg-primary/5 border border-primary/10 text-foreground'
                            : 'bg-primary text-primary-foreground'
                        }`}>
                          {turn.role === 'interviewer' && (
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
                                <Brain className="h-3 w-3 text-primary" />
                              </div>
                              <span className="text-[10px] font-medium text-primary">AI Interviewer</span>
                              {voiceMode && i === mockSession.conversation.length - 1 && turn.role === 'interviewer' && !aiSpeaking && (
                                <button
                                  onClick={() => playInterviewerAudio(turn.text)}
                                  className="ml-1 p-0.5 rounded hover:bg-primary/10 transition-colors"
                                  title="Replay audio"
                                >
                                  <Volume2 className="h-3 w-3 text-primary/50 hover:text-primary" />
                                </button>
                              )}
                            </div>
                          )}
                          {turn.role === 'candidate' && (
                            <div className="flex items-center gap-1.5 mb-1.5 justify-end">
                              <span className="text-[10px] font-medium opacity-70">You</span>
                              {voiceMode && <Mic className="h-2.5 w-2.5 opacity-50" />}
                            </div>
                          )}
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{turn.text}</p>
                        </div>
                      </div>
                    ))}
                    {(mockSending || voiceProcessing) && (
                      <div className="flex justify-start">
                        <div className="bg-primary/5 border border-primary/10 rounded-2xl px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <span className="text-xs text-muted-foreground">
                              {voiceProcessing ? 'Transcribing & generating response...' : 'AI is thinking...'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input area */}
                  <div className="border-t p-3">
                    {voiceMode ? (
                      <div className="text-center space-y-2">
                        {!candidateRecording && !aiSpeaking && !voiceProcessing ? (
                          <div className="flex items-center justify-center gap-3">
                            <Button
                              onClick={startVoiceRecording}
                              size="lg"
                              className="bg-green-600 hover:bg-green-700 gap-2"
                            >
                              <Mic className="h-5 w-5" /> Start Speaking
                            </Button>
                            <span className="text-xs text-muted-foreground">or type below</span>
                          </div>
                        ) : null}
                        {/* Also show text input as fallback in voice mode */}
                        <div className="flex gap-2">
                          <Textarea
                            value={mockResponseText}
                            onChange={e => setMockResponseText(e.target.value)}
                            placeholder="Or type your answer here..."
                            rows={1}
                            className="resize-none text-sm"
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                sendMockResponse()
                              }
                            }}
                          />
                          <Button
                            onClick={sendMockResponse}
                            disabled={mockSending || mockResponseText.trim().length < 10}
                            className="shrink-0 self-end"
                            size="sm"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Textarea
                            value={mockResponseText}
                            onChange={e => setMockResponseText(e.target.value)}
                            placeholder="Type your answer... (be detailed, use the STAR method for behavioral questions)"
                            rows={2}
                            className="resize-none text-sm"
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                sendMockResponse()
                              }
                            }}
                          />
                          <Button
                            onClick={sendMockResponse}
                            disabled={mockSending || mockResponseText.trim().length < 10}
                            className="shrink-0 self-end"
                            size="sm"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          Press Enter to send · Shift+Enter for new line · Min 10 characters · Try <button className="text-primary underline" onClick={() => setVoiceMode(true)}>Voice Mode</button> for a real interview experience
                        </p>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : mockFeedback ? (
            /* Session feedback display */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  Interview Complete — {mockSession?.target_role}
                </h3>
                <Button size="sm" variant="outline" onClick={resetMockInterview}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> New Interview
                </Button>
              </div>

              {/* Overall score */}
              <div className={`text-center p-6 rounded-xl border-2 ${scoreBg(mockFeedback.overall_score)}`}>
                <div className={`text-5xl font-bold ${scoreColor(mockFeedback.overall_score)}`}>
                  {mockFeedback.overall_score}/10
                </div>
                <div className="text-sm text-muted-foreground mt-1">{scoreLabel(mockFeedback.overall_score)}</div>
                <Badge className={`mt-2 ${
                  mockFeedback.interview_readiness === 'ready' ? 'bg-green-100 text-green-700' :
                  mockFeedback.interview_readiness === 'almost_ready' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                } border-0`}>
                  {mockFeedback.interview_readiness === 'ready' ? 'Interview Ready' :
                   mockFeedback.interview_readiness === 'almost_ready' ? 'Almost Ready' : 'Needs Work'}
                </Badge>
              </div>

              {/* Summary */}
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm leading-relaxed">{mockFeedback.summary}</p>
                </CardContent>
              </Card>

              {/* Skill breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {mockFeedback.star_method_usage && (
                  <Card><CardContent className="p-3 text-center">
                    <div className={`text-2xl font-bold ${scoreColor(mockFeedback.star_method_usage.score)}`}>
                      {mockFeedback.star_method_usage.score}/10
                    </div>
                    <div className="text-xs font-medium mt-1">STAR Method</div>
                    <p className="text-[10px] text-muted-foreground mt-1">{mockFeedback.star_method_usage.feedback}</p>
                  </CardContent></Card>
                )}
                {mockFeedback.communication_quality && (
                  <Card><CardContent className="p-3 text-center">
                    <div className={`text-2xl font-bold ${scoreColor(mockFeedback.communication_quality.score)}`}>
                      {mockFeedback.communication_quality.score}/10
                    </div>
                    <div className="text-xs font-medium mt-1">Communication</div>
                    <p className="text-[10px] text-muted-foreground mt-1">{mockFeedback.communication_quality.feedback}</p>
                  </CardContent></Card>
                )}
                {mockFeedback.technical_depth && (
                  <Card><CardContent className="p-3 text-center">
                    <div className={`text-2xl font-bold ${scoreColor(mockFeedback.technical_depth.score)}`}>
                      {mockFeedback.technical_depth.score}/10
                    </div>
                    <div className="text-xs font-medium mt-1">Technical Depth</div>
                    <p className="text-[10px] text-muted-foreground mt-1">{mockFeedback.technical_depth.feedback}</p>
                  </CardContent></Card>
                )}
              </div>

              {/* Strengths & Improvements */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {mockFeedback.strengths?.length > 0 && (
                  <div className="p-4 rounded-lg bg-green-50 border border-green-100">
                    <h4 className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4" /> Strengths
                    </h4>
                    <ul className="space-y-1.5">
                      {mockFeedback.strengths.map((s, i) => (
                        <li key={i} className="text-xs text-green-700 flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {mockFeedback.improvements?.length > 0 && (
                  <div className="p-4 rounded-lg bg-amber-50 border border-amber-100">
                    <h4 className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                      <TrendingUp className="h-4 w-4" /> To Improve
                    </h4>
                    <ul className="space-y-1.5">
                      {mockFeedback.improvements.map((s, i) => (
                        <li key={i} className="text-xs text-amber-700 flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Question-by-question scores */}
              {mockFeedback.question_scores?.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <h4 className="text-sm font-semibold mb-3">Question-by-Question Scores</h4>
                    <div className="space-y-2">
                      {mockFeedback.question_scores.map((qs, i) => (
                        <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-muted/30">
                          <div className={`text-sm font-bold shrink-0 w-10 text-center ${scoreColor(qs.score)}`}>
                            {qs.score}/10
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">{qs.question_summary}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{qs.feedback}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Top tip */}
              {mockFeedback.top_tip && (
                <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-1">
                    <Sparkles className="h-4 w-4 text-primary" /> #1 Tip to Improve
                  </h4>
                  <p className="text-sm text-muted-foreground">{mockFeedback.top_tip}</p>
                </div>
              )}

              {/* Full transcript */}
              {mockSession && mockSession.conversation && mockSession.conversation.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-muted-foreground" /> Full Transcript
                    </h4>
                    <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                      {mockSession.conversation.map((turn, i) => (
                        <div key={i} className={`flex gap-3 ${turn.role === 'interviewer' ? '' : 'flex-row-reverse'}`}>
                          <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                            turn.role === 'interviewer' ? 'bg-primary/10' : 'bg-green-100'
                          }`}>
                            {turn.role === 'interviewer'
                              ? <Brain className="h-3.5 w-3.5 text-primary" />
                              : <User className="h-3.5 w-3.5 text-green-600" />
                            }
                          </div>
                          <div className={`flex-1 ${turn.role === 'interviewer' ? '' : 'text-right'}`}>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">
                              {turn.role === 'interviewer' ? 'AI Interviewer' : 'You'}
                            </p>
                            <p className="text-xs leading-relaxed whitespace-pre-wrap">{turn.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            /* Setup / Landing */
            <div className="space-y-6">
              {/* Hero CTA */}
              {!mockShowSetup && (
                <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
                  <CardContent className="p-6 text-center">
                    <div className="inline-flex p-4 rounded-2xl bg-primary/10 mb-4">
                      <Volume2 className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-bold mb-2">AI Voice Interview</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                      Your AI interviewer <strong>speaks out loud</strong> — just like a real video call. Answer with your voice or by typing. The AI asks follow-ups, challenges weak answers, and adapts in real-time.
                    </p>
                    <div className="flex items-center justify-center gap-3 mb-3">
                      <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-3 py-1.5 rounded-full">
                        <Volume2 className="h-3.5 w-3.5" /> AI speaks questions
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
                        <Mic className="h-3.5 w-3.5" /> Answer by voice
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-sky-600 bg-sky-50 px-3 py-1.5 rounded-full">
                        <Brain className="h-3.5 w-3.5" /> AI adapts in real-time
                      </div>
                    </div>
                    <Button onClick={() => setMockShowSetup(true)} size="lg">
                      <Briefcase className="h-4 w-4 mr-2" /> Start Mock Interview
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Setup form */}
              {mockShowSetup && (
                <Card className="border-2 border-primary/20">
                  <CardContent className="p-6 space-y-4">
                    <div>
                      <h3 className="font-semibold flex items-center gap-2 mb-1">
                        <Briefcase className="h-4 w-4 text-primary" /> Set Up Your Interview
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Questions are generated specifically for your target role. The more context you give, the more realistic the interview.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Target Role *</label>
                      <input
                        type="text"
                        value={mockTargetRole}
                        onChange={e => setMockTargetRole(e.target.value)}
                        placeholder='e.g. "Senior Software Engineer", "Product Manager", "Data Scientist"'
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Job Description <span className="text-xs text-muted-foreground">(optional but recommended)</span></label>
                      <Textarea
                        value={mockJobDescription}
                        onChange={e => setMockJobDescription(e.target.value)}
                        placeholder="Paste the job description here for highly targeted questions..."
                        rows={4}
                        className="resize-y text-sm"
                      />
                    </div>

                    {/* Voice mode option */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-100">
                      <button
                        onClick={() => setVoiceMode(!voiceMode)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${voiceMode ? 'bg-violet-600' : 'bg-gray-300'}`}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${voiceMode ? 'translate-x-5' : ''}`} />
                      </button>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-violet-900">🎙️ Voice Mode {voiceMode ? '(On)' : '(Off)'}</p>
                        <p className="text-xs text-violet-600">AI speaks questions out loud. Answer by talking — like a real interview.</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setMockShowSetup(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button
                        onClick={startMockInterview}
                        disabled={mockStarting || mockTargetRole.trim().length < 2}
                        className={`flex-1 ${voiceMode ? 'bg-violet-600 hover:bg-violet-700' : ''}`}
                      >
                        {mockStarting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Generating questions...
                          </>
                        ) : (
                          <>
                            {voiceMode ? <Volume2 className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                            {voiceMode ? 'Start Voice Interview' : 'Start Interview'}
                          </>
                        )}
                      </Button>
                    </div>

                    {mockStarting && (
                      <p className="text-xs text-center text-muted-foreground animate-pulse">
                        AI is creating personalized questions for your {mockTargetRole} interview — this takes 10-20 seconds...
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Past mock interview sessions */}
              {mockPastSessions.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" /> Past Mock Interviews
                  </h3>
                  <div className="space-y-2">
                    {mockPastSessions.map(s => (
                      <Card key={s.id} className="hover:border-primary/30 transition-colors">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {s.overall_score ? (
                                <div className={`h-10 w-10 rounded-lg flex items-center justify-center border ${scoreBg(s.overall_score)}`}>
                                  <span className={`font-bold ${scoreColor(s.overall_score)}`}>{s.overall_score}</span>
                                </div>
                              ) : (
                                <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-muted">
                                  <span className="text-xs text-muted-foreground">—</span>
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-medium">{s.target_role}</p>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                  <span>{s.questions_asked} questions</span>
                                  <span>·</span>
                                  <span>{s.follow_ups_asked} follow-ups</span>
                                  <span>·</span>
                                  <span>{Math.round(s.duration_minutes)} min</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <Badge variant={s.status === 'completed' ? 'secondary' : 'outline'} className="text-[10px]">
                                {s.status === 'completed' ? 'Completed' : 'In Progress'}
                              </Badge>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {new Date(s.started_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

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

        {/* History Tab */}
        <TabsContent value="history">
          <div className="space-y-4">
            {/* Filter bar */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Filter:</span>
              {['all', 'behavioral', 'technical', 'situational'].map(cat => (
                <button
                  key={cat}
                  onClick={() => { setHistoryFilter(cat); loadHistory(cat) }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    historyFilter === cat
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted-foreground/10 text-muted-foreground'
                  }`}
                >
                  {cat === 'all' ? 'All' : categoryConfig[cat]?.label || cat}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">{historyTotal} session{historyTotal !== 1 ? 's' : ''}</span>
            </div>

            {historyLoading ? (
              <div className="text-center py-12 text-muted-foreground text-sm">Loading sessions...</div>
            ) : historySessions.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No coaching sessions yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">Complete a mock interview to see your history here.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {historySessions.map(session => {
                  const catCfg = categoryConfig[session.category] || categoryConfig.behavioral
                  const CatIcon = catCfg.icon
                  const isVideo = session.response_type === 'video'
                  const cd = session.coaching_data
                  return (
                    <Card
                      key={session.id}
                      className="cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
                      onClick={() => { setReviewSession(session); setReviewExpanded('content') }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Score */}
                          <div className={`flex items-center justify-center h-12 w-12 rounded-xl border-2 shrink-0 ${scoreBg(session.score)}`}>
                            <span className={`text-lg font-bold ${scoreColor(session.score)}`}>{session.score}</span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-snug line-clamp-2">{session.question}</p>
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <Badge variant="secondary" className={`${catCfg.bg} ${catCfg.color} text-xs border-0`}>
                                <CatIcon className="h-3 w-3 mr-1" /> {catCfg.label}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {isVideo ? <><Video className="h-3 w-3 mr-1" /> Video</> : <><FileText className="h-3 w-3 mr-1" /> Text</>}
                              </Badge>
                              {isVideo && cd?.content && (
                                <span className="text-[10px] text-muted-foreground">
                                  Content {cd.content.score}/10 · Comm {cd.communication?.score || '?'}/10 · Pres {cd.presentation?.score || '?'}/10
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Date + arrow */}
                          <div className="text-right shrink-0">
                            <p className="text-xs text-muted-foreground">
                              {new Date(session.created_at).toLocaleDateString()}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <ArrowRight className="h-4 w-4 text-muted-foreground/50 mt-2 ml-auto" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ==================== Session Review Dialog ==================== */}
      <Dialog open={!!reviewSession} onClose={() => setReviewSession(null)} className="max-w-2xl">
        <div className="max-h-[85vh] overflow-y-auto">
          {reviewSession && (() => {
            const cd = reviewSession.coaching_data
            const isVideo = reviewSession.response_type === 'video' && cd?.content && cd?.communication && cd?.presentation
            const catCfg = categoryConfig[reviewSession.category] || categoryConfig.behavioral

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <History className="h-5 w-5 text-primary" />
                    Session Review
                  </DialogTitle>
                </DialogHeader>

                {/* Question */}
                <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant="secondary" className={`${catCfg.bg} ${catCfg.color} text-xs border-0`}>
                      {catCfg.label}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {reviewSession.response_type === 'video' ? 'Video' : 'Text'}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      <Calendar className="h-3 w-3 inline mr-1" />
                      {new Date(reviewSession.created_at).toLocaleDateString()} at {new Date(reviewSession.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{reviewSession.question}</p>
                </div>

                {/* Overall Score */}
                <div className={`mt-3 text-center p-4 rounded-xl border ${scoreBg(reviewSession.score)}`}>
                  <div className={`text-4xl font-bold ${scoreColor(reviewSession.score)}`}>
                    {reviewSession.score}/10
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {scoreLabel(reviewSession.score)} — Overall Score
                  </div>
                </div>

                {/* Video coaching: show full breakdown */}
                {isVideo && (
                  <>
                    <div className="mt-3 p-3 rounded-lg bg-muted/30 space-y-2.5">
                      <ScoreBar score={cd.content.score} label="Answer Content" icon={Brain} />
                      <ScoreBar score={cd.communication.score} label="Communication" icon={Volume2} />
                      <ScoreBar score={cd.presentation.score} label="Presentation" icon={Eye} />
                    </div>

                    <div className="mt-3 space-y-2">
                      {/* Content section */}
                      <div className="border rounded-lg overflow-hidden">
                        <button onClick={() => setReviewExpanded(reviewExpanded === 'content' ? null : 'content')}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <Brain className="h-4 w-4 text-violet-600" /> Answer Content
                            <span className={`text-xs font-bold ${scoreColor(cd.content.score)}`}>{cd.content.score}/10</span>
                          </span>
                          {reviewExpanded === 'content' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {reviewExpanded === 'content' && (
                          <div className="p-3 pt-0 space-y-2.5">
                            {cd.content.strengths?.length > 0 && (
                              <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                                <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                                <ul className="space-y-1">{cd.content.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-green-700">{s}</li>)}</ul>
                              </div>
                            )}
                            {cd.content.improvements?.length > 0 && (
                              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                                <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Improve</h5>
                                <ul className="space-y-1">{cd.content.improvements.map((s: string, i: number) => <li key={i} className="text-xs text-amber-700">{s}</li>)}</ul>
                              </div>
                            )}
                            {cd.content.specific_tips?.length > 0 && (
                              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                                <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Tips</h5>
                                <ul className="space-y-1">{cd.content.specific_tips.map((s: string, i: number) => <li key={i} className="text-xs text-blue-700">{s}</li>)}</ul>
                              </div>
                            )}
                            {cd.content.improved_response && (
                              <div className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                                <h5 className="text-xs font-semibold text-purple-800 mb-1.5">⭐ Example Strong Response</h5>
                                <p className="text-xs text-purple-700 italic leading-relaxed">"{cd.content.improved_response}"</p>
                              </div>
                            )}
                            {cd.content.common_mistake && (
                              <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                                <h5 className="text-xs font-semibold text-red-800 mb-1.5">⚠️ Common Mistake</h5>
                                <p className="text-xs text-red-700">{cd.content.common_mistake}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Communication section */}
                      <div className="border rounded-lg overflow-hidden">
                        <button onClick={() => setReviewExpanded(reviewExpanded === 'communication' ? null : 'communication')}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <Volume2 className="h-4 w-4 text-sky-600" /> Communication & Speech
                            <span className={`text-xs font-bold ${scoreColor(cd.communication.score)}`}>{cd.communication.score}/10</span>
                          </span>
                          {reviewExpanded === 'communication' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {reviewExpanded === 'communication' && (
                          <div className="p-3 pt-0 space-y-2.5">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{cd.communication.words_per_minute}</div>
                                <div className="text-[10px] text-muted-foreground">Words/min</div>
                              </div>
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{cd.communication.word_count}</div>
                                <div className="text-[10px] text-muted-foreground">Total Words</div>
                              </div>
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{cd.communication.total_fillers}</div>
                                <div className="text-[10px] text-muted-foreground">Filler Words</div>
                              </div>
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <div className="text-lg font-bold">{Math.round(cd.communication.duration_seconds / 60)}:{String(cd.communication.duration_seconds % 60).padStart(2, '0')}</div>
                                <div className="text-[10px] text-muted-foreground">Duration</div>
                              </div>
                            </div>
                            {cd.communication.pace && (
                              <div className={`p-3 rounded-lg ${
                                cd.communication.pace.assessment === 'good' ? 'bg-green-50 border border-green-100' :
                                cd.communication.pace.assessment?.includes('slight') ? 'bg-amber-50 border border-amber-100' :
                                'bg-red-50 border border-red-100'
                              }`}>
                                <h5 className="text-xs font-semibold mb-1">🎙️ Speaking Pace</h5>
                                <p className="text-xs">{cd.communication.pace.feedback}</p>
                              </div>
                            )}
                            {cd.communication.tips?.length > 0 && (
                              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                                <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Speech Tips</h5>
                                <ul className="space-y-1">{cd.communication.tips.map((t: string, i: number) => <li key={i} className="text-xs text-blue-700">{t}</li>)}</ul>
                              </div>
                            )}
                            {cd.communication.voice_analysis && (
                              <div className="space-y-2 pt-1">
                                <h5 className="text-xs font-semibold flex items-center gap-1.5">
                                  <Mic className="h-3.5 w-3.5 text-indigo-600" /> Voice & Tone Analysis
                                </h5>
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { key: 'voice_confidence', label: 'Confidence', icon: Star },
                                    { key: 'vocal_variety', label: 'Vocal Variety', icon: Volume2 },
                                    { key: 'energy', label: 'Energy', icon: Zap },
                                    { key: 'articulation', label: 'Articulation', icon: MessageSquare },
                                  ].map(item => {
                                    const data = cd.communication.voice_analysis?.[item.key]
                                    if (!data) return null
                                    const ItemIcon = item.icon
                                    return (
                                      <div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                            <ItemIcon className="h-3 w-3" /> {item.label}
                                          </span>
                                          <span className={`text-sm font-bold ${scoreColor(data.score)}`}>{data.score}/10</span>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground leading-relaxed">{data.feedback}</p>
                                      </div>
                                    )
                                  })}
                                </div>
                                {cd.communication.voice_analysis.voice_summary && (
                                  <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                                    <p className="text-xs text-indigo-700">{cd.communication.voice_analysis.voice_summary}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Presentation section */}
                      <div className="border rounded-lg overflow-hidden">
                        <button onClick={() => setReviewExpanded(reviewExpanded === 'presentation' ? null : 'presentation')}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                          <span className="flex items-center gap-2 font-medium text-sm">
                            <Eye className="h-4 w-4 text-emerald-600" /> Body Language & Presentation
                            <span className={`text-xs font-bold ${scoreColor(cd.presentation.score)}`}>{cd.presentation.score}/10</span>
                          </span>
                          {reviewExpanded === 'presentation' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {reviewExpanded === 'presentation' && (
                          <div className="p-3 pt-0 space-y-2.5">
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { key: 'eye_contact', label: 'Eye Contact' },
                                { key: 'facial_expressions', label: 'Expressions' },
                                { key: 'body_language', label: 'Body Language' },
                                { key: 'professional_appearance', label: 'Appearance' },
                              ].map(item => {
                                const data = cd.presentation?.[item.key]
                                if (!data) return null
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
                            {cd.presentation.summary && (
                              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                                <h5 className="text-xs font-semibold text-emerald-800 mb-1">📊 Overall Assessment</h5>
                                <p className="text-xs text-emerald-700">{cd.presentation.summary}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Text coaching: show simplified feedback */}
                {!isVideo && cd && (
                  <div className="mt-3 space-y-2.5">
                    {cd.strengths?.length > 0 && (
                      <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                        <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                        <ul className="space-y-1">{cd.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-green-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {cd.improvements?.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                        <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Areas for Improvement</h5>
                        <ul className="space-y-1">{cd.improvements.map((s: string, i: number) => <li key={i} className="text-xs text-amber-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {cd.specific_tips?.length > 0 && (
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Tips</h5>
                        <ul className="space-y-1">{cd.specific_tips.map((s: string, i: number) => <li key={i} className="text-xs text-blue-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {cd.improved_response && (
                      <div className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                        <h5 className="text-xs font-semibold text-purple-800 mb-1.5">⭐ Example Strong Response</h5>
                        <p className="text-xs text-purple-700 italic leading-relaxed">"{cd.improved_response}"</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" onClick={() => setReviewSession(null)} className="flex-1">Close</Button>
                </div>
              </>
            )
          })()}
        </div>
      </Dialog>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ==================== Practice Dialog ==================== */}
      {/* 11TH FIX (Feb 10 2026): WebKit bug #98538 — overflow:hidden + border-radius on parent
          containers kills video rendering on iOS. Fix: isolation:isolate creates a new stacking
          context, and inline overflow:visible guarantees override of base overflow-y-auto. */}
      {/* overflow-visible hack is ONLY for live video recording (iOS WebKit camera fix).
           Once coaching results are shown, restore normal scroll so feedback is scrollable. */}
      <Dialog open={!!practiceQuestion} onClose={closePractice}
        className={`max-w-2xl ${responseMode === 'video' && !cameraError && !coaching ? 'overflow-visible isolate max-h-none' : ''}`}
        style={responseMode === 'video' && !cameraError && !coaching ? { overflow: 'visible', isolation: 'isolate' } : undefined}>
        <div className={responseMode === 'video' && !cameraError && !coaching ? '' : 'max-h-[85vh] overflow-y-auto'}>
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
                  {/* Camera Preview — only show when no error blocking everything */}
                  {!cameraError && (
                    <div className="relative bg-black aspect-video rounded-xl isolate overflow-hidden">
                      {/* 13TH FIX: NO key prop. The key swap was destroying the video
                          element on every cameraReady change, causing black screen.
                          Stream is attached DIRECTLY in startCamera(). */}
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        // @ts-ignore — webkit-playsinline is a non-standard attribute
                        webkit-playsinline=""
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ transform: 'scaleX(-1)' }}
                      />

                      {/* DOM-based debug status — ALWAYS visible (not hidden by overlays).
                          This is critical for debugging — canvas-drawn text was invisible
                          under the !cameraReady overlay in all previous attempts. */}
                      {cameraStatus && (
                        <div className="absolute bottom-2 left-2 z-30 bg-black/80 text-green-400 text-[10px] px-2 py-0.5 rounded font-mono pointer-events-none">
                          {cameraStatus}
                        </div>
                      )}

                      {/* Enable Camera prompt — shown before camera is started.
                          getUserMedia MUST be called from a direct user gesture. */}
                      {!cameraReady && (
                        <div className="absolute inset-0 z-10 bg-black/90 flex items-center justify-center p-4">
                          <div className="text-center text-white max-w-xs">
                            <div className="p-4 rounded-full bg-white/10 inline-flex mb-3">
                              <Camera className="h-8 w-8 text-white" />
                            </div>
                            <p className="font-medium mb-1">Camera & Microphone</p>
                            {isIOS ? (
                              <div className="text-xs text-white/70 mb-4 space-y-2">
                                <p>Your browser will ask for camera access.</p>
                                <p className="text-white/50">
                                  If no prompt appears, check <strong className="text-white/80">iPhone Settings → {isChromeIOS ? 'Chrome' : 'Safari'} → Camera</strong> is on.
                                </p>
                              </div>
                            ) : (
                              <p className="text-xs text-white/70 mb-4">
                                Your browser will ask for permission. Tap <strong className="text-white/80">"Allow"</strong> when prompted.
                              </p>
                            )}
                            <Button
                              onClick={() => startCamera()}
                              className="bg-white text-black hover:bg-white/90"
                            >
                              <Camera className="h-4 w-4 mr-2" />
                              Enable Camera & Mic
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Countdown overlay */}
                      {countdown !== null && (
                        <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center">
                          <div className="text-7xl font-bold text-white animate-pulse">{countdown}</div>
                        </div>
                      )}

                      {/* Recording indicator */}
                      {isRecording && (
                        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full text-sm font-medium">
                          <div className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                          REC {formatTime(recordingTime)}
                        </div>
                      )}

                      {/* Frame count + mic status */}
                      {isRecording && (
                        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5 items-end">
                          <div className="bg-black/60 text-white px-2 py-1 rounded text-xs">
                            {capturedFrames.length} frames
                          </div>
                          <div className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${micActive ? 'bg-black/60 text-green-400' : 'bg-red-900/60 text-red-300'}`}>
                            {micActive ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
                            {micActive ? 'Mic on' : 'No mic'}
                          </div>
                        </div>
                      )}

                      {/* Transcription status */}
                      {isRecording && (
                        <div className="absolute bottom-3 left-3 right-3 z-10">
                          <div className="bg-black/70 rounded-lg p-2 text-white text-xs max-h-16 overflow-y-auto">
                            {isTranscribing && <Mic className="h-3 w-3 inline mr-1 text-green-400" />}
                            {transcription || 'Listening...'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ===== CAMERA ERROR — full replacement panel ===== */}
                  {cameraError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-full bg-red-100 shrink-0">
                          <VideoOff className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-red-900">
                            {cameraError === 'denied'
                              ? (isIOS ? 'Camera Access Required' : 'Camera Permission Blocked')
                              : cameraError === 'not_found' ? 'Camera Not Working'
                              : cameraError === 'in_use' ? 'Camera In Use'
                              : cameraError === 'not_supported' ? 'Camera Not Supported'
                              : 'Camera Unavailable'}
                          </h4>
                          <p className="text-xs text-red-700 mt-1">
                            {cameraError === 'denied'
                              ? (isIOS
                                  ? `Camera access needs to be enabled in your iPhone Settings for ${isChromeIOS ? 'Chrome' : 'Safari'}.`
                                  : 'Your browser blocked camera access for this site.')
                              : cameraError === 'not_found'
                              ? (isIOS
                                  ? `Camera couldn't start. Try: close ${isChromeIOS ? 'Chrome' : 'Safari'} completely (swipe up from app switcher), reopen, and try again.`
                                  : 'Camera was detected but not delivering video. Try closing and reopening your browser.')
                              : cameraError === 'in_use'
                              ? 'Another app is currently using your camera.'
                              : cameraError === 'not_supported'
                              ? 'Your browser does not support camera access. Try Safari or Chrome.'
                              : 'Something went wrong accessing your camera.'}
                          </p>
                        </div>
                      </div>

                      {/* iOS-specific instructions for camera not working */}
                      {cameraError === 'not_found' && isIOS && (
                        <div className="bg-white rounded-lg p-4 border border-red-100 space-y-3">
                          <p className="text-xs font-semibold text-gray-900">Steps to fix:</p>
                          <ol className="text-xs text-gray-700 space-y-2 list-none">
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">1.</span>
                              <span>Open <strong>Settings</strong> → <strong>{isChromeIOS ? 'Chrome' : 'Safari'}</strong> → ensure <strong>Camera</strong> is <strong className="text-green-700">ON</strong></span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">2.</span>
                              <span>Close {isChromeIOS ? 'Chrome' : 'Safari'} completely (swipe up in app switcher)</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">3.</span>
                              <span>Reopen {isChromeIOS ? 'Chrome' : 'Safari'} and navigate back to this page</span>
                            </li>
                          </ol>
                        </div>
                      )}

                      {/* iOS-specific instructions */}
                      {cameraError === 'denied' && isIOS && (
                        <div className="bg-white rounded-lg p-4 border border-red-100 space-y-3">
                          <p className="text-xs font-semibold text-gray-900">
                            Enable camera for {isChromeIOS ? 'Chrome' : 'Safari'}:
                          </p>
                          <ol className="text-xs text-gray-700 space-y-2 list-none">
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">1.</span>
                              <span>Open your iPhone <strong>Settings</strong> app</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">2.</span>
                              <span>Scroll down and tap <strong>{isChromeIOS ? 'Chrome' : 'Safari'}</strong></span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">3.</span>
                              <span>
                                {isChromeIOS
                                  ? <>Make sure <strong>Camera</strong> and <strong>Microphone</strong> toggles are <strong className="text-green-700">green (on)</strong></>
                                  : <>Under "Settings for Websites", tap <strong>Camera</strong> and set to <strong>Allow</strong>. Do the same for <strong>Microphone</strong>.</>
                                }
                              </span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">4.</span>
                              <span>Come back here and tap <strong>Try Again</strong></span>
                            </li>
                          </ol>
                        </div>
                      )}

                      {/* Desktop/Android instructions */}
                      {cameraError === 'denied' && !isIOS && (
                        <div className="bg-white rounded-lg p-4 border border-red-100 space-y-2">
                          <p className="text-xs font-semibold text-gray-900">How to fix:</p>
                          <ol className="text-xs text-gray-700 space-y-1.5 list-none">
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">1.</span>
                              <span>Click the <strong>lock icon</strong> (or tune icon) in your browser's address bar</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">2.</span>
                              <span>Set <strong>Camera</strong> and <strong>Microphone</strong> to "Allow"</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="font-bold text-primary shrink-0">3.</span>
                              <span>Refresh the page and try again</span>
                            </li>
                          </ol>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setCameraError(null)
                            setCameraReady(false)
                            startCamera()
                          }}
                          className="flex-1"
                        >
                          <Camera className="h-4 w-4 mr-1.5" />
                          Try Again
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            stopCamera()
                            setCameraError(null)
                            setResponseMode('text')
                          }}
                          className="flex-1"
                        >
                          <MessageSquare className="h-4 w-4 mr-1.5" />
                          Use Text Mode
                        </Button>
                      </div>

                      <p className="text-[10px] text-center text-muted-foreground">
                        Text mode lets you type your answer — AI still analyzes content and structure
                      </p>
                    </div>
                  )}

                  {/* Recording Controls — ONLY shown when camera is working, NO error */}
                  {!cameraError && (
                    <>
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
                            {micActive && (
                              <span className="flex items-center gap-1 text-green-600">
                                <Mic className="h-3.5 w-3.5" /> Audio recorded
                              </span>
                            )}
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
                    </>
                  )}

                  {/* Back to mode select — always available when not recording */}
                  {!isRecording && !recordingDone && !submitting && !cameraError && (
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

                      {/* Voice Analysis (when audio was recorded) */}
                      {coaching.communication.voice_analysis && (
                        <div className="space-y-2 pt-1">
                          <h5 className="text-xs font-semibold flex items-center gap-1.5">
                            <Mic className="h-3.5 w-3.5 text-indigo-600" />
                            Voice & Tone Analysis
                          </h5>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { key: 'voice_confidence', label: 'Confidence', icon: Star },
                              { key: 'vocal_variety', label: 'Vocal Variety', icon: Volume2 },
                              { key: 'energy', label: 'Energy', icon: Zap },
                              { key: 'articulation', label: 'Articulation', icon: MessageSquare },
                            ].map(item => {
                              const data = (coaching.communication.voice_analysis as any)?.[item.key]
                              if (!data) return null
                              const ItemIcon = item.icon
                              return (
                                <div key={item.key} className={`p-2.5 rounded-lg border ${scoreBg(data.score)}`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                      <ItemIcon className="h-3 w-3" /> {item.label}
                                    </span>
                                    <span className={`text-sm font-bold ${scoreColor(data.score)}`}>{data.score}/10</span>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground leading-relaxed">{data.feedback}</p>
                                </div>
                              )
                            })}
                          </div>
                          {coaching.communication.voice_analysis.voice_summary && (
                            <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                              <p className="text-xs text-indigo-700">{coaching.communication.voice_analysis.voice_summary}</p>
                            </div>
                          )}
                          {coaching.communication.voice_analysis.voice_tips && coaching.communication.voice_analysis.voice_tips.length > 0 && (
                            <div className="p-3 rounded-lg bg-violet-50 border border-violet-100">
                              <h5 className="text-xs font-semibold text-violet-800 mb-1.5">🎤 Voice Tips</h5>
                              <ul className="space-y-1">
                                {coaching.communication.voice_analysis.voice_tips.map((tip: string, i: number) => (
                                  <li key={i} className="text-xs text-violet-700">{tip}</li>
                                ))}
                              </ul>
                            </div>
                          )}
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
