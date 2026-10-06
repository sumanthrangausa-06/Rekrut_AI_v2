/**
 * Track B (#323, M4) — the hiring team's side of a human-interview voice room.
 *
 * Minimal room join: reads ?sessionId=, fetches a session token from the
 * Phase 2 session endpoint (participant grants — publish+subscribe, the
 * recruiter interviews the candidate), and renders the standard LiveKitRoom
 * chrome. Same @livekit/components-react primitives as livekit-room.tsx;
 * deliberately no second room system.
 */

import {
	LiveKitRoom,
	RoomAudioRenderer,
	useLocalParticipant,
	useTracks,
	VideoTrack,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { AlertTriangle, Loader2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiCall } from '@/lib/api';

interface TokenResponse {
	token: string;
	roomName: string;
	livekitUrl: string;
}

function RecruiterControlBar({ onLeave }: { onLeave: () => void }) {
	const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

	const toggleMic = useCallback(() => {
		void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
	}, [localParticipant, isMicrophoneEnabled]);

	const toggleCam = useCallback(() => {
		void localParticipant.setCameraEnabled(!isCameraEnabled);
	}, [localParticipant, isCameraEnabled]);

	return (
		<div className="flex items-center justify-center gap-3 p-4 bg-slate-900/95 border-t border-slate-700 shrink-0">
			<Button
				variant={isMicrophoneEnabled ? 'secondary' : 'destructive'}
				size="icon"
				onClick={toggleMic}
				className="rounded-full h-12 w-12 min-h-[44px] min-w-[44px]"
				aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
			>
				{isMicrophoneEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
			</Button>
			<Button
				variant={isCameraEnabled ? 'secondary' : 'destructive'}
				size="icon"
				onClick={toggleCam}
				className="rounded-full h-12 w-12 min-h-[44px] min-w-[44px]"
				aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
			>
				{isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
			</Button>
			<Button
				variant="destructive"
				size="icon"
				onClick={onLeave}
				className="rounded-full h-12 w-12 min-h-[44px] min-w-[44px]"
				aria-label="Leave room"
			>
				<PhoneOff className="h-5 w-5" />
			</Button>
		</div>
	);
}

function RecruiterRoomUI({ roomName, onLeave }: { roomName: string; onLeave: () => void }) {
	const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);

	return (
		<div className="flex flex-col h-full bg-slate-950">
			<div className="px-4 py-2 border-b border-slate-800">
				<p className="text-sm text-slate-300">{roomName}</p>
			</div>
			<div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 p-2 overflow-auto">
				{tracks.map((track) => (
					<div
						key={track.participant.identity + track.source}
						className="relative rounded-lg overflow-hidden bg-slate-900 aspect-video"
					>
						<VideoTrack trackRef={track} className="w-full h-full object-cover" />
						<span className="absolute bottom-2 left-2 text-xs text-white bg-black/50 px-2 py-0.5 rounded">
							{track.participant.name || track.participant.identity}
						</span>
					</div>
				))}
			</div>
			<RecruiterControlBar onLeave={onLeave} />
			<RoomAudioRenderer />
		</div>
	);
}

export function SessionRoomPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const sessionId = searchParams.get('sessionId');

	const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchToken = useCallback(async () => {
		if (!sessionId) return;
		setLoading(true);
		setError(null);
		try {
			const data = await apiCall<TokenResponse>(
				`/livekit/session-rooms/${sessionId}/token`,
				{ method: 'POST' },
			);
			setTokenData(data);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to join room.');
		} finally {
			setLoading(false);
		}
	}, [sessionId]);

	useEffect(() => {
		if (sessionId) void fetchToken();
	}, [sessionId, fetchToken]);

	const handleLeave = useCallback(() => {
		navigate(-1);
	}, [navigate]);

	if (!sessionId) {
		return (
			<div className="min-h-[60vh] flex items-center justify-center px-4">
				<Card className="max-w-md w-full">
					<CardContent className="pt-6">
						<EmptyState
							icon={Video}
							title="No Session Selected"
							description="Open this page from the 'Join voice room' button on a human interview session."
						/>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-[60vh]">
				<div className="text-center space-y-4">
					<Loader2 className="h-12 w-12 animate-spin text-indigo-500 mx-auto" />
					<p className="text-foreground font-medium">Joining voice room…</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center min-h-[60vh] px-4">
				<Card className="max-w-md w-full">
					<CardContent className="flex flex-col items-center justify-center py-12 text-center">
						<AlertTriangle className="h-12 w-12 text-destructive mb-4" />
						<h2 className="text-xl font-semibold mb-2">Could Not Join Room</h2>
						<p className="text-muted-foreground mb-6 text-sm">{error}</p>
						<Button onClick={fetchToken}>Try Again</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!tokenData) return null;

	return (
		<div className="h-[calc(100vh-4rem)]">
			<LiveKitRoom
				token={tokenData.token}
				serverUrl={tokenData.livekitUrl}
				connect={true}
				audio={true}
				video={true}
				onDisconnected={handleLeave}
			>
				<RecruiterRoomUI roomName={tokenData.roomName} onLeave={handleLeave} />
			</LiveKitRoom>
		</div>
	);
}
