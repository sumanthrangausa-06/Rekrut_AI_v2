import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
	LiveKitRoom,
	RoomAudioRenderer,
	VideoTrack,
	useConnectionState,
	useLocalParticipant,
	useParticipants,
	useTracks,
} from '@livekit/components-react'
import { ConnectionState, Track } from 'livekit-client'
import {
	AlertTriangle,
	ArrowLeft,
	ChevronRight,
	Loader2,
	Mic,
	MicOff,
	MonitorUp,
	MonitorX,
	PhoneOff,
	Users,
	Video,
	VideoOff,
	Wifi,
	WifiOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/domain/empty-state'
import { apiCall } from '@/lib/api'

// ─── Types ───────────────────────────────────────────────────────────────

interface TokenResponse {
	token: string
	roomName: string
	livekitUrl: string
	expiresIn: number
}

// ─── Connection State Badge ──────────────────────────────────────────────

function ConnectionBadge() {
	const state = useConnectionState()

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
	}

	const config = configs[state] || configs[ConnectionState.Connecting]
	const Icon = config.icon

	return (
		<Badge variant='outline' className={`${config.classes} flex items-center gap-1.5 px-2.5 py-1`}>
			<Icon className={`h-3.5 w-3.5 ${config.spin ? 'animate-spin' : ''}`} />
			<span className='text-xs font-medium'>{config.label}</span>
		</Badge>
	)
}

// ─── Participant Video Tile ──────────────────────────────────────────────

function ParticipantVideoTile({
	identity,
	name,
	isLocal,
}: {
	identity: string
	name: string
	isLocal?: boolean
}) {
	const cameraTracks = useTracks([Track.Source.Camera])
	const screenTracks = useTracks([Track.Source.ScreenShare])

	const cameraTrack = cameraTracks.find(
		(t) => t.participant.identity === identity && t.source === Track.Source.Camera,
	)
	const screenTrack = screenTracks.find(
		(t) => t.participant.identity === identity && t.source === Track.Source.ScreenShare,
	)

	return (
		<div className='relative rounded-xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center shadow-lg'>
			{cameraTrack ? (
				<VideoTrack trackRef={cameraTrack} className='w-full h-full object-cover' />
			) : (
				<div className='flex flex-col items-center justify-center gap-2'>
					<div className='w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-xl'>
						{(name || identity || '?').charAt(0).toUpperCase()}
					</div>
				</div>
			)}

			{/* Name badge */}
			<div className='absolute bottom-3 left-3 flex items-center gap-2'>
				<span className='text-xs font-medium text-white bg-black/60 px-2.5 py-1 rounded-md backdrop-blur-sm'>
					{name || identity} {isLocal && '(You)'}
				</span>
			</div>

			{/* Screen-share indicator */}
			{screenTrack && (
				<div className='absolute top-3 right-3 bg-indigo-500/90 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1'>
					<MonitorUp className='h-3 w-3' /> Sharing
				</div>
			)}
		</div>
	)
}

// ─── Video Grid ──────────────────────────────────────────────────────────

function VideoGrid() {
	const { localParticipant } = useLocalParticipant()
	const remoteParticipants = useParticipants()

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
	]

	const count = allParticipants.length
	const gridClass =
		count === 1
			? 'grid-cols-1'
			: count === 2
				? 'grid-cols-1 md:grid-cols-2'
				: count === 3
					? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
					: 'grid-cols-1 md:grid-cols-2'

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
	)
}

// ─── Participant Sidebar ─────────────────────────────────────────────────

