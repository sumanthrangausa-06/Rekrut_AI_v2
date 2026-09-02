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
import { useCallback, useEffect, useState } from 'react';
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
}

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

// ─── Consent Dialog ──────────────────────────────────────────────────────

function ConsentDialog({
	open,
	onClose,
	participants,
	recordingId,
	onConsentGiven,
	onStartRecording,
	allConsented,
	consentLoading,
}: {
	open: boolean;
	onClose: () => void;
	participants: ConsentParticipant[];
	recordingId: number | null;
	onConsentGiven: (userId: number) => void;
	onStartRecording: () => void;
	allConsented: boolean;
	consentLoading: boolean;
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
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3 py-2">
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
}: {
	roomName: string;
	onLeave: () => void;
	roomId: string;
	isRecruiter: boolean;
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
		} catch (err: unknown) {
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
		} catch (err: unknown) {
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
			} catch (err: unknown) {
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
		} catch (err: unknown) {
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
			/>
		</LiveKitRoom>
	);
}
