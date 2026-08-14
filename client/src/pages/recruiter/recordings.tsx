import {
	AlertCircle,
	CheckCircle,
	Clock,
	FileAudio,
	Loader2,
	Play,
	Search,
	Trash2,
	Video,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'

interface Recording {
	id: number
	status: 'recording' | 'completed' | 'processing' | 'failed' | 'deleted'
	started_at: string
	stopped_at: string | null
	duration_seconds: number | null
	file_size_bytes: number | null
	file_format: string | null
	retention_expires_at: string | null
	created_at: string
}

interface InterviewEvent {
	id: number
	candidate_name: string
	candidate_email: string
	job_title: string
	scheduled_at: string
}

type ToastType = 'success' | 'error' | 'info'

interface Toast {
	id: string
	message: string
	type: ToastType
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
	return (
		<div className='fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0'>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg animate-in slide-in-from-right fade-in duration-200 ${
						toast.type === 'success'
							? 'bg-emerald-50 border-emerald-200 text-emerald-800'
							: toast.type === 'error'
								? 'bg-red-50 border-red-200 text-red-800'
								: 'bg-blue-50 border-blue-200 text-blue-800'
					}`}
				>
					{toast.type === 'success' ? (
						<CheckCircle className='h-5 w-5 shrink-0 mt-0.5 text-emerald-600' />
					) : toast.type === 'error' ? (
						<XCircle className='h-5 w-5 shrink-0 mt-0.5 text-red-600' />
					) : (
						<AlertCircle className='h-5 w-5 shrink-0 mt-0.5 text-blue-600' />
					)}
					<p className='text-sm flex-1'>{toast.message}</p>
					<button
						onClick={() => onDismiss(toast.id)}
						className='shrink-0 text-muted-foreground hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center rounded'
					>
						<span className='sr-only'>Dismiss</span>
						<svg className='h-4 w-4' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
							<path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
						</svg>
					</button>
				</div>
			))}
		</div>
	)
}

function formatDuration(seconds: number | null): string {
	if (!seconds) return '—'
	const mins = Math.floor(seconds / 60)
	const secs = seconds % 60
	if (mins < 60) return `${mins}m ${secs}s`
	const hrs = Math.floor(mins / 60)
	const remMins = mins % 60
	return `${hrs}h ${remMins}m`
}

function formatFileSize(bytes: number | null): string {
	if (!bytes) return '—'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; icon: React.ElementType }> = {
	recording: { label: 'Recording', variant: 'destructive', icon: Video },
	completed: { label: 'Completed', variant: 'success', icon: CheckCircle },
	processing: { label: 'Processing', variant: 'warning', icon: Loader2 },
	failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
	deleted: { label: 'Deleted', variant: 'secondary', icon: Trash2 },
}

export function RecruiterRecordingsPage() {
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const eventIdParam = searchParams.get('event_id')

	const [recordings, setRecordings] = useState<Recording[]>([])
	const [events, setEvents] = useState<InterviewEvent[]>([])
	const [selectedEventId, setSelectedEventId] = useState<string>(eventIdParam || '')
	const [loading, setLoading] = useState(true)
	const [toasts, setToasts] = useState<Toast[]>([])
	const [searchQuery, setSearchQuery] = useState('')
	const [transcribingId, setTranscribingId] = useState<number | null>(null)
	const [deletingId, setDeletingId] = useState<number | null>(null)
	const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

	const showToast = useCallback((message: string, type: ToastType = 'info') => {
		const id = `${Date.now()}-${Math.random()}`
		setToasts((prev) => [...prev, { id, message, type }])
		setTimeout(() => {
			setToasts((prev) => prev.filter((t) => t.id !== id))
		}, 5000)
	}, [])

	const dismissToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id))
	}, [])

	const loadEvents = useCallback(async () => {
		try {
			const data = await apiCall<{ interviews: InterviewEvent[] }>('/recruiter/interviews?upcoming_only=false')
			setEvents(data.interviews || [])
		} catch (err: any) {
			console.error('Failed to load events:', err)
		}
	}, [])

	const loadRecordings = useCallback(async () => {
		if (!selectedEventId) {
			setRecordings([])
			setLoading(false)
			return
		}
		setLoading(true)
		try {
			const data = await apiCall<{ success: boolean; recordings: Recording[] }>(
				`/interviews/recordings?event_id=${selectedEventId}`,
			)
			setRecordings(data.recordings || [])
		} catch (err: any) {
			showToast(err.message || 'Failed to load recordings', 'error')
		} finally {
			setLoading(false)
		}
	}, [selectedEventId, showToast])

	useEffect(() => {
		loadEvents()
	}, [loadEvents])

	useEffect(() => {
		loadRecordings()
	}, [loadRecordings])

	// Poll active recordings
	useEffect(() => {
		const hasActive = recordings.some((r) => r.status === 'recording')
		if (!hasActive) return

		const interval = setInterval(() => {
			loadRecordings()
		}, 5000)
		return () => clearInterval(interval)
	}, [recordings, loadRecordings])

	async function handleTranscribe(recordingId: number) {
		setTranscribingId(recordingId)
		try {
			await apiCall(`/interviews/recordings/${recordingId}/transcribe`, { method: 'POST' })
			showToast('Transcription started', 'success')
			await loadRecordings()
		} catch (err: any) {
			showToast(err.message || 'Failed to start transcription', 'error')
		} finally {
			setTranscribingId(null)
		}
	}

	async function handleDelete(_recordingId: number) {
		// Delete endpoint not yet implemented on backend
		showToast('Delete recording is not yet implemented', 'info')
		setConfirmDeleteId(null)
	}

	const filteredRecordings = recordings.filter((r) => {
		if (!searchQuery) return true
		const q = searchQuery.toLowerCase()
		return (
			(r.status || '').toLowerCase().includes(q) ||
			(r.file_format || '').toLowerCase().includes(q) ||
			formatDuration(r.duration_seconds).toLowerCase().includes(q)
		)
	})

	const selectedEvent = events.find((e) => e.id.toString() === selectedEventId)

	return (
		<div className='space-y-6 px-4 sm:px-6'>
			<ToastContainer toasts={toasts} onDismiss={dismissToast} />

			{/* Header */}
			<div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4'>
				<div>
					<h1 className='text-2xl font-heading font-bold'>Recordings</h1>
					<p className='text-muted-foreground text-sm'>
						View and manage interview recordings
					</p>
				</div>
				<Button
					variant='outline'
					onClick={() => navigate('/recruiter/interviews')}
					className='min-h-[44px]'
				>
					<span className='hidden sm:inline'>Back to Interviews</span>
					<span className='sm:hidden'>Back</span>
				</Button>
			</div>

			{/* Event selector */}
			<Card>
				<CardContent className='p-4'>
					<div className='flex flex-col sm:flex-row gap-4 items-start sm:items-center'>
						<div className='flex-1 w-full'>
							<label className='text-sm font-medium mb-1.5 block'>Select Interview</label>
							<select
								value={selectedEventId}
								onChange={(e) => {
									setSelectedEventId(e.target.value)
									if (e.target.value) {
										navigate(`/recruiter/recordings?event_id=${e.target.value}`, { replace: true })
									}
								}}
								className='flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
							>
								<option value=''>Choose an interview event...</option>
								{events.map((event) => (
									<option key={event.id} value={event.id}>
										{event.candidate_name} — {event.job_title} ({new Date(event.scheduled_at).toLocaleDateString()})
									</option>
								))}
							</select>
						</div>
						{selectedEvent && (
							<div className='text-sm text-muted-foreground'>
								<div className='flex items-center gap-1'>
									<Video className='h-3.5 w-3.5' />
									{selectedEvent.candidate_name}
								</div>
								<div className='flex items-center gap-1'>
									<Clock className='h-3.5 w-3.5' />
									{new Date(selectedEvent.scheduled_at).toLocaleString()}
								</div>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Search */}
			{selectedEventId && recordings.length > 0 && (
				<div className='relative'>
					<Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
					<Input
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder='Search recordings...'
						className='pl-9 min-h-[44px]'
					/>
				</div>
			)}

			{/* Recordings list */}
			{!selectedEventId ? (
				<EmptyState
					icon={Video}
					title='Select an Interview'
					description='Choose an interview event from the dropdown above to view its recordings.'
				/>
			) : loading ? (
				<div className='space-y-3'>
					<Skeleton variant='list' />
					<Skeleton variant='list' />
					<Skeleton variant='list' />
				</div>
			) : filteredRecordings.length === 0 ? (
				<EmptyState
					icon={FileAudio}
					title='No recordings found'
					description={
						searchQuery
							? 'No recordings match your search.'
							: 'This interview event has no recordings yet. Start a recording from the LiveKit room.'
					}
				/>
			) : (
				<div className='space-y-3'>
					{filteredRecordings.map((recording) => {
						const config = statusConfig[recording.status] || statusConfig.completed
						const StatusIcon = config.icon

						return (
							<Card key={recording.id}>
								<CardContent className='p-4'>
									<div className='flex flex-col sm:flex-row items-start sm:items-center gap-4'>
										<div className='flex-1 min-w-0 space-y-1'>
											<div className='flex items-center gap-2 flex-wrap'>
												<Badge variant={config.variant}>
													<StatusIcon className={`h-3 w-3 mr-1 ${recording.status === 'recording' ? 'animate-pulse' : ''}`} />
													{config.label}
												</Badge>
												<span className='text-xs text-muted-foreground'>
													ID: {recording.id}
												</span>
											</div>
											<div className='flex items-center gap-4 text-sm text-muted-foreground flex-wrap'>
												<span className='flex items-center gap-1'>
													<Clock className='h-3.5 w-3.5' />
													{formatDuration(recording.duration_seconds)}
												</span>
												<span className='flex items-center gap-1'>
													<span className='text-xs'>📁</span>
													{formatFileSize(recording.file_size_bytes)}
												</span>
												<span className='flex items-center gap-1'>
													<span className='text-xs'>🎬</span>
													{recording.file_format || 'mp4'}
												</span>
												<span>
													Started: {new Date(recording.started_at).toLocaleString()}
												</span>
											</div>
										</div>

										<div className='flex flex-wrap gap-2'>
											{recording.status === 'completed' && (
												<Button
													size='sm'
													className='min-h-[44px]'
													onClick={() => navigate(`/recruiter/recordings/${recording.id}/playback`)}
												>
													<Play className='h-3.5 w-3.5 mr-1' /> Play
												</Button>
											)}
											{recording.status === 'completed' && (
												<Button
													size='sm'
													variant='outline'
													className='min-h-[44px]'
													onClick={() => handleTranscribe(recording.id)}
													disabled={transcribingId === recording.id}
												>
													{transcribingId === recording.id ? (
														<>
															<Loader2 className='h-3.5 w-3.5 animate-spin mr-1' />
															Transcribing...
														</>
													) : (
														<>
															<FileAudio className='h-3.5 w-3.5 mr-1' /> Transcribe
														</>
													)}
												</Button>
											)}
											<Button
												size='sm'
												variant='ghost'
												className='text-destructive hover:text-destructive min-h-[44px]'
												onClick={() => setConfirmDeleteId(recording.id)}
												disabled={deletingId === recording.id}
											>
												<Trash2 className='h-3.5 w-3.5 mr-1' /> Delete
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>
						)
					})}
				</div>
			)}

			{/* Delete confirmation dialog */}
			<Dialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<Trash2 className='h-5 w-5 text-red-600' />
							Delete Recording
						</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this recording? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant='outline' onClick={() => setConfirmDeleteId(null)} disabled={!!deletingId}>
							Cancel
						</Button>
						<Button
							variant='destructive'
							onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
							disabled={!!deletingId}
						>
							{deletingId === confirmDeleteId ? (
								<>
									<Loader2 className='h-4 w-4 animate-spin mr-1' />
									Deleting...
								</>
							) : (
								<>
									<Trash2 className='h-4 w-4 mr-1' />
									Delete
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