function ParticipantSidebar({ onClose }: { onClose: () => void }) {
	const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
	const remoteParticipants = useParticipants()

	return (
		<div className='w-full sm:w-64 bg-slate-900/95 border-l border-slate-700 flex flex-col h-full absolute right-0 top-0 z-20 sm:relative'>
			<div className='flex items-center justify-between p-4 border-b border-slate-700'>
				<h3 className='text-sm font-semibold text-white flex items-center gap-2'>
					<Users className='h-4 w-4 text-indigo-400' />
					Participants ({remoteParticipants.length + 1})
				</h3>
				<Button
					variant='ghost'
					size='icon'
					onClick={onClose}
					className='text-slate-400 hover:text-white h-8 w-8'
				>
					<ChevronRight className='h-4 w-4' />
				</Button>
			</div>

			<div className='flex-1 overflow-y-auto p-2 space-y-1'>
				{/* Local participant */}
				<div className='flex items-center gap-3 p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20'>
					<div className='w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0'>
						{(localParticipant.name || localParticipant.identity || '?').charAt(0).toUpperCase()}
					</div>
					<div className='flex-1 min-w-0'>
						<p className='text-sm text-white font-medium truncate'>
							{localParticipant.name || localParticipant.identity}{' '}
							<span className='text-indigo-300'>(You)</span>
						</p>
					</div>
					<div className='flex gap-1'>
						{isMicrophoneEnabled ? (
							<Mic className='h-3.5 w-3.5 text-emerald-400' />
						) : (
							<MicOff className='h-3.5 w-3.5 text-red-400' />
						)}
						{isCameraEnabled ? (
							<Video className='h-3.5 w-3.5 text-emerald-400' />
						) : (
							<VideoOff className='h-3.5 w-3.5 text-red-400' />
						)}
					</div>
				</div>

				{/* Remote participants */}
				{remoteParticipants.map((p) => (
					<div
						key={p.identity}
						className='flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-800/50 transition-colors'
					>
						<div className='w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-white text-xs font-bold shrink-0'>
							{(p.name || p.identity || '?').charAt(0).toUpperCase()}
						</div>
						<div className='flex-1 min-w-0'>
							<p className='text-sm text-slate-200 truncate'>{p.name || p.identity}</p>
						</div>
						{p.isSpeaking && (
							<div className='w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0' />
						)}
					</div>
				))}
			</div>
		</div>
	)
}

// ─── Control Bar ─────────────────────────────────────────────────────────

function RoomControlBar({ onLeave }: { onLeave: () => void }) {
	const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
	const [isScreenSharing, setIsScreenSharing] = useState(false)

	const toggleMic = useCallback(() => {
		void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
	}, [localParticipant, isMicrophoneEnabled])

	const toggleCam = useCallback(() => {
		void localParticipant.setCameraEnabled(!isCameraEnabled)
	}, [localParticipant, isCameraEnabled])

	const toggleScreenShare = useCallback(async () => {
		try {
			await localParticipant.setScreenShareEnabled(!isScreenSharing)
			setIsScreenSharing((prev) => !prev)
		} catch {
			// User cancelled or screen share not supported
		}
	}, [localParticipant, isScreenSharing])

	return (
		<div className='flex items-center justify-center gap-3 p-4 bg-slate-900/95 border-t border-slate-700 shrink-0'>
			<Button
				variant={isMicrophoneEnabled ? 'secondary' : 'destructive'}
				size='icon'
				onClick={toggleMic}
				className={`rounded-full h-12 w-12 min-h-[44px] min-w-[44px] ${
					isMicrophoneEnabled ? 'bg-slate-700 hover:bg-slate-600 text-white' : ''
				}`}
				aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
			>
				{isMicrophoneEnabled ? (
					<Mic className='h-5 w-5' />
				) : (
					<MicOff className='h-5 w-5' />
				)}
			</Button>

			<Button
				variant={isCameraEnabled ? 'secondary' : 'destructive'}
				size='icon'
				onClick={toggleCam}
				className={`rounded-full h-12 w-12 min-h-[44px] min-w-[44px] ${
					isCameraEnabled ? 'bg-slate-700 hover:bg-slate-600 text-white' : ''
				}`}
				aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
			>
				{isCameraEnabled ? (
					<Video className='h-5 w-5' />
				) : (
					<VideoOff className='h-5 w-5' />
				)}
			</Button>

			<Button
				variant={isScreenSharing ? 'default' : 'secondary'}
				size='icon'
				onClick={toggleScreenShare}
				className={`rounded-full h-12 w-12 min-h-[44px] min-w-[44px] ${
					isScreenSharing
						? 'bg-indigo-600 hover:bg-indigo-700 text-white'
						: 'bg-slate-700 hover:bg-slate-600 text-white'
				}`}
				aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
			>
				{isScreenSharing ? (
					<MonitorX className='h-5 w-5' />
				) : (
					<MonitorUp className='h-5 w-5' />
				)}
			</Button>

			<Button
				variant='destructive'
				size='icon'
				onClick={onLeave}
				className='rounded-full h-12 w-12 min-h-[44px] min-w-[44px] bg-red-600 hover:bg-red-700'
				aria-label='Leave room'
			>
				<PhoneOff className='h-5 w-5' />
			</Button>
		</div>
	)
}

// ─── Room UI (rendered inside LiveKitRoom context) ───────────────────────

