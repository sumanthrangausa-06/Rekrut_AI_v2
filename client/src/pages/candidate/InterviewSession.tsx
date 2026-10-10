/**
 * Unified candidate interview session page — Phase 1 conversational AI interviews (#322).
 *
 * One page for screening + AI interviews, joined from the invite link:
 *   token landing → sign-in gate → start → recording consent → device check
 *   → live session (voice/text + frame capture) → thank-you + report summary.
 *
 * Global constraints enforced in UI order:
 *  - No camera/mic activation before the consent screen is answered.
 *  - Consent is written to recording_consent (Task 4 backend) before any frame
 *    capture starts. Withdrawing consent mid-session stops capture; the
 *    backend 403 CONSENT_REQUIRED keeps text/voice usable.
 *  - Crash-resume: start is idempotent; an in_progress session resumes.
 */

import {
	AlertTriangle,
	Briefcase,
	Building2,
	CheckCircle2,
	Clock,
	Loader2,
	Mic,
	MicOff,
	PhoneOff,
	Send,
	ShieldCheck,
	Video,
	VideoOff,
	Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useInterviewerAudio } from '@/hooks/useInterviewerAudio';
import { getCameraErrorMessage, useInterviewCamera } from '@/hooks/useInterviewCamera';
import {
	isSpeechRecognitionAvailable,
	SPEECH_NOT_SUPPORTED_MESSAGE,
} from '@/hooks/useSpeechRecognition';
import { trackEvent } from '@/lib/analytics';
import { apiCall, getToken } from '@/lib/api';
import { useVoiceRoom, type VoiceRoomTurn } from './useVoiceRoom';

type Phase =
	| 'loading'
	| 'invalid'
	| 'expired'
	| 'invite'
	| 'signin'
	| 'consent'
	| 'devices'
	| 'active'
	| 'done';

interface TokenSession {
	id: number;
	type: string;
	status: string;
	job_id: number | null;
	company_id: number | null;
	candidate_id: number;
	invite_token: string;
	job: {
		title: string | null;
		company_name: string | null;
		description: string | null;
	} | null;
	created_at: string;
	invite_expires_at: string | null;
}

interface Turn {
	role: 'interviewer' | 'candidate';
	text: string;
	phase?: string;
	timestamp: string;
	/** Stable list key (append-only transcript, assigned at append time). */
	_key: number;
}

interface Session {
	id: number;
	type: string;
	status: string;
	conversation: Turn[];
	config?: {
		question_source?: string;
		current_phase?: string;
		observer_enabled?: boolean;
	};
}

const SESSION_TYPE_LABEL: Record<string, string> = {
	screening: 'AI Screening',
	ai_interview: 'AI Interview',
	mock: 'Mock Interview',
	live: 'Live Interview',
	human: 'Human Interview',
};

const FRAME_INTERVAL_MS = 4000;
const MAX_FRAMES_PER_QUESTION = 8;
const MAX_FRAMES_TOTAL = 20;

function sessionTypeLabel(type: string) {
	return SESSION_TYPE_LABEL[type] || 'AI Interview';
}

