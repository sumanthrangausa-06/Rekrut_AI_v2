import {
	AlertTriangle,
	Bell,
	CheckCircle,
	ChevronRight,
	Clock,
	Info,
	Trash2,
	Volume2,
	X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { trackEvent } from '@/lib/analytics'
import { cn } from '@/lib/utils'

export type Notification = {
	id: string
	title: string
	message: string
	type: 'info' | 'success' | 'warning' | 'error' | 'interview' | 'offer' | 'message'
	read: boolean
	timestamp: string
	action?: {
		label: string
		url: string
	}
}

const typeConfig: Record<string, { icon: React.ReactNode; color: string; badge: string }> = {
	info: {
		icon: <Info className='h-4 w-4' />,
		color: 'text-blue-600',
		badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
	},
	success: {
		icon: <CheckCircle className='h-4 w-4' />,
		color: 'text-green-600',
		badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
	},
	warning: {
		icon: <AlertTriangle className='h-4 w-4' />,
		color: 'text-amber-600',
		badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
	},
	error: {
		icon: <X className='h-4 w-4' />,
		color: 'text-red-600',
		badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
	},
	interview: {
		icon: <Clock className='h-4 w-4' />,
		color: 'text-purple-600',
		badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
	},
	offer: {
		icon: <CheckCircle className='h-4 w-4' />,
		color: 'text-emerald-600',
		badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	},
	message: {
		icon: <Info className='h-4 w-4' />,
		color: 'text-indigo-600',
		badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
	},
}

export function NotificationCenter({ className }: { className?: string }) {
	const [open, setOpen] = useState(false)
	const [notifications, setNotifications] = useState<Notification[]>([])
	const [loading, setLoading] = useState(false)
	const [playingId, setPlayingId] = useState<string | null>(null)
	const [audioError, setAudioError] = useState<string | null>(null)

	const unreadCount = notifications.filter((n) => !n.read).length

	useEffect(() => {
		if (!open) return
		async function load() {
			setLoading(true)
			try {
				// TODO: Replace with real API call
				// const data = await apiCall<{ notifications: Notification[] }>("/notifications")
				// setNotifications(data.notifications || [])

				// Demo data
				setNotifications([
					{
						id: '1',
						title: 'Interview Scheduled',
						message:
							'Your AI interview for Senior Developer at TechCorp is scheduled for tomorrow at 2:00 PM.',
						type: 'interview',
						read: false,
						timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
						action: { label: 'Join Interview', url: '/candidate/interviews' },
					},
					{
						id: '2',
						title: 'New Job Match',
						message: 'We found 3 new jobs matching your profile with 85%+ match score.',
						type: 'info',
						read: false,
						timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
						action: { label: 'View Jobs', url: '/candidate/jobs' },
					},
					{
						id: '3',
						title: 'Document Verified',
						message:
							'Your resume has been AI-verified and boosted your profile score by 12 points.',
						type: 'success',
						read: true,
						timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
					},
					{
						id: '4',
						title: 'Assessment Due',
						message: 'Complete your technical assessment for Product Manager role before Friday.',
						type: 'warning',
						read: false,
						timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
						action: { label: 'Take Assessment', url: '/candidate/assessments' },
					},
				])
			} finally {
				setLoading(false)
			}
		}
		load()
	}, [open])

	const markRead = (id: string) => {
		setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
		trackEvent('notification_read', { notification_id: id })
	}

	const markAllRead = () => {
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
		trackEvent('notifications_mark_all_read')
	}

	const deleteNotification = (id: string) => {
		setNotifications((prev) => prev.filter((n) => n.id !== id))
		trackEvent('notification_delete', { notification_id: id })
	}

	const playNotification = async (notification: Notification) => {
		// Don't start if already playing this one
		if (playingId === notification.id) return

		setPlayingId(notification.id)
		setAudioError(null)

		try {
			// Create a cache key from notification content (simple hash)
			const cacheKey = btoa(`${notification.id}:${notification.message}`).replace(
				/[^a-zA-Z0-9]/g,
				'',
			)

			const response = await fetch(`/api/notifications/voice/${cacheKey}`)

			if (!response.ok) {
				// If cache miss, generate voice via POST
				const genResponse = await fetch('/api/notifications/voice', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						text: `${notification.title}. ${notification.message}`,
						voice_id: 'sonic-2',
						speed: 1.0,
						language: 'en',
					}),
				})

				if (!genResponse.ok) {
					throw new Error(`Voice generation failed: ${genResponse.status}`)
				}

				const genData = await genResponse.json()
				if (!genData.audio_url) {
					throw new Error('No audio URL returned')
				}

				// Fetch the generated audio
				const audioResponse = await fetch(genData.audio_url)
				if (!audioResponse.ok) {
					throw new Error('Failed to fetch generated audio')
				}

				const audioBlob = await audioResponse.blob()
				const audioUrl = URL.createObjectURL(audioBlob)
				const audio = new Audio(audioUrl)

				audio.onended = () => {
					setPlayingId(null)
					URL.revokeObjectURL(audioUrl)
				}

				audio.onerror = () => {
					setPlayingId(null)
					setAudioError('Failed to play audio')
					URL.revokeObjectURL(audioUrl)
				}

				await audio.play()
				return
			}

			// Cache hit — play directly
			const audioBlob = await response.blob()
			const audioUrl = URL.createObjectURL(audioBlob)
			const audio = new Audio(audioUrl)

			audio.onended = () => {
				setPlayingId(null)
				URL.revokeObjectURL(audioUrl)
			}

			audio.onerror = () => {
				setPlayingId(null)
				setAudioError('Failed to play audio')
				URL.revokeObjectURL(audioUrl)
			}

			await audio.play()
		} catch (err: any) {
			console.error('[NotificationCenter] Voice playback error:', err)
			setPlayingId(null)
			setAudioError(err.message || 'Voice playback failed')
		}
	}

	const timeAgo = (timestamp: string) => {
		const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
		if (seconds < 60) return 'just now'
		const minutes = Math.floor(seconds / 60)
		if (minutes < 60) return `${minutes}m ago`
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return `${hours}h ago`
		const days = Math.floor(hours / 24)
		return `${days}d ago`
	}

	return (
		<>
			<Button
				variant='ghost'
				size='sm'
				className={cn('relative h-9 w-9 p-0', className)}
				onClick={() => setOpen(true)}
				aria-label='Notifications'
			>
				<Bell className='h-5 w-5' />
				{unreadCount > 0 && (
					<span className='absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-bold'>
						{unreadCount > 9 ? '9+' : unreadCount}
					</span>
				)}
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className='max-w-md max-h-[80vh] flex flex-col'>
					<DialogHeader className='flex flex-row items-center justify-between'>
						<DialogTitle>Notifications</DialogTitle>
						{unreadCount > 0 && (
							<Button variant='ghost' size='sm' onClick={markAllRead}>
								Mark all read
							</Button>
						)}
					</DialogHeader>

					<div className='flex-1 overflow-y-auto space-y-2 -mx-2 px-2'>
						{audioError && (
							<div className='text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md flex items-center gap-2'>
								<span className='flex-1'>{audioError}</span>
								<button
									className='text-red-700 hover:text-red-900 font-medium'
									onClick={() => setAudioError(null)}
								>
									Dismiss
								</button>
							</div>
						)}
						{loading ? (
							<div className='space-y-3'>
								{[1, 2, 3].map((i) => (
									<div key={i} className='h-16 rounded-lg bg-muted animate-pulse' />
								))}
							</div>
						) : notifications.length === 0 ? (
							<div className='text-center py-8 text-muted-foreground'>
								<Bell className='h-8 w-8 mx-auto mb-2 opacity-50' />
								<p>No notifications yet</p>
							</div>
						) : (
							notifications.map((n) => {
								const config = typeConfig[n.type]
								return (
									<div
										key={n.id}
										className={cn(
											'group relative rounded-lg p-3 transition-colors',
											n.read ? 'bg-muted/50' : 'bg-primary/5 hover:bg-primary/10',
										)}
										onClick={() => {
											markRead(n.id)
											if (n.action) {
												window.location.href = n.action.url
											}
										}}
									>
										<div className='flex items-start gap-3'>
											<div className={cn('mt-0.5', config.color)}>{config.icon}</div>
											<div className='flex-1 min-w-0'>
												<div className='flex items-center gap-2'>
													<p className={cn('text-sm font-medium', !n.read && 'text-primary')}>
														{n.title}
													</p>
													<Badge className={cn('text-xs', config.badge)}>{n.type}</Badge>
												</div>
												<p className='text-sm text-muted-foreground mt-0.5 line-clamp-2'>
													{n.message}
												</p>
												<div className='flex items-center justify-between mt-1'>
													<span className='text-xs text-muted-foreground'>
														{timeAgo(n.timestamp)}
													</span>
													{n.action && (
														<span className='text-xs text-primary flex items-center gap-0.5'>
															{n.action.label}
															<ChevronRight className='h-3 w-3' />
														</span>
													)}
												</div>
											</div>
											<Button
												variant='ghost'
												size='sm'
												className={cn(
													'h-6 w-6 p-0 opacity-0 group-hover:opacity-100',
													playingId === n.id && 'opacity-100 text-primary animate-pulse',
												)}
												onClick={(e) => {
													e.stopPropagation()
													playNotification(n)
												}}
												title={playingId === n.id ? 'Playing...' : 'Listen to notification'}
											>
												<Volume2
													className={cn(
														'h-3.5 w-3.5',
														playingId === n.id ? 'text-primary' : 'text-muted-foreground',
													)}
												/>
											</Button>
											<Button
												variant='ghost'
												size='sm'
												className='h-6 w-6 p-0 opacity-0 group-hover:opacity-100'
												onClick={(e) => {
													e.stopPropagation()
													deleteNotification(n.id)
												}}
											>
												<Trash2 className='h-3.5 w-3.5 text-muted-foreground' />
											</Button>
										</div>
									</div>
								)
							})
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
