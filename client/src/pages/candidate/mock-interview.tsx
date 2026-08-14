// Mock Interview component — full AI video interview with voice mode
// Extracted from ai-coaching.tsx for maintainability

import {
	Brain,
	Briefcase,
	Camera,
	History,
	Loader2,
	Mic,
	Video,
	Volume2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { apiCall, getToken } from '@/lib/api'

import type {
	MockConversationTurn,
	MockSession,
	MockSessionSummary,
	SessionFeedback,
} from './coaching-types'
import {
	categoryConfig,
	formatTime,
	ScoreBar,
	scoreBg,
	scoreColor,
	scoreLabel,
} from './coaching-utils'

import { InterviewActiveLayout } from './interview-active-layout'
import { InterviewResultsPage } from './interview-results-page'

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
	const normalize = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^\w\s]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
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
	const [_mockCameraError, setMockCameraError] = useState<string | null>(null)
	const mockVideoRef = useRef<HTMLVideoElement>(null)
	const mockStreamRef = useRef<MediaStream | null>(null)
	const [_showTranscript, setShowTranscript] = useState(false)

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

	const [frameCount, setFrameCount] = useState(0)

	// Real-time body language indicators
	const [bodyLanguageIndicators, setBodyLanguageIndicators] = useState<{
		eye_contact: string
		posture: string
		confidence: string
		expression: string
		last_updated: string
	} | null>(null)
	const bodyLanguageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

	// Feedback expandable sections
	const [expandedSection, setExpandedSection] = useState<string | null>('mock-content')

	// Keep mockSessionRef in sync
	useEffect(() => {
		mockSessionRef.current = mockSession
	}, [mockSession])

	// Attach camera stream to video element after render
	useEffect(() => {
		if (
			mockCameraReady &&
			mockStreamRef.current &&
			mockSession &&
			mockSession.status === 'in_progress'
		) {
			const v = mockVideoRef.current
			if (v && !v.srcObject) {
				console.log('[camera] Attaching stream to video element (deferred)')
				v.srcObject = mockStreamRef.current
				v.play().catch(() => {
					v.play().catch(() => {})
				})
			}
		}
	}, [mockCameraReady, mockSession])

	// When voice mode is enabled and session starts, play first message
	useEffect(() => {
		if (
			voiceMode &&
			mockSession &&
			mockSession.status === 'in_progress' &&
			mockSession.conversation.length > 0
		) {
			const lastMsg = mockSession.conversation[mockSession.conversation.length - 1]
			if (
				lastMsg.role === 'interviewer' &&
				!aiSpeaking &&
				!candidateRecording &&
				!voiceProcessing
			) {
				if (mockSession.conversation.length === 1) {
					playInterviewerAudio(lastMsg.text)
				}
			}
		}
	}, [
		voiceMode,
		mockSession?.id,
		candidateRecording,
		playInterviewerAudio,
		aiSpeaking,
		mockSession?.status,
		voiceProcessing,
		mockSession?.conversation?.length,
		mockSession?.conversation,
		mockSession,
	]) // eslint-disable-line react-hooks/exhaustive-deps

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
				try {
					audioCtxRef.current.close()
				} catch (err) { console.error("[mock-interview] Operation failed:", err); }
			}
		}
	}, [stopMockFrameCapture, stopMockSpeechRecognition, stopVoiceMode, stopMockCamera])

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
					stream.getTracks().forEach((t) => {
						t.stop()
					})
					stream = null
				} catch {
					stream = null
				}
			}
			if (!stream) {
				setMockCameraError('Could not access camera')
				return
			}
			mockStreamRef.current = stream
			const v = mockVideoRef.current
			if (v) {
				v.srcObject = stream
				try {
					await v.play()
				} catch {
					try {
						await v.play()
					} catch (err) { console.error("[mock-interview] Camera play failed:", err); }
				}
			}
			setMockCameraReady(true)
		} catch (err: any) {
			setMockCameraError(err.message || 'Camera error')
		}
	}

	function stopMockCamera() {
		if (mockStreamRef.current) {
			mockStreamRef.current.getTracks().forEach((t) => {
				t.stop()
			})
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
		setFrameCount(0)
		setTimeout(() => {
			const frame = captureMockFrame()
			if (frame) {
				mockFramesRef.current.push(frame)
				mockPerQuestionFramesRef.current.push(frame)
				setFrameCount(mockPerQuestionFramesRef.current.length)
			}
		}, 500)
		mockFrameIntervalRef.current = setInterval(() => {
			const frame = captureMockFrame()
			if (frame) {
				if (mockFramesRef.current.length < 20) mockFramesRef.current.push(frame)
				if (mockPerQuestionFramesRef.current.length < 8) {
					mockPerQuestionFramesRef.current.push(frame)
					setFrameCount(mockPerQuestionFramesRef.current.length)
				}
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
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
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
					finalTranscript += `${result[0].transcript} `
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
				try {
					recognition.start()
				} catch (err) { console.error("[mock-interview] Operation failed:", err); }
			}
		}

		recognition.onend = () => {
			if (candidateRecordingRef.current) {
				try {
					recognition.start()
				} catch (err) { console.error("[mock-interview] Operation failed:", err); }
			}
		}

		try {
			recognition.start()
			mockRecognitionRef.current = recognition
		} catch (err) { console.error("[mock-interview] Operation failed:", err); }
	}

	function stopMockSpeechRecognition() {
		if (mockRecognitionRef.current) {
			try {
				mockRecognitionRef.current.stop()
			} catch (err) { console.error("[mock-interview] Operation failed:", err); }
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
					const preferred =
						voices.find(
							(v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'),
						) ||
						voices.find(
							(v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('samantha'),
						) ||
						voices.find((v) => v.lang.startsWith('en-US')) ||
						voices.find((v) => v.lang.startsWith('en'))
					if (preferred) utterance.voice = preferred
				}
			} else {
				const preferred =
					voices.find((v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('female')) ||
					voices.find(
						(v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('samantha'),
					) ||
					voices.find((v) => v.lang.startsWith('en-US')) ||
					voices.find((v) => v.lang.startsWith('en'))
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

			utterance.onend = () => {
				clearTimeout(timeout)
				clearInterval(keepAlive)
				resolve()
			}
			utterance.onerror = (e) => {
				clearTimeout(timeout)
				clearInterval(keepAlive)
				console.warn('[browser-tts] error:', e)
				resolve()
			}

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
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ text }),
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
				if (voiceModeRef.current && !candidateRecordingRef.current)
					setTimeout(() => startVoiceRecording(), 500)
				return
			}

			const arrayBuffer = await response.arrayBuffer()
			if (arrayBuffer.byteLength < 100) {
				console.error('[tts-client] Audio too small:', arrayBuffer.byteLength)
				await speakWithBrowserTTS(text)
				setAiSpeaking(false)
				if (voiceModeRef.current && !candidateRecordingRef.current)
					setTimeout(() => startVoiceRecording(), 500)
				return
			}

			const ctx = ensureAudioContext()

			try {
				const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
				if (mockAudioSourceRef.current) {
					try {
						mockAudioSourceRef.current.stop()
					} catch (err) { console.error("[mock-interview] Operation failed:", err); }
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
				console.warn(
					'[tts-client] Web Audio decode failed, falling back to Audio element:',
					decodeErr,
				)
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
					if (voiceModeRef.current && !candidateRecordingRef.current)
						setTimeout(() => startVoiceRecording(), 1000)
				}
				await audio.play()
			}
		} catch (err) {
			console.error('[tts-client] TTS playback error:', err)
			try {
				await speakWithBrowserTTS(text)
			} catch (err) { console.error("[mock-interview] Operation failed:", err); }
			setAiSpeaking(false)
			if (voiceModeRef.current && !candidateRecordingRef.current)
				setTimeout(() => startVoiceRecording(), 500)
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
			const hasLiveTrack = existingTracks.some((t) => t.readyState === 'live' && t.enabled)
			if (!voiceStreamRef.current || !hasLiveTrack) {
				if (voiceStreamRef.current) {
					console.log('[voice] Audio track died between questions — re-acquiring fresh stream')
					voiceStreamRef.current = null
				}
				const cameraLiveTrack = mockStreamRef.current
					?.getAudioTracks()
					.find((t) => t.readyState === 'live')
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
				try {
					analyserRef.current.disconnect()
				} catch (err) { console.error("[mock-interview] Operation failed:", err); }
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
					const voiceQuestionDuration = Math.round(
						(Date.now() - mockQuestionStartTimeRef.current) / 1000,
					)
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
							headers: { Authorization: `Bearer ${token}` },
							body: formData,
							signal: abortController.signal,
						})
						// Handle expired token — refresh and retry once
						if (res.status === 401) {
							try {
								const rt = localStorage.getItem('refresh_token')
								if (rt) {
									const rr = await fetch('/api/auth/refresh', {
										method: 'POST',
										headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({ refreshToken: rt }),
									})
									const rd = await rr.json()
									if (rd.accessToken) {
										localStorage.setItem('token', rd.accessToken)
										if (rd.refreshToken) localStorage.setItem('refresh_token', rd.refreshToken)
										token = rd.accessToken
										const retryFD = new FormData()
										retryFD.append('audio', audioBlob, `recording.${ext}`)
										if (liveTranscript.length >= 5) retryFD.append('response_text', liveTranscript)
										if (voicePerQuestionFrames.length > 0)
											retryFD.append('frames_json', JSON.stringify(voicePerQuestionFrames))
										retryFD.append('duration_seconds', String(voiceQuestionDuration))
										res = await fetch(`/api/interviews/mock/${currentSession.id}/voice-respond`, {
											method: 'POST',
											headers: { Authorization: `Bearer ${token}` },
											body: retryFD,
											signal: abortController.signal,
										})
									}
								}
							} catch (refreshErr) {
								console.warn('[voice] Token refresh failed:', refreshErr)
							}
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
							timestamp: new Date().toISOString(),
						}
						const cleanedInterviewerMsg = {
							...data.interviewer_message,
							text: deduplicateInterviewerText(data.interviewer_message.text),
						}
						const textWasDeduped = cleanedInterviewerMsg.text !== data.interviewer_message.text
						setMockSession((prev) =>
							prev
								? {
										...prev,
										conversation: [...prev.conversation, candidateMsg, cleanedInterviewerMsg],
									}
								: null,
						)
						setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)

						if (data.interviewer_audio_base64 && !textWasDeduped) {
							setAiSpeaking(true)
							const audioData = Uint8Array.from(atob(data.interviewer_audio_base64), (c) =>
								c.charCodeAt(0),
							)
							const ctx = ensureAudioContext()

							try {
								const audioBuffer = await ctx.decodeAudioData(audioData.buffer.slice(0))
								if (mockAudioSourceRef.current) {
									try {
										mockAudioSourceRef.current.stop()
									} catch (err) { console.error("[mock-interview] Operation failed:", err); }
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
									if (voiceModeRef.current && !data.is_wrapping_up)
										setTimeout(() => startVoiceRecording(), 1000)
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
							setVoiceError(
								'Could not understand your response. Tap the mic button to try again, or type your answer below.',
							)
						} else {
							setVoiceError(errorMsg)
						}
					}
				} catch (err: any) {
					if (err.name === 'AbortError') {
						console.warn('[voice] Request timed out after 28s')
						setVoiceError(
							'The AI is taking too long to respond. Tap the mic to try again, or type your answer below.',
						)
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
				setMockRecordingTime((prev) => prev + 1)
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
			try {
				mockAudioSourceRef.current.stop()
			} catch (err) { console.error("[mock-interview] Operation failed:", err); }
			mockAudioSourceRef.current = null
		}
		if (aiAudioRef.current) {
			aiAudioRef.current.pause()
			aiAudioRef.current = null
		}
		stopVoiceRecording()
		stopMockSpeechRecognition()
		if (voiceStreamRef.current && voiceStreamRef.current !== mockStreamRef.current) {
			const cameraAudioIds = mockStreamRef.current?.getAudioTracks().map((t) => t.id) || []
			voiceStreamRef.current.getTracks().forEach((t) => {
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

			const res = await apiCall<{
				success: boolean
				session: MockSession
				first_message: MockConversationTurn
			}>('/interviews/mock/start', {
				method: 'POST',
				body: {
					target_role: mockTargetRole.trim(),
					job_description: mockJobDescription.trim() || undefined,
				},
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
			if (
				msg.includes('429') ||
				msg.includes('rate') ||
				msg.includes('limit') ||
				msg.includes('token')
			) {
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

		const candidateMsg: MockConversationTurn = {
			role: 'candidate',
			text,
			timestamp: new Date().toISOString(),
		}
		setMockSession((prev) =>
			prev ? { ...prev, conversation: [...prev.conversation, candidateMsg] } : null,
		)
		setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

		try {
			const textAbort = new AbortController()
			const textTimeout = setTimeout(() => textAbort.abort(), 28000)

			try {
				const res = await apiCall<{
					success: boolean
					interviewer_message: MockConversationTurn
					action: string
					is_wrapping_up: boolean
				}>(`/interviews/mock/${mockSession.id}/respond`, {
					method: 'POST',
					body: {
						response_text: text,
						frames: perQuestionFrames.length > 0 ? perQuestionFrames : undefined,
						duration_seconds: questionDuration,
					},
					signal: textAbort.signal,
				})
				if (res.success) {
					const cleanedResMsg = {
						...res.interviewer_message,
						text: deduplicateInterviewerText(res.interviewer_message.text),
					}
					setMockSession((prev) =>
						prev
							? {
									...prev,
									conversation: [...prev.conversation, cleanedResMsg],
								}
							: null,
					)
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
			await new Promise<void>((resolve) => {
				const check = setInterval(() => {
					if (!voiceProcessingRef.current) {
						clearInterval(check)
						resolve()
					}
				}, 200)
				setTimeout(() => {
					clearInterval(check)
					resolve()
				}, 6000)
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
				new Promise((resolve) => setTimeout(resolve, 3000)),
			]).catch(() => {})
		}

		try {
			const frames = mockFramesRef.current.length > 0 ? mockFramesRef.current : undefined
			const res = await apiCall<{
				success: boolean
				feedback: SessionFeedback
				no_feedback?: boolean
			}>(`/interviews/mock/${mockSession.id}/end`, {
				method: 'POST',
				body: { frames },
			})
			if (res.success) {
				stopMockCamera()
				if (res.no_feedback) {
					setMockFeedback({
						overall_score: 0,
						interview_readiness: 'needs_practice',
						summary:
							'Interview ended before any questions were answered. No feedback is available. Start a new interview to practice!',
						strengths: [],
						improvements: ['Complete at least one question to receive feedback'],
						question_scores: [],
						star_method_usage: { score: 0, feedback: 'N/A' },
						communication_quality: { score: 0, feedback: 'N/A' },
						technical_depth: { score: 0, feedback: 'N/A' },
						top_tip: 'Start a new interview to practice.',
					} as SessionFeedback)
				} else {
					setMockFeedback(res.feedback)
					if (res.feedback && !res.feedback.presentation) {
						const sessionIdForPolling = mockSession.id
						const pollFeedback = async () => {
							try {
								const pollRes = await apiCall<{ success: boolean; feedback: SessionFeedback }>(
									`/interviews/mock/sessions/${sessionIdForPolling}/feedback`,
								)
								if (pollRes.success && pollRes.feedback) {
									setMockFeedback(pollRes.feedback)
									return !!pollRes.feedback.presentation
								}
							} catch {
								/* ignore poll errors */
							}
							return false
						}
						setTimeout(async () => {
							const done = await pollFeedback()
							if (!done) setTimeout(pollFeedback, 15000)
						}, 15000)
					}
				}
				setMockSession((prev) => (prev ? { ...prev, status: 'completed' } : null))
				mockFramesRef.current = []
				onSessionComplete()
			}
		} catch (_err: any) {
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
				top_tip: 'Start a new interview to practice.',
			} as SessionFeedback)
			setMockSession((prev) => (prev ? { ...prev, status: 'completed' } : null))
			mockFramesRef.current = []
		} finally {
			setMockEnding(false)
		}
	}

	async function viewPastSession(sessionId: number) {
		setHistoryLoading(sessionId)
		try {
			// Fetch full session (includes conversation, overall_feedback, etc.)
			const sessionRes = await apiCall<{ success: boolean; session: MockSession }>(
				`/interviews/mock/sessions/${sessionId}`,
			)
			if (!sessionRes.success || !sessionRes.session) return

			const session = sessionRes.session
			// Parse overall_feedback if it's a string
			let feedback: SessionFeedback | null = null
			if (session.overall_feedback) {
				feedback =
					typeof session.overall_feedback === 'string'
						? JSON.parse(session.overall_feedback)
						: session.overall_feedback
			}

			if (!feedback) {
				// Try the dedicated feedback endpoint
				try {
					const fbRes = await apiCall<{ success: boolean; feedback: SessionFeedback }>(
						`/interviews/mock/sessions/${sessionId}/feedback`,
					)
					if (fbRes.success && fbRes.feedback) feedback = fbRes.feedback
				} catch {
					/* no feedback available */
				}
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
		if (mockRecordingTimerRef.current) {
			clearInterval(mockRecordingTimerRef.current)
			mockRecordingTimerRef.current = null
		}
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
			<InterviewActiveLayout
				mockSession={mockSession}
				mockVideoRef={mockVideoRef}
				mockCameraReady={mockCameraReady}
				mockCameraError={_mockCameraError}
				voiceMode={voiceMode}
				aiSpeaking={aiSpeaking}
				candidateRecording={candidateRecording}
				voiceProcessing={voiceProcessing}
				silenceTimer={silenceTimer}
				voiceError={voiceError}
				mockLiveTranscript={mockLiveTranscript}
				mockRecordingTime={mockRecordingTime}
				bodyLanguageIndicators={bodyLanguageIndicators}
				frameCount={frameCount}
				mockResponseText={mockResponseText}
				setMockResponseText={setMockResponseText}
				mockSending={mockSending}
				startVoiceRecording={startVoiceRecording}
				stopVoiceRecording={stopVoiceRecording}
				startMockCamera={startMockCamera}
				stopMockCamera={stopMockCamera}
				endMockInterview={endMockInterview}
				sendMockResponse={sendMockResponse}
				setVoiceError={setVoiceError}
				chatEndRef={chatEndRef}
			/>
			) : mockFeedback ? (
			<InterviewResultsPage
				mockSession={mockSession}
				mockFeedback={mockFeedback}
				viewingHistorySession={viewingHistorySession}
				onBack={backToSetup}
				onNewInterview={resetMockInterview}
			/>
			) : (
				/* Setup / Landing */
				<div className='space-y-6'>
					{/* Hero CTA */}
					{!mockShowSetup && (
						<Card className='border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent'>
							<CardContent className='p-6 text-center'>
								<div className='inline-flex p-4 rounded-2xl bg-primary/10 mb-4'>
									<Video className='h-8 w-8 text-primary' />
								</div>
								<h3 className='text-lg font-bold mb-2'>Mock Interview</h3>
								<p className='text-sm text-muted-foreground mb-4 max-w-md mx-auto'>
									Practice with a <strong>real video call experience</strong>. Your AI interviewer
									speaks out loud while you answer on camera — just like Zoom. Get scored and get
									feedback after.
								</p>
								<div className='flex items-center justify-center gap-3 mb-3 flex-wrap'>
									<div className='flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-3 py-1.5 rounded-full'>
										<Volume2 className='h-3.5 w-3.5' /> Real-time AI voice
									</div>
									<div className='flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full'>
										<Camera className='h-3.5 w-3.5' /> Body language analysis
									</div>
									<div className='flex items-center gap-1.5 text-xs text-sky-600 bg-sky-50 px-3 py-1.5 rounded-full'>
										<Brain className='h-3.5 w-3.5' /> Voice & delivery coaching
									</div>
								</div>
								<Button
									onClick={() => setMockShowSetup(true)}
									size='lg'
									className='min-h-[44px] min-w-[44px]'
								>
									<Video className='h-4 w-4 mr-2' /> Start Mock Interview
								</Button>
							</CardContent>
						</Card>
					)}

					{/* Setup form */}
					{mockShowSetup && (
						<Card className='border-2 border-primary/20'>
							<CardContent className='p-6 space-y-4'>
								<div>
									<h3 className='font-semibold flex items-center gap-2 mb-1'>
										<Briefcase className='h-4 w-4 text-primary' /> Set Up Your Interview
									</h3>
									<p className='text-xs text-muted-foreground'>
										Questions are generated specifically for your target role. The more context you
										give, the more realistic the interview.
									</p>
								</div>

								<div className='space-y-2'>
									<label className='text-sm font-medium'>Target Role *</label>
									<input
										type='text'
										value={mockTargetRole}
										onChange={(e) => setMockTargetRole(e.target.value)}
										placeholder='e.g. "Senior Software Engineer", "Product Manager", "Data Scientist"'
										className='w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'
									/>
								</div>

								<div className='space-y-2'>
									<label className='text-sm font-medium'>
										Job Description{' '}
										<span className='text-xs text-muted-foreground'>
											(optional but recommended)
										</span>
									</label>
									<Textarea
										value={mockJobDescription}
										onChange={(e) => setMockJobDescription(e.target.value)}
										placeholder='Paste the job description here for highly targeted questions...'
										rows={4}
										className='resize-y text-sm'
									/>
								</div>

								<div className='flex items-center gap-3 p-3 rounded-lg bg-sky-50 border border-sky-100'>
									<div className='h-9 w-9 rounded-full bg-sky-100 flex items-center justify-center shrink-0'>
										<Video className='h-4 w-4 text-sky-600' />
									</div>
									<div className='flex-1'>
										<p className='text-sm font-medium text-sky-900'>Video call experience</p>
										<p className='text-xs text-sky-600'>
											Camera & mic will be enabled. AI speaks questions, you answer verbally — like
											a real interview.
										</p>
									</div>
								</div>

								<div className='flex gap-2'>
									<Button
										variant='outline'
										onClick={() => setMockShowSetup(false)}
										className='min-h-[44px] min-w-[44px] flex-1'
									>
										Cancel
									</Button>
									<Button
										onClick={startMockInterview}
										disabled={mockStarting || mockTargetRole.trim().length < 2}
										className='min-h-[44px] min-w-[44px] flex-1'
									>
										{mockStarting ? (
											<>
												<Loader2 className='h-4 w-4 mr-2 animate-spin' />
												Generating questions...
											</>
										) : (
											<>
												<Video className='h-4 w-4 mr-2' />
												Start Mock Interview
											</>
										)}
									</Button>
								</div>

								{mockStarting && (
									<p className='text-xs text-center text-muted-foreground animate-pulse'>
										AI is creating personalized questions for your {mockTargetRole} interview — this
										takes 10-20 seconds...
									</p>
								)}
							</CardContent>
						</Card>
					)}

					{/* Past mock interview sessions */}
					{mockPastSessions.length > 0 && (
						<div>
							<h3 className='font-semibold text-sm mb-3 flex items-center gap-2'>
								<History className='h-4 w-4 text-muted-foreground' /> Past Mock Interviews
							</h3>
							<div className='space-y-2'>
								{mockPastSessions.map((s) => {
									const tags = s.category_tags || ['behavioral']
									return (
										<Card
											key={s.id}
											className={`hover:border-primary/30 transition-colors ${s.status === 'completed' ? 'cursor-pointer' : ''} ${historyLoading === s.id ? 'opacity-60' : ''}`}
											onClick={() => s.status === 'completed' && viewPastSession(s.id)}
										>
											<CardContent className='p-4'>
												<div className='flex items-center justify-between'>
													<div className='flex items-center gap-3'>
														{historyLoading === s.id ? (
															<div className='h-10 w-10 rounded-lg flex items-center justify-center bg-muted'>
																<Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
															</div>
														) : s.overall_score ? (
															<div
																className={`h-10 w-10 rounded-lg flex items-center justify-center border ${scoreBg(s.overall_score)}`}
															>
																<span className={`font-bold ${scoreColor(s.overall_score)}`}>
																	{s.overall_score}
																</span>
															</div>
														) : (
															<div className='h-10 w-10 rounded-lg flex items-center justify-center bg-muted'>
																<span className='text-xs text-muted-foreground'>—</span>
															</div>
														)}
														<div>
															<p className='text-sm font-medium'>{s.target_role}</p>
															<div className='flex flex-wrap items-center gap-1.5 mt-1'>
																{tags.map((tag) => {
																	const cfg = categoryConfig[tag] || categoryConfig.behavioral
																	const TagIcon = cfg.icon
																	return (
																		<Badge
																			key={tag}
																			variant='secondary'
																			className={`${cfg.bg} ${cfg.color} text-[10px] border-0 py-0`}
																		>
																			<TagIcon className='h-2.5 w-2.5 mr-0.5' /> {cfg.label}
																		</Badge>
																	)
																})}
																<Badge variant='outline' className='text-[10px] py-0'>
																	<Mic className='h-2.5 w-2.5 mr-0.5' /> Voice
																</Badge>
															</div>
															<div className='flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5'>
																<span>{s.questions_asked} questions</span>
																<span>·</span>
																<span>{s.follow_ups_asked} follow-ups</span>
																<span>·</span>
																<span>{Math.round(s.duration_minutes)} min</span>
															</div>
														</div>
													</div>
													<div className='text-right'>
														<Badge
															variant={s.status === 'completed' ? 'secondary' : 'outline'}
															className='text-[10px]'
														>
															{s.status === 'completed' ? 'Completed' : 'In Progress'}
														</Badge>
														<p className='text-[10px] text-muted-foreground mt-1'>
															{new Date(s.started_at).toLocaleDateString()}
														</p>
														{s.status === 'completed' && (
															<p className='text-[10px] text-primary mt-0.5 font-medium'>
																View feedback →
															</p>
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
