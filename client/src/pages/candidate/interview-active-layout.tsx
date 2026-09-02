// Modern video call layout for active AI interview
// Polished design: glassmorphism, floating controls, participant tiles, chat sidebar

import {
	AlertCircle,
	Brain,
	Expand,
	FileText,
	Hand,
	Loader2,
	Maximize2,
	MessageSquare,
	Mic,
	MicOff,
	Minimize2,
	Monitor,
	MoreHorizontal,
	PhoneOff,
	Plus,
	Send,
	Settings,
	Smile,
	Sparkles,
	User,
	Video,
	VideoOff,
	Volume2,
	Wand2,
	X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { MockConversationTurn, MockSession } from './coaching-types';
import { formatTime } from './coaching-utils';

interface InterviewActiveLayoutProps {
	mockSession: MockSession;
	mockVideoRef: React.RefObject<HTMLVideoElement | null>;
	mockCameraReady: boolean;
	mockCameraError: string | null;

	// Voice state
	voiceMode: boolean;
	aiSpeaking: boolean;
	candidateRecording: boolean;
	voiceProcessing: boolean;
	silenceTimer: number;
	voiceError: string | null;
	mockLiveTranscript: string;
	mockRecordingTime: number;

	// Body language
	bodyLanguageIndicators: {
		eye_contact: string;
		posture: string;
		confidence: string;
		expression: string;
		last_updated: string;
	} | null;

	// Frame stats (for display)
	frameCount: number;

	// Text input
	mockResponseText: string;
	setMockResponseText: (text: string) => void;
	mockSending: boolean;

	// Callbacks
	startVoiceRecording: () => void;
	stopVoiceRecording: () => void;
	startMockCamera: () => void;
	stopMockCamera: () => void;
	endMockInterview: () => void;
	sendMockResponse: () => void;
	setVoiceError: (error: string | null) => void;

	// Refs for scrolling
	chatEndRef: React.RefObject<HTMLDivElement | null>;
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
	const [showChat, setShowChat] = useState(true);
	const [chatPanelMobileOpen, setChatPanelMobileOpen] = useState(false);
	const [controlsMobileOpen, setControlsMobileOpen] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isVideoOn, setIsVideoOn] = useState(true);
	const [_isMicOn, setIsMicOn] = useState(true);
	const [showReactions, setShowReactions] = useState(false);
	const [raisedHand, setRaisedHand] = useState(false);
	const videoContainerRef = useRef<HTMLDivElement>(null);
	const [interviewDuration, setInterviewDuration] = useState(0);
	const [activeSpeaker, setActiveSpeaker] = useState<'ai' | 'candidate'>('ai');

	// Interview duration timer
	useEffect(() => {
		const interval = setInterval(() => {
			setInterviewDuration((prev) => prev + 1);
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	// Track active speaker
	useEffect(() => {
		if (aiSpeaking) setActiveSpeaker('ai');
		else if (candidateRecording) setActiveSpeaker('candidate');
	}, [aiSpeaking, candidateRecording]);

	// Auto-scroll chat
	useEffect(() => {
		chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [chatEndRef]);

	// Fullscreen toggle
	const toggleFullscreen = () => {
		if (!videoContainerRef.current) return;
		if (!document.fullscreenElement) {
			videoContainerRef.current.requestFullscreen().catch(() => {});
			setIsFullscreen(true);
		} else {
			document.exitFullscreen().catch(() => {});
			setIsFullscreen(false);
		}
	};

	useEffect(() => {
		const handler = () => setIsFullscreen(!!document.fullscreenElement);
		document.addEventListener('fullscreenchange', handler);
		return () => document.removeEventListener('fullscreenchange', handler);
	}, []);

	const currentQuestion = mockSession.conversation.filter((t) => t.role === 'interviewer').length;
	const totalQuestions = mockSession.questions_asked + mockSession.follow_ups_asked;

	// Status message
	const statusMessage = voiceError
		? null
		: aiSpeaking
			? 'AI interviewer is speaking...'
			: candidateRecording
				? silenceTimer > 0
					? `Paused ${silenceTimer}s — auto-sends when silent`
					: 'Recording... speak your answer'
				: voiceProcessing
					? 'Processing your response...'
					: 'Tap the microphone to answer';

	const toggleVideo = () => {
		if (mockCameraReady) {
			stopMockCamera();
			setIsVideoOn(false);
		} else {
			startMockCamera();
			setIsVideoOn(true);
		}
	};

	const toggleMic = () => {
		if (candidateRecording) {
			stopVoiceRecording();
			setIsMicOn(false);
		} else {
			startVoiceRecording();
			setIsMicOn(true);
		}
	};

	const reactions = ['👍', '❤️', '😂', '😮', '👏', '🎉'];

	return (
		<div className="flex flex-col h-[calc(100vh-8rem)] min-h-[500px] rounded-2xl overflow-hidden bg-[#0f0f0f] shadow-2xl ring-1 ring-white/5">
			{/* ===== GLASSMORPHISM HEADER ===== */}
			<header className="flex items-center justify-between px-4 py-2.5 bg-black/40 backdrop-blur-xl border-b border-white/5 shrink-0 z-20">
				{/* Left: Meeting info */}
				<div className="flex items-center gap-3">
					{/* Participant Avatar Stack */}
					<div className="flex items-center">
						<div className="flex -space-x-2">
							<div className="relative h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center ring-2 ring-black/50 z-10">
								<Brain className="h-3.5 w-3.5 text-white" />
							</div>
							<div className="relative h-8 w-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center ring-2 ring-black/50 z-0">
								<User className="h-3.5 w-3.5 text-white" />
							</div>
						</div>
						<span className="ml-2 text-[11px] text-white/50 font-medium">2</span>
					</div>

					<div className="hidden sm:block">
						<h2 className="text-sm font-semibold text-white/90 leading-tight">
							{mockSession.target_role} — Mock Interview
						</h2>
						<div className="flex items-center gap-2 text-[11px] text-white/40">
							<span className="flex items-center gap-1">
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
								Live
							</span>
							<span>·</span>
							<span className="font-mono">{formatTime(interviewDuration)}</span>
						</div>
					</div>
				</div>

				{/* Center: Progress Pill */}
				<div className="hidden md:flex items-center gap-3">
					<div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
						<span className="text-xs font-medium text-white/60">Q</span>
						<span className="text-xs font-semibold text-white">
							{currentQuestion} / {Math.max(totalQuestions, currentQuestion)}
						</span>
					</div>
					{candidateRecording && (
						<div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400">
							<div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
							<span className="text-[11px] font-medium">REC {formatTime(mockRecordingTime)}</span>
						</div>
					)}
				</div>

				{/* Right: Actions */}
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						className="hidden sm:flex h-8 gap-1.5 text-xs text-white/60 hover:text-white hover:bg-white/10 rounded-full border border-white/10"
					>
						<Plus className="h-3.5 w-3.5" />
						Add Members
					</Button>

					{/* Mobile controls toggle */}
					<Button
						variant="ghost"
						size="sm"
						className="lg:hidden h-8 w-8 p-0 text-white/60 hover:text-white hover:bg-white/10"
						onClick={() => setControlsMobileOpen(true)}
					>
						<MoreHorizontal className="h-4 w-4" />
					</Button>

					{/* Mobile chat toggle */}
					<Button
						variant="ghost"
						size="sm"
						className="lg:hidden h-8 w-8 p-0 text-white/60 hover:text-white hover:bg-white/10"
						onClick={() => setChatPanelMobileOpen(true)}
					>
						<MessageSquare className="h-4 w-4" />
					</Button>

					{/* Desktop chat toggle */}
					<Button
						variant="ghost"
						size="sm"
						className="hidden lg:flex h-8 gap-1.5 text-xs text-white/60 hover:text-white hover:bg-white/10 rounded-full"
						onClick={() => setShowChat((s) => !s)}
					>
						{showChat ? (
							<Minimize2 className="h-3.5 w-3.5" />
						) : (
							<Maximize2 className="h-3.5 w-3.5" />
						)}
						{showChat ? 'Hide Chat' : 'Show Chat'}
					</Button>
				</div>
			</header>

			{/* ===== MAIN CONTENT ===== */}
			<div className="flex flex-1 overflow-hidden relative">
				{/* Video Area */}
				<div className="flex-1 flex flex-col relative min-w-0 bg-[#0a0a0a]">
					{/* Primary Video Stage */}
					<div ref={videoContainerRef} className="flex-1 relative min-h-0">
						{/* Active Speaker Video Feed */}
						<video
							ref={mockVideoRef}
							autoPlay
							muted
							playsInline
							webkit-playsinline=""
							className="absolute inset-0 w-full h-full object-cover"
							style={{ transform: 'scaleX(-1)' }}
						/>

						{/* AI Interviewer Placeholder (when AI is active speaker and no candidate video) */}
						{activeSpeaker === 'ai' && (
							<div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-900/40 via-indigo-900/30 to-black/60 z-[1]">
								<div className="text-center">
									<div className="h-24 w-24 sm:h-32 sm:w-32 rounded-full bg-gradient-to-br from-violet-500/20 to-indigo-600/20 border-2 border-violet-400/30 flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
										<Brain className="h-10 w-10 sm:h-14 sm:w-14 text-violet-300/80" />
									</div>
									<p className="text-white/40 text-sm font-medium">Alex — AI Interviewer</p>
								</div>
							</div>
						)}

						{/* Camera loading / error overlay */}
						{!mockCameraReady && (
							<div className="absolute inset-0 flex items-center justify-center bg-gray-950/95 z-20">
								<div className="text-center text-white">
									{mockCameraError ? (
										<>
											<VideoOff className="h-10 w-10 mx-auto mb-3 opacity-60" />
											<p className="text-sm font-medium">Camera unavailable</p>
											<p className="text-xs opacity-60 mt-1">{mockCameraError}</p>
											<Button
												variant="outline"
												size="sm"
												className="mt-3 text-xs bg-white/5 border-white/20 text-white hover:bg-white/10"
												onClick={startMockCamera}
											>
												Retry Camera
											</Button>
										</>
									) : (
										<>
											<div className="h-10 w-10 mx-auto mb-3 rounded-full border-2 border-white/20 border-t-white animate-spin" />
											<p className="text-sm">Starting camera...</p>
										</>
									)}
								</div>
							</div>
						)}

						{/* Body language indicators — top left, glassmorphism */}
						{bodyLanguageIndicators && (
							<div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1.5 max-w-[60%]">
								{[
									{ emoji: '👁️', label: 'Eyes', value: bodyLanguageIndicators.eye_contact },
									{ emoji: '🧍', label: 'Posture', value: bodyLanguageIndicators.posture },
									{ emoji: '💪', label: 'Confidence', value: bodyLanguageIndicators.confidence },
									{ emoji: '😊', label: 'Expression', value: bodyLanguageIndicators.expression },
								].map((item) => (
									<div
										key={item.label}
										className={cn(
											'px-2.5 py-1 rounded-lg text-[10px] font-medium backdrop-blur-md border',
											item.value === 'good' ||
												item.value === 'confident' ||
												item.value === 'engaged' ||
												item.value === 'positive'
												? 'bg-emerald-500/70 border-emerald-400/30 text-white'
												: item.value === 'neutral' ||
														item.value === 'moderate' ||
														item.value === 'ok'
													? 'bg-amber-500/70 border-amber-400/30 text-white'
													: 'bg-red-500/70 border-red-400/30 text-white',
										)}
									>
										{item.emoji} {item.value || '?'}
									</div>
								))}
							</div>
						)}

						{/* Recording badge — top right */}
						{candidateRecording && (
							<div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-red-500/90 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg border border-red-400/20">
								<div className="h-2 w-2 rounded-full bg-white animate-pulse" />
								REC {formatTime(mockRecordingTime)}
							</div>
						)}

						{/* Frame count badge (when recording) */}
						{candidateRecording && (
							<div className="absolute top-3 right-3 z-10 mt-8 flex flex-col gap-1 items-end">
								<div className="bg-black/50 backdrop-blur-sm text-white/70 px-2 py-1 rounded-md text-[10px] border border-white/10">
									{frameCount} frames
								</div>
								<div className="bg-black/50 backdrop-blur-sm text-white/70 px-2 py-1 rounded-md text-[10px] border border-white/10">
									{mockLiveTranscript.split(/\s+/).filter((w) => w).length} words
								</div>
							</div>
						)}

						{/* AI Speaking overlay */}
						{aiSpeaking && (
							<div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-violet-600/90 backdrop-blur-md text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-xl border border-violet-400/20">
								<Volume2 className="h-4 w-4 animate-pulse" />
								AI Interviewer is speaking
							</div>
						)}

						{/* Fullscreen toggle */}
						<Button
							variant="ghost"
							size="sm"
							className="absolute top-3 right-3 z-10 h-8 w-8 p-0 bg-black/30 backdrop-blur-md text-white/70 hover:text-white hover:bg-black/50 rounded-lg border border-white/10"
							onClick={toggleFullscreen}
						>
							{isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
						</Button>

						{/* ===== FLOATING PARTICIPANT TILES (bottom-left) ===== */}
						<div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2">
							{/* AI Interviewer Tile */}
							<div className="relative w-28 h-20 sm:w-36 sm:h-24 rounded-xl overflow-hidden border border-white/10 shadow-xl bg-gradient-to-br from-violet-900/60 to-indigo-900/60 backdrop-blur-sm">
								<div className="absolute inset-0 flex items-center justify-center">
									<Brain className="h-8 w-8 text-violet-300/60" />
								</div>
								{/* Name label */}
								<div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
									<div className="flex items-center justify-between">
										<span className="text-[10px] text-white/90 font-medium truncate">Alex</span>
										<div className="flex items-center gap-1">
											{aiSpeaking && (
												<Volume2 className="h-2.5 w-2.5 text-violet-300 animate-pulse" />
											)}
											<Mic className="h-2.5 w-2.5 text-white/50" />
										</div>
									</div>
								</div>
								{/* Active speaker border */}
								{activeSpeaker === 'ai' && (
									<div className="absolute inset-0 rounded-xl ring-2 ring-violet-400/50 animate-pulse" />
								)}
							</div>

							{/* Candidate Self-view Tile */}
							{mockCameraReady && (
								<div className="relative w-28 h-20 sm:w-36 sm:h-24 rounded-xl overflow-hidden border border-white/10 shadow-xl bg-black">
									<video
										ref={(el) => {
											if (el && mockVideoRef.current) {
												el.srcObject = mockVideoRef.current.srcObject;
											}
										}}
										autoPlay
										muted
										playsInline
										className="w-full h-full object-cover"
										style={{ transform: 'scaleX(-1)' }}
									/>
									{/* Name label */}
									<div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
										<div className="flex items-center justify-between">
											<span className="text-[10px] text-white/90 font-medium">You</span>
											<div className="flex items-center gap-1">
												{candidateRecording ? (
													<Mic className="h-2.5 w-2.5 text-emerald-400 animate-pulse" />
												) : (
													<MicOff className="h-2.5 w-2.5 text-white/40" />
												)}
												{isVideoOn ? (
													<Video className="h-2.5 w-2.5 text-white/50" />
												) : (
													<VideoOff className="h-2.5 w-2.5 text-red-400" />
												)}
											</div>
										</div>
									</div>
									{/* Active speaker border */}
									{activeSpeaker === 'candidate' && (
										<div className="absolute inset-0 rounded-xl ring-2 ring-emerald-400/50 animate-pulse" />
									)}
								</div>
							)}
						</div>
					</div>

					{/* Status bar below video — glassmorphism */}
					<div className="shrink-0 px-4 py-2 bg-black/30 backdrop-blur-sm border-t border-white/5 flex items-center justify-between">
						<div className="flex items-center gap-2">
							{voiceError ? (
								<div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-300 text-xs">
									<AlertCircle className="h-3 w-3" />
									<span className="max-w-[200px] sm:max-w-sm truncate">{voiceError}</span>
									<button type="button"
										onClick={() => setVoiceError(null)}
										className="ml-1 text-red-400 hover:text-red-200"
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							) : (
								<p className="text-xs text-white/50">{statusMessage}</p>
							)}
						</div>
						<div className="hidden sm:flex items-center gap-2 text-[10px] text-white/30">
							{voiceMode && (
								<span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/20">
									<Mic className="h-2.5 w-2.5" /> Voice mode
								</span>
							)}
						</div>
					</div>
				</div>

				{/* ===== CHAT PANEL (Desktop) ===== */}
				{showChat && (
					<div className="hidden lg:flex w-[30%] max-w-md flex-col border-l border-white/5 bg-[#111111]/80 backdrop-blur-xl shrink-0">
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
							interviewDuration={interviewDuration}
						/>
					</div>
				)}
			</div>

			{/* ===== FLOATING BOTTOM TOOLBAR (Desktop) ===== */}
			<div className="hidden lg:flex absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
				<div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl">
					{/* Mic */}
					<Tooltip content={candidateRecording ? 'Stop recording' : 'Start speaking'}>
						<button type="button"
							onClick={toggleMic}
							className={cn(
								'h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-200',
								candidateRecording
									? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse'
									: 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white',
							)}
						>
							{candidateRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
						</button>
					</Tooltip>

					{/* Video */}
					<Tooltip content={mockCameraReady ? 'Turn off camera' : 'Turn on camera'}>
						<button type="button"
							onClick={toggleVideo}
							className={cn(
								'h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-200',
								mockCameraReady
									? 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
									: 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
							)}
						>
							{mockCameraReady ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
						</button>
					</Tooltip>

					{/* Reactions */}
					<div className="relative">
						<Tooltip content="Reactions">
							<button type="button"
								onClick={() => setShowReactions(!showReactions)}
								className="h-11 w-11 rounded-xl flex items-center justify-center bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all duration-200"
							>
								<Smile className="h-5 w-5" />
							</button>
						</Tooltip>
						{/* Reaction picker popup */}
						{showReactions && (
							<div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-2 rounded-xl bg-black/80 backdrop-blur-xl border border-white/10 shadow-xl flex gap-1">
								{reactions.map((r) => (
									<button type="button"
										key={r}
										onClick={() => setShowReactions(false)}
										className="h-8 w-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-lg transition-colors"
									>
										{r}
									</button>
								))}
							</div>
						)}
					</div>

					{/* Screen Share */}
					<Tooltip content="Screen share (coming soon)">
						<button type="button"
							disabled
							className="h-11 w-11 rounded-xl flex items-center justify-center bg-white/5 text-white/30 cursor-not-allowed transition-all duration-200"
						>
							<Monitor className="h-5 w-5" />
						</button>
					</Tooltip>

					{/* Hand raise */}
					<Tooltip content={raisedHand ? 'Lower hand' : 'Raise hand'}>
						<button type="button"
							onClick={() => setRaisedHand(!raisedHand)}
							className={cn(
								'h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-200',
								raisedHand
									? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
									: 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white',
							)}
						>
							<Hand className="h-5 w-5" />
						</button>
					</Tooltip>

					{/* Divider */}
					<div className="h-8 w-px bg-white/10 mx-1" />

					{/* Effects */}
					<Tooltip content="Effects (coming soon)">
						<button type="button"
							disabled
							className="h-11 w-11 rounded-xl flex items-center justify-center bg-white/5 text-white/30 cursor-not-allowed transition-all duration-200"
						>
							<Wand2 className="h-5 w-5" />
						</button>
					</Tooltip>

					{/* Settings */}
					<Tooltip content="Settings">
						<button type="button" className="h-11 w-11 rounded-xl flex items-center justify-center bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all duration-200">
							<Settings className="h-5 w-5" />
						</button>
					</Tooltip>

					{/* Divider */}
					<div className="h-8 w-px bg-white/10 mx-1" />

					{/* End Call */}
					<Tooltip content="End interview">
						<button type="button"
							onClick={endMockInterview}
							className="h-11 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium shadow-lg shadow-red-600/30 flex items-center gap-2 transition-all duration-200 hover:scale-105"
						>
							<PhoneOff className="h-4 w-4" />
							<span className="text-sm">End</span>
						</button>
					</Tooltip>
				</div>
			</div>

			{/* ===== MOBILE BOTTOM SHEET: CONTROLS ===== */}
			<Sheet open={controlsMobileOpen} onOpenChange={setControlsMobileOpen} side="bottom">
				<SheetContent className="p-0 flex flex-col bg-[#111111] border-t border-white/10 rounded-t-2xl">
					<SheetHeader className="px-4 py-3 border-b border-white/5">
						<SheetTitle className="text-sm text-white/90 flex items-center gap-2">
							<Sparkles className="h-4 w-4 text-violet-400" /> Meeting Controls
						</SheetTitle>
						<SheetClose className="text-white/50 hover:text-white" />
					</SheetHeader>
					<div className="p-4 grid grid-cols-4 gap-3">
						<MobileControlButton
							onClick={() => {
								toggleMic();
								setControlsMobileOpen(false);
							}}
							active={candidateRecording}
							icon={candidateRecording ? MicOff : Mic}
							label={candidateRecording ? 'Stop' : 'Speak'}
							activeColor="bg-red-500 text-white"
						/>
						<MobileControlButton
							onClick={() => {
								toggleVideo();
								setControlsMobileOpen(false);
							}}
							active={mockCameraReady}
							icon={mockCameraReady ? Video : VideoOff}
							label="Camera"
						/>
						<MobileControlButton
							onClick={() => setRaisedHand(!raisedHand)}
							active={raisedHand}
							icon={Hand}
							label="Hand"
							activeColor="bg-amber-500 text-white"
						/>
						<MobileControlButton
							onClick={() => {}}
							active={false}
							icon={Monitor}
							label="Share"
							disabled
						/>
						<MobileControlButton
							onClick={() => {}}
							active={false}
							icon={Wand2}
							label="Effects"
							disabled
						/>
						<MobileControlButton
							onClick={() => {}}
							active={false}
							icon={Settings}
							label="Settings"
						/>
						<MobileControlButton
							onClick={toggleFullscreen}
							active={isFullscreen}
							icon={isFullscreen ? Minimize2 : Expand}
							label="Fullscreen"
						/>
						<MobileControlButton
							onClick={() => {
								endMockInterview();
								setControlsMobileOpen(false);
							}}
							active={false}
							icon={PhoneOff}
							label="End"
							activeColor="bg-red-600 text-white"
						/>
					</div>
				</SheetContent>
			</Sheet>

			{/* ===== MOBILE BOTTOM SHEET: CHAT ===== */}
			<Sheet open={chatPanelMobileOpen} onOpenChange={setChatPanelMobileOpen} side="bottom">
				<SheetContent className="p-0 flex flex-col bg-[#111111] border-t border-white/10 rounded-t-2xl h-[70vh]">
					<SheetHeader className="px-4 py-3 border-b border-white/5">
						<SheetTitle className="text-sm text-white/90 flex items-center gap-2">
							<MessageSquare className="h-4 w-4 text-violet-400" /> Conversation
						</SheetTitle>
						<SheetClose className="text-white/50 hover:text-white" />
					</SheetHeader>
					<div className="flex-1 overflow-hidden">
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
							interviewDuration={interviewDuration}
						/>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}

// ===== MOBILE CONTROL BUTTON =====
function MobileControlButton({
	onClick,
	active,
	icon: Icon,
	label,
	activeColor,
	disabled = false,
}: {
	onClick: () => void;
	active: boolean;
	icon: React.ElementType;
	label: string;
	activeColor?: string;
	disabled?: boolean;
}) {
	return (
		<button type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				'flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl transition-all duration-200',
				active
					? activeColor || 'bg-white/15 text-white'
					: 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70',
				disabled && 'opacity-30 cursor-not-allowed',
			)}
		>
			<Icon className="h-5 w-5" />
			<span className="text-[10px] font-medium">{label}</span>
		</button>
	);
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
	interviewDuration,
}: {
	conversation: MockConversationTurn[];
	candidateRecording: boolean;
	mockLiveTranscript: string;
	voiceProcessing: boolean;
	chatEndRef: React.RefObject<HTMLDivElement | null>;
	mockResponseText: string;
	setMockResponseText: (text: string) => void;
	mockSending: boolean;
	sendMockResponse: () => void;
	interviewDuration: number;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, []);

	return (
		<>
			{/* Messages */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
				{/* Interview start info */}
				<div className="flex items-center justify-center gap-2 text-[10px] text-white/20 py-2">
					<div className="h-px flex-1 bg-white/5" />
					<span>Interview started · {formatTime(interviewDuration)} ago</span>
					<div className="h-px flex-1 bg-white/5" />
				</div>

				{conversation.map((turn, i) => (
					<ChatMessage key={turn.id || `turn-${i}`} turn={turn} index={i} />
				))}

				{/* Live transcription */}
				{candidateRecording && mockLiveTranscript && (
					<div className="flex gap-3 opacity-70 animate-in fade-in slide-in-from-bottom-2 duration-300">
						<div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 border border-emerald-500/30">
							<User className="h-3.5 w-3.5 text-emerald-400" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 mb-1">
								<p className="text-[10px] font-semibold text-emerald-400">You</p>
								<span className="text-[9px] text-white/20">speaking...</span>
							</div>
							<p className="text-xs text-white/60 italic leading-relaxed">{mockLiveTranscript}</p>
						</div>
					</div>
				)}

				{/* Processing */}
				{voiceProcessing && (
					<div className="flex gap-3 opacity-60 animate-in fade-in duration-300">
						<div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-amber-500/20 border border-amber-500/30">
							<Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-[10px] font-semibold text-amber-400 mb-0.5">AI Interviewer</p>
							<p className="text-xs text-amber-400/70">Processing your answer...</p>
						</div>
					</div>
				)}

				<div ref={chatEndRef} />
			</div>

			{/* Text input fallback */}
			{!candidateRecording && (
				<div className="shrink-0 p-3 border-t border-white/5 bg-black/20">
					<div className="flex items-end gap-2">
						{/* Attachment / formatting icons */}
						<div className="flex items-center gap-1 shrink-0 pb-1">
							<button type="button" className="h-8 w-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors">
								<FileText className="h-4 w-4" />
							</button>
							<button type="button" className="h-8 w-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors">
								<Smile className="h-4 w-4" />
							</button>
						</div>
						<div className="flex-1 relative">
							<Textarea
								value={mockResponseText}
								onChange={(e) => setMockResponseText(e.target.value)}
								placeholder="Type your answer..."
								rows={2}
								className="resize-none text-xs min-h-[60px] bg-white/5 border-white/10 text-white/90 placeholder:text-white/20 focus:border-violet-500/50 focus:ring-violet-500/20 rounded-xl pr-10"
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										sendMockResponse();
									}
								}}
							/>
						</div>
						<Button
							onClick={sendMockResponse}
							disabled={mockSending || mockResponseText.trim().length < 10}
							className="shrink-0 h-9 w-9 p-0 rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-30"
							size="sm"
						>
							<Send className="h-3.5 w-3.5" />
						</Button>
					</div>
				</div>
			)}
		</>
	);
}

// ===== CHAT MESSAGE =====
function ChatMessage({ turn, index }: { turn: MockConversationTurn; index: number }) {
	const isInterviewer = turn.role === 'interviewer';
	const time = turn.timestamp
		? new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		: '';

	return (
		<div
			className={cn(
				'flex gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300',
				index > 0 && 'mt-3',
			)}
		>
			<div
				className={cn(
					'h-8 w-8 rounded-full flex items-center justify-center shrink-0 border',
					isInterviewer
						? 'bg-violet-500/20 border-violet-500/30'
						: 'bg-emerald-500/20 border-emerald-500/30',
				)}
			>
				{isInterviewer ? (
					<Brain className="h-3.5 w-3.5 text-violet-400" />
				) : (
					<User className="h-3.5 w-3.5 text-emerald-400" />
				)}
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2 mb-1">
					<p
						className={cn(
							'text-[10px] font-semibold',
							isInterviewer ? 'text-violet-400' : 'text-emerald-400',
						)}
					>
						{isInterviewer ? 'Alex' : 'You'}
					</p>
					{turn.action && turn.action !== 'transition' && (
						<span className="text-[9px] text-white/20">
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
					<span className="text-[9px] text-white/15 ml-auto">{time}</span>
				</div>
				<div
					className={cn(
						'text-xs leading-relaxed whitespace-pre-wrap rounded-xl px-3 py-2',
						isInterviewer
							? 'bg-violet-500/10 text-white/80 border border-violet-500/10'
							: 'bg-white/5 text-white/80 border border-white/5',
					)}
				>
					{turn.text}
				</div>
			</div>
		</div>
	);
}