function RoomUI({ roomName, onLeave }: { roomName: string; onLeave: () => void }) {
	const [showSidebar, setShowSidebar] = useState(false)

	return (
		<div className='flex flex-col h-[calc(100vh-4rem)] bg-slate-950 text-white overflow-hidden rounded-xl'>
			{/* Header */}
			<header className='flex items-center justify-between px-4 py-3 bg-slate-900/95 border-b border-slate-700 shrink-0'>
				<div className='flex items-center gap-3 min-w-0'>
					<Button
						variant='ghost'
						size='sm'
						onClick={onLeave}
						className='text-slate-300 hover:text-white shrink-0'
					>
						<ArrowLeft className='h-4 w-4 mr-1' />
						<span className='hidden sm:inline'>Back</span>
					</Button>
					<h1 className='text-sm font-semibold text-white truncate'>{roomName}</h1>
				</div>
				<div className='flex items-center gap-3 shrink-0'>
					<ConnectionBadge />
					<Button
						variant='ghost'
						size='sm'
						onClick={() => setShowSidebar((s) => !s)}
						className={`text-slate-300 hover:text-white ${showSidebar ? 'bg-slate-800' : ''}`}
					>
						<Users className='h-4 w-4 mr-1.5' />
						<span className='hidden sm:inline'>Participants</span>
					</Button>
				</div>
			</header>

			{/* Main area */}
			<div className='flex flex-1 overflow-hidden relative'>
				<main className='flex-1 overflow-y-auto p-3'>
					<VideoGrid />
				</main>
				{showSidebar && <ParticipantSidebar onClose={() => setShowSidebar(false)} />}
			</div>

			{/* Controls */}
			<RoomControlBar onLeave={onLeave} />
			<RoomAudioRenderer />
		</div>
	)
}

// ─── Main Page Component ─────────────────────────────────────────────────

export function LiveKitRoomPage() {
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const roomId = searchParams.get('roomId')

	const [tokenData, setTokenData] = useState<TokenResponse | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchToken = useCallback(async () => {
		if (!roomId) return
		setLoading(true)
		setError(null)
		try {
			const data = await apiCall<TokenResponse>(`/livekit/rooms/${roomId}/token`, {
				method: 'POST',
			})
			setTokenData(data)
		} catch (err: any) {
			setError(err.message || 'Failed to join room. Please check your room ID and try again.')
		} finally {
			setLoading(false)
		}
	}, [roomId])

	useEffect(() => {
		if (roomId) {
			fetchToken()
		}
	}, [roomId, fetchToken])

	const handleLeave = useCallback(() => {
		navigate('/candidate/interviews')
	}, [navigate])

	/* ── Empty state: no roomId ── */
	if (!roomId) {
		return (
			<div className='min-h-[60vh] flex items-center justify-center px-4'>
				<Card className='max-w-md w-full'>
					<CardContent className='pt-6'>
						<EmptyState
							icon={Video}
							title='No Room Selected'
							description='Please provide a room ID to join a video interview. You can find your room link in your scheduled interviews.'
							action={{ label: 'View Interviews', href: '/candidate/interviews' }}
						/>
					</CardContent>
				</Card>
			</div>
		)
	}

	/* ── Loading state ── */
	if (loading) {
		return (
			<div className='flex items-center justify-center min-h-[60vh]'>
				<div className='text-center space-y-4'>
					<Loader2 className='h-12 w-12 animate-spin text-indigo-500 mx-auto' />
					<p className='text-foreground font-medium'>Joining video room…</p>
					<p className='text-muted-foreground text-sm'>
						Please allow camera and microphone access when prompted
					</p>
				</div>
			</div>
		)
	}

	/* ── Error state ── */
	if (error) {
		return (
			<div className='flex items-center justify-center min-h-[60vh] px-4'>
				<Card className='max-w-md w-full'>
					<CardContent className='flex flex-col items-center justify-center py-12 text-center'>
						<AlertTriangle className='h-12 w-12 text-destructive mb-4' />
						<h2 className='text-xl font-semibold mb-2'>Could Not Join Room</h2>
						<p className='text-muted-foreground mb-6 text-sm'>{error}</p>
						<div className='flex gap-3 flex-wrap justify-center'>
							<Button variant='outline' onClick={() => navigate('/candidate/interviews')}>
								Back to Interviews
							</Button>
							<Button onClick={fetchToken}>Try Again</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	/* ── Not ready yet ── */
	if (!tokenData) {
		return null
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
			<RoomUI roomName={tokenData.roomName} onLeave={handleLeave} />
		</LiveKitRoom>
	)
}
