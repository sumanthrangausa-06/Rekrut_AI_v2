import {
	AlertCircle,
	CheckCircle,
	Clock,
	Eye,
	Flag,
	Loader2,
	Shield,
	ShieldAlert,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { apiCall } from '@/lib/api'

interface ProctoringEvent {
	id: number
	event_type: string
	severity: 'low' | 'medium' | 'high'
	details: Record<string, unknown>
	created_at: string
}

interface ProctoringFlag {
	id: number
	flag_type: string
	description: string
	severity: string
	review_decision: string
	review_notes: string | null
	reviewer_name: string | null
	created_at: string
}

interface ProctoringSession {
	id: number
	application_id: number
	candidate_id: number
	status: string
	consent_given: boolean
	consent_timestamp: string | null
	started_at: string | null
	ended_at: string | null
	created_at: string
	updated_at: string
	candidate_name: string
	candidate_email: string
	job_title: string | null
}

export function CandidateProctoringSessionPage() {
	const { sessionId } = useParams<{ sessionId: string }>()
	const navigate = useNavigate()
	const [session, setSession] = useState<ProctoringSession | null>(null)
	const [events, setEvents] = useState<ProctoringEvent[]>([])
	const [flags, setFlags] = useState<ProctoringFlag[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [completing, setCompleting] = useState(false)

	const loadSession = useCallback(async () => {
		try {
			setLoading(true)
			const data = await apiCall<{
				success: boolean
				session: ProctoringSession
				events: ProctoringEvent[]
				flags: ProctoringFlag[]
			}>(`/proctoring/session/${sessionId}`)
			setSession(data.session)
			setEvents(data.events)
			setFlags(data.flags)
		} catch (err: any) {
			setError(err.message || 'Failed to load session')
		} finally {
			setLoading(false)
		}
	}, [sessionId])

	useEffect(() => {
		loadSession()
	}, [loadSession])

	async function completeSession() {
		if (!session) return
		setCompleting(true)
		try {
			await apiCall(`/proctoring/session/${sessionId}/complete`, { method: 'POST' })
			await loadSession()
		} catch (err: any) {
			setError(err.message || 'Failed to complete session')
		} finally {
			setCompleting(false)
		}
	}

	function eventIcon(type: string) {
		switch (type) {
			case 'tab_switch':
			case 'fullscreen_exit':
			case 'window_blur':
				return <Eye className='w-4 h-4' />
			case 'no_face':
			case 'multiple_faces':
				return <Shield className='w-4 h-4' />
			case 'copy_paste':
			case 'right_click':
			case 'suspicious_keypress':
				return <AlertCircle className='w-4 h-4' />
			case 'audio_anomaly':
			case 'timing_anomaly':
				return <Clock className='w-4 h-4' />
			default:
				return <Shield className='w-4 h-4' />
		}
	}

	function severityColor(severity: string) {
		switch (severity) {
			case 'high':
				return 'bg-red-100 text-red-700 border-red-200'
			case 'medium':
				return 'bg-amber-100 text-amber-700 border-amber-200'
			default:
				return 'bg-slate-100 text-slate-600 border-slate-200'
		}
	}

	function statusBadge(status: string) {
		switch (status) {
			case 'in_progress':
				return (
					<Badge className='bg-indigo-100 text-indigo-700 border-indigo-200'>
						<Shield className='w-3 h-3 mr-1' /> In Progress
					</Badge>
				)
			case 'completed':
				return (
					<Badge className='bg-green-100 text-green-700 border-green-200'>
						<CheckCircle className='w-3 h-3 mr-1' /> Completed
					</Badge>
				)
			case 'flagged':
				return (
					<Badge className='bg-red-100 text-red-700 border-red-200'>
						<Flag className='w-3 h-3 mr-1' /> Flagged
					</Badge>
				)
			case 'reviewed':
				return (
					<Badge className='bg-blue-100 text-blue-700 border-blue-200'>
						<CheckCircle className='w-3 h-3 mr-1' /> Reviewed
					</Badge>
				)
			default:
				return <Badge variant='secondary'>{status}</Badge>
		}
	}

	if (loading) {
		return (
			<div className='min-h-dvh-safe bg-gradient-to-br from-slate-50 to-indigo-50 flex items-center justify-center'>
				<div className='text-center space-y-4'>
					<Loader2 className='w-8 h-8 animate-spin text-indigo-600 mx-auto' />
					<p className='text-slate-600'>Loading session...</p>
				</div>
			</div>
		)
	}

	if (error && !session) {
		return (
			<div className='min-h-dvh-safe bg-gradient-to-br from-slate-50 to-red-50 flex items-center justify-center p-4'>
				<Card className='max-w-md w-full'>
					<CardContent className='p-8 text-center space-y-4'>
						<AlertCircle className='w-12 h-12 text-red-500 mx-auto' />
						<h2 className='text-xl font-semibold text-slate-900'>Error</h2>
						<p className='text-slate-600'>{error}</p>
						<Button onClick={() => navigate('/candidate/dashboard')} variant='outline'>
							Go to Dashboard
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (!session) return null

	const isActive = session.status === 'in_progress'
	const isDone = ['completed', 'flagged', 'reviewed'].includes(session.status)

	return (
		<div className='min-h-dvh-safe bg-gradient-to-br from-slate-50 to-indigo-50 py-8 px-4 sm:px-6'>
			<div className='max-w-3xl mx-auto space-y-6'>
				{/* Header */}
				<div className='flex items-center justify-between flex-wrap gap-3'>
					<div>
						<h1 className='text-2xl font-bold text-slate-900'>Proctoring Session</h1>
						<p className='text-sm text-slate-500 mt-1'>
							{session.job_title ? `Job: ${session.job_title}` : `Application #${session.application_id}`}
						</p>
					</div>
					{statusBadge(session.status)}
				</div>

				{error && (
					<div className='bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-3'>
						<AlertCircle className='w-4 h-4 mt-0.5 flex-shrink-0' />
						{error}
					</div>
				)}

				{/* Session info */}
				<Card>
					<CardContent className='p-6 space-y-4'>
						<div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
							<div className='space-y-1'>
								<p className='text-xs font-medium text-slate-500 uppercase tracking-wide'>Started</p>
								<p className='text-sm text-slate-900'>
									{session.started_at
										? new Date(session.started_at).toLocaleString()
										: 'Not started'}
								</p>
							</div>
							<div className='space-y-1'>
								<p className='text-xs font-medium text-slate-500 uppercase tracking-wide'>Ended</p>
								<p className='text-sm text-slate-900'>
									{session.ended_at
										? new Date(session.ended_at).toLocaleString()
										: isActive
											? 'In progress'
											: 'N/A'}
								</p>
							</div>
							<div className='space-y-1'>
								<p className='text-xs font-medium text-slate-500 uppercase tracking-wide'>Consent</p>
								<p className='text-sm text-slate-900 flex items-center gap-1'>
									{session.consent_given ? (
										<>
											<CheckCircle className='w-4 h-4 text-green-600' />
											Given at {new Date(session.consent_timestamp!).toLocaleString()}
										</>
									) : (
										<span className='text-amber-600'>Pending</span>
									)}
								</p>
							</div>
							<div className='space-y-1'>
								<p className='text-xs font-medium text-slate-500 uppercase tracking-wide'>Events</p>
								<p className='text-sm text-slate-900'>{events.length} recorded</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Active session actions */}
				{isActive && (
					<Card className='border-indigo-200 bg-indigo-50/30'>
						<CardContent className='p-6 space-y-4'>
							<div className='flex items-center gap-3 text-indigo-800'>
								<ShieldAlert className='w-5 h-5' />
								<p className='font-medium'>Session is active</p>
							</div>
							<p className='text-sm text-slate-600'>
								You are currently being proctored. If you have finished your assessment, click the button
								below to end the session.
							</p>
							<Button
								onClick={completeSession}
								disabled={completing}
								className='min-h-[44px]'
								variant='default'
							>
								{completing ? (
									<>
										<Loader2 className='w-4 h-4 animate-spin mr-2' />
										Completing...
									</>
								) : (
									<>
										<CheckCircle className='w-4 h-4 mr-2' />
										End Session & Submit
									</>
								)}
							</Button>
						</CardContent>
					</Card>
				)}

				{/* Flags */}
				{flags.length > 0 && (
					<Card>
						<CardContent className='p-6 space-y-4'>
							<h2 className='text-lg font-semibold text-slate-900 flex items-center gap-2'>
								<Flag className='w-5 h-5 text-red-600' />
								Flags ({flags.length})
							</h2>
							<div className='space-y-3'>
								{flags.map((flag) => (
									<div
										key={flag.id}
										className={`rounded-lg border p-4 space-y-2 ${
											flag.review_decision === 'approved'
												? 'bg-green-50 border-green-200'
												: flag.review_decision === 'rejected'
													? 'bg-red-50 border-red-200'
													: 'bg-amber-50 border-amber-200'
										}`}
									>
										<div className='flex items-center justify-between'>
											<div className='flex items-center gap-2'>
												<Badge
													variant='outline'
													className={severityColor(flag.severity)}
												>
													{flag.severity}
												</Badge>
												<span className='text-sm font-medium text-slate-900 capitalize'>
													{flag.flag_type.replace(/_/g, ' ')}
												</span>
											</div>
											<Badge
												variant='outline'
												className={
													flag.review_decision === 'approved'
														? 'bg-green-100 text-green-700'
														: flag.review_decision === 'rejected'
															? 'bg-red-100 text-red-700'
															: 'bg-amber-100 text-amber-700'
												}
											>
												{flag.review_decision}
											</Badge>
										</div>
										<p className='text-sm text-slate-600'>{flag.description}</p>
										{flag.review_notes && (
											<p className='text-sm text-slate-500 italic'>
												Reviewer note: {flag.review_notes}
											</p>
										)}
										{flag.reviewer_name && (
											<p className='text-xs text-slate-400'>
												Reviewed by {flag.reviewer_name} on{' '}
												{new Date(flag.created_at).toLocaleDateString()}
											</p>
										)}
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Events log */}
				<Card>
					<CardContent className='p-6 space-y-4'>
						<h2 className='text-lg font-semibold text-slate-900'>Event Log</h2>
						{events.length === 0 ? (
							<div className='text-center py-8 text-slate-500'>
								<Shield className='w-8 h-8 mx-auto mb-2 text-slate-300' />
								<p className='text-sm'>No events recorded yet</p>
								{isActive && (
									<p className='text-xs text-slate-400 mt-1'>
										Events will appear here as the proctoring system detects them.
									</p>
								)}
							</div>
						) : (
							<div className='space-y-2'>
								{events.map((event) => (
									<div
										key={event.id}
										className={`flex items-start gap-3 rounded-lg border p-3 ${severityColor(
											event.severity,
										)}`}
									>
										<div className='mt-0.5'>{eventIcon(event.event_type)}</div>
										<div className='flex-1 min-w-0'>
											<div className='flex items-center justify-between gap-2'>
												<span className='text-sm font-medium capitalize'>
													{event.event_type.replace(/_/g, ' ')}
												</span>
												<span className='text-xs text-slate-500 flex-shrink-0'>
													{new Date(event.created_at).toLocaleTimeString()}
												</span>
											</div>
											{event.details && Object.keys(event.details).length > 0 && (
												<p className='text-xs text-slate-500 mt-1 truncate'>
													{JSON.stringify(event.details)}
												</p>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Done state */}
				{isDone && (
					<div className='text-center space-y-4'>
						<Button
							onClick={() => navigate('/candidate/dashboard')}
							variant='outline'
							className='min-h-[44px]'
						>
							Go to Dashboard
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
