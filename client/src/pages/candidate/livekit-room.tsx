import {
	LiveKitRoom,
	RoomAudioRenderer,
	useConnectionState,
	useLocalParticipant,
	useParticipants,
	useTracks,
	VideoTrack,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import {
	AlertTriangle,
	ArrowLeft,
	CheckCircle,
	ChevronRight,
	CircleDot,
	Loader2,
	Mic,
	MicOff,
	MonitorUp,
	MonitorX,
	PhoneOff,
	PlayCircle,
	Square,
	Users,
	Video,
	VideoOff,
	Wifi,
	WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────

interface TokenResponse {
	token: string;
	roomName: string;
	livekitUrl: string;
	expiresIn: number;
	// S-048 (#696): observer disclosure fields (optional for backwards compat)
	observer_enabled?: boolean;
	observer_consent?: 'granted' | 'declined' | 'unknown';
	// S-D18 (#1955, BR-7 §4.2): the caller's OWN labelling-notice state —
	// present only for recruiter/panel roles, absent for candidates.
	labelling_notice?: LabellingNoticeState;
}

// S-D20 (#1957, BR-7 §4.2/§4.3): token labelling_notice field, verbatim
// shape from S-D18 — the caller's own decision only, never another
// participant's posture.
export interface LabellingNoticeState {
	event_id: number;
	notice_version: string;
	roster_version: string;
	own_decision: 'granted' | 'declined' | 'withdrawn' | null;
	decision_scope?: string;
}

export type LabellingDecision = 'granted' | 'declined' | 'withdrawn';

interface RecordingInfo {
	id: number;
	status: string;
	started_at: string;
	room_id: number;
}

interface ConsentParticipant {
	userId: number;
	name: string;
	consented: boolean;
}

// ─── Connection State Badge ──────────────────────────────────────────────

function ConnectionBadge() {
	const state = useConnectionState();

	const configs: Record<
		ConnectionState,
		{ label: string; classes: string; icon: typeof Wifi; spin?: boolean }
	> = {
		[ConnectionState.Connecting]: {
			label: 'Connecting…',
			classes: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
			icon: Loader2,
			spin: true,
		},
		[ConnectionState.Connected]: {
			label: 'Connected',
			classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
			icon: Wifi,
		},
		[ConnectionState.Disconnected]: {
			label: 'Disconnected',
			classes: 'bg-red-500/20 text-red-300 border-red-500/30',
			icon: WifiOff,
		},
		[ConnectionState.Reconnecting]: {
			label: 'Reconnecting…',
			classes: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
			icon: Loader2,
			spin: true,
		},
		[ConnectionState.SignalReconnecting]: {
			label: 'Reconnecting…',
			classes: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
			icon: Loader2,
			spin: true,
		},
	};

	const config = configs[state] || configs[ConnectionState.Connecting];
	const Icon = config.icon;

	return (
		<Badge variant="outline" className={`${config.classes} flex items-center gap-1.5 px-2.5 py-1`}>
			<Icon className={`h-3.5 w-3.5 ${config.spin ? 'animate-spin' : ''}`} />
			<span className="text-xs font-medium">{config.label}</span>
		</Badge>
	);
}

// ─── Recording Indicator ─────────────────────────────────────────────────

function RecordingBadge() {
	return (
		<Badge
			variant="outline"
			className="bg-red-500/20 text-red-300 border-red-500/30 flex items-center gap-1.5 px-2.5 py-1"
		>
			<CircleDot className="h-3 w-3 animate-pulse text-red-500" />
			<span className="text-xs font-medium">Recording</span>
		</Badge>
	);
}

// ─── Participant Video Tile ──────────────────────────────────────────────

function ParticipantVideoTile({
	identity,
	name,
	isLocal,
}: {
	identity: string;
	name: string;
	isLocal?: boolean;
}) {
	const cameraTracks = useTracks([Track.Source.Camera]);
	const screenTracks = useTracks([Track.Source.ScreenShare]);

	const cameraTrack = cameraTracks.find(
		(t) => t.participant.identity === identity && t.source === Track.Source.Camera,
	);
	const screenTrack = screenTracks.find(
		(t) => t.participant.identity === identity && t.source === Track.Source.ScreenShare,
	);

	return (
		<div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center shadow-lg">
			{cameraTrack ? (
				<VideoTrack trackRef={cameraTrack} className="w-full h-full object-cover" />
			) : (
				<div className="flex flex-col items-center justify-center gap-2">
					<div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-xl">
						{(name || identity || '?').charAt(0).toUpperCase()}
					</div>
				</div>
			)}

			{/* Name badge */}
			<div className="absolute bottom-3 left-3 flex items-center gap-2">
				<span className="text-xs font-medium text-white bg-black/60 px-2.5 py-1 rounded-md backdrop-blur-sm">
					{name || identity} {isLocal && '(You)'}
				</span>
			</div>

			{/* Screen-share indicator */}
			{screenTrack && (
				<div className="absolute top-3 right-3 bg-indigo-500/90 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1">
					<MonitorUp className="h-3 w-3" /> Sharing
				</div>
			)}
		</div>
	);
}

// ─── Video Grid ──────────────────────────────────────────────────────────

function VideoGrid() {
	const { localParticipant } = useLocalParticipant();
	const remoteParticipants = useParticipants();

	const allParticipants = [
		{
			identity: localParticipant.identity,
			name: localParticipant.name,
			isLocal: true as const,
		},
		...remoteParticipants.map((p) => ({
			identity: p.identity,
			name: p.name,
			isLocal: false as const,
		})),
	];

	const count = allParticipants.length;
	const gridClass =
		count === 1
			? 'grid-cols-1'
			: count === 2
				? 'grid-cols-1 md:grid-cols-2'
				: count === 3
					? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
					: 'grid-cols-1 md:grid-cols-2';

	return (
		<div className={`grid ${gridClass} gap-3 h-full content-center`}>
			{allParticipants.map((p) => (
				<ParticipantVideoTile
					key={p.identity}
					identity={p.identity}
					name={p.name || p.identity}
					isLocal={p.isLocal}
				/>
			))}
		</div>
	);
}

// ─── Participant Sidebar ─────────────────────────────────────────────────

function ParticipantSidebar({ onClose }: { onClose: () => void }) {
	const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
	const remoteParticipants = useParticipants();

	return (
		<div className="w-full sm:w-64 bg-slate-900/95 border-l border-slate-700 flex flex-col h-full absolute right-0 top-0 z-20 sm:relative">
			<div className="flex items-center justify-between p-4 border-b border-slate-700">
				<h3 className="text-sm font-semibold text-white flex items-center gap-2">
					<Users className="h-4 w-4 text-indigo-400" />
					Participants ({remoteParticipants.length + 1})
				</h3>
				<Button
					variant="ghost"
					size="icon"
					onClick={onClose}
					className="text-slate-400 hover:text-white h-8 w-8"
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>

			<div className="flex-1 overflow-y-auto p-2 space-y-1">
				{/* Local participant */}
				<div className="flex items-center gap-3 p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
					<div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
						{(localParticipant.name || localParticipant.identity || '?').charAt(0).toUpperCase()}
					</div>
					<div className="flex-1 min-w-0">
						<p className="text-sm text-white font-medium truncate">
							{localParticipant.name || localParticipant.identity}{' '}
							<span className="text-indigo-300">(You)</span>
						</p>
					</div>
					<div className="flex gap-1">
						{isMicrophoneEnabled ? (
							<Mic className="h-3.5 w-3.5 text-emerald-400" />
						) : (
							<MicOff className="h-3.5 w-3.5 text-red-400" />
						)}
						{isCameraEnabled ? (
							<Video className="h-3.5 w-3.5 text-emerald-400" />
						) : (
							<VideoOff className="h-3.5 w-3.5 text-red-400" />
						)}
					</div>
				</div>

				{/* Remote participants */}
				{remoteParticipants.map((p) => (
					<div
						key={p.identity}
						className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-800/50 transition-colors"
					>
						<div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
							{(p.name || p.identity || '?').charAt(0).toUpperCase()}
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-sm text-slate-200 truncate">{p.name || p.identity}</p>
						</div>
						{p.isSpeaking && (
							<div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
						)}
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Control Bar ─────────────────────────────────────────────────────────

function RoomControlBar({
	onLeave,
	isRecruiter,
	recording,
	onStartRecording,
	onStopRecording,
	startingRecording,
	stoppingRecording,
}: {
	onLeave: () => void;
	isRecruiter: boolean;
	recording: RecordingInfo | null;
	onStartRecording: () => void;
	onStopRecording: () => void;
	startingRecording: boolean;
	stoppingRecording: boolean;
}) {
	const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
	const [isScreenSharing, setIsScreenSharing] = useState(false);

	const toggleMic = useCallback(() => {
		void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
	}, [localParticipant, isMicrophoneEnabled]);

	const toggleCam = useCallback(() => {
		void localParticipant.setCameraEnabled(!isCameraEnabled);
	}, [localParticipant, isCameraEnabled]);

	const toggleScreenShare = useCallback(async () => {
		try {
			await localParticipant.setScreenShareEnabled(!isScreenSharing);
			setIsScreenSharing((prev) => !prev);
		} catch {
			// User cancelled or screen share not supported
		}
	}, [localParticipant, isScreenSharing]);

	return (
		<div className="flex items-center justify-center gap-3 p-4 bg-slate-900/95 border-t border-slate-700 shrink-0 flex-wrap">
			<Button
				variant={isMicrophoneEnabled ? 'secondary' : 'destructive'}
				size="icon"
				onClick={toggleMic}
				className={`rounded-full h-12 w-12 min-h-[44px] min-w-[44px] ${
					isMicrophoneEnabled ? 'bg-slate-700 hover:bg-slate-600 text-white' : ''
				}`}
				aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
			>
				{isMicrophoneEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
			</Button>

			<Button
				variant={isCameraEnabled ? 'secondary' : 'destructive'}
				size="icon"
				onClick={toggleCam}
				className={`rounded-full h-12 w-12 min-h-[44px] min-w-[44px] ${
					isCameraEnabled ? 'bg-slate-700 hover:bg-slate-600 text-white' : ''
				}`}
				aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
			>
				{isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
			</Button>

			<Button
				variant={isScreenSharing ? 'default' : 'secondary'}
				size="icon"
				onClick={toggleScreenShare}
				className={`rounded-full h-12 w-12 min-h-[44px] min-w-[44px] ${
					isScreenSharing
						? 'bg-indigo-600 hover:bg-indigo-700 text-white'
						: 'bg-slate-700 hover:bg-slate-600 text-white'
				}`}
				aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
			>
				{isScreenSharing ? <MonitorX className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
			</Button>

			{/* Recording controls — recruiters only */}
			{isRecruiter &&
				(recording ? (
					<Button
						variant="destructive"
						size="icon"
						onClick={onStopRecording}
						disabled={stoppingRecording}
						className="rounded-full h-12 w-12 min-h-[44px] min-w-[44px] bg-red-600 hover:bg-red-700"
						aria-label="Stop recording"
					>
						{stoppingRecording ? (
							<Loader2 className="h-5 w-5 animate-spin" />
						) : (
							<Square className="h-5 w-5" />
						)}
					</Button>
				) : (
					<Button
						variant="destructive"
						size="icon"
						onClick={onStartRecording}
						disabled={startingRecording}
						className="rounded-full h-12 w-12 min-h-[44px] min-w-[44px] bg-red-600 hover:bg-red-700"
						aria-label="Start recording"
					>
						{startingRecording ? (
							<Loader2 className="h-5 w-5 animate-spin" />
						) : (
							<PlayCircle className="h-5 w-5" />
						)}
					</Button>
				))}

			<Button
				variant="destructive"
				size="icon"
				onClick={onLeave}
				className="rounded-full h-12 w-12 min-h-[44px] min-w-[44px] bg-red-600 hover:bg-red-700"
				aria-label="Leave room"
			>
				<PhoneOff className="h-5 w-5" />
			</Button>
		</div>
	);
}

// ─── Panel Labelling Notice (S-D20, #1957 — BR-7 §4.3) ──────────────────

/**
 * PanelLabellingNotice — each non-candidate participant's OWN speaker-
 * labelling disclosure + decision, on their own screen, per join.
 *
 * The notice IS the disclosure (privacy C-10, binding): the labelling
 * decision is visually and mechanically distinct from recording consent
 * (own section, own heading, own fieldset — never a bundled control);
 * Decline is rendered with exactly Agree's prominence; neither is
 * pre-selected. A recorded decision renders as a collapsed one-line
 * status with a Change control — a recorded decline is NOT re-prompted
 * on rejoin. Clicking a decision POSTs the S-D18 capture as the caller
 * and the component re-renders ONLY from the server's response; a
 * failed POST leaves the notice open with an honest error.
 *
 * Renders nothing when `notice` is absent — the candidate case (the
 * token carries no labelling field for candidates, §4.2).
 */
export function PanelLabellingNotice({
	notice,
	callerName,
	roomId,
	onDecide,
	variant = 'dark',
}: {
	notice?: LabellingNoticeState | null;
	callerName?: string;
	roomId: string | number;
	onDecide?: (
		decision: LabellingDecision,
	) => Promise<{ own_decision?: string | null; decision?: string }>;
	variant?: 'dark' | 'light';
}) {
	const [decision, setDecision] = useState<LabellingDecision | null>(notice?.own_decision ?? null);
	const [changing, setChanging] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const changeButtonRef = useRef<HTMLButtonElement | null>(null);
	const focusChangeOnCollapse = useRef(false);

	// A rejoin issues a fresh token: re-sync to the server's current word.
	useEffect(() => {
		setDecision(notice?.own_decision ?? null);
		setChanging(false);
		setError(null);
	}, [notice?.event_id, notice?.roster_version, notice?.own_decision]);

	// Minor 3: after a decision (or Keep) collapses the notice, move focus
	// to the collapsed Change control so keyboard focus is not dropped.
	useEffect(() => {
		if (focusChangeOnCollapse.current && decision && !changing) {
			focusChangeOnCollapse.current = false;
			changeButtonRef.current?.focus();
		}
	});

	if (!notice) return null;

	const decide = async (d: LabellingDecision) => {
		setSubmitting(true);
		setError(null);
		try {
			const res = onDecide
				? await onDecide(d)
				: await apiCall<{ own_decision?: string; decision?: string }>(
						`/interviews/events/${notice.event_id}/labelling-consent`,
						{
							method: 'POST',
							body: {
								decision: d,
								room_id: Number(roomId),
								roster_version: notice.roster_version,
							},
						},
					);
			const recorded = (res?.own_decision ?? res?.decision) as LabellingDecision | undefined;
			if (!recorded) throw new Error('Decision was not recorded');
			setDecision(recorded);
			setChanging(false);
			// Minor 3: the clicked control unmounts as the notice collapses —
			// move focus to the collapsed Change control, not <body>.
			focusChangeOnCollapse.current = true;
		} catch (err) {
			const e = err as { status?: number; code?: string } | null;
			if (e?.code === 'ROSTER_CHANGED' || e?.status === 409) {
				// Minor 1 (§5.2): retrying replays the stale roster_version and
				// can never succeed — the remedy is to re-join for a fresh token.
				setError(
					'Your speaker labelling decision could not be recorded because the participant list has changed. Please re-join the interview to get the latest information, then make your decision again.',
				);
			} else {
				setError('Your speaker labelling decision could not be recorded. Please try again.');
			}
		} finally {
			setSubmitting(false);
		}
	};

	const shell =
		variant === 'dark'
			? 'rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100'
			: 'rounded-lg border border-border bg-muted/40 px-4 py-3 text-foreground';
	const muted = variant === 'dark' ? 'text-slate-300' : 'text-muted-foreground';

	const statusText =
		decision === 'granted'
			? 'You agreed to speaker labelling for this interview'
			: decision === 'declined'
				? 'You declined speaker labelling for this interview'
				: decision === 'withdrawn'
					? 'You withdrew your speaker labelling agreement for this interview'
					: null;

	// Collapsed status (§4.3): a recorded decision is a one-line status +
	// Change — never a re-prompt, never reset to undecided.
	if (statusText && !changing) {
		return (
			<div className={`${shell} flex items-center justify-between gap-3`}>
				<p className="text-sm" role="status" aria-live="polite">
					{statusText}
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					ref={changeButtonRef}
					onClick={() => setChanging(true)}
					className="min-h-[44px] shrink-0"
				>
					Change
				</Button>
			</div>
		);
	}

	return (
		<section aria-labelledby="panel-labelling-notice-heading" className={shell}>
			<h2 id="panel-labelling-notice-heading" className="text-sm font-semibold">
				Speaker labelling — your decision
			</h2>
			{/* Canonical BR-7 sentence, verbatim — the same string the
			    ConsentDialog and privacy.tsx §13 carry (§4.3). */}
			<p className={`mt-2 text-sm ${muted}`}>
				Speaker labelling (where the candidate has given biometric consent): to label who
				said what in a recorded interview, we create a temporary mathematical template of
				each speaker's voice during processing; the template exists only while the
				labelling runs and is never stored. This applies to everyone in the call —
				candidate, recruiters, and panel members alike.
			</p>
			{callerName && (
				<p className="mt-2 text-sm font-medium">You are agreeing as {callerName}</p>
			)}
			{/* Consequences stated BEFORE the click — a decline must be
			    informed to be real (§4.3). */}
			<p className={`mt-2 text-sm ${muted}`}>
				If you decline: The interview and the recording can still go ahead. No speaker
				labels will be created for this recording, and the transcript will not show who
				said what.
			</p>
			<p className={`mt-1 text-sm ${muted}`}>
				If you agree: Speaker labels will be created for this recording only if every
				participant agrees and the candidate has given biometric consent.
			</p>
			{error && (
				<p role="alert" className="mt-2 text-sm font-medium text-red-500">
					{error}
				</p>
			)}
			<fieldset className="mt-3">
				<legend className="text-sm font-medium">Your speaker labelling decision</legend>
				<div className="mt-2 flex flex-col gap-2 sm:flex-row">
					<Button
						type="button"
						variant="secondary"
						disabled={submitting}
						onClick={() => void decide('granted')}
						className="min-h-[44px] flex-1"
					>
						I agree to speaker labelling of my voice as described above
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={submitting}
						onClick={() => void decide('declined')}
						className="min-h-[44px] flex-1"
					>
						I decline speaker labelling
					</Button>
				</div>
				{(decision === 'granted' || statusText) && (
					<div className="mt-2 flex flex-wrap gap-2">
						{decision === 'granted' && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={submitting}
								onClick={() => void decide('withdrawn')}
								className="min-h-[44px]"
							>
								Withdraw my agreement
							</Button>
						)}
						{statusText && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={submitting}
								onClick={() => {
									focusChangeOnCollapse.current = true;
									setChanging(false);
								}}
								className="min-h-[44px]"
							>
								Keep my current decision
							</Button>
						)}
					</div>
				)}
			</fieldset>
		</section>
	);
}

// ─── Consent Dialog ──────────────────────────────────────────────────────

// Exported for S-048 (#696) component tests
export function ConsentDialog({
	open,
	onClose,
	participants,
	recordingId,
	onConsentGiven,
	onStartRecording,
	allConsented,
	consentLoading,
	// S-048 (#696): observer disclosure — branched on consent state per
	// privacy-engineer review. observerEnabled = recruiter intent;
	// observerConsent = default-deny gate state (granted|declined|unknown).
	observerEnabled,
	observerConsent,
}: {
	open: boolean;
	onClose: () => void;
	participants: ConsentParticipant[];
	recordingId: number | null;
	onConsentGiven: (userId: number) => void;
	onStartRecording: () => void;
	allConsented: boolean;
	consentLoading: boolean;
	observerEnabled?: boolean;
	observerConsent?: 'granted' | 'declined' | 'unknown';
}) {
	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<CircleDot className="h-5 w-5 text-red-500" />
						Recording Consent Required
					</DialogTitle>
					<DialogDescription>
						All participants must consent before the interview can be recorded.
						{/* S-048 (#696): observer disclosure branched on default-deny
						    gate state. granted → affirmative notice; declined →
						    reassurance that the gate honored their choice; unknown
						    or disabled → nothing (observer is blocked, nothing
						    truthful to disclose). */}
						{observerEnabled && observerConsent === 'granted' && (
							<span className="block mt-2 text-xs">
								This session will include AI-assisted analysis of your voice and video
								to help the recruiter evaluate the interview.{' '}
								<a
									href="/privacy/biometric-policy"
									target="_blank"
									rel="noopener noreferrer"
									className="underline"
								>
									Learn more
								</a>
							</span>
						)}
						{observerEnabled && observerConsent === 'declined' && (
							<span className="block mt-2 text-xs text-emerald-700">
								AI-assisted analysis of this session is disabled — you declined
								biometric analysis.
							</span>
						)}
						{/* S-D15 (#1917, BR-7): all-speaker diarization disclosure.
						    Standing mechanism explanation (not a promise labelling
						    will run on this call — it stays gated on the candidate's
						    live biometric consent at job-claim time, BR-2/BR-3). */}
						<span className="block mt-2 text-xs">
							Speaker labelling (where the candidate has given biometric consent):
							to label who said what in a recorded interview, we
							create a temporary mathematical template of each speaker's voice
							during processing; the template exists only while the labelling runs
							and is never stored. This applies to everyone in the call —
							candidate, recruiters, and panel members alike.
						</span>
						{/* S-D20 (#1957, BR-7 §4.4): clarification only — this
						    dialog is never the labelling capture surface; it
						    gains NO labelling buttons. */}
						<span className="block mt-2 text-xs">
							Speaker labelling is decided by each participant on their own
							screen — it is not recorded here. The list below is recording
							consent only.
						</span>
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3 py-2">
					<p className="text-sm font-medium">Recording consent</p>
					{participants.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading participants...</p>
					) : (
						participants.map((p) => (
							<div
								key={p.userId}
								className={`flex items-center justify-between p-3 rounded-lg border ${
									p.consented ? 'bg-emerald-50 border-emerald-200' : 'bg-muted/50 border-border'
								}`}
							>
								<div className="flex items-center gap-2">
									{p.consented ? (
										<CheckCircle className="h-4 w-4 text-emerald-600" />
									) : (
										<CircleDot className="h-4 w-4 text-muted-foreground" />
									)}
									<span className="text-sm font-medium">{p.name}</span>
								</div>
								{p.consented ? (
									<Badge variant="success" className="text-xs">
										Consented
									</Badge>
								) : (
									<Button
										size="sm"
										variant="outline"
										onClick={() => onConsentGiven(p.userId)}
										disabled={consentLoading || !recordingId}
										className="min-h-[36px] text-xs"
										title={
											!recordingId
												? 'Recording ID not available. Please retry starting the recording.'
												: ''
										}
									>
										I consent to being recorded
									</Button>
								)}
							</div>
						))
					)}
					{!recordingId && participants.some((p) => !p.consented) && (
						<p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
							Note: Recording consent cannot be recorded until a recording is initialized. Click
							"Start Recording" below to retry after all participants have given verbal consent.
						</p>
					)}
				</div>
				<div className="flex justify-end gap-2 mt-4">
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={onStartRecording}
						disabled={!allConsented || consentLoading}
						className="gap-1"
					>
						{consentLoading ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<PlayCircle className="h-4 w-4" />
						)}
						Start Recording
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ─── Room UI (rendered inside LiveKitRoom context) ───────────────────────

function RoomUI({
	roomName,
	onLeave,
	roomId,
	isRecruiter,
	observerEnabled,
	observerConsent,
	labellingNotice,
	callerName,
}: {
	roomName: string;
	onLeave: () => void;
	roomId: string;
	isRecruiter: boolean;
	observerEnabled?: boolean;
	observerConsent?: 'granted' | 'declined' | 'unknown';
	labellingNotice?: LabellingNoticeState | null;
	callerName?: string;
}) {
	const [showSidebar, setShowSidebar] = useState(false);
	const [recording, setRecording] = useState<RecordingInfo | null>(null);
	const [startingRecording, setStartingRecording] = useState(false);
	const [stoppingRecording, setStoppingRecording] = useState(false);
	const [showConsentDialog, setShowConsentDialog] = useState(false);
	const [consentParticipants, setConsentParticipants] = useState<ConsentParticipant[]>([]);
	const [consentRecordingId, setConsentRecordingId] = useState<number | null>(null);
	const [consentLoading, setConsentLoading] = useState(false);
	const [toastMessage, setToastMessage] = useState<string | null>(null);

	// Get participant info at component top level (hooks rule)
	const localParticipantInfo = useLocalParticipant();
	const remoteParticipantsList = useParticipants();

	const showToast = useCallback((message: string) => {
		setToastMessage(message);
		setTimeout(() => setToastMessage(null), 4000);
	}, []);

	const handleStartRecording = useCallback(async () => {
		if (!roomId) return;
		setStartingRecording(true);
		try {
			const res = await fetch(`/api/interviews/recordings/start`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${localStorage.getItem('rekrutai_token') || ''}`,
				},
				body: JSON.stringify({ room_id: parseInt(roomId, 10) }),
				credentials: 'include',
			});

			const data = await res.json().catch(() => ({ error: 'Request failed' }));

			if (res.status === 201 && data.recording) {
				setRecording(data.recording);
				setConsentRecordingId(data.recording.id);
				showToast('Recording started');
			} else if (res.status === 409 && data.recording) {
				setRecording(data.recording);
				setConsentRecordingId(data.recording.id);
				showToast('Recording already in progress');
			} else if (res.status === 403 && data.code === 'CONSENT_REQUIRED') {
				// Build participant list from missing consent data
				const allParticipants = [
					{
						identity: localParticipantInfo.localParticipant.identity,
						name: localParticipantInfo.localParticipant.name,
					},
					...remoteParticipantsList.map((p) => ({
						identity: p.identity,
						name: p.name,
					})),
				];
				const missingIds: number[] = data.missingConsentFrom || [];
				const participants: ConsentParticipant[] = missingIds.map((userId, idx) => ({
					userId,
					name:
						allParticipants[idx]?.name || allParticipants[idx]?.identity || `Participant ${userId}`,
					consented: false,
				}));
				setConsentParticipants(participants);
				setShowConsentDialog(true);
				showToast('Consent required from all participants');
			} else {
				showToast(data.error || 'Failed to start recording');
			}
		} catch (err: any) {
			showToast(err.message || 'Failed to start recording');
		} finally {
			setStartingRecording(false);
		}
	}, [roomId, localParticipantInfo, remoteParticipantsList, showToast]);

	const handleStopRecording = useCallback(async () => {
		if (!recording) return;
		setStoppingRecording(true);
		try {
			await apiCall(`/interviews/recordings/${recording.id}/stop`, {
				method: 'POST',
			});
			setRecording(null);
			showToast('Recording stopped');
		} catch (err: any) {
			showToast(err.message || 'Failed to stop recording');
		} finally {
			setStoppingRecording(false);
		}
	}, [recording, showToast]);

	const handleConsentGiven = useCallback(
		async (userId: number) => {
			if (!consentRecordingId) {
				showToast('Unable to record consent — no recording ID available');
				return;
			}
			setConsentLoading(true);
			try {
				await apiCall(`/interviews/recordings/${consentRecordingId}/consent`, {
					method: 'POST',
					body: { consent_type: 'explicit' },
				});
				setConsentParticipants((prev) =>
					prev.map((p) => (p.userId === userId ? { ...p, consented: true } : p)),
				);
				showToast('Consent recorded');
			} catch (err: any) {
				showToast(err.message || 'Failed to record consent');
			} finally {
				setConsentLoading(false);
			}
		},
		[consentRecordingId, showToast],
	);

	const handleConsentStartRecording = useCallback(async () => {
		setShowConsentDialog(false);
		await handleStartRecording();
	}, [handleStartRecording]);

	const allConsented = consentParticipants.every((p) => p.consented);

	return (
		<div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-950 text-white overflow-hidden rounded-xl">
			{/* Toast */}
			{toastMessage && (
				<div className="fixed top-4 right-4 z-[100] flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg bg-emerald-600 text-white animate-in slide-in-from-right fade-in duration-200">
					<CheckCircle className="h-4 w-4" />
					{toastMessage}
				</div>
			)}

			{/* Header */}
			<header className="flex items-center justify-between px-4 py-3 bg-slate-900/95 border-b border-slate-700 shrink-0">
				<div className="flex items-center gap-3 min-w-0">
					<Button
						variant="ghost"
						size="sm"
						onClick={onLeave}
						className="text-slate-300 hover:text-white shrink-0"
					>
						<ArrowLeft className="h-4 w-4 mr-1" />
						<span className="hidden sm:inline">Back</span>
					</Button>
					<h1 className="text-sm font-semibold text-white truncate">{roomName}</h1>
				</div>
				<div className="flex items-center gap-3 shrink-0">
					{recording && <RecordingBadge />}
					<ConnectionBadge />
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setShowSidebar((s) => !s)}
						className={`text-slate-300 hover:text-white ${showSidebar ? 'bg-slate-800' : ''}`}
					>
						<Users className="h-4 w-4 mr-1.5" />
						<span className="hidden sm:inline">Participants</span>
					</Button>
				</div>
			</header>

			{/* Main area */}
			<div className="flex flex-1 overflow-hidden relative">
				<main className="flex-1 overflow-y-auto p-3">
					<VideoGrid />
				</main>
				{showSidebar && <ParticipantSidebar onClose={() => setShowSidebar(false)} />}
			</div>

			{/* S-D20 (#1957, BR-7 §4.3): own-screen labelling notice — above
			    the room controls, before recording starts; renders per join
			    for non-candidates only (the token field is absent for
			    candidates, and the component renders nothing without it). */}
			{labellingNotice && (
				<div className="shrink-0 px-3 pt-3">
					<PanelLabellingNotice
						notice={labellingNotice}
						callerName={callerName}
						roomId={roomId}
					/>
				</div>
			)}

			{/* Controls */}
			<RoomControlBar
				onLeave={onLeave}
				isRecruiter={isRecruiter}
				recording={recording}
				onStartRecording={handleStartRecording}
				onStopRecording={handleStopRecording}
				startingRecording={startingRecording}
				stoppingRecording={stoppingRecording}
			/>
			<RoomAudioRenderer />

			{/* Consent Dialog */}
			<ConsentDialog
				open={showConsentDialog}
				onClose={() => setShowConsentDialog(false)}
				participants={consentParticipants}
				recordingId={consentRecordingId}
				onConsentGiven={handleConsentGiven}
				onStartRecording={handleConsentStartRecording}
				allConsented={allConsented}
				consentLoading={consentLoading}
				observerEnabled={observerEnabled}
				observerConsent={observerConsent}
			/>
		</div>
	);
}

// ─── Main Page Component ─────────────────────────────────────────────────

export function LiveKitRoomPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { user } = useAuth();
	const roomId = searchParams.get('roomId');

	const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isRecruiter =
		user?.role === 'recruiter' ||
		user?.role === 'hiring_manager' ||
		user?.role === 'employer' ||
		user?.role === 'admin';

	const fetchToken = useCallback(async () => {
		if (!roomId) return;
		setLoading(true);
		setError(null);
		try {
			const data = await apiCall<TokenResponse>(`/livekit/rooms/${roomId}/token`, {
				method: 'POST',
			});
			setTokenData(data);
		} catch (err: any) {
			setError(err.message || 'Failed to join room. Please check your room ID and try again.');
		} finally {
			setLoading(false);
		}
	}, [roomId]);

	useEffect(() => {
		if (roomId) {
			fetchToken();
		}
	}, [roomId, fetchToken]);

	const handleLeave = useCallback(() => {
		navigate('/candidate/interviews');
	}, [navigate]);

	/* ── Empty state: no roomId ── */
	if (!roomId) {
		return (
			<div className="min-h-[60vh] flex items-center justify-center px-4">
				<Card className="max-w-md w-full">
					<CardContent className="pt-6">
						<EmptyState
							icon={Video}
							title="No Room Selected"
							description="Please provide a room ID to join a video interview. You can find your room link in your scheduled interviews."
							action={{ label: 'View Interviews', href: '/candidate/interviews' }}
						/>
					</CardContent>
				</Card>
			</div>
		);
	}

	/* ── Loading state ── */
	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-[60vh]">
				<div className="text-center space-y-4">
					<Loader2 className="h-12 w-12 animate-spin text-indigo-500 mx-auto" />
					<p className="text-foreground font-medium">Joining video room…</p>
					<p className="text-muted-foreground text-sm">
						Please allow camera and microphone access when prompted
					</p>
				</div>
			</div>
		);
	}

	/* ── Error state ── */
	if (error) {
		return (
			<div className="flex items-center justify-center min-h-[60vh] px-4">
				<Card className="max-w-md w-full">
					<CardContent className="flex flex-col items-center justify-center py-12 text-center">
						<AlertTriangle className="h-12 w-12 text-destructive mb-4" />
						<h2 className="text-xl font-semibold mb-2">Could Not Join Room</h2>
						<p className="text-muted-foreground mb-6 text-sm">{error}</p>
						<div className="flex gap-3 flex-wrap justify-center">
							<Button variant="outline" onClick={() => navigate('/candidate/interviews')}>
								Back to Interviews
							</Button>
							<Button onClick={fetchToken}>Try Again</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	/* ── Not ready yet ── */
	if (!tokenData) {
		return null;
	}

	return (
		<LiveKitRoom
			token={tokenData.token}
			serverUrl={tokenData.livekitUrl}
			connect={true}
			audio={true}
			video={true}
			onDisconnected={handleLeave}
		>
			<RoomUI
				roomName={tokenData.roomName}
				onLeave={handleLeave}
				roomId={roomId}
				isRecruiter={isRecruiter}
				observerEnabled={tokenData.observer_enabled}
				observerConsent={tokenData.observer_consent}
				labellingNotice={tokenData.labelling_notice}
				callerName={user?.name}
			/>
		</LiveKitRoom>
	);
}
