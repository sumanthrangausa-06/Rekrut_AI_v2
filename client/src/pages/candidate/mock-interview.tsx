// Mock Interview component — full AI video interview with voice mode
// Extracted from ai-coaching.tsx for maintainability

import { useState, useRef, useEffect } from 'react'
import { apiCall, getToken } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Brain, Trophy, TrendingUp, Sparkles,
  Video, VideoOff, Mic, MicOff, Camera, Eye,
  Volume2, AlertCircle, ChevronDown, ChevronUp, Square,
  User, Monitor, MessageSquare, Star, Zap,
  Send, Briefcase, StopCircle, Loader2, Plus,
  History, FileText, Timer,
} from 'lucide-react'

import type {
  MockConversationTurn, MockSession, MockSessionSummary, SessionFeedback,
} from './coaching-types'
import {
  categoryConfig, scoreColor, scoreBg, scoreLabel, ScoreBar, formatTime,
} from './coaching-utils'


/** Remove duplicate question text from interviewer messages.
 *  The AI sometimes embeds the question in its reaction AND returns it separately,
 *  causing the backend to concatenate both → question appears twice. */
function deduplicateInterviewerText(text: string): string {
  if (!text) return text
  const idx = text.lastIndexOf('\n\n')
  if (idx === -1) return text
  const before = text.substring(0, idx).trim()
  const after = text.substring(idx + 2).trim()
  if (!after || !before) return text
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
  if (normalize(before).includes(normalize(after))) {
    return before
  }
  return text
}

interface MockInterviewProps {
  mockPastSessions: MockSessionSummary[]
  onSessionComplete: () => void
}