export default function CandidateInterviewSessionPage() {
	const { token } = useParams<{ token: string }>();
	const [phase, setPhase] = useState<Phase>('loading');
	const [tokenSession, setTokenSession] = useState<TokenSession | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [recordingId, setRecordingId] = useState<number | null>(null);
	const [turns, setTurns] = useState<Turn[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	// Consent state
	const [videoConsent, setVideoConsent] = useState(false);
	const [consentDeclined, setConsentDeclined] = useState(false);
	const [consentBusy, setConsentBusy] = useState(false);

	// Camera/mic — Phase 2 (#447): shared camera hook.
	// videoConsent gate is preserved: startCamera is only called when consented.
	const videoRef = useRef<HTMLVideoElement>(null);
	const {
		cameraReady,
		cameraError,
		startCamera: startCameraInternal,
		stopCamera,
		getStream,
	} = useInterviewCamera({ videoRef, audio: false });
	// Consent-gated wrapper: matches the original startCamera behavior.
	const startCamera = useCallback(async () => {
		if (!videoConsent) return;
		await startCameraInternal();
	}, [videoConsent, startCameraInternal]);

	// Frame capture
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const framesRef = useRef<string[]>([]);
	const perQuestionFramesRef = useRef<string[]>([]);
	const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Voice input (manual toggle)
	const [recording, setRecording] = useState(false);
	const recordingRef = useRef(false);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const [liveTranscript, setLiveTranscript] = useState('');
	const recognitionRef = useRef<any>(null);

	// Chat
	const [draft, setDraft] = useState('');
	// Phase 3 (#447): tracks when Web Speech API is absent.
	const [speechNotSupported, setSpeechNotSupported] = useState(false);
	const [sending, setSending] = useState(false);
	const [finishing, setFinishing] = useState(false);
	const [confirmEnd, setConfirmEnd] = useState(false);
	const [report, setReport] = useState<{ overall_score?: number; recommendation?: string } | null>(null);
	const transcriptEndRef = useRef<HTMLDivElement>(null);
	// Set false once the session completes: the recorder's onstop must not
	// fire a respond POST against a completed session.
	const sessionActiveRef = useRef(true);

	// Elapsed timer
	const [elapsedSec, setElapsedSec] = useState(0);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// AI voice (shared hook from mock-interview extraction)
	const [aiSpeaking, setAiSpeaking] = useState(false);
	const { playInterviewerAudio, stopAudio, dispose: disposeAudio } = useInterviewerAudio({
		getTtsRequest: (text) => ({
			url: `/api/interviews/interview-sessions/${session?.id ?? 0}/tts`,
			body: { text },
		}),
		onSpeakingChange: setAiSpeaking,
		onError: (msg) => setNotice(msg),
	});

	const questionCount = turns.filter((t) => t.role === 'interviewer').length;

	// ---- Track A live voice (Phase 2, #323) ----
	// The voice agent persists turns to the session conversation after every
	// turn; merge them into the transcript while the room is live.
	const handleVoiceTranscript = useCallback((conv: VoiceRoomTurn[]) => {
		setTurns(
			conv.map((t, i) => ({
				role: t.role === 'interviewer' ? ('interviewer' as const) : ('candidate' as const),
				text: t.text,
				timestamp: t.timestamp ?? new Date().toISOString(),
				_key: i,
			})),
		);
	}, []);
	const {
		voiceState,
		start: startVoice,
		stop: stopVoice,
		setVideoEnabled: setVoiceVideoEnabled,
	} = useVoiceRoom({
		sessionId: session?.id ?? -1,
		candidateName: '',
		videoEnabled: videoConsent,
		onTranscript: handleVoiceTranscript,
		// Full-branch review C1 (#323): human interviews (Track B) are for
		// the two humans — the candidate joins the room, no AI interviewer.
		dispatchMode: session?.type === 'human' ? null : 'interviewer',
	});

	// ---- token resolution ----
	useEffect(() => {
		async function resolve() {
			if (!token) {
				setPhase('invalid');
				return;
			}
			try {
				const res = await apiCall<{ success: boolean; session: TokenSession }>(
					`/interviews/interview-sessions/by-token/${encodeURIComponent(token)}`,
					{ skipAuthCheck: true },
				);
				const s = res.session;
				if (s.status === 'completed') {
					setTokenSession(s);
					setSession({
						id: s.id,
						type: s.type,
						status: s.status,
						conversation: [],
					});
					setPhase('done');
					return;
				}
				setTokenSession(s);
				setPhase(getToken() ? 'invite' : 'signin');
			} catch (err) {
				if ((err as Error & { code?: string }).code === 'INVITE_EXPIRED') {
					setPhase('expired');
				} else {
					setPhase('invalid');
				}
			}
		}
		resolve();
	}, [token]);

	// ---- elapsed timer ----
	useEffect(() => {
		if (phase === 'active') {
			timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
		}
		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, [phase]);

	// ---- auto-scroll transcript when new content arrives ----
	const transcriptVersion = turns.length + (liveTranscript ? 1 : 0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll when transcript content changes
	useEffect(() => {
		transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [transcriptVersion]);

	// ---- cleanup ----
	// biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup
	useEffect(() => {
		return () => {
			disposeAudio();
			stopFrameCapture();
			stopCamera();
			stopDictation();
		};
	}, []);

	function elapsedLabel() {
		const m = Math.floor(elapsedSec / 60);
		const s = elapsedSec % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// ---- session start ----
	const handleStart = useCallback(async () => {
		if (!tokenSession) return;
		setError(null);
		try {
			trackEvent('interview_session_start_clicked', {
				session_id: tokenSession.id,
				type: tokenSession.type,
			});
			const res = await apiCall<{
				success: boolean;
				session: Session;
				recording: { id: number } | null;
			}>(`/interviews/interview-sessions/${tokenSession.id}/start`, { method: 'POST' });
			setSession(res.session);
			setTurns((res.session.conversation || []).map((t, i) => ({ ...t, _key: i })));
			setRecordingId(res.recording?.id ?? null);
			setPhase('consent');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not start the interview.');
		}
	}, [tokenSession]);

	// ---- consent ----
	const handleConsent = useCallback(
		async (granted: boolean) => {
			if (!granted) {
				setConsentDeclined(true);
				return;
			}
			setConsentBusy(true);
			try {
				if (recordingId) {
					await apiCall(`/interviews/recordings/${recordingId}/consent`, {
						method: 'POST',
						body: { consent_type: 'explicit', recording_types: ['video', 'audio'] },
					});
				}
				setVideoConsent(true);
				trackEvent('interview_session_consent_granted', { recording_id: recordingId });
				setPhase('devices');
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Could not save consent.');
			} finally {
				setConsentBusy(false);
			}
		},
		[recordingId],
	);

	const handleContinueWithoutVideo = useCallback(() => {
		// No consent row is written: the backend consent gate blocks frames,
		// so capture stays off and the interview runs text/voice only.
		setVideoConsent(false);
		trackEvent('interview_session_video_declined', { recording_id: recordingId });
		setPhase('devices');
	}, [recordingId]);

	// ---- frame capture (same cadence as mock-interview) ----
	const captureFrame = useCallback(() => {
		if (!videoConsent || !getStream() || !videoRef.current || !canvasRef.current) return;
		if (perQuestionFramesRef.current.length >= MAX_FRAMES_PER_QUESTION) return;
		if (framesRef.current.length >= MAX_FRAMES_TOTAL) return;
		try {
			const video = videoRef.current;
			const canvas = canvasRef.current;
			if (video.videoWidth === 0) return;
			canvas.width = 320;
			canvas.height = 240;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.drawImage(video, 0, 0, 320, 240);
			const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
			perQuestionFramesRef.current.push(dataUrl);
			framesRef.current.push(dataUrl);
		} catch {
			// frame capture is best-effort
		}
	}, [videoConsent]);

	const stopFrameCapture = useCallback(() => {
		if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
		frameIntervalRef.current = null;
	}, []);

	const startFrameCapture = useCallback(() => {
		stopFrameCapture();
		frameIntervalRef.current = setInterval(captureFrame, FRAME_INTERVAL_MS);
	}, [captureFrame, stopFrameCapture]);

	// ---- join: devices -> active ----
	const handleJoin = useCallback(async () => {
		if (videoConsent) await startCamera();
		perQuestionFramesRef.current = [];
		framesRef.current = [];
		setPhase('active');
		trackEvent('interview_session_joined', { session_id: session?.id, video: videoConsent });
		if (videoConsent) startFrameCapture();
		// Track A voice attempt (#323). On 'live' the agent speaks the intro
		// itself; on 'fallback' restore the Phase 1 behavior (speak the intro
		// aloud) and keep the HTTP-turn UI as the path.
		const outcome = await startVoice();
		if (outcome === 'fallback') {
			setNotice(
				'Live voice isn\u2019t available right now \u2014 continuing with text and voice answers.',
			);
			trackEvent('interview_session_voice_fallback', { session_id: session?.id });
			const lastAi = [...turns].reverse().find((t) => t.role === 'interviewer');
			if (lastAi) {
				void playInterviewerAudio(lastAi.text).catch(() => {});
			}
		} else {
			trackEvent('interview_session_voice_live', { session_id: session?.id });
		}
	}, [videoConsent, startCamera, startFrameCapture, playInterviewerAudio, turns, session?.id, startVoice]);

	// ---- voice input (manual toggle, same as mock-interview v1) ----
	const startDictation = useCallback(() => {
		// Phase 3 (#447): shared check. When absent, show the typed-answer
		// fallback message instead of silently doing nothing.
		if (!isSpeechRecognitionAvailable()) {
			setSpeechNotSupported(true);
			return;
		}
		const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		try {
			const rec = new SR();
			rec.continuous = true;
			rec.interimResults = true;
			rec.onresult = (e: any) => {
				let interim = '';
				for (let i = e.resultIndex; i < e.results.length; i++) {
					if (!e.results[i].isFinal) interim += e.results[i][0].transcript;
				}
				if (interim) setLiveTranscript(interim);
			};
			rec.start();
			recognitionRef.current = rec;
		} catch {
			// speech recognition unavailable — manual toggle still records audio
		}
	}, []);

	const stopDictation = useCallback(() => {
		try {
			recognitionRef.current?.stop();
		} catch {
			// ignore
		}
		recognitionRef.current = null;
		setLiveTranscript('');
	}, []);

	// ---- complete ----
	const finishSession = useCallback(async () => {
		if (!session || finishing) return;
		setFinishing(true);
		sessionActiveRef.current = false;
		stopVoice();
		stopAudio();
		stopFrameCapture();
		stopCamera();
		stopDictation();
		if (recorderRef.current && recordingRef.current) {
			recordingRef.current = false;
			setRecording(false);
			try {
				recorderRef.current.stop();
			} catch {
				// ignore
			}
		}
		try {
			const data = await apiCall<{ success: boolean; report?: { overall_score?: number; recommendation?: string } }>(
				`/interviews/interview-sessions/${session.id}/complete`,
				{ method: 'POST', body: { frames: framesRef.current } },
			);
			setReport(data.report ?? null);
			trackEvent('interview_session_completed', { session_id: session.id });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not finish the interview.');
		} finally {
			setFinishing(false);
			setPhase('done');
		}
	}, [session, finishing, stopVoice, stopAudio, stopFrameCapture, stopCamera, stopDictation]);

	// ---- respond ----
	const handleRespondResult = useCallback(
		async (data: { ai_message?: string; is_complete?: boolean }) => {
			setTurns((prev) => {
				const at = prev.length;
				return [
					...prev,
					{
						role: 'candidate' as const,
						text: lastCandidateText.current,
						timestamp: new Date().toISOString(),
						_key: at,
					},
					...(data.ai_message
						? [
								{
									role: 'interviewer' as const,
									text: data.ai_message,
									timestamp: new Date().toISOString(),
									_key: at + 1,
								},
							]
						: []),
				];
			});
			perQuestionFramesRef.current = [];
			if (data.ai_message) {
				await playInterviewerAudio(data.ai_message).catch(() => {});
			}
			if (data.is_complete) {
				void finishSession();
			}
		},
		[playInterviewerAudio, finishSession],
	);

	const lastCandidateText = useRef('');
	const handleSend = useCallback(async () => {
		const text = draft.trim();
		if (!text || !session || sending) return;
		setSending(true);
		setError(null);
		lastCandidateText.current = text;
		setDraft('');
		const frames = videoConsent ? [...perQuestionFramesRef.current] : [];
		try {
			const data = await apiCall<{ ai_message?: string; is_complete?: boolean }>(
				`/interviews/interview-sessions/${session.id}/respond`,
				{ method: 'POST', body: { text, frames } },
			);
			await handleRespondResult(data);
		} catch (err) {
			if ((err as Error & { code?: string }).code === 'CONSENT_REQUIRED') {
				// Consent was withdrawn (or never granted): stop capture, keep text working
				setVideoConsent(false);
				stopFrameCapture();
				stopCamera();
				setNotice('Video recording is off — continuing with text and voice answers.');
				try {
					const data = await apiCall<{ ai_message?: string; is_complete?: boolean }>(
						`/interviews/interview-sessions/${session.id}/respond`,
						{ method: 'POST', body: { text } },
					);
					await handleRespondResult(data);
				} catch (retryErr) {
					setError(retryErr instanceof Error ? retryErr.message : 'Could not send your answer.');
					setDraft(text);
				}
			} else {
				setError(err instanceof Error ? err.message : 'Could not send your answer.');
				setDraft(text);
			}
		} finally {
			setSending(false);
		}
	}, [draft, session, sending, videoConsent, handleRespondResult, stopFrameCapture, stopCamera]);

	// ---- voice input: manual mic toggle ----
	const toggleRecording = useCallback(async () => {
		if (!session) return;
		if (recordingRef.current) {
			// stop
			recordingRef.current = false;
			setRecording(false);
			stopDictation();
			recorderRef.current?.stop();
			return;
		}
		setError(null);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const rec = new MediaRecorder(stream);
			chunksRef.current = [];
			rec.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};
			rec.onstop = async () => {
				stream.getTracks().forEach((t) => {
					t.stop();
				});
				const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
				if (blob.size === 0 || !sessionActiveRef.current) return;
				setSending(true);
				lastCandidateText.current = '[voice answer]';
				const frames = videoConsent ? [...perQuestionFramesRef.current] : [];
				const form = new FormData();
				form.append('audio', blob, 'answer.webm');
				form.append('frames', JSON.stringify(frames));
				form.append('client_transcript', liveTranscript);
				try {
					const data = await apiCall<{ ai_message?: string; is_complete?: boolean; transcript?: string }>(
						`/interviews/interview-sessions/${session.id}/respond`,
						{ method: 'POST', body: form, isFormData: true },
					);
					if (data.transcript) lastCandidateText.current = data.transcript;
					await handleRespondResult(data);
				} catch (err) {
					if ((err as Error & { code?: string }).code === 'CONSENT_REQUIRED') {
						// Consent was withdrawn: stop capture, retry audio-only
						setVideoConsent(false);
						stopFrameCapture();
						stopCamera();
						setNotice('Video recording is off — continuing with text and voice answers.');
						try {
							const retryForm = new FormData();
							retryForm.append('audio', blob, 'answer.webm');
							retryForm.append('client_transcript', liveTranscript);
							const data = await apiCall<{
								ai_message?: string;
								is_complete?: boolean;
								transcript?: string;
							}>(`/interviews/interview-sessions/${session.id}/respond`, {
								method: 'POST',
								body: retryForm,
								isFormData: true,
							});
							if (data.transcript) lastCandidateText.current = data.transcript;
							await handleRespondResult(data);
						} catch (retryErr) {
							setError(
								retryErr instanceof Error ? retryErr.message : 'Could not send your voice answer.',
							);
						}
					} else {
						setError(err instanceof Error ? err.message : 'Could not send your voice answer.');
					}
				} finally {
					setSending(false);
				}
			};
			recorderRef.current = rec;
			rec.start();
			recordingRef.current = true;
			setRecording(true);
			startDictation();
		} catch {
			setError('Microphone unavailable. Please type your answer instead.');
		}
	}, [session, videoConsent, liveTranscript, handleRespondResult, startDictation, stopDictation, stopFrameCapture, stopCamera]);


	// ---- withdraw video consent mid-session ----
	const handleWithdrawVideo = useCallback(async () => {
		if (recordingId) {
			try {
				await apiCall(`/interviews/recordings/${recordingId}/consent`, {
					method: 'POST',
					body: { consent_type: 'withdrawn' },
				});
			} catch {
				// best-effort; local capture stops regardless
			}
		}
		setVideoConsent(false);
		stopFrameCapture();
		stopCamera();
		stopAudio();
		// Also kill the voice room's camera track — withdrawing consent must
		// stop video everywhere, not just the local preview (#323).
		void setVoiceVideoEnabled(false);
		setNotice('Video recording stopped. Your interview continues with text and voice.');
		trackEvent('interview_session_video_withdrawn', { recording_id: recordingId });
	}, [recordingId, stopFrameCapture, stopCamera, stopAudio, setVoiceVideoEnabled]);

	// ================= RENDER =================

	if (phase === 'loading') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background">
				<Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
			</div>
		);
	}

	if (phase === 'invalid') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background p-4">
				<Card className="max-w-md w-full">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<AlertTriangle className="h-5 w-5 text-destructive" />
							Invite not found
						</CardTitle>
						<CardDescription>
							This interview link isn't valid or has expired. Please check the link from your
							invitation email, or contact the recruiter for a new one.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		);
	}

	if (phase === 'expired') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background p-4">
				<Card className="max-w-md w-full">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Clock className="h-5 w-5 text-amber-500" />
							Invite expired
						</CardTitle>
						<CardDescription>
							This interview invitation has expired — invites are valid for 7 weeks. Please
							contact the recruiter to request a new invitation.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		);
	}

	if (phase === 'signin') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background p-4">
				<Card className="max-w-md w-full">
					<CardHeader>
						<CardTitle>You've been invited to an interview</CardTitle>
						<CardDescription>
							{tokenSession?.job
								? `${sessionTypeLabel(tokenSession.type)} for ${tokenSession.job.title}${
										tokenSession.job.company_name ? ` at ${tokenSession.job.company_name}` : ''
									}`
								: sessionTypeLabel(tokenSession?.type ?? '')}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm text-muted-foreground">
							Please sign in to your candidate account to join this interview.
						</p>
						<Button className="w-full min-h-[44px]" asChild>
							<a href="/login">Sign in to continue</a>
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (phase === 'invite') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background p-4">
				<Card className="max-w-lg w-full">
					<CardHeader>
						<Badge className="w-fit mb-2">{sessionTypeLabel(tokenSession?.type ?? '')}</Badge>
						<CardTitle className="text-2xl">
							{tokenSession?.job?.title ?? 'Interview invitation'}
						</CardTitle>
						{tokenSession?.job?.company_name && (
							<CardDescription className="flex items-center gap-1.5">
								<Building2 className="h-4 w-4" />
								{tokenSession.job.company_name}
							</CardDescription>
						)}
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="space-y-2 text-sm">
							<p className="font-medium">What to expect</p>
							<ul className="space-y-1.5 text-muted-foreground">
								<li className="flex gap-2">
									<Clock className="h-4 w-4 mt-0.5 shrink-0" />
									About 15–20 minutes with an AI interviewer
								</li>
								<li className="flex gap-2">
									<Volume2 className="h-4 w-4 mt-0.5 shrink-0" />
									Questions are spoken aloud; answer by voice or text
								</li>
								<li className="flex gap-2">
									<ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
									Recording happens only with your explicit consent
								</li>
							</ul>
						</div>
					{tokenSession?.invite_expires_at && (
						<p className="text-xs text-muted-foreground flex items-center gap-1.5">
							<Clock className="h-3.5 w-3.5 shrink-0" />
							This invite expires on{' '}
							{new Date(tokenSession.invite_expires_at).toLocaleDateString(undefined, {
								year: 'numeric',
								month: 'long',
								day: 'numeric',
							})}
						</p>
					)}
						{tokenSession?.status === 'in_progress' && (
							<p className="text-sm text-muted-foreground bg-muted rounded-md p-3">
								You have an interview in progress — you can pick up where you left off.
							</p>
						)}
						{error && <p className="text-sm text-destructive">{error}</p>}
						<Button className="w-full min-h-[44px]" onClick={handleStart}>
							{tokenSession?.status === 'in_progress' ? 'Resume interview' : 'Start interview'}
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (phase === 'consent') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background p-4">
				<Card className="max-w-lg w-full">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ShieldCheck className="h-5 w-5 text-primary" />
							Recording consent
						</CardTitle>
						<CardDescription>
							Before your camera or microphone turn on, we need your permission.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<ul className="space-y-2 text-sm text-muted-foreground">
							<li>
								<strong className="text-foreground">What is captured:</strong> video frames for
								analysis, your audio, and the interview transcript.
							</li>
							<li>
								<strong className="text-foreground">Who sees it:</strong> the hiring team at{' '}
								{tokenSession?.job?.company_name ?? 'the company'} evaluating your application.
							</li>
							<li>
								<strong className="text-foreground">How long it is kept:</strong> recordings are
								deleted 30 days after a hiring decision is made.
							</li>
							<li>
								<strong className="text-foreground">Your control:</strong> you can stop video
								recording at any time during the interview and continue with text and voice.
							</li>
						</ul>
						{consentDeclined && (
							<p className="text-sm text-muted-foreground bg-muted rounded-md p-3">
								Without recording consent the AI interview can't proceed. You can continue
								without video, or close this page — no recording was made.
							</p>
						)}
						{/* Task 5 (#323) — Track B: the candidate is told the AI
						    observer is present before joining (spec §5). */}
						{session?.config?.observer_enabled && (
							<p className="text-sm bg-blue-50 border border-blue-200 rounded-md p-3">
								<strong className="text-blue-900">AI observer present:</strong>{' '}
								<span className="text-blue-800">
									an AI assistant will silently observe this interview to help the hiring
									team evaluate it. It listens only — it won't speak or interrupt.
								</span>
							</p>
						)}
						{error && <p className="text-sm text-destructive">{error}</p>}
						<div className="space-y-2">
							<Button
								className="w-full min-h-[44px]"
								onClick={() => handleConsent(true)}
								disabled={consentBusy}
							>
								{consentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'I consent to recording'}
							</Button>
							<Button
								variant="outline"
								className="w-full min-h-[44px]"
								onClick={handleContinueWithoutVideo}
								disabled={consentBusy}
							>
								Continue without video
							</Button>
							<Button
								variant="ghost"
								className="w-full min-h-[44px]"
								onClick={() => handleConsent(false)}
								disabled={consentBusy}
							>
								Decline
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (phase === 'devices') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background p-4">
				<Card className="max-w-lg w-full">
					<CardHeader>
						<CardTitle>Check your camera and microphone</CardTitle>
						<CardDescription>
							Make sure you can see yourself and the microphone is working before joining.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
							{videoConsent && (
								<video
									ref={videoRef}
									autoPlay
									playsInline
									muted
									className="absolute inset-0 w-full h-full object-cover mirror"
								/>
							)}
							{(!videoConsent || !cameraReady) && (
								<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
									{videoConsent ? (
										<>
											<Video className="h-8 w-8" />
											<p className="text-sm">Click below to enable your camera</p>
										</>
									) : (
										<>
											<VideoOff className="h-8 w-8" />
											<p className="text-sm">Continuing without video</p>
										</>
									)}
								</div>
							)}
						</div>
						{cameraError && (
							<p className="text-sm text-amber-600">
								{getCameraErrorMessage(cameraError, true)}
							</p>
						)}
						{!videoConsent && (
							<p className="text-sm text-muted-foreground">
								You'll answer by text and voice. Video analysis is off.
							</p>
						)}
						<div className="flex gap-2">
							{videoConsent && !cameraReady && (
								<Button variant="outline" className="flex-1 min-h-[44px]" onClick={startCamera}>
									Enable camera
								</Button>
							)}
							<Button
								className="flex-1 min-h-[44px]"
								onClick={handleJoin}
								disabled={voiceState === 'connecting'}
							>
								Join interview
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (phase === 'done') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background p-4">
				<Card className="max-w-2xl w-full">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<CheckCircle2 className="h-5 w-5 text-green-600" />
							Thank you for completing your interview
						</CardTitle>
						<CardDescription>
							{tokenSession?.job
								? `${sessionTypeLabel(tokenSession.type)} for ${tokenSession.job.title}${
										tokenSession.job.company_name ? ` at ${tokenSession.job.company_name}` : ''
									}`
								: 'Your responses have been recorded.'}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						{report && (report.overall_score != null || report.recommendation) && (
							<div className="flex gap-4 items-center bg-muted rounded-lg p-4">
								{report.overall_score != null && (
									<div className="text-center">
										<p className="text-3xl font-bold">{report.overall_score}</p>
										<p className="text-xs text-muted-foreground">overall score</p>
									</div>
								)}
								{report.recommendation && (
									<Badge variant="secondary" className="capitalize">
										{report.recommendation.replace(/_/g, ' ')}
									</Badge>
								)}
							</div>
						)}
						{turns.length > 0 && (
							<div className="space-y-3">
								<p className="font-medium text-sm">Interview transcript</p>
								<div className="max-h-96 overflow-y-auto space-y-2 border rounded-lg p-3">
																		{turns.map((t) => (
										<div
											key={t._key}
											className={`rounded-md p-2.5 text-sm ${
												t.role === 'interviewer'
													? 'bg-primary/10 mr-8'
													: 'bg-muted ml-8'
											}`}
										>
											<p className="text-xs font-medium text-muted-foreground mb-1">
												{t.role === 'interviewer' ? 'Interviewer' : 'You'}
											</p>
											<p>{t.text}</p>
										</div>
									))}
								</div>
							</div>
						)}
						<p className="text-sm text-muted-foreground">
							The hiring team will review your interview and follow up by email.
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	// ---- active session ----
	return (
		<div className="min-h-screen bg-background flex flex-col">
			<canvas ref={canvasRef} className="hidden" />
			{/* header */}
			<header className="border-b px-4 py-3 flex items-center justify-between gap-2 sticky top-0 bg-background z-10">
				<div className="flex items-center gap-2 min-w-0">
					<Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
					<span className="font-medium truncate text-sm">
						{tokenSession?.job?.title ?? sessionTypeLabel(session?.type ?? '')}
					</span>
					<Badge variant="secondary" className="shrink-0">
						{sessionTypeLabel(session?.type ?? '')}
					</Badge>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span className="text-sm text-muted-foreground flex items-center gap-1">
						<Clock className="h-3.5 w-3.5" />
						{elapsedLabel()}
					</span>
					{questionCount > 0 && (
						<Badge variant="outline">
							Question {questionCount}
						</Badge>
					)}
					{confirmEnd ? (
						<>
							<Button size="sm" variant="destructive" onClick={finishSession} disabled={finishing}>
								{finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Yes, end interview'}
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
								Cancel
							</Button>
						</>
					) : (
						<Button size="sm" variant="destructive" onClick={() => setConfirmEnd(true)}>
							<PhoneOff className="h-4 w-4 mr-1" />
							End interview
						</Button>
					)}
				</div>
			</header>

			{notice && (
				<div className="px-4 pt-3">
					<div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2 text-sm flex items-start gap-2">
						<AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
						<span>{notice}</span>
						<button
							type="button"
							className="ml-auto text-amber-600 hover:text-amber-800"
							onClick={() => setNotice(null)}
							aria-label="Dismiss"
						>
							×
						</button>
					</div>
				</div>
			)}

			{/* main */}
			{voiceState === 'connecting' ? (
				<main className="flex-1 flex items-center justify-center p-4">
					<Card className="max-w-md w-full">
						<CardContent className="py-10 flex flex-col items-center gap-3 text-center">
							<Loader2 className="h-8 w-8 animate-spin text-primary" />
							<p className="font-medium">Connecting to your live voice interview…</p>
							<p className="text-sm text-muted-foreground">
								This takes a few seconds. If live voice isn&apos;t available, you&apos;ll
								continue with text answers instead.
							</p>
						</CardContent>
					</Card>
				</main>
			) : (
			<main className="flex-1 grid md:grid-cols-[1fr_380px] gap-4 p-4 max-w-6xl w-full mx-auto">
				{/* left: self view + status */}
				<div className="space-y-4">
					<div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
						{videoConsent && cameraReady ? (
							<video
								ref={videoRef}
								autoPlay
								playsInline
								muted
								className="absolute inset-0 w-full h-full object-cover mirror"
							/>
						) : (
							<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
								<VideoOff className="h-10 w-10" />
								<p className="text-sm">Video off</p>
							</div>
						)}
						{videoConsent && (
							<Button
								size="sm"
								variant="secondary"
								className="absolute bottom-3 left-3"
								onClick={handleWithdrawVideo}
							>
								<VideoOff className="h-4 w-4 mr-1" />
								Stop video
							</Button>
						)}
					</div>

					{/* AI status */}
					<div className="flex items-center gap-3 text-sm text-muted-foreground">
						<span className="relative flex h-3 w-3">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
							<span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
						</span>
						{sending
							? 'Interviewer is thinking…'
							: aiSpeaking
								? 'Interviewer is speaking…'
								: recording
									? 'Listening — tap the mic to stop'
									: voiceState === 'live'
										? 'Connected — the interviewer is listening'
										: 'Your turn — answer by text or voice'}
					</div>

					{/* live interim transcript */}
					{liveTranscript && (
						<div className="text-sm text-muted-foreground italic border-l-2 border-primary pl-3">
							{liveTranscript}
						</div>
					)}

					{error && <p className="text-sm text-destructive">{error}</p>}

					{/* input: voice room replaces the HTTP-turn controls while live */}
					{voiceState === 'live' ? (
						<div className="flex gap-2 items-center rounded-lg border border-primary/30 bg-primary/5 p-3">
							<span className="relative flex h-3 w-3 shrink-0">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
								<span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
							</span>
							<p className="text-sm flex-1">
								Live voice interview — speak naturally, the interviewer hears you and
								responds out loud.
							</p>
							<Button size="sm" variant="outline" onClick={stopVoice} className="shrink-0">
								Switch to text
							</Button>
						</div>
					) : (
					<div className="space-y-2">
						{/* Phase 3 (#447): typed-answer fallback when Web Speech API absent */}
						{speechNotSupported && (
							<p className="text-sm text-amber-600">
								{SPEECH_NOT_SUPPORTED_MESSAGE}
							</p>
						)}
					<div className="flex gap-2 items-end">
						<Textarea
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder="Type your answer…"
							className="min-h-[44px] flex-1"
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									void handleSend();
								}
							}}
							disabled={sending}
						/>
						<Button
							size="icon"
							variant={recording ? 'destructive' : 'outline'}
							className="min-h-[44px] min-w-[44px] shrink-0"
							onClick={toggleRecording}
							disabled={sending}
							aria-label={recording ? 'Stop recording' : 'Record voice answer'}
						>
							{recording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
						</Button>
						<Button
							className="min-h-[44px] shrink-0"
							onClick={handleSend}
							disabled={sending || !draft.trim()}
						>
							{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
							<span className="ml-1">Send</span>
						</Button>
					</div>
					</div>
					)}
				</div>

				{/* right: transcript */}
				<div className="border rounded-lg flex flex-col min-h-[300px] md:min-h-0">
					<div className="px-3 py-2 border-b font-medium text-sm">Conversation</div>
					<div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[60vh] md:max-h-none">
						{turns.length === 0 && (
							<p className="text-sm text-muted-foreground">
								The interviewer will begin shortly…
							</p>
						)}
												{turns.map((t) => (
										<div
											key={t._key}
								className={`rounded-md p-2.5 text-sm ${
									t.role === 'interviewer' ? 'bg-primary/10' : 'bg-muted'
								}`}
							>
								<p className="text-xs font-medium text-muted-foreground mb-1">
									{t.role === 'interviewer' ? 'Interviewer' : 'You'}
								</p>
								<p>{t.text}</p>
							</div>
						))}
						<div ref={transcriptEndRef} />
					</div>
				</div>
			</main>
			)}
		</div>
	);
}
