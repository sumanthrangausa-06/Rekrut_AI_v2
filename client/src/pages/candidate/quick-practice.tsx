// Quick Practice component — single-question video/text practice with AI analysis
// Extracted from ai-coaching.tsx for maintainability

import { useState, useRef, useEffect } from 'react'
import { apiCall, getToken } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  Brain, Target, Sparkles, Trophy, TrendingUp,
  BookOpen, CheckCircle, ArrowRight, Video, VideoOff,
  Mic, MicOff, Camera, Eye, Volume2, AlertCircle,
  ChevronDown, ChevronUp, Play, Square, Timer, User,
  Monitor, MessageSquare, Star, Zap, Loader2,
} from 'lucide-react'

import type {
  PracticeQuestion, VideoCoaching, TextCoaching, CategoryScoreDetail,
} from './coaching-types'
import {
  categoryConfig, difficultyColors,
  scoreColor, scoreBg, scoreLabel, ScoreBar, formatTime,
} from './coaching-utils'


interface QuickPracticeProps {
  questions: PracticeQuestion[]
  categoryFilter: string
  setCategoryFilter: (filter: string) => void
  onSessionComplete: () => void
}

export function QuickPractice({ questions, categoryFilter, setCategoryFilter, onSessionComplete }: QuickPracticeProps) {
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

  // Feedback detail sections
  const [expandedSection, setExpandedSection] = useState<string | null>('content')

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
      if (timerRef.current) clearInterval(timerRef.current)
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    }
  }, [])

  // Detect iOS (all browsers on iOS use WebKit)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isChromeIOS = isIOS && /CriOS/.test(navigator.userAgent)
  const isSafari = isIOS && !isChromeIOS && /Safari/.test(navigator.userAgent)

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

  // Camera management — 13TH FIX (Feb 11 2026)
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
          break
        } catch (err: any) {
          console.warn(`[camera] ${label} error: ${err?.name} ${err?.message}`)
          setCameraStatus(`${label}: ${err?.name}`)
          if (err.name === 'NotAllowedError' && !ac) {
            setCameraError('denied')
            return
          }
        }
      }

      if (!videoStream) {
        setCameraError('not_found')
        setCameraStatus('Camera not working — tap Retry')
        return
      }

      streamRef.current = videoStream

      const audioTracks = videoStream.getAudioTracks()
      if (audioTracks.length > 0) {
        setMicActive(true)
        console.log(`[camera] mic active: ${audioTracks[0].label}`)
      } else {
        setMicActive(false)
        console.log('[camera] no audio track — mic not available')
      }

      const v = videoRef.current
      if (v) {
        v.srcObject = videoStream
        try {
          await v.play()
          console.log(`[camera] play() succeeded, readyState=${v.readyState}, videoWidth=${v.videoWidth}`)
        } catch (e: any) {
          console.warn('[camera] play() failed, retrying:', e?.message)
          try { await v.play() } catch (_) {}
        }
      }

      const vt = videoStream.getVideoTracks()[0]
      const at2 = videoStream.getAudioTracks()
      const settings = vt?.getSettings?.() || {}
      setCameraStatus(`OK ${settings.width || '?'}x${settings.height || '?'} ${at2.length > 0 ? '🎙' : ''} ▶`)

      setCameraReady(true)

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
        try { recognition.start() } catch (_) {}
      }
    }

    recognition.onend = () => {
      setIsTranscribing(false)
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

    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1)
    }, 1000)

    frameIntervalRef.current = setInterval(() => {
      const frame = captureFrame()
      if (frame) {
        setCapturedFrames(prev => [...prev, frame])
      }
    }, 4000)

    setTimeout(() => {
      const frame = captureFrame()
      if (frame) setCapturedFrames(prev => [...prev, frame])
    }, 500)

    startSpeechRecognition()

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

    const frame = captureFrame()
    if (frame) setCapturedFrames(prev => [...prev, frame])

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }

    stopSpeechRecognition()
    setRecordingDone(true)
  }

  // Submit video response
  // BUG FIX (Feb 14, 2026): Added 35s AbortController timeout
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
    const abortController = new AbortController()
    const fetchTimeout = setTimeout(() => abortController.abort(), 35000)
    try {
      const res = await apiCall<{ success: boolean; coaching: VideoCoaching }>('/interviews/practice/submit-video', {
        method: 'POST',
        signal: abortController.signal,
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
        onSessionComplete()
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        alert('Analysis is taking longer than expected. Please try again — the AI may need a moment.')
      } else {
        alert(err.message || 'Failed to get AI coaching. Please try again.')
      }
    } finally {
      clearTimeout(fetchTimeout)
      setSubmitting(false)
    }
  }

  async function submitTextResponse() {
    if (!practiceQuestion) return
    if (responseText.trim().length < 50) {
      alert('Please write at least 50 characters for a meaningful response.')
      return
    }

    setSubmitting(true)
    const abortController = new AbortController()
    const fetchTimeout = setTimeout(() => abortController.abort(), 35000)
    try {
      const res = await apiCall<{ success: boolean; coaching: TextCoaching }>('/interviews/practice/submit', {
        method: 'POST',
        signal: abortController.signal,
        body: {
          question_id: practiceQuestion.id,
          question: practiceQuestion.question,
          category: practiceQuestion.category,
          response_text: responseText,
        },
      })

      if (res.success) {
        setTextCoaching(res.coaching)
        onSessionComplete()
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        alert('Analysis is taking longer than expected. Please try again.')
      } else {
        alert(err.message || 'Failed to get AI coaching. Please try again.')
      }
    } finally {
      clearTimeout(fetchTimeout)
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

  const filteredQuestions =
    categoryFilter === 'all' ? questions : questions.filter(q => q.category === categoryFilter)

  const categoryCounts = questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.category] = (acc[q.category] || 0) + 1
    return acc
  }, {})

  return (
    <>
      {/* Category filter */}
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

      {/* Question list */}
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

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ==================== Practice Dialog ==================== */}
      <Dialog open={!!practiceQuestion} onClose={closePractice}
        className={`max-w-2xl ${responseMode === 'video' && !cameraError && !coaching ? 'overflow-visible isolate max-h-none' : ''}`}
        style={responseMode === 'video' && !cameraError && !coaching ? { overflow: 'visible', isolation: 'isolate' } : undefined}>
        <div className={responseMode === 'video' && !cameraError && !coaching ? '' : 'max-h-[85vh] overflow-y-auto'}>
          {practiceQuestion && !coaching && !textCoaching && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Quick Practice
                </DialogTitle>
                <DialogDescription>
                  Answer a single question — AI analyzes everything
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
                  {!cameraError && (
                    <div className="relative bg-black aspect-video rounded-xl isolate overflow-hidden">
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        // @ts-ignore
                        webkit-playsinline=""
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ transform: 'scaleX(-1)' }}
                      />

                      {cameraStatus && (
                        <div className="absolute bottom-2 left-2 z-30 bg-black/80 text-green-400 text-[10px] px-2 py-0.5 rounded font-mono pointer-events-none">
                          {cameraStatus}
                        </div>
                      )}

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

                      {countdown !== null && (
                        <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center">
                          <div className="text-7xl font-bold text-white animate-pulse">{countdown}</div>
                        </div>
                      )}

                      {isRecording && (
                        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full text-sm font-medium">
                          <div className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                          REC {formatTime(recordingTime)}
                        </div>
                      )}

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

                  {/* Camera Error */}
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

                  {/* Recording Controls */}
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

                      {submitting && (
                        <div className="text-center py-6 space-y-3">
                          <div className="animate-spin rounded-full h-10 w-10 border-3 border-primary border-t-transparent mx-auto" />
                          <div>
                            <p className="font-medium text-sm">Analyzing your practice...</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              AI is reviewing your body language, speech patterns, and answer content
                            </p>
                          </div>
                        </div>
                      )}

                      {!isRecording && !recordingDone && !submitting && cameraReady && (
                        <div className="text-center text-xs text-muted-foreground space-y-1">
                          <p>💡 Look at your camera as if it were the interviewer</p>
                          <p>Speak clearly and take your time — aim for 1-2 minutes</p>
                        </div>
                      )}
                    </>
                  )}

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

              {/* Text Response Mode */}
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
                  Practice Analysis
                </DialogTitle>
              </DialogHeader>

              <div className={`mt-4 text-center p-5 rounded-xl border ${scoreBg(coaching.overall_score)}`}>
                <div className={`text-5xl font-bold ${scoreColor(coaching.overall_score)}`}>
                  {coaching.overall_score}/10
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {scoreLabel(coaching.overall_score)} — Overall Practice Score
                </div>
              </div>

              {/* Your Answer transcript */}
              {transcription && transcription.trim().length > 0 && (
                <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5 text-slate-700 mb-2">
                    <MessageSquare className="h-4 w-4" />
                    Your Answer
                  </h4>
                  <p className="text-sm text-slate-600 leading-relaxed italic">
                    "{transcription.trim()}"
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                    <span>{transcription.trim().split(/\s+/).filter(w => w).length} words</span>
                    <span>•</span>
                    <span>{formatTime(recordingTime)} recording</span>
                  </div>
                </div>
              )}

              <div className="mt-4 p-4 rounded-lg bg-muted/30 space-y-3">
                <ScoreBar score={coaching.content.score} label="Answer Content" icon={Brain} />
                <ScoreBar score={coaching.communication.score} label="Communication" icon={Volume2} />
                <ScoreBar score={coaching.presentation.score} label="Presentation" icon={Eye} />
              </div>

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

                      {coaching.communication?.pace && (
                      <div className={`p-3 rounded-lg ${
                        coaching.communication.pace.assessment === 'good' ? 'bg-green-50 border border-green-100' :
                        coaching.communication.pace.assessment?.includes('slight') ? 'bg-amber-50 border border-amber-100' :
                        'bg-red-50 border border-red-100'
                      }`}>
                        <h5 className="text-xs font-semibold mb-1">🎙️ Speaking Pace</h5>
                        <p className="text-xs">{coaching.communication.pace.feedback}</p>
                      </div>
                      )}

                      {coaching.communication?.total_fillers > 0 && coaching.communication?.filler_words && (
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

                      {coaching.communication?.tips?.length > 0 && (
                        <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                          <h5 className="text-xs font-semibold text-blue-800 mb-1.5">💡 Speech Tips</h5>
                          <ul className="space-y-1">
                            {coaching.communication.tips.map((tip, i) => (
                              <li key={i} className="text-xs text-blue-700">{tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}

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

                      {coaching.presentation.summary && (
                        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                          <h5 className="text-xs font-semibold text-emerald-800 mb-1">📊 Overall Assessment</h5>
                          <p className="text-xs text-emerald-700">{coaching.presentation.summary}</p>
                        </div>
                      )}

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

          {/* ==================== Text Coaching Results ==================== */}
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
    </>
  )
}