export function MockInterview({ mockPastSessions, onSessionComplete }: MockInterviewProps) {
  // Mock Interview state
  const [mockTargetRole, setMockTargetRole] = useState('')
  const [mockJobDescription, setMockJobDescription] = useState('')
  const [mockStarting, setMockStarting] = useState(false)
  const [mockSession, setMockSession] = useState<MockSession | null>(null)
  const mockSessionRef = useRef<MockSession | null>(null)
  const [mockResponseText, setMockResponseText] = useState('')
  const [mockSending, setMockSending] = useState(false)
  const [mockEnding, setMockEnding] = useState(false)
  const [mockFeedback, setMockFeedback] = useState<SessionFeedback | null>(null)
  const [mockShowSetup, setMockShowSetup] = useState(false)
  const [viewingHistorySession, setViewingHistorySession] = useState(false)
  const [historyLoading, setHistoryLoading] = useState<number | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Voice interview state
  const [voiceMode, setVoiceMode] = useState(false)
  const voiceModeRef = useRef(false)
  const [aiSpeaking, setAiSpeaking] = useState(false)
  const [candidateRecording, setCandidateRecording] = useState(false)
  const candidateRecordingRef = useRef(false)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const voiceProcessingRef = useRef(false)
  const [silenceTimer, setSilenceTimer] = useState<number>(0)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const aiAudioRef = useRef<HTMLAudioElement | null>(null)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceCountRef = useRef<number>(0)

  // Mock interview camera state
  const [mockCameraReady, setMockCameraReady] = useState(false)
  const [mockCameraError, setMockCameraError] = useState<string | null>(null)
  const mockVideoRef = useRef<HTMLVideoElement>(null)
  const mockStreamRef = useRef<MediaStream | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  // Enhanced mock interview: AudioContext, frame capture, live transcript
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mockCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const mockFramesRef = useRef<string[]>([])
  const mockPerQuestionFramesRef = useRef<string[]>([])
  const mockQuestionStartTimeRef = useRef<number>(Date.now())
  const mockFrameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [mockLiveTranscript, setMockLiveTranscript] = useState('')
  const mockLiveTranscriptRef = useRef('')
  const mockRecognitionRef = useRef<any>(null)
  const mockAudioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const voiceRetryCountRef = useRef<number>(0)
  const mockRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [mockRecordingTime, setMockRecordingTime] = useState(0)

  // Real-time body language indicators
  const [bodyLanguageIndicators, setBodyLanguageIndicators] = useState<{
    eye_contact: string; posture: string; confidence: string; expression: string; last_updated: string
  } | null>(null)
  const bodyLanguageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Feedback expandable sections
  const [expandedSection, setExpandedSection] = useState<string | null>('mock-content')

  // Keep mockSessionRef in sync
  useEffect(() => { mockSessionRef.current = mockSession }, [mockSession])

  // Attach camera stream to video element after render
  useEffect(() => {
    if (mockCameraReady && mockStreamRef.current && mockSession && mockSession.status === 'in_progress') {
      const v = mockVideoRef.current
      if (v && !v.srcObject) {
        console.log('[camera] Attaching stream to video element (deferred)')
        v.srcObject = mockStreamRef.current
        v.play().catch(() => { v.play().catch(() => {}) })
      }
    }
  }, [mockCameraReady, mockSession])

  // When voice mode is enabled and session starts, play first message
  useEffect(() => {
    if (voiceMode && mockSession && mockSession.status === 'in_progress' && mockSession.conversation.length > 0) {
      const lastMsg = mockSession.conversation[mockSession.conversation.length - 1]
      if (lastMsg.role === 'interviewer' && !aiSpeaking && !candidateRecording && !voiceProcessing) {
        if (mockSession.conversation.length === 1) {
          playInterviewerAudio(lastMsg.text)
        }
      }
    }
  }, [voiceMode, mockSession?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss voice errors after 10 seconds
  useEffect(() => {
    if (voiceError) {
      const t = setTimeout(() => setVoiceError(null), 10000)
      return () => clearTimeout(t)
    }
  }, [voiceError])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVoiceMode()
      stopMockCamera()
      stopMockFrameCapture()
      stopMockSpeechRecognition()
      if (mockRecordingTimerRef.current) clearInterval(mockRecordingTimerRef.current)
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close() } catch (_) {}
      }
    }
  }, [])

  // ===== CAMERA FUNCTIONS =====

  async function startMockCamera() {
    try {
      setMockCameraError(null)
      if (!navigator.mediaDevices?.getUserMedia) {
        setMockCameraError('Camera not supported in this browser')
        return
      }
      const constraints = [
        { video: { facingMode: 'user' }, audio: true },
        { video: true, audio: true },
        { video: { facingMode: 'user' }, audio: false },
        { video: true, audio: false },
      ]
      let stream: MediaStream | null = null
      for (const c of constraints) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c)
          const vt = stream.getVideoTracks()[0]
          if (vt?.readyState === 'live') break
          stream.getTracks().forEach(t => t.stop())
          stream = null
        } catch { stream = null }
      }
      if (!stream) {
        setMockCameraError('Could not access camera')
        return
      }
      mockStreamRef.current = stream
      const v = mockVideoRef.current
      if (v) {
        v.srcObject = stream
        try { await v.play() } catch { try { await v.play() } catch {} }
      }
      setMockCameraReady(true)
    } catch (err: any) {
      setMockCameraError(err.message || 'Camera error')
    }
  }

  function stopMockCamera() {
    if (mockStreamRef.current) {
      mockStreamRef.current.getTracks().forEach(t => t.stop())
      mockStreamRef.current = null
    }
    setMockCameraReady(false)
  }

  function captureMockFrame(): string | null {
    if (!mockVideoRef.current) return null
    if (!mockCanvasRef.current) {
      mockCanvasRef.current = document.createElement('canvas')
    }
    const canvas = mockCanvasRef.current
    const video = mockVideoRef.current
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, 320, 240)
    return canvas.toDataURL('image/jpeg', 0.7)
  }

  function startMockFrameCapture() {
    mockFramesRef.current = []
    mockPerQuestionFramesRef.current = []
    mockQuestionStartTimeRef.current = Date.now()
    setTimeout(() => {
      const frame = captureMockFrame()
      if (frame) {
        mockFramesRef.current.push(frame)
        mockPerQuestionFramesRef.current.push(frame)
      }
    }, 500)
    mockFrameIntervalRef.current = setInterval(() => {
      const frame = captureMockFrame()
      if (frame) {
        if (mockFramesRef.current.length < 20) mockFramesRef.current.push(frame)
        if (mockPerQuestionFramesRef.current.length < 8) mockPerQuestionFramesRef.current.push(frame)
      }
    }, 4000)
  }

  function stopMockFrameCapture() {
    if (mockFrameIntervalRef.current) {
      clearInterval(mockFrameIntervalRef.current)
      mockFrameIntervalRef.current = null
    }
    if (bodyLanguageIntervalRef.current) {
      clearInterval(bodyLanguageIntervalRef.current)
      bodyLanguageIntervalRef.current = null
    }
  }

  // ===== SPEECH RECOGNITION =====

  function startMockSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

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
      const combined = finalTranscript + interim
      setMockLiveTranscript(combined)
      mockLiveTranscriptRef.current = combined
    }

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        try { recognition.start() } catch (_) {}
      }
    }

    recognition.onend = () => {
      if (candidateRecordingRef.current) {
        try { recognition.start() } catch (_) {}
      }
    }

    try {
      recognition.start()
      mockRecognitionRef.current = recognition
    } catch (_) {}
  }

  function stopMockSpeechRecognition() {
    if (mockRecognitionRef.current) {
      try { mockRecognitionRef.current.stop() } catch (_) {}
      mockRecognitionRef.current = null
    }
  }

  function ensureAudioContext(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  // ===== VOICE FUNCTIONS =====

  function speakWithBrowserTTS(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        console.warn('[browser-tts] speechSynthesis not available')
        resolve()
        return
      }
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.volume = 1.0

      let voices = window.speechSynthesis.getVoices()
      if (voices.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          voices = window.speechSynthesis.getVoices()
          const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
            || voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('samantha'))
            || voices.find(v => v.lang.startsWith('en-US'))
            || voices.find(v => v.lang.startsWith('en'))
          if (preferred) utterance.voice = preferred
        }
      } else {
        const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
          || voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('samantha'))
          || voices.find(v => v.lang.startsWith('en-US'))
          || voices.find(v => v.lang.startsWith('en'))
        if (preferred) utterance.voice = preferred
      }

      const timeout = setTimeout(() => {
        console.warn('[browser-tts] Safety timeout — resolving after 30s')
        resolve()
      }, 30000)

      const keepAlive = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.resume()
        } else {
          clearInterval(keepAlive)
        }
      }, 5000)

      utterance.onend = () => { clearTimeout(timeout); clearInterval(keepAlive); resolve() }
      utterance.onerror = (e) => { clearTimeout(timeout); clearInterval(keepAlive); console.warn('[browser-tts] error:', e); resolve() }

      window.speechSynthesis.speak(utterance)
      console.log('[browser-tts] Speaking via browser speechSynthesis')
    })
  }

  async function playInterviewerAudio(text: string) {
    if (!text) return
    setAiSpeaking(true)
    setVoiceError(null)
    try {
      const token = getToken()
      const response = await fetch('/api/interviews/mock/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text })
      })

      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        console.log('[tts-client] TTS API unavailable, falling back to browser speech synthesis')
        await speakWithBrowserTTS(text)
        setAiSpeaking(false)
        if (voiceModeRef.current && !candidateRecordingRef.current) startVoiceRecording()
        return
      }

      if (!response.ok) {
        console.error('[tts-client] TTS failed:', response.status)
        await speakWithBrowserTTS(text)
        setAiSpeaking(false)
        if (voiceModeRef.current && !candidateRecordingRef.current) setTimeout(() => startVoiceRecording(), 500)
        return
      }

      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength < 100) {
        console.error('[tts-client] Audio too small:', arrayBuffer.byteLength)
        await speakWithBrowserTTS(text)
        setAiSpeaking(false)
        if (voiceModeRef.current && !candidateRecordingRef.current) setTimeout(() => startVoiceRecording(), 500)
        return
      }

      const ctx = ensureAudioContext()

      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
        if (mockAudioSourceRef.current) {
          try { mockAudioSourceRef.current.stop() } catch (_) {}
        }
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(ctx.destination)
        mockAudioSourceRef.current = source

        source.onended = () => {
          setAiSpeaking(false)
          mockAudioSourceRef.current = null
          if (voiceModeRef.current && !candidateRecordingRef.current) startVoiceRecording()
        }

        source.start()
        console.log('[tts-client] Playing via Web Audio API')
      } catch (decodeErr) {
        console.warn('[tts-client] Web Audio decode failed, falling back to Audio element:', decodeErr)
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
        const audioUrl = URL.createObjectURL(blob)
        if (aiAudioRef.current) {
          aiAudioRef.current.pause()
          URL.revokeObjectURL(aiAudioRef.current.src)
        }
        const audio = new Audio(audioUrl)
        aiAudioRef.current = audio
        audio.onended = () => {
          setAiSpeaking(false)
          URL.revokeObjectURL(audioUrl)
          if (voiceModeRef.current && !candidateRecordingRef.current) startVoiceRecording()
        }
        audio.onerror = () => {
          setAiSpeaking(false)
          URL.revokeObjectURL(audioUrl)
          if (voiceModeRef.current && !candidateRecordingRef.current) setTimeout(() => startVoiceRecording(), 1000)
        }
        await audio.play()
      }
    } catch (err) {
      console.error('[tts-client] TTS playback error:', err)
      try { await speakWithBrowserTTS(text) } catch (_) {}
      setAiSpeaking(false)
      if (voiceModeRef.current && !candidateRecordingRef.current) setTimeout(() => startVoiceRecording(), 500)
    }
  }

  async function startVoiceRecording() {
    setVoiceError(null)
    setMockLiveTranscript('')
    mockLiveTranscriptRef.current = ''
    try {
      // CRITICAL: Stop and cleanup old MediaRecorder before creating new one
      if (voiceRecorderRef.current) {
        const oldState = voiceRecorderRef.current.state
        if (oldState !== 'inactive') {
          console.log(`[voice] Stopping old recorder (state: ${oldState}) before creating new one`)
          try {
            voiceRecorderRef.current.stop()
          } catch (e) {
            console.warn('[voice] Failed to stop old recorder:', e)
          }
        }
        voiceRecorderRef.current = null
      }

      // Always verify audio track is still alive — tracks can die between questions
      const existingTracks = voiceStreamRef.current?.getAudioTracks() || []
      const hasLiveTrack = existingTracks.some(t => t.readyState === 'live' && t.enabled)
      if (!voiceStreamRef.current || !hasLiveTrack) {
        if (voiceStreamRef.current) {
          console.log('[voice] Audio track died between questions — re-acquiring fresh stream')
          voiceStreamRef.current = null
        }
        const cameraLiveTrack = mockStreamRef.current?.getAudioTracks().find(t => t.readyState === 'live')
        if (cameraLiveTrack) {
          voiceStreamRef.current = new MediaStream([cameraLiveTrack])
          console.log('[voice] Re-acquired audio from camera stream')
        } else {
          console.log('[voice] Camera has no live audio — requesting fresh mic')
          voiceStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
        }
      }

      voiceChunksRef.current = []

      const audioContext = ensureAudioContext()
      // Disconnect old analyser to prevent orphaned audio graph nodes
      if (analyserRef.current) {
        try { analyserRef.current.disconnect() } catch (_) {}
        analyserRef.current = null
      }
      const source = audioContext.createMediaStreamSource(voiceStreamRef.current)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser
      silenceCountRef.current = 0
      const recordingStartedAt = Date.now()

      // CRITICAL: Clear any existing silence detection interval before creating new one
      if (silenceIntervalRef.current) {
        clearInterval(silenceIntervalRef.current)
        silenceIntervalRef.current = null
      }

      silenceIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return
        // Grace period: don't count silence for first 2.5s to let user start speaking
        if (Date.now() - recordingStartedAt < 2500) return
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        if (avg < 8) {
          silenceCountRef.current++
          setSilenceTimer(Math.round(silenceCountRef.current * 0.2))
          if (silenceCountRef.current >= 15) stopVoiceRecording()
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
      console.log('[voice] Created new MediaRecorder, ready to start')

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        setCandidateRecording(false)
        candidateRecordingRef.current = false
        if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current)
        setSilenceTimer(0)

        if (voiceChunksRef.current.length === 0) return

        const totalSilenceChecks = silenceCountRef.current
        const currentTranscript = mockLiveTranscriptRef.current
        if (totalSilenceChecks >= 23 && !currentTranscript.trim()) {
          console.log('[voice] Skipping — recording was mostly silence')
          setMockLiveTranscript('')
          setVoiceError('No speech detected. Tap the mic button when ready to speak.')
          return
        }

        setVoiceProcessing(true)
        voiceProcessingRef.current = true
        try {
          const currentSession = mockSessionRef.current
          if (!currentSession?.id) {
            console.error('[voice] No active session — cannot send voice response')
            setVoiceError('No active interview session. Please restart.')
            setVoiceProcessing(false)
            voiceProcessingRef.current = false
            return
          }

          const audioBlob = new Blob(voiceChunksRef.current, { type: mimeType })

          const voicePerQuestionFrames = [...mockPerQuestionFramesRef.current]
          const voiceQuestionDuration = Math.round((Date.now() - mockQuestionStartTimeRef.current) / 1000)
          mockPerQuestionFramesRef.current = []
          mockQuestionStartTimeRef.current = Date.now()

          const formData = new FormData()
          const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
          formData.append('audio', audioBlob, `recording.${ext}`)
          const liveTranscript = mockLiveTranscriptRef.current.trim()
          if (liveTranscript.length >= 5) {
            formData.append('response_text', liveTranscript)
          }
          if (voicePerQuestionFrames.length > 0) {
            formData.append('frames_json', JSON.stringify(voicePerQuestionFrames))
          }
          formData.append('duration_seconds', String(voiceQuestionDuration))

          let token = getToken()
          const abortController = new AbortController()
          const fetchTimeout = setTimeout(() => abortController.abort(), 28000)

          let res: Response
          try {
            res = await fetch(`/api/interviews/mock/${currentSession.id}/voice-respond`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: formData,
              signal: abortController.signal
            })
            // Handle expired token — refresh and retry once
            if (res.status === 401) {
              try {
                const rt = localStorage.getItem('refresh_token')
                if (rt) {
                  const rr = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: rt })
                  })
                  const rd = await rr.json()
                  if (rd.accessToken) {
                    localStorage.setItem('token', rd.accessToken)
                    if (rd.refreshToken) localStorage.setItem('refresh_token', rd.refreshToken)
                    token = rd.accessToken
                    const retryFD = new FormData()
                    retryFD.append('audio', audioBlob, `recording.${ext}`)
                    if (liveTranscript.length >= 5) retryFD.append('response_text', liveTranscript)
                    if (voicePerQuestionFrames.length > 0) retryFD.append('frames_json', JSON.stringify(voicePerQuestionFrames))
                    retryFD.append('duration_seconds', String(voiceQuestionDuration))
                    res = await fetch(`/api/interviews/mock/${currentSession.id}/voice-respond`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}` },
                      body: retryFD,
                      signal: abortController.signal
                    })
                  }
                }
              } catch (refreshErr) { console.warn('[voice] Token refresh failed:', refreshErr) }
            }
          } finally {
            clearTimeout(fetchTimeout)
          }

          const data = await res.json()

          if (data.success) {
            voiceRetryCountRef.current = 0

            const candidateMsg: MockConversationTurn = {
              role: 'candidate',
              text: data.transcribed_text,
              timestamp: new Date().toISOString()
            }
            const cleanedInterviewerMsg = { ...data.interviewer_message, text: deduplicateInterviewerText(data.interviewer_message.text) }
            const textWasDeduped = cleanedInterviewerMsg.text !== data.interviewer_message.text
            setMockSession(prev => prev ? {
              ...prev,
              conversation: [...prev.conversation, candidateMsg, cleanedInterviewerMsg]
            } : null)
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)

            if (data.interviewer_audio_base64 && !textWasDeduped) {
              setAiSpeaking(true)
              const audioData = Uint8Array.from(atob(data.interviewer_audio_base64), c => c.charCodeAt(0))
              const ctx = ensureAudioContext()

              try {
                const audioBuffer = await ctx.decodeAudioData(audioData.buffer.slice(0))
                if (mockAudioSourceRef.current) {
                  try { mockAudioSourceRef.current.stop() } catch (_) {}
                }
                const srcNode = ctx.createBufferSource()
                srcNode.buffer = audioBuffer
                srcNode.connect(ctx.destination)
                mockAudioSourceRef.current = srcNode
                srcNode.onended = () => {
                  setAiSpeaking(false)
                  mockAudioSourceRef.current = null
                  if (voiceModeRef.current && !data.is_wrapping_up) startVoiceRecording()
                }
                srcNode.start()
                console.log('[voice-respond] Playing AI audio via Web Audio API')
              } catch (decodeErr) {
                console.warn('[voice-respond] Web Audio decode failed, fallback:', decodeErr)
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
                  if (voiceModeRef.current && !data.is_wrapping_up) startVoiceRecording()
                }
                audio.onerror = () => {
                  setAiSpeaking(false)
                  URL.revokeObjectURL(url)
                  if (voiceModeRef.current && !data.is_wrapping_up) setTimeout(() => startVoiceRecording(), 1000)
                }
                await audio.play()
              }
            } else {
              // No backend audio or text was deduped (backend audio has question twice) — use frontend TTS
              await playInterviewerAudio(cleanedInterviewerMsg.text)
            }
          } else {
            const errorMsg = data.error || 'Failed to process your response'
            console.warn('[voice] Transcription failed:', errorMsg)
            voiceRetryCountRef.current = 0
            setMockLiveTranscript('')
            if (errorMsg.includes("didn't catch") || errorMsg.includes('Could not transcribe')) {
              setVoiceError('Could not understand your response. Tap the mic button to try again, or type your answer below.')
            } else {
              setVoiceError(errorMsg)
            }
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.warn('[voice] Request timed out after 28s')
            setVoiceError('The AI is taking too long to respond. Tap the mic to try again, or type your answer below.')
          } else {
            setVoiceError(err.message || 'Voice processing failed. Tap the mic to try again.')
            console.error('Voice response error:', err)
          }
        } finally {
          setVoiceProcessing(false)
          voiceProcessingRef.current = false
        }
      }

      recorder.start(250)
      setCandidateRecording(true)
      candidateRecordingRef.current = true

      // Start recording timer for stats display
      setMockRecordingTime(0)
      if (mockRecordingTimerRef.current) clearInterval(mockRecordingTimerRef.current)
      mockRecordingTimerRef.current = setInterval(() => {
        setMockRecordingTime(prev => prev + 1)
      }, 1000)

      setMockLiveTranscript('')
      mockLiveTranscriptRef.current = ''
      startMockSpeechRecognition()
    } catch (err: any) {
      console.error('Mic access error:', err)
      setVoiceError('Microphone access denied. Please allow microphone access to use voice mode.')
      setCandidateRecording(false)
      candidateRecordingRef.current = false
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
    stopMockSpeechRecognition()
    if (mockRecordingTimerRef.current) {
      clearInterval(mockRecordingTimerRef.current)
      mockRecordingTimerRef.current = null
    }
  }

  function stopVoiceMode() {
    if (mockAudioSourceRef.current) {
      try { mockAudioSourceRef.current.stop() } catch (_) {}
      mockAudioSourceRef.current = null
    }
    if (aiAudioRef.current) {
      aiAudioRef.current.pause()
      aiAudioRef.current = null
    }
    stopVoiceRecording()
    stopMockSpeechRecognition()
    if (voiceStreamRef.current && voiceStreamRef.current !== mockStreamRef.current) {
      const cameraAudioIds = mockStreamRef.current?.getAudioTracks().map(t => t.id) || []
      voiceStreamRef.current.getTracks().forEach(t => {
        if (!cameraAudioIds.includes(t.id)) t.stop()
      })
    }
    voiceStreamRef.current = null
    setAiSpeaking(false)
    setCandidateRecording(false)
    candidateRecordingRef.current = false
    setVoiceProcessing(false)
    voiceProcessingRef.current = false
    setSilenceTimer(0)
  }

  // ===== MOCK INTERVIEW FUNCTIONS =====

  async function startMockInterview() {
    if (!mockTargetRole.trim()) return
    setMockStarting(true)
    try {
      setVoiceMode(true)
      voiceModeRef.current = true
      ensureAudioContext()
      await startMockCamera()
      startMockFrameCapture()
      setShowTranscript(true)

      const res = await apiCall<{ success: boolean; session: MockSession; first_message: MockConversationTurn }>('/interviews/mock/start', {
        method: 'POST',
        body: { target_role: mockTargetRole.trim(), job_description: mockJobDescription.trim() || undefined }
      })
      if (res.success) {
        setMockSession(res.session)
        setMockShowSetup(false)
        setMockFeedback(null)
        if (res.first_message?.text) {
          playInterviewerAudio(res.first_message.text)
        }
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to start interview'
      if (msg.includes('429') || msg.includes('rate') || msg.includes('limit') || msg.includes('token')) {
        alert('AI service is temporarily at capacity. Please wait a moment and try again.')
      } else {
        alert(msg)
      }
      stopMockCamera()
      stopMockFrameCapture()
      stopVoiceMode()
      setMockSession(null)
      setVoiceMode(false)
      voiceModeRef.current = false
      setShowTranscript(false)
    } finally {
      setMockStarting(false)
    }
  }

  async function sendMockResponse() {
    if (!mockSession || !mockResponseText.trim() || mockSending) return
    const text = mockResponseText.trim()
    setMockResponseText('')
    setMockSending(true)

    const perQuestionFrames = [...mockPerQuestionFramesRef.current]
    const questionDuration = Math.round((Date.now() - mockQuestionStartTimeRef.current) / 1000)
    mockPerQuestionFramesRef.current = []
    mockQuestionStartTimeRef.current = Date.now()

    const candidateMsg: MockConversationTurn = { role: 'candidate', text, timestamp: new Date().toISOString() }
    setMockSession(prev => prev ? { ...prev, conversation: [...prev.conversation, candidateMsg] } : null)
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      const textAbort = new AbortController()
      const textTimeout = setTimeout(() => textAbort.abort(), 28000)

      try {
        const res = await apiCall<{
          success: boolean; interviewer_message: MockConversationTurn; action: string; is_wrapping_up: boolean
        }>(`/interviews/mock/${mockSession.id}/respond`, {
          method: 'POST',
          body: {
            response_text: text,
            frames: perQuestionFrames.length > 0 ? perQuestionFrames : undefined,
            duration_seconds: questionDuration
          },
          signal: textAbort.signal
        })
        if (res.success) {
          const cleanedResMsg = { ...res.interviewer_message, text: deduplicateInterviewerText(res.interviewer_message.text) }
          setMockSession(prev => prev ? {
            ...prev,
            conversation: [...prev.conversation, cleanedResMsg]
          } : null)
          setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
          if (cleanedResMsg?.text) {
            playInterviewerAudio(cleanedResMsg.text)
          }
          if (res.is_wrapping_up) {
            setTimeout(() => {
              if (!mockEnding) endMockInterview()
            }, 8000)
          }
        }
      } finally {
        clearTimeout(textTimeout)
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setVoiceError('AI is taking too long. Please try sending your response again.')
      } else {
        alert(err.message || 'Failed to send response')
      }
    } finally {
      setMockSending(false)
    }
  }

  async function endMockInterview() {
    if (!mockSession) return
    setMockEnding(true)

    if (voiceProcessingRef.current) {
      console.log('[end] Waiting for in-flight voice response to complete...')
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          if (!voiceProcessingRef.current) { clearInterval(check); resolve() }
        }, 200)
        setTimeout(() => { clearInterval(check); resolve() }, 6000)
      })
    }

    stopVoiceMode()
    stopMockFrameCapture()
    stopMockSpeechRecognition()

    const finalFrame = captureMockFrame()
    if (finalFrame && mockFramesRef.current.length < 20) {
      mockFramesRef.current.push(finalFrame)
    }

    if (voiceMode) {
      const goodbyeText = `Thank you for the interview. I'll prepare your feedback now.`
      Promise.race([
        speakWithBrowserTTS(goodbyeText),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]).catch(() => {})
    }

    try {
      const frames = mockFramesRef.current.length > 0 ? mockFramesRef.current : undefined
      const res = await apiCall<{ success: boolean; feedback: SessionFeedback; no_feedback?: boolean }>(`/interviews/mock/${mockSession.id}/end`, {
        method: 'POST',
        body: { frames }
      })
      if (res.success) {
        stopMockCamera()
        if (res.no_feedback) {
          setMockFeedback({
            overall_score: 0,
            interview_readiness: 'needs_practice',
            summary: 'Interview ended before any questions were answered. No feedback is available. Start a new interview to practice!',
            strengths: [],
            improvements: ['Complete at least one question to receive feedback'],
            question_scores: [],
            star_method_usage: { score: 0, feedback: 'N/A' },
            communication_quality: { score: 0, feedback: 'N/A' },
            technical_depth: { score: 0, feedback: 'N/A' },
            top_tip: 'Start a new interview to practice.'
          } as SessionFeedback)
        } else {
          setMockFeedback(res.feedback)
          if (res.feedback && !res.feedback.presentation) {
            const sessionIdForPolling = mockSession.id
            const pollFeedback = async () => {
              try {
                const pollRes = await apiCall<{ success: boolean; feedback: SessionFeedback }>(`/interviews/mock/sessions/${sessionIdForPolling}/feedback`)
                if (pollRes.success && pollRes.feedback) {
                  setMockFeedback(pollRes.feedback)
                  return !!pollRes.feedback.presentation
                }
              } catch { /* ignore poll errors */ }
              return false
            }
            setTimeout(async () => {
              const done = await pollFeedback()
              if (!done) setTimeout(pollFeedback, 15000)
            }, 15000)
          }
        }
        setMockSession(prev => prev ? { ...prev, status: 'completed' } : null)
        mockFramesRef.current = []
        onSessionComplete()
      }
    } catch (err: any) {
      stopMockCamera()
      setMockFeedback({
        overall_score: 0,
        interview_readiness: 'needs_practice',
        summary: 'Interview ended. Feedback could not be generated — please try again.',
        strengths: [],
        improvements: [],
        question_scores: [],
        star_method_usage: { score: 0, feedback: 'N/A' },
        communication_quality: { score: 0, feedback: 'N/A' },
        technical_depth: { score: 0, feedback: 'N/A' },
        top_tip: 'Start a new interview to practice.'
      } as SessionFeedback)
      setMockSession(prev => prev ? { ...prev, status: 'completed' } : null)
      mockFramesRef.current = []
    } finally {
      setMockEnding(false)
    }
  }

  async function viewPastSession(sessionId: number) {
    setHistoryLoading(sessionId)
    try {
      // Fetch full session (includes conversation, overall_feedback, etc.)
      const sessionRes = await apiCall<{ success: boolean; session: MockSession }>(`/interviews/mock/sessions/${sessionId}`)
      if (!sessionRes.success || !sessionRes.session) return

      const session = sessionRes.session
      // Parse overall_feedback if it's a string
      let feedback: SessionFeedback | null = null
      if (session.overall_feedback) {
        feedback = typeof session.overall_feedback === 'string'
          ? JSON.parse(session.overall_feedback)
          : session.overall_feedback
      }

      if (!feedback) {
        // Try the dedicated feedback endpoint
        try {
          const fbRes = await apiCall<{ success: boolean; feedback: SessionFeedback }>(`/interviews/mock/sessions/${sessionId}/feedback`)
          if (fbRes.success && fbRes.feedback) feedback = fbRes.feedback
        } catch { /* no feedback available */ }
      }

      if (feedback) {
        setMockSession({ ...session, status: 'completed' })
        setMockFeedback(feedback)
        setViewingHistorySession(true)
        setMockShowSetup(false)
      }
    } catch (err) {
      console.error('Failed to load past session:', err)
    } finally {
      setHistoryLoading(null)
    }
  }

  function backToSetup() {
    setMockSession(null)
    setMockFeedback(null)
    setViewingHistorySession(false)
    setMockShowSetup(false)
  }

  function resetMockInterview() {
    stopVoiceMode()
    stopMockCamera()
    stopMockFrameCapture()
    mockFramesRef.current = []
    setMockLiveTranscript('')
    setMockRecordingTime(0)
    if (mockRecordingTimerRef.current) { clearInterval(mockRecordingTimerRef.current); mockRecordingTimerRef.current = null }
    setMockSession(null)
    setMockFeedback(null)
    setMockResponseText('')
    setMockTargetRole('')
    setMockJobDescription('')
    setMockShowSetup(false)
    setShowTranscript(false)
    setVoiceMode(false)
    voiceModeRef.current = false
    setBodyLanguageIndicators(null)
    setViewingHistorySession(false)
  }

  // ==================== RENDER ====================
  return (
    <>
      {mockSession && mockSession.status === 'in_progress' ? (
        /* Active interview */
        <div className="space-y-4">
          {/* Video feed */}
          <div className="relative bg-black aspect-video rounded-xl overflow-hidden isolate">
            <video
              ref={mockVideoRef}
              autoPlay
              muted
              playsInline
              // @ts-ignore
              webkit-playsinline=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Body language indicators overlay */}
            {bodyLanguageIndicators && (
              <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-1.5 max-w-[60%]">
                {[
                  { emoji: '\uD83D\uDC41\uFE0F', label: 'Eyes', value: bodyLanguageIndicators.eye_contact },
                  { emoji: '\uD83E\uDDCD', label: 'Posture', value: bodyLanguageIndicators.posture },
                  { emoji: '\uD83D\uDCAA', label: 'Confidence', value: bodyLanguageIndicators.confidence },
                  { emoji: '\uD83D\uDE0A', label: 'Expression', value: bodyLanguageIndicators.expression },
                ].map(item => (
                  <div key={item.label} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    item.value === 'good' || item.value === 'confident' || item.value === 'engaged' || item.value === 'positive'
                      ? 'bg-green-600/80 text-white'
                      : item.value === 'neutral' || item.value === 'moderate' || item.value === 'ok'
                      ? 'bg-amber-600/80 text-white'
                      : 'bg-red-600/80 text-white'
                  }`}>
                    {item.emoji} {item.value || '?'}
                  </div>
                ))}
              </div>
            )}

            {/* Recording indicator — REC badge with timer (top-left) */}
            {candidateRecording && (
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full text-sm font-medium">
                <div className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                REC {formatTime(mockRecordingTime)}
              </div>
            )}

            {/* Recording stats — frames, word count, mic (top-right) */}
            {candidateRecording && (
              <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5 items-end">
                <div className="bg-black/60 text-white px-2 py-1 rounded text-xs">
                  {mockPerQuestionFramesRef.current.length} frames
                </div>
                <div className="bg-black/60 text-white px-2 py-1 rounded text-xs">
                  {mockLiveTranscript.split(/\s+/).filter(w => w).length} words
                </div>
                <div className="bg-black/60 text-green-400 px-2 py-1 rounded text-xs flex items-center gap-1">
                  <Mic className="h-3 w-3" /> Mic on
                </div>
              </div>
            )}

            {!mockCameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="text-center text-white">
                  <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm opacity-70">Camera loading...</p>
                </div>
              </div>
            )}
          </div>

          {/* Conversation transcript */}
          <div className="max-h-[40vh] overflow-y-auto space-y-3 p-3 rounded-lg bg-muted/30">
            {mockSession.conversation.map((turn, i) => (
              <div key={i} className="flex gap-3">
                <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                  turn.role === 'interviewer' ? 'bg-violet-100' : 'bg-green-100'
                }`}>
                  {turn.role === 'interviewer'
                    ? <Brain className="h-3.5 w-3.5 text-violet-600" />
                    : <User className="h-3.5 w-3.5 text-green-600" />
                  }
                </div>
                <div className="flex-1">
                  <p className={`text-[10px] font-medium mb-0.5 ${
                    turn.role === 'interviewer' ? 'text-violet-600' : 'text-green-600'
                  }`}>
                    {turn.role === 'interviewer' ? 'Alex (Interviewer)' : 'You'}
                  </p>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{turn.text}</p>
                </div>
              </div>
            ))}

            {/* Live transcription while recording */}
            {candidateRecording && mockLiveTranscript && (
              <div className="flex gap-3 opacity-60">
                <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 bg-green-100">
                  <User className="h-3.5 w-3.5 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-medium mb-0.5 text-green-600">You (speaking...)</p>
                  <p className="text-xs leading-relaxed italic">{mockLiveTranscript}</p>
                </div>
              </div>
            )}

            {/* Processing indicator */}
            {voiceProcessing && (
              <div className="flex gap-3 opacity-60">
                <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 bg-amber-100">
                  <Loader2 className="h-3.5 w-3.5 text-amber-600 animate-spin" />
                </div>
                <p className="text-xs text-amber-600 self-center">Processing your answer...</p>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3 py-2">
            {/* Mic button */}
            {!candidateRecording && !aiSpeaking && !voiceProcessing ? (
              <Button
                onClick={startVoiceRecording}
                size="lg"
                className="bg-green-600 hover:bg-green-700 rounded-full h-14 w-14 p-0"
                title="Start speaking"
              >
                <Mic className="h-6 w-6" />
              </Button>
            ) : candidateRecording ? (
              <Button
                onClick={stopVoiceRecording}
                size="lg"
                className="bg-red-600 hover:bg-red-700 rounded-full h-14 w-14 p-0 animate-pulse"
                title="Stop recording"
              >
                <Square className="h-5 w-5" />
              </Button>
            ) : aiSpeaking ? (
              <div className="h-14 w-14 rounded-full bg-violet-600/20 border-2 border-violet-400/40 flex items-center justify-center">
                <Volume2 className="h-6 w-6 text-violet-400 animate-pulse" />
              </div>
            ) : (
              <div className="h-14 w-14 rounded-full bg-amber-600/20 border-2 border-amber-400/40 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-amber-400 animate-spin" />
              </div>
            )}

            {/* Camera toggle */}
            <Button
              onClick={() => mockCameraReady ? stopMockCamera() : startMockCamera()}
              variant="outline"
              className={`rounded-full h-11 w-11 p-0 ${!mockCameraReady ? 'bg-gray-200 text-gray-500' : ''}`}
              title={mockCameraReady ? 'Turn off camera' : 'Turn on camera'}
            >
              {mockCameraReady ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </Button>

            {/* End call */}
            <Button
              onClick={() => endMockInterview()}
              disabled={mockEnding}
              className="bg-red-600 hover:bg-red-700 text-white rounded-full h-11 px-5"
            >
              {mockEnding ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <StopCircle className="h-4 w-4 mr-1.5" />}
              End
            </Button>
          </div>

          {/* Status text */}
          <div className="text-center">
            {voiceError ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-900/50 border border-red-700/50 text-red-300 text-xs animate-in fade-in">
                <AlertCircle className="h-3.5 w-3.5" />
                {voiceError}
                <button onClick={() => setVoiceError(null)} className="text-red-400 hover:text-red-200 ml-1">✕</button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {aiSpeaking ? 'Listening to interviewer... mic will auto-activate when they finish' :
                 candidateRecording ? `Speaking... ${silenceTimer > 0 ? `paused ${silenceTimer}s (auto-sends at 3s)` : 'auto-sends when you stop talking'}` :
                 voiceProcessing ? 'Processing your answer...' :
                 'Mic will activate automatically — or tap the green button to start'}
              </p>
            )}
          </div>

          {/* Hidden text fallback input */}
          {!candidateRecording && !aiSpeaking && !voiceProcessing && (
            <div className="flex gap-2 px-1">
              <Textarea
                value={mockResponseText}
                onChange={e => setMockResponseText(e.target.value)}
                placeholder="Or type your answer here..."
                rows={1}
                className="resize-none text-xs text-muted-foreground"
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
                variant="outline"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      ) : mockFeedback ? (
        /* Session feedback display */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              {viewingHistorySession ? 'Past Interview' : 'Interview Complete'} — {mockSession?.target_role}
            </h3>
            <div className="flex items-center gap-2">
              {viewingHistorySession && (
                <Button size="sm" variant="ghost" onClick={backToSetup}>
                  ← Back
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={resetMockInterview}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> New Interview
              </Button>
            </div>
          </div>

          {/* Overall score */}
          <div className={`text-center p-6 rounded-xl border-2 ${scoreBg(mockFeedback.overall_score)}`}>
            <div className={`text-5xl font-bold ${scoreColor(mockFeedback.overall_score)}`}>
              {mockFeedback.overall_score}/10
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {(mockFeedback as any)._content_failed
                ? 'Based on Communication & Presentation only'
                : scoreLabel(mockFeedback.overall_score)}
            </div>
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

          {/* Score bars */}
          {(mockFeedback as any).content && (mockFeedback as any).communication && (
            <div className="flex items-center justify-center gap-6 py-2">
              <ScoreBar score={(mockFeedback as any).content?._failed ? null : (mockFeedback as any).content?.score} label="Answer Content" icon={Brain} />
              <ScoreBar score={(mockFeedback as any).communication?.score} label="Communication" icon={Volume2} />
              <ScoreBar score={(mockFeedback as any).presentation?.score || 5} label="Presentation" icon={Eye} />
            </div>
          )}

          {/* Structured feedback sections */}
          <div className="space-y-2">
            {/* Answer Content Section */}
            {(mockFeedback as any).content && (
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'mock-content' ? null : 'mock-content')}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium text-sm">
                    <Brain className="h-4 w-4 text-violet-600" />
                    Answer Content
                    {(mockFeedback as any).content._failed ? (
                      <span className="text-xs font-bold text-muted-foreground">Analysis failed</span>
                    ) : (
                      <span className={`text-xs font-bold ${scoreColor((mockFeedback as any).content.score)}`}>{(mockFeedback as any).content.score}/10</span>
                    )}
                  </span>
                  {expandedSection === 'mock-content' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {expandedSection === 'mock-content' && (
                  <div className="p-3 pt-0 space-y-3">
                    {(mockFeedback as any).content.detailed_feedback && (
                      <p className="text-xs leading-relaxed text-muted-foreground">{(mockFeedback as any).content.detailed_feedback}</p>
                    )}
                    {(mockFeedback as any).content.strengths?.length > 0 && (
                      <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                        <h5 className="text-xs font-semibold text-green-800 mb-1.5">✓ Strengths</h5>
                        <ul className="space-y-1">{(mockFeedback as any).content.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-green-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {(mockFeedback as any).content.improvements?.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                        <h5 className="text-xs font-semibold text-amber-800 mb-1.5">↑ Improve</h5>
                        <ul className="space-y-1">{(mockFeedback as any).content.improvements.map((s: string, i: number) => <li key={i} className="text-xs text-amber-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {(mockFeedback as any).content.specific_tips?.length > 0 && (
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Tips</h5>
                        <ul className="space-y-1">{(mockFeedback as any).content.specific_tips.map((s: string, i: number) => <li key={i} className="text-xs text-blue-700">{s}</li>)}</ul>
                      </div>
                    )}
                    {(mockFeedback as any).content.common_mistake && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                        <h5 className="text-xs font-semibold text-red-800 mb-1.5">⚠️ Common Mistake</h5>
                        <p className="text-xs text-red-700">{(mockFeedback as any).content.common_mistake}</p>
                      </div>
                    )}
                    {/* Sub-scores */}
                    <div className="grid grid-cols-2 gap-2">
                      {(mockFeedback as any).content.star_method_usage && (
                        <div className={`p-2.5 rounded-lg border ${scoreBg((mockFeedback as any).content.star_method_usage.score)}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-medium text-muted-foreground">STAR Method</span>
                            <span className={`text-sm font-bold ${scoreColor((mockFeedback as any).content.star_method_usage.score)}`}>{(mockFeedback as any).content.star_method_usage.score}/10</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">{(mockFeedback as any).content.star_method_usage.feedback}</p>
                        </div>
                      )}
                      {(mockFeedback as any).content.technical_depth && (
                        <div className={`p-2.5 rounded-lg border ${scoreBg((mockFeedback as any).content.technical_depth.score)}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-medium text-muted-foreground">Technical Depth</span>
                            <span className={`text-sm font-bold ${scoreColor((mockFeedback as any).content.technical_depth.score)}`}>{(mockFeedback as any).content.technical_depth.score}/10</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">{(mockFeedback as any).content.technical_depth.feedback}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Communication & Speech Section */}
            {(mockFeedback as any).communication && (
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'mock-communication' ? null : 'mock-communication')}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium text-sm">
                    <Volume2 className="h-4 w-4 text-sky-600" />
                    Communication & Speech
                    <span className={`text-xs font-bold ${scoreColor((mockFeedback as any).communication.score)}`}>{(mockFeedback as any).communication.score}/10</span>
                  </span>
                  {expandedSection === 'mock-communication' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {expandedSection === 'mock-communication' && (
                  <div className="p-3 pt-0 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-lg font-bold">{(mockFeedback as any).communication.words_per_minute || '\u2014'}</div>
                        <div className="text-[10px] text-muted-foreground">Words/min</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-lg font-bold">{(mockFeedback as any).communication.word_count || '\u2014'}</div>
                        <div className="text-[10px] text-muted-foreground">Total Words</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-lg font-bold">{(mockFeedback as any).communication.total_fillers || 0}</div>
                        <div className="text-[10px] text-muted-foreground">Filler Words</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-lg font-bold">{(mockFeedback as any).communication.duration_seconds ? `${Math.round((mockFeedback as any).communication.duration_seconds / 60)}:${String((mockFeedback as any).communication.duration_seconds % 60).padStart(2, '0')}` : '\u2014'}</div>
                        <div className="text-[10px] text-muted-foreground">Duration</div>
                      </div>
                    </div>

                    {(mockFeedback as any).communication.pace && (
                      <div className={`p-3 rounded-lg ${
                        (mockFeedback as any).communication.pace.assessment === 'good' ? 'bg-green-50 border border-green-100' :
                        (mockFeedback as any).communication.pace.assessment?.includes('slight') ? 'bg-amber-50 border border-amber-100' :
                        'bg-red-50 border border-red-100'
                      }`}>
                        <h5 className="text-xs font-semibold mb-1">🎙️ Speaking Pace</h5>
                        <p className="text-xs">{(mockFeedback as any).communication.pace.feedback}</p>
                      </div>
                    )}

                    {(mockFeedback as any).communication.total_fillers > 0 && (mockFeedback as any).communication.filler_words && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                        <h5 className="text-xs font-semibold text-amber-800 mb-1.5">
                          Filler Words ({(mockFeedback as any).communication.filler_rate || 0}% of speech)
                        </h5>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries((mockFeedback as any).communication.filler_words).filter(([, count]) => (count as number) > 0).map(([word, count]) => (
                            <Badge key={word} variant="outline" className="text-[10px] bg-white">
                              "{word}" × {count as number}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {(mockFeedback as any).communication.trends && (
                      <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                        <h5 className="text-xs font-semibold text-indigo-800 mb-1">📈 Communication Trends</h5>
                        <p className="text-xs text-indigo-700">{(mockFeedback as any).communication.trends}</p>
                      </div>
                    )}

                    {(mockFeedback as any).communication.tips?.length > 0 && (
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Speech Tips</h5>
                        <ul className="space-y-1">{(mockFeedback as any).communication.tips.map((tip: string, i: number) => <li key={i} className="text-xs text-blue-700">{tip}</li>)}</ul>
                      </div>
                    )}

                    {/* Voice Analysis */}
                    {(mockFeedback as any).voice_analysis && (
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
                            const data = ((mockFeedback as any).voice_analysis as any)?.[item.key]
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
                        {(mockFeedback as any).voice_analysis.voice_summary && (
                          <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                            <p className="text-xs text-indigo-700">{(mockFeedback as any).voice_analysis.voice_summary}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Body Language & Presentation Section */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === 'mock-presentation' ? null : 'mock-presentation')}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
              >
                <span className="flex items-center gap-2 font-medium text-sm">
                  <Eye className="h-4 w-4 text-emerald-600" />
                  Body Language & Presentation
                  {mockFeedback.presentation ? (
                    <span className={`text-xs font-bold ${scoreColor(mockFeedback.presentation.score)}`}>{mockFeedback.presentation.score}/10</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not available</span>
                  )}
                </span>
                {expandedSection === 'mock-presentation' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedSection === 'mock-presentation' && (
                <div className="p-3 pt-0 space-y-3">
                  {mockFeedback.presentation ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { key: 'eye_contact', label: 'Eye Contact', icon: Eye },
                          { key: 'facial_expressions', label: 'Expressions', icon: User },
                          { key: 'body_language', label: 'Body Language', icon: User },
                          { key: 'professional_appearance', label: 'Appearance', icon: Monitor },
                        ].map(item => {
                          const data = (mockFeedback.presentation as any)?.[item.key]
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
                      {mockFeedback.presentation.summary && (
                        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                          <h5 className="text-xs font-semibold text-emerald-800 mb-1">📊 Overall Assessment</h5>
                          <p className="text-xs text-emerald-700">{mockFeedback.presentation.summary}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      📹 Body language analysis requires camera access during the interview. Enable your camera next time for presentation feedback.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Interview Arc */}
          {(mockFeedback as any).interview_arc && (
            <Card>
              <CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-primary" /> Overall Interview Arc
                </h4>
                <p className="text-xs leading-relaxed text-muted-foreground">{(mockFeedback as any).interview_arc}</p>
              </CardContent>
            </Card>
          )}

          {/* Question-by-question scores */}
          {mockFeedback.question_scores?.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-3">Question-by-Question Scores</h4>
                <div className="space-y-2">
                  {mockFeedback.question_scores.map((qs: any, i: number) => (
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
                <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                  {mockSession.conversation.map((turn: any, i: number) => (
                    <div key={i} className="flex gap-3">
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                        turn.role === 'interviewer' ? 'bg-violet-100' : 'bg-green-100'
                      }`}>
                        {turn.role === 'interviewer'
                          ? <Brain className="h-3.5 w-3.5 text-violet-600" />
                          : <User className="h-3.5 w-3.5 text-green-600" />
                        }
                      </div>
                      <div className="flex-1">
                        <p className={`text-[10px] font-medium mb-0.5 ${
                          turn.role === 'interviewer' ? 'text-violet-600' : 'text-green-600'
                        }`}>
                          {turn.role === 'interviewer' ? 'Alex (Interviewer)' : 'You'}
                          {turn.action && turn.action !== 'transition' && (
                            <span className="ml-1.5 text-muted-foreground font-normal">
                              · {turn.action === 'follow_up' ? 'Follow-up' : turn.action === 'challenge' ? 'Probing deeper' : turn.action === 'introduction' ? 'Introduction' : turn.action === 'wrap_up' ? 'Wrapping up' : ''}
                            </span>
                          )}
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
                  <Video className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-2">Mock Interview</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  Practice with a <strong>real video call experience</strong>. Your AI interviewer speaks out loud while you answer on camera — just like Zoom. Get scored and get feedback after.
                </p>
                <div className="flex items-center justify-center gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-3 py-1.5 rounded-full">
                    <Volume2 className="h-3.5 w-3.5" /> Real-time AI voice
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
                    <Camera className="h-3.5 w-3.5" /> Body language analysis
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-sky-600 bg-sky-50 px-3 py-1.5 rounded-full">
                    <Brain className="h-3.5 w-3.5" /> Voice & delivery coaching
                  </div>
                </div>
                <Button onClick={() => setMockShowSetup(true)} size="lg">
                  <Video className="h-4 w-4 mr-2" /> Start Mock Interview
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

                <div className="flex items-center gap-3 p-3 rounded-lg bg-sky-50 border border-sky-100">
                  <div className="h-9 w-9 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                    <Video className="h-4 w-4 text-sky-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-sky-900">Video call experience</p>
                    <p className="text-xs text-sky-600">Camera & mic will be enabled. AI speaks questions, you answer verbally — like a real interview.</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setMockShowSetup(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={startMockInterview}
                    disabled={mockStarting || mockTargetRole.trim().length < 2}
                    className="flex-1"
                  >
                    {mockStarting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating questions...
                      </>
                    ) : (
                      <>
                        <Video className="h-4 w-4 mr-2" />
                        Start Mock Interview
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
                {mockPastSessions.map(s => {
                  const tags = s.category_tags || ['behavioral']
                  return (
                    <Card key={s.id} className={`hover:border-primary/30 transition-colors ${s.status === 'completed' ? 'cursor-pointer' : ''} ${historyLoading === s.id ? 'opacity-60' : ''}`} onClick={() => s.status === 'completed' && viewPastSession(s.id)}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {historyLoading === s.id ? (
                              <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-muted">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            ) : s.overall_score ? (
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
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                {tags.map(tag => {
                                  const cfg = categoryConfig[tag] || categoryConfig.behavioral
                                  const TagIcon = cfg.icon
                                  return (
                                    <Badge key={tag} variant="secondary" className={`${cfg.bg} ${cfg.color} text-[10px] border-0 py-0`}>
                                      <TagIcon className="h-2.5 w-2.5 mr-0.5" /> {cfg.label}
                                    </Badge>
                                  )
                                })}
                                <Badge variant="outline" className="text-[10px] py-0">
                                  <Mic className="h-2.5 w-2.5 mr-0.5" /> Voice
                                </Badge>
                              </div>
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
                            {s.status === 'completed' && (
                              <p className="text-[10px] text-primary mt-0.5 font-medium">View feedback →</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
