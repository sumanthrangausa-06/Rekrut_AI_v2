import {
	AlertCircle,
	Calendar,
	CheckCircle,
	Link as LinkIcon,
	RefreshCw,
	Unlink,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

interface CalendarConnection {
	provider: string
	calendar_id: string
	calendar_email: string
	is_active: boolean
	expires_at: string
	created_at: string
	updated_at: string
}

interface CalendarStatus {
	google: { connected: boolean; calendarId?: string; createdAt?: string; updatedAt?: string }
	outlook: { connected: boolean; calendarId?: string; createdAt?: string; updatedAt?: string }
}

export function CalendarSettingsPage() {
	const [searchParams, setSearchParams] = useSearchParams()
	const [status, setStatus] = useState<CalendarStatus | null>(null)
	const [connections, setConnections] = useState<CalendarConnection[]>([])
	const [loading, setLoading] = useState(true)
	const [connecting, setConnecting] = useState<string | null>(null)
	const [syncing, setSyncing] = useState<number | null>(null)
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		text: string
	} | null>(null)

	const oauthSuccess = searchParams.get('success')
	const oauthError = searchParams.get('error')

	const loadData = useCallback(async () => {
		setLoading(true)
		try {
			const [statusRes, connRes] = await Promise.all([
				apiCall<CalendarStatus>('/calendar/status'),
				apiCall<{ success: boolean; connections: CalendarConnection[] }>(
					'/calendar/connections',
				).catch(() => ({ success: false, connections: [] })),
			])
			setStatus(statusRes)
			setConnections(connRes.connections || [])
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to load calendar status' })
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadData()
		trackEvent('page_view_calendar_settings')
	}, [loadData])

	// Handle OAuth callback
	useEffect(() => {
		if (oauthSuccess) {
			setMessage({
				type: 'success',
				text: `${oauthSuccess.charAt(0).toUpperCase() + oauthSuccess.slice(1)} Calendar connected successfully`,
			})
			// Clear query params
			setSearchParams({}, { replace: true })
			loadData()
			trackEvent('calendar_oauth_success', { provider: oauthSuccess })
		}
		if (oauthError) {
			setMessage({
				type: 'error',
				text: `Connection failed: ${decodeURIComponent(oauthError)}`,
			})
			setSearchParams({}, { replace: true })
			trackEvent('calendar_oauth_error', { error: oauthError })
		}
	}, [oauthSuccess, oauthError, setSearchParams, loadData])

	useEffect(() => {
		if (message) {
			const t = setTimeout(() => setMessage(null), 5000)
			return () => clearTimeout(t)
		}
	}, [message])

	async function connectProvider(provider: 'google' | 'outlook') {
		setConnecting(provider)
		try {
			const res = await apiCall<{ success: boolean; authUrl: string }>(
				`/calendar/connect/${provider}`,
				{ method: 'POST' },
			)
			if (res.authUrl) {
				trackEvent('calendar_connect_initiated', { provider })
				window.location.href = res.authUrl
			} else {
				setMessage({ type: 'error', text: 'No auth URL returned' })
			}
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || `Failed to connect ${provider}` })
		} finally {
			setConnecting(null)
		}
	}

	async function disconnectProvider(provider: 'google' | 'outlook') {
		if (!confirm(`Disconnect ${provider} Calendar?`)) return
		try {
			await apiCall('/calendar/disconnect', {
				method: 'POST',
				body: { provider },
			})
			setMessage({
				type: 'success',
				text: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Calendar disconnected`,
			})
			trackEvent('calendar_disconnect', { provider })
			await loadData()
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to disconnect' })
		}
	}

	async function syncConnection(connectionId: number) {
		setSyncing(connectionId)
		try {
			await apiCall(`/calendar/sync/${connectionId}`, { method: 'POST' })
			setMessage({ type: 'success', text: 'Calendar synced successfully' })
			trackEvent('calendar_manual_sync', { connectionId })
			await loadData()
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Sync failed' })
		} finally {
			setSyncing(null)
		}
	}

	const googleConnected = status?.google?.connected ?? false
	const outlookConnected = status?.outlook?.connected ?? false
	const anyConnected = googleConnected || outlookConnected

	if (loading) {
		return (
			<div className='space-y-6 px-4 sm:px-6'>
				<div className='space-y-2'>
					<div className='h-8 w-48 rounded bg-muted animate-pulse' />
					<div className='h-4 w-72 rounded bg-muted animate-pulse' />
				</div>
				<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
					<div className='h-48 rounded bg-muted animate-pulse' />
					<div className='h-48 rounded bg-muted animate-pulse' />
				</div>
			</div>
		)
	}

	return (
		<div className='space-y-6 px-4 sm:px-6'>
			{/* Toast */}
			{message && (
				<div
					className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
						message.type === 'success'
							? 'bg-emerald-600 text-white'
							: 'bg-destructive text-white'
					}`}
				>
					{message.type === 'success' ? (
						<CheckCircle className='h-4 w-4' />
					) : (
						<AlertCircle className='h-4 w-4' />
					)}
					{message.text}
				</div>
			)}

			{/* Header */}
			<div>
				<h1 className='text-2xl font-heading font-bold'>Calendar Settings</h1>
				<p className='text-muted-foreground text-sm'>
					Connect your calendar to sync interviews and manage scheduling
				</p>
			</div>

			{/* Status overview */}
			{anyConnected && (
				<Card className='border-emerald-200 bg-emerald-50/50'>
					<CardContent className='p-4'>
						<div className='flex items-center gap-3'>
							<div className='p-2 rounded-lg bg-emerald-100 text-emerald-700'>
								<CheckCircle className='h-5 w-5' />
							</div>
							<div>
								<p className='font-semibold text-emerald-900'>
									Calendar connected
								</p>
								<p className='text-sm text-emerald-700'>
									Interview events will automatically sync to your calendar
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Provider cards */}
			<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
				{/* Google Calendar */}
				<Card>
					<CardHeader>
						<div className='flex items-center justify-between'>
							<CardTitle className='flex items-center gap-2'>
								<Calendar className='h-5 w-5 text-indigo-500' />
								Google Calendar
							</CardTitle>
							{googleConnected ? (
								<Badge variant='success'>Connected</Badge>
							) : (
								<Badge variant='secondary'>Not connected</Badge>
							)}
						</div>
						<CardDescription>
							Sync interview events with Google Calendar
						</CardDescription>
					</CardHeader>
					<CardContent className='space-y-4'>
						{googleConnected ? (
							<div className='space-y-3'>
								<div className='flex items-center gap-2 text-sm'>
									<CheckCircle className='h-4 w-4 text-emerald-500' />
									<span className='text-muted-foreground'>
										Calendar ID: {status?.google?.calendarId || 'Primary'}
									</span>
								</div>
								<div className='flex gap-2 flex-wrap'>
									{connections
										.filter((c) => c.provider === 'google')
										.map((conn) => (
											<Button
												key={conn.calendar_id}
												size='sm'
												variant='outline'
												onClick={() => syncConnection(parseInt(conn.calendar_id, 10) || 0)}
												disabled={syncing === (parseInt(conn.calendar_id, 10) || 0)}
												className='min-h-[44px]'
											>
												{syncing === (parseInt(conn.calendar_id, 10) || 0) ? (
													<>
														<RefreshCw className='h-4 w-4 mr-1 animate-spin' />
														Syncing...
													</>
												) : (
													<>
														<RefreshCw className='h-4 w-4 mr-1' />
														Sync Now
													</>
												)}
											</Button>
										))}
									<Button
										size='sm'
										variant='ghost'
										className='text-destructive min-h-[44px]'
										onClick={() => disconnectProvider('google')}
									>
										<Unlink className='h-4 w-4 mr-1' />
										Disconnect
									</Button>
								</div>
							</div>
						) : (
							<Button
								onClick={() => connectProvider('google')}
								disabled={connecting === 'google'}
								className='min-h-[44px]'
							>
								{connecting === 'google' ? (
									<span className='flex items-center gap-2'>
										<RefreshCw className='h-4 w-4 animate-spin' />
										Connecting...
									</span>
								) : (
									<span className='flex items-center gap-2'>
										<LinkIcon className='h-4 w-4' />
										Connect Google Calendar
									</span>
								)}
							</Button>
						)}
					</CardContent>
				</Card>

				{/* Outlook Calendar */}
				<Card>
					<CardHeader>
						<div className='flex items-center justify-between'>
							<CardTitle className='flex items-center gap-2'>
								<Calendar className='h-5 w-5 text-blue-500' />
								Outlook Calendar
							</CardTitle>
							{outlookConnected ? (
								<Badge variant='success'>Connected</Badge>
							) : (
								<Badge variant='secondary'>Not connected</Badge>
							)}
						</div>
						<CardDescription>
							Sync interview events with Microsoft Outlook
						</CardDescription>
					</CardHeader>
					<CardContent className='space-y-4'>
						{outlookConnected ? (
							<div className='space-y-3'>
								<div className='flex items-center gap-2 text-sm'>
									<CheckCircle className='h-4 w-4 text-emerald-500' />
									<span className='text-muted-foreground'>
										Calendar ID: {status?.outlook?.calendarId || 'Primary'}
									</span>
								</div>
								<div className='flex gap-2 flex-wrap'>
									{connections
										.filter((c) => c.provider === 'outlook')
										.map((conn) => (
											<Button
												key={conn.calendar_id}
												size='sm'
												variant='outline'
												onClick={() => syncConnection(parseInt(conn.calendar_id, 10) || 0)}
												disabled={syncing === (parseInt(conn.calendar_id, 10) || 0)}
												className='min-h-[44px]'
											>
												{syncing === (parseInt(conn.calendar_id, 10) || 0) ? (
													<>
														<RefreshCw className='h-4 w-4 mr-1 animate-spin' />
														Syncing...
													</>
												) : (
													<>
														<RefreshCw className='h-4 w-4 mr-1' />
														Sync Now
													</>
												)}
											</Button>
										))}
									<Button
										size='sm'
										variant='ghost'
										className='text-destructive min-h-[44px]'
										onClick={() => disconnectProvider('outlook')}
									>
										<Unlink className='h-4 w-4 mr-1' />
										Disconnect
									</Button>
								</div>
							</div>
						) : (
							<Button
								onClick={() => connectProvider('outlook')}
								disabled={connecting === 'outlook'}
								className='min-h-[44px]'
							>
								{connecting === 'outlook' ? (
									<span className='flex items-center gap-2'>
										<RefreshCw className='h-4 w-4 animate-spin' />
										Connecting...
									</span>
								) : (
									<span className='flex items-center gap-2'>
										<LinkIcon className='h-4 w-4' />
										Connect Outlook Calendar
									</span>
								)}
							</Button>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Troubleshooting */}
			{!anyConnected && (
				<Card className='bg-muted/50 border-dashed'>
					<CardContent className='p-4'>
						<div className='flex items-start gap-3'>
							<XCircle className='h-5 w-5 text-muted-foreground mt-0.5' />
							<div>
								<p className='font-medium text-sm'>No calendar connected</p>
								<p className='text-sm text-muted-foreground mt-1'>
									Connect your Google or Outlook calendar to automatically sync interview
									events and propose time slots to candidates.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
