// Modern video call layout for active AI interview
// Extracted from mock-interview.tsx for maintainability

import {
	AlertCircle,
	Brain,
	Camera,
	Loader2,
	Maximize2,
	MessageSquare,
	Mic,
	MicOff,
	Minimize2,
	Monitor,
	MonitorOff,
	PhoneOff,
	Send,
	Square,
	User,
	Video,
	VideoOff,
	Volume2,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'

import type { MockConversationTurn, MockSession } from './coaching-types'
import { formatTime } from './coaching-utils'

interface InterviewActiveLayoutProps {
	mockSession: MockSession
	mockVideoRef: React.RefObject<HTMLVideoElement | null>
	mockCameraReady: boolean
	mockCameraError: string | null

	// Voice state
	voiceMode: boolean
	aiSpeaking: boolean
	candidateRecording: boolean
	voiceProcessing: boolean
	silenceTimer: number
	voiceError: string | null
	mockLiveTranscript: string
	mockRecordingTime: number

	// Body language
	bodyLanguageIndicators: {
		eye_contact: string
		posture: string
		confidence: string
		expression: string
		last_updated: string
	} | null

	// Frame stats (for display)
	frameCount: number

	// Text input
	mockResponseText: string
	setMockResponseText: (text: string) => void
	mockSending: boolean

	// Callbacks
	startVoiceRecording: () => void
	stopVoiceRecording: () => void
	startMockCamera: () => void
	stopMockCamera: () => void
	endMockInterview: () => void
	sendMockResponse: () => void
	setVoiceError: (error: string | null) => void

	// Refs for scrolling
	chatEndRef: React.RefObject<HTMLDivElement | null>
}

export function InterviewActiveLayout({
	mockSession,
	mockVideoRef,
	mockCameraReady,
	mockCameraError,
	voiceMode,
	aiSpeaking,
	candidateRecording,
	voiceProcessing,
	silenceTimer,
	voiceError,
	mockLiveTranscript,
	mockRecordingTime,
	bodyLanguageIndicators,
	frameCount,
	mockResponseText,
	setMockResponseText,
	mockSending,
	startVoiceRecording,
	stopVoiceRecording,
	startMockCamera,
	stopMockCamera,
	endMockInterview,
	sendMockResponse,
	setVoiceError,
	chatEndRef,
}: InterviewActiveLayoutProps) {
	const [showChat, setShowChat] = useState(true)
	const [chatPanelMobileOpen, setChatPanelMobileOpen] = useState(false)
	const [isFullscreen, setIsFullscreen] = useState(false)
	const videoContainerRef = useRef<HTMLDivElement>(null)
	const [interviewDuration, setInterviewDuration] = useState(0)

	// Interview duration timer
	useEffect(() => {
		const interval = setInterval(() => {
			setInterviewDuration((prev) => prev + 1)
		}, 1000)
		return () => clearInterval(interval)
	}, [])

	// Auto-scroll chat
	useEffect(() => {
		chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [mockSession.conversation.length, mockLiveTranscript, voiceProcessing, chatEndRef])

	// Fullscreen toggle
	const toggleFullscreen = () => {
		if (!videoContainerRef.current) return
		if (!document.fullscreenElement) {
			videoContainerRef.current.requestFullscreen().catch(() => {})
			setIsFullscreen(true)
		} else {
			document.exitFullscreen().catch(() => {})
			setIsFullscreen(false)
		}
	}

	useEffect(() => {
		const handler = () => setIsFullscreen(!!document.fullscreenElement)
		document.addEventListener('fullscreenchange', handler)
		return () => document.removeEventListener('fullscreenchange', handler)
	}, [])

	const currentQuestion = mockSession.conversation.filter((t) => t.role === 'interviewer').length
	const totalQuestions = mockSession.questions_asked + mockSession.follow_ups_asked

	// Status message
	const statusMessage = voiceError
		? null // handled separately
		: aiSpeaking
			? 'AI interviewer is speaking...'
			: candidateRecording
				? silenceTimer > 0
					? `Paused ${silenceTimer}s — auto-sends when silent`
					: 'Recording... speak your answer'
				: voiceProcessing
					? 'Processing your response...'
					: 'Tap the microphone to answer'

	return (
		<div className='flex flex-col h-[calc(100vh-8rem)] min-h-[500px] gap-0 rounded-xl overflow-hidden border bg-background shadow-sm'>
			{/* ===== HEADER ===== */}
			<header className='flex items-center justify-between px-4 py-2.5 bg-card border-b shrink-0'>
				<div className='flex items-center gap-3'>
					{/* AI Interviewer Avatar */}
					<div className='relative'>
						<div className='h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm'>
							<Brain className='h-4 w-4 text-white' />
						</div>
						{aiSpeaking && (
							<span className='absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background animate-pulse' />
						)}
					</div>
					<div>
						<h2 className='text-sm font-semibold leading-tight'>Alex — AI Interviewer</h2>
						<p className='text-[11px] text-muted-foreground'>
							{mockSession.target_role}
						</p>
					</div>
				</div>

				{/* Center: Timer & Progress */}
				<div className='hidden sm:flex items-center gap-4'>
					<div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
						<span className='font-mono font-medium text-foreground'>
							{formatTime(interviewDuration)}
						</span>
						<span>elapsed</span>
					</div>
					<div className='h-4 w-px bg-border' />
					<div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
						<span className='font-medium text-foreground'>
							{currentQuestion}
						</span>
						<span>/</span>
						<span>{Math.max(totalQuestions, currentQuestion)}</span>
						<span>questions</span>
					</div>
					{candidateRecording && (
						<>
							<div className='h-4 w-px bg-border' />
							<div className='flex items-center gap-1.5 text-xs font-medium text-red-500'>
								<div className='h-2 w-2 rounded-full bg-red-500 animate-pulse' />
								REC {formatTime(mockRecordingTime)}
							</div>
						</>
					)}
				</div>

				{/* Right: Actions */}
				<div className='flex items-center gap-2'>
					{/* Mobile chat toggle */}
					<Button
						variant='ghost'
						size='sm'
						className='lg:hidden h-8 w-8 p-0'
						onClick={() => setChatPanelMobileOpen(true)}
					>
						<MessageSquare className='h-4 w-4' />
					</Button>
					{/* Desktop chat toggle */}
					<Button
						variant='ghost'
						size='sm'
						className='hidden lg:flex h-8 gap-1.5 text-xs'
						onClick={() => setShowChat((s) => !s)}
					>
						{showChat ? <Minimize2 className='h-3.5 w-3.5' /> : <Maximize2 className='h-3.5 w-3.5' />}
						{showChat ? 'Hide Chat' : 'Show Chat'}
					</Button>
				</div>
			</header>

			{/* ===== MAIN CONTENT ===== */}
			<div className='flex flex-1 overflow-hidden'>
				{/* Video Area */}
				<div className='flex-1 flex flex-col relative min-w-0'>
					{/* Primary Video Feed */}
					<div
						ref={videoContainerRef}
						className='flex-1 relative bg-black min-h-0'
					>
						<video
							ref={mockVideoRef}
							autoPlay
							muted
							playsInline
							webkit-playsinline=''
							className='absolute inset-0 w-full h-full object-cover'
							style={{ transform: 'scaleX(-1)' }}
						/>

						{/* Camera loading / error overlay */}
						{!mockCameraReady && (
							<div className='absolute inset-0 flex items-center justify-center bg-gray-950/90 z-10'>
								<div className='text-center text-white'>
									{mockCameraError ? (
										<>
											<VideoOff className='h-10 w-10 mx-auto mb-3 opacity-60' />
											<p className='text-sm font-medium'>Camera unavailable</p>
											<p className='text-xs opacity-60 mt-1'>{mockCameraError}</p>
											<Button
												variant='outline'
												size='sm'
												className='mt-3 text-xs'
												onClick={startMockCamera}
											>
												Retry Camera
											</Button>
										</>
									) : (
										<>
											<div className='h-10 w-10 mx-auto mb-3 rounded-full border-2 border-white/20 border-t-white animate-spin' />
											<p className='text-sm'>Starting camera...</p>
										</>
									)}
								</div>
							</div>
						)}

						{/* Body language indicators — top left */}
						{bodyLanguageIndicators && (
							<div className='absolute top-3 left-3 z-10 flex flex-wrap gap-1.5 max-w-[60%]'>
								{[
									{ emoji: '👁️', label: 'Eyes', value: bodyLanguageIndicators.eye_contact },
									{ emoji: '🧍', label: 'Posture', value: bodyLanguageIndicators.posture },
									{ emoji: '💪', label: 'Confidence', value: bodyLanguageIndicators.confidence },
									{ emoji: '😊', label: 'Expression', value: bodyLanguageIndicators.expression },
								].map((item) => (
									<div
										key={item.label}
										className={`px-2 py-1 rounded-md text-[10px] font-medium backdrop-blur-sm ${
											item.value === 'good' ||
											item.value === 'confident' ||
											item.value === 'engaged' ||
											item.value === 'positive'
												? 'bg-green-500/80 text-white'
												: item.value === 'neutral' ||
													item.value === 'moderate' ||
													item.value === 'ok'
													? 'bg-amber-500/80 text-white'
													: 'bg-red-500/80 text-white'
										}`}
									>
										{item.emoji} {item.value || '?'}
									</div>
								))}
							</div>
						)}

						{/* Recording badge — top right */}
						{candidateRecording && (
							<div className='absolute top-3 right-3 z-10 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg'>
								<div className='h-2 w-2 rounded-full bg-white animate-pulse' />
								REC {formatTime(mockRecordingTime)}
							</div>
						)}

						{/* Frame count badge (when recording) */}
						{candidateRecording && (
							<div className='absolute top-3 right-3 z-10 mt-8 flex flex-col gap-1 items-end'>
								<div className='bg-black/60 backdrop-blur-sm text-white px-2 py-1 rounded text-[10px]'>
									{frameCount} frames
								</div>
								<div className='bg-black/60 backdrop-blur-sm text-white px-2 py-1 rounded text-[10px]'>
									{mockLiveTranscript.split(/\s+/).filter((w) => w).length} words
								</div>
							</div>
						)}

						{/* AI Speaking overlay */}
						{aiSpeaking && (
							<div className='absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-indigo-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg'>
								<Volume2 className='h-4 w-4 animate-pulse' />
								AI Interviewer is speaking
							</div>
						)}

						{/* Self-view thumbnail (picture-in-picture style) */}
						{mockCameraReady && (
							<div className='absolute bottom-4 right-4 z-10 w-28 h-20 sm:w-36 sm:h-24 rounded-lg overflow-hidden border-2 border-white/20 shadow-lg bg-black'>
								<video
									ref={(el) => {
										if (el && mockVideoRef.current) {
											el.srcObject = mockVideoRef.current.srcObject
										}
									}}
									autoPlay
									muted
									playsInline
									className='w-full h-full object-cover'
									style={{ transform: 'scaleX(-1)' }}
								/>
								<div className='absolute bottom-1 left-1.5 text-[9px] text-white/80 font-medium bg-black/40 px-1 rounded'>
									You
								</div>
							</div>
						)}

						{/* Fullscreen toggle */}
						<Button
							variant='ghost'
							size='sm'
							className='absolute top-3 right-3 z-10 h-8 w-8 p-0 bg-black/40 text-white hover:bg-black/60 hover:text-white'
							onClick={toggleFullscreen}
						>
							{isFullscreen ? <Minimize2 className='h-4 w-4' /> : <Maximize2 className='h-4 w-4' />}
						</Button>
					</div>

					{/* Status bar below video */}
					<div className='shrink-0 px-4 py-2 bg-card border-t flex items-center justify-between'>
						<div className='flex items-center gap-2'>
							{voiceError ? (
								<div className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs'>
									<AlertCircle className='h-3 w-3' />
									<span className='max-w-[200px] sm:max-w-sm truncate'>{voiceError}</span>
									<button
										onClick={() => setVoiceError(null)}
										className='ml-1 text-red-400 hover:text-red-600'
									>
										<X className='h-3 w-3' />
									</button>
								</div>
							) : (
								<p className='text-xs text-muted-foreground'>{statusMessage}</p>
							)}
						</div>
						<div className='hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground'>
							{voiceMode && (
								<span className='flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700'>
									<Mic className='h-2.5 w-2.5' /> Voice mode
								</span>
							)}
						</div>
					</div>
				</div>

				{/* ===== CHAT PANEL (Desktop) ===== */}
				{showChat && (
					<div className='hidden lg:flex w-80 xl:w-96 flex-col border-l bg-card shrink-0'>
						<ChatPanelContent
							conversation={mockSession.conversation}
							candidateRecording={candidateRecording}
							mockLiveTranscript={mockLiveTranscript}
							voiceProcessing={voiceProcessing}
							chatEndRef={chatEndRef}
							mockResponseText={mockResponseText}
							setMockResponseText={setMockResponseText}
							mockSending={mockSending}
							sendMockResponse={sendMockResponse}
						/>
					</div>
				)}
			</div>

			{/* ===== CONTROLS BAR ===== */}
			<div className='shrink-0 px-4 py-3 bg-card border-t'>
				<div className='flex items-center justify-center gap-3 sm:gap-4'>
					{/* Mute / Unmute (mic) */}
					<ControlButton
						onClick={candidateRecording ? stopVoiceRecording : startVoiceRecording}
						active={candidateRecording}
						variant={candidateRecording ? 'danger' : 'primary'}
						icon={candidateRecording ? MicOff : Mic}
						label={candidateRecording ? 'Stop' : 'Speak'}
						pulse={candidateRecording}
					/>

					{/* Camera toggle */}
					<ControlButton
						onClick={mockCameraReady ? stopMockCamera : startMockCamera}
						active={mockCameraReady}
						variant='default'
						icon={mockCameraReady ? Video : VideoOff}
						label={mockCameraReady ? 'Camera' : 'Camera'}
					/>

					{/* Screen share (placeholder — toggles icon only for now) */}
					<ControlButton
						onClick={() => {}}
						active={false}
						variant='default'
						icon={Monitor}
						label='Share'
						disabled
					/>

					{/* Divider */}
					<div className='h-8 w-px bg-border mx-1' />

					{/* End call */}
					<Button
						onClick={endMockInterview}
						className='h-11 px-5 bg-red-600 hover:bg-red-700 text-white rounded-full font-medium shadow-sm'
					>
						<PhoneOff className='h-4 w-4 mr-1.5' />
						<span className='hidden sm:inline'>End Interview</span>
					</Button>
				</div>
			</div>

			{/* ===== MOBILE BOTTOM SHEET: CHAT ===== */}
			<Sheet open={chatPanelMobileOpen} onOpenChange={setChatPanelMobileOpen} side='bottom'>
				<SheetContent className='h-[70vh] p-0 flex flex-col'>
					<div className='flex items-center justify-between px-4 py-3 border-b'>
						<h3 className='text-sm font-semibold flex items-center gap-2'>
							<MessageSquare className='h-4 w-4' /> Conversation
						</h3>
						<Button
							variant='ghost'
							size='sm'
							className='h-8 w-8 p-0'
							onClick={() => setChatPanelMobileOpen(false)}
						>
							<X className='h-4 w-4' />
						</Button>
					</div>
					<div className='flex-1 overflow-hidden'>
						<ChatPanelContent
							conversation={mockSession.conversation}
							candidateRecording={candidateRecording}
							mockLiveTranscript={mockLiveTranscript}
							voiceProcessing={voiceProcessing}
							chatEndRef={chatEndRef}
							mockResponseText={mockResponseText}
							setMockResponseText={setMockResponseText}
							mockSending={mockSending}
							sendMockResponse={sendMockResponse}
						/>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	)
}

// ===== CONTROL BUTTON =====
function ControlButton({
	onClick,
	active,
	variant,
	icon: Icon,
	label,
	pulse = false,
	disabled = false,
}: {
	onClick: () => void
	active: boolean
	variant: 'primary' | 'danger' | 'default'
	icon: React.ElementType
	label: string
	pulse?: boolean
	disabled?: boolean
}) {
	const baseClasses =
		'h-11 w-11 sm:h-12 sm:w-12 rounded-full flex flex-col items-center justify-center gap-0.5 transition-all duration-200'
	const variantClasses = {
		primary: active
			? 'bg-indigo-600 text-white shadow-md'
			: 'bg-muted hover:bg-muted-foreground/20 text-foreground border',
		danger: active
			? 'bg-red-600 text-white shadow-md animate-pulse'
			: 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
		default: active
			? 'bg-indigo-600 text-white shadow-md'
			: 'bg-muted hover:bg-muted-foreground/20 text-foreground border',
	}

	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={`${baseClasses} ${variantClasses[variant]} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
			title={label}
		>
			<Icon className={`h-5 w-5 ${pulse ? 'animate-pulse' : ''}`} />
			<span className='text-[9px] font-medium hidden sm:block'>{label}</span>
		</button>
	)
}

// ===== CHAT PANEL CONTENT =====
function ChatPanelContent({
	conversation,
	candidateRecording,
	mockLiveTranscript,
	voiceProcessing,
	chatEndRef,
	mockResponseText,
	setMockResponseText,
	mockSending,
	sendMockResponse,
}: {
	conversation: MockConversationTurn[]
	candidateRecording: boolean
	mockLiveTranscript: string
	voiceProcessing: boolean
	chatEndRef: React.RefObject<HTMLDivElement | null>
	mockResponseText: string
	setMockResponseText: (text: string) => void
	mockSending: boolean
	sendMockResponse: () => void
}) {
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [conversation.length, mockLiveTranscript, voiceProcessing])

	return (
		<>
			{/* Messages */}
			<div ref={scrollRef} className='flex-1 overflow-y-auto p-3 space-y-3 min-h-0'>
				{conversation.map((turn, i) => (
					<ChatMessage key={turn.id || `turn-${i}`} turn={turn} />
				))}

				{/* Live transcription */}
				{candidateRecording && mockLiveTranscript && (
					<div className='flex gap-2.5 opacity-60'>
						<div className='h-7 w-7 rounded-full flex items-center justify-center shrink-0 bg-green-100'>
							<User className='h-3.5 w-3.5 text-green-600' />
						</div>
						<div className='flex-1 min-w-0'>
							<p className='text-[10px] font-medium text-green-600'>You (speaking...)</p>
							<p className='text-xs italic leading-relaxed'>{mockLiveTranscript}</p>
						</div>
					</div>
				)}

				{/* Processing */}
				{voiceProcessing && (
					<div className='flex gap-2.5 opacity-60'>
						<div className='h-7 w-7 rounded-full flex items-center justify-center shrink-0 bg-amber-100'>
							<Loader2 className='h-3.5 w-3.5 text-amber-600 animate-spin' />
						</div>
						<p className='text-xs text-amber-600 self-center'>Processing your answer...</p>
					</div>
				)}

				<div ref={chatEndRef} />
			</div>

			{/* Text input fallback */}
			{!candidateRecording && (
				<div className='shrink-0 p-3 border-t bg-card'>
					<div className='flex gap-2'>
						<Textarea
							value={mockResponseText}
							onChange={(e) => setMockResponseText(e.target.value)}
							placeholder='Or type your answer...'
							rows={2}
							className='resize-none text-xs min-h-[60px]'
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault()
									sendMockResponse()
								}
							}}
						/>
						<Button
							onClick={sendMockResponse}
							disabled={mockSending || mockResponseText.trim().length < 10}
							className='shrink-0 self-end h-9 w-9 p-0'
							size='sm'
						>
							<Send className='h-3.5 w-3.5' />
						</Button>
					</div>
				</div>
			)}
		</>
	)
}

// ===== CHAT MESSAGE =====
function ChatMessage({ turn }: { turn: MockConversationTurn }) {
	const isInterviewer = turn.role === 'interviewer'
	return (
		<div className='flex gap-2.5'>
			<div
				className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
					isInterviewer ? 'bg-indigo-100' : 'bg-green-100'
				}`}
			>
				{isInterviewer ? (
					<Brain className='h-3.5 w-3.5 text-indigo-600' />
				) : (
					<User className='h-3.5 w-3.5 text-green-600' />
				)}
			</div>
			<div className='flex-1 min-w-0'>
				<div className='flex items-center gap-1.5 mb-0.5'>
					<p className={`text-[10px] font-semibold ${isInterviewer ? 'text-indigo-600' : 'text-green-600'}`}>
						{isInterviewer ? 'Alex' : 'You'}
					</p>
					{turn.action && turn.action !== 'transition' && (
						<span className='text-[9px] text-muted-foreground'>
							·{' '}
							{turn.action === 'follow_up'
								? 'Follow-up'
								: turn.action === 'challenge'
									? 'Probing'
									: turn.action === 'introduction'
										? 'Intro'
										: turn.action === 'wrap_up'
											? 'Wrap-up'
											: turn.action}
						</span>
					)}
				</div>
				<div
					className={`text-xs leading-relaxed whitespace-pre-wrap rounded-lg px-2.5 py-1.5 ${
						isInterviewer
							? 'bg-indigo-50/70 text-foreground'
							: 'bg-green-50/70 text-foreground'
					}`}
				>
					{turn.text}
				</div>
			</div>
		</div>
	)
}
