import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiCall } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft, Video, VideoOff, Mic, MicOff, Play, Square, SkipForward,
  AlertTriangle, CheckCircle, Timer, ChevronRight, Loader2,
} from 'lucide-react'

interface VideoQuestion {
  id: number
  question: string
  time_limit_seconds: number
}

interface VideoInterview {
  id: number
  title: string
  questions: VideoQuestion[]
}

export function VideoInterviewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const interviewId = searchParams.get('id')

  const [interview, setInterview] = useState<VideoInterview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [responses, setResponses] = useState<Blob[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    async function loadInterview() {
      try {
        if (!interviewId) {
          setError('No interview ID provided')
          setLoading(false)
          return
        }
        const data = await apiCall<VideoInterview>(`/interviews/${interviewId}`)
        setInterview(data)
        setTimeLeft(data.questions[0]?.time_limit_seconds || 120)
      } catch (err) {
        console.error('Failed to load interview:', err)
        setError('Failed to load interview')
      } finally {
        setLoading(false)
      }
    }
    loadInterview()
  }, [interviewId])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      stopCamera()
    }
  }, [])

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraError(null)
      setMicError(null)
    } catch (err) {
      console.error('Camera error:', err)
      setCameraError('Could not access camera. Please allow permissions.')
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  function startRecording() {
    if (!streamRef.current || !interview) return

    chunksRef.current = []
    const recorder = new MediaRecorder(streamRef.current)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      setResponses((prev) => [...prev, blob])
    }

    recorder.start()
    setIsRecording(true)
    setIsReviewing(false)

    const timeLimit = interview.questions[currentQuestionIndex]?.time_limit_seconds || 120
    setTimeLeft(timeLimit)

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopRecording()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    setIsReviewing(true)
  }

  function nextQuestion() {
    if (!interview) return

    if (currentQuestionIndex < interview.questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1)
      setIsReviewing(false)
      setTimeLeft(interview.questions[currentQuestionIndex + 1]?.time_limit_seconds || 120)
    } else {
      setIsComplete(true)
      stopCamera()
    }
  }

  function skipQuestion() {
    stopRecording()
    setResponses((prev) => [...prev, new Blob()])
    nextQuestion()
  }

  async function submitInterview() {
    setSubmitting(true)
    try {
      const formData = new FormData()
      responses.forEach((blob, index) => {
        if (blob.size > 0) {
          formData.append(`response_${index}`, blob, `response_${index}.webm`)
        }
      })
      formData.append('interview_id', interviewId || '')

      await apiCall('/interviews/video/submit', {
        method: 'POST',
        isFormData: true,
        body: formData,
      })

      navigate(`/candidate/interview-analysis?interview_id=${interviewId}`)
    } catch (err) {
      console.error('Failed to submit interview:', err)
      setError('Failed to submit interview')
    } finally {
      setSubmitting(false)
    }
  }

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading interview...</p>
        </div>
      </div>
    )
  }

  if (error || !interview) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/candidate')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Error</h2>
            <p className="text-muted-foreground">{error || 'Interview not found'}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const currentQuestion = interview.questions[currentQuestionIndex]
  const progress = ((currentQuestionIndex + (isComplete ? 1 : 0)) / interview.questions.length) * 100

  if (isComplete) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate('/candidate')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="h-16 w-16 text-emerald-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Interview Complete!</h2>
            <p className="text-muted-foreground mb-6">
              You answered {interview.questions.length} questions. Review your answers before submitting.
            </p>

            <div className="space-y-3 w-full mb-6">
              {interview.questions.map((q, index) => (
                <div key={q.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">
                      {index + 1}
                    </div>
                    <span className="font-medium truncate">{q.question}</span>
                  </div>
                  <Badge variant={responses[index]?.size > 0 ? 'default' : 'secondary'}>
                    {responses[index]?.size > 0 ? (
                      <>
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Recorded
                      </>
                    ) : (
                      <>
                        <SkipForward className="h-3 w-3 mr-1" />
                        Skipped
                      </>
                    )}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => navigate('/candidate/interviews')}>
                Cancel
              </Button>
              <Button onClick={submitInterview} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Submit Interview
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/candidate/interviews')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Exit Interview
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            Question {currentQuestionIndex + 1} of {interview.questions.length}
          </Badge>
        </div>
      </div>

      <Progress value={progress} className="h-2" />

      <Card>
        <CardContent className="p-6 space-y-6">
          {/* Question */}
          <div>
            <h2 className="text-xl font-semibold mb-2">{currentQuestion?.question}</h2>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Timer className="h-4 w-4" />
              <span className={timeLeft <= 10 ? 'text-red-500 font-bold' : ''}>
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>

          {/* Video Preview */}
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            {!streamRef.current && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                <VideoOff className="h-12 w-12 mb-2" />
                <p>Camera preview unavailable</p>
              </div>
            )}
            {isRecording && (
              <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-500 text-white px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Recording
              </div>
            )}
          </div>

          {/* Camera/Mic Status */}
          <div className="flex flex-wrap gap-2">
            {cameraError ? (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {cameraError}
              </Badge>
            ) : (
              <Badge variant="outline" className="flex items-center gap-1">
                <Video className="h-3 w-3" />
                Camera ready
              </Badge>
            )}
            {micError ? (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {micError}
              </Badge>
            ) : (
              <Badge variant="outline" className="flex items-center gap-1">
                <Mic className="h-3 w-3" />
                Microphone ready
              </Badge>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-3 justify-center">
            {!streamRef.current && (
              <Button onClick={startCamera}>
                <Video className="h-4 w-4 mr-2" />
                Start Camera
              </Button>
            )}

            {streamRef.current && !isRecording && !isReviewing && (
              <Button onClick={startRecording}>
                <Play className="h-4 w-4 mr-2" />
                Start Recording
              </Button>
            )}

            {isRecording && (
              <Button variant="destructive" onClick={stopRecording}>
                <Square className="h-4 w-4 mr-2" />
                Stop Recording
              </Button>
            )}

            {isReviewing && (
              <>
                <Button variant="outline" onClick={startRecording}>
                  <Play className="h-4 w-4 mr-2" />
                  Retake
                </Button>
                <Button variant="secondary" onClick={skipQuestion}>
                  <SkipForward className="h-4 w-4 mr-2" />
                  Skip
                </Button>
                <Button onClick={nextQuestion}>
                  Next Question
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
          </div>

          {/* Instructions */}
          <Separator />
          <div className="bg-muted rounded-lg p-4">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Before you begin
            </h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Find a quiet space with good lighting</li>
              <li>• Ensure your camera and microphone are working</li>
              <li>• You have {formatTime(currentQuestion?.time_limit_seconds || 120)} to answer each question</li>
              <li>• You can retake your response once per question</li>
              <li>• Review all answers before final submission</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
