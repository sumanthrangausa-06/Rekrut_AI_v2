import {
	AlertTriangle,
	Bell,
	CalendarClock,
	CheckCircle,
	ChevronRight,
	ClipboardList,
	Clock,
	Info,
	Sparkles,
	Trash2,
	Volume2,
	X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

export type Notification = {
	id: string;
	title: string;
	message: string;
	type:
		| 'info'
		| 'success'
		| 'warning'
		| 'error'
		| 'interview'
		| 'offer'
		| 'message'
		| 'application_submitted'
		| 'application_received'
		| 'application_status_changed'
		| 'screening_invited'
		| 'screening_completed'
		| 'assessment_assigned'
		| 'assessment_completed'
		| 'interview_scheduled'
		| 'interview_confirmed'
		| 'offer_received'
		| 'screening_stalled'
		| 'ai_interview_invited'
		| 'assessment_scored'
		| 'aptitude_test_assigned'
		| 'application_shortlisted'
		| 'application_rejected';
	read: boolean;
	timestamp: string;
	action?: {
		label: string;
		url: string;
	};
};

const typeConfig: Record<string, { icon: React.ReactNode; color: string; badge: string ; label: string }> = {
	info: {
		label: 'Info',
		icon: <Info className="h-4 w-4" />,
		color: 'text-blue-600',
		badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
	},
	success: {
		label: 'Success',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-green-600',
		badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
	},
	warning: {
		label: 'Warning',
		icon: <AlertTriangle className="h-4 w-4" />,
		color: 'text-amber-600',
		badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
	},
	error: {
		label: 'Alert',
		icon: <X className="h-4 w-4" />,
		color: 'text-red-600',
		badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
	},
	interview: {
		label: 'Interview',
		icon: <Clock className="h-4 w-4" />,
		color: 'text-purple-600',
		badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
	},
	offer: {
		label: 'Offer',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-emerald-600',
		badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	},
	message: {
		label: 'Message',
		icon: <Info className="h-4 w-4" />,
		color: 'text-indigo-600',
		badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
	},
	// Pipeline notification types (hiring-pipeline-v1)
	application_submitted: {
		label: 'Application',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-green-600',
		badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
	},
	application_received: {
		label: 'Application',
		icon: <Bell className="h-4 w-4" />,
		color: 'text-blue-600',
		badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
	},
	application_status_changed: {
		label: 'Status Update',
		icon: <ChevronRight className="h-4 w-4" />,
		color: 'text-purple-600',
		badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
	},
	screening_invited: {
		label: 'Screening',
		icon: <Sparkles className="h-4 w-4" />,
		color: 'text-violet-600',
		badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
	},
	screening_completed: {
		label: 'Screening',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-emerald-600',
		badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	},
	assessment_assigned: {
		label: 'Assessment',
		icon: <ClipboardList className="h-4 w-4" />,
		color: 'text-orange-600',
		badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
	},
	assessment_completed: {
		label: 'Assessment',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-emerald-600',
		badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	},
	interview_scheduled: {
		label: 'Interview',
		icon: <CalendarClock className="h-4 w-4" />,
		color: 'text-sky-600',
		badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
	},
	interview_confirmed: {
		label: 'Interview',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-green-600',
		badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
	},
	offer_received: {
		label: 'Offer',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-emerald-600',
		badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	},
	screening_stalled: {
		label: 'Screening',
		icon: <AlertTriangle className="h-4 w-4" />,
		color: 'text-amber-600',
		badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
	},
	ai_interview_invited: {
		label: 'Interview',
		icon: <CalendarClock className="h-4 w-4" />,
		color: 'text-sky-600',
		badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
	},
	assessment_scored: {
		label: 'Assessment',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-emerald-600',
		badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
	},
	aptitude_test_assigned: {
		label: 'Assessment',
		icon: <ClipboardList className="h-4 w-4" />,
		color: 'text-orange-600',
		badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
	},
	application_shortlisted: {
		label: 'Shortlisted',
		icon: <CheckCircle className="h-4 w-4" />,
		color: 'text-teal-600',
		badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
	},
	application_rejected: {
		label: 'Update',
		icon: <Info className="h-4 w-4" />,
		color: 'text-slate-600',
		badge: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
	},
};

// Maps a notification type + metadata to a client route. Returns null when the
// metadata lacks the IDs needed for a destination — the caller then renders no
// "View" action rather than a broken link.
export function resolveNotificationUrl(
	type: string,
	metadata: Record<string, unknown> | undefined,
	isRecruiter: boolean,
): string | null {
	const meta = metadata ?? {};
	const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
	const conversationId = str(meta.conversation_id);
	const jobId = str(meta.job_id);

	switch (type) {
		case 'message': {
			if (!conversationId) return null;
			return isRecruiter
				? `/recruiter/chat?conversation=${conversationId}`
				: `/candidate/chat?conversation=${conversationId}`;
		}
		case 'application_submitted':
		case 'application_received':
		case 'application_status_changed':
		case 'application_shortlisted':
		case 'application_rejected': {
			if (isRecruiter) {
				return jobId ? `/recruiter/applications?job=${jobId}` : '/recruiter/applications';
			}
			return '/candidate/applications';
		}
		case 'screening_invited':
		case 'screening_completed':
		case 'screening_stalled': {
			if (isRecruiter) return '/recruiter/screening';
			return jobId ? `/candidate/screening/${jobId}` : '/candidate/assessments';
		}
		case 'assessment_assigned':
		case 'assessment_completed':
		case 'assessment_scored':
		case 'aptitude_test_assigned': {
			return isRecruiter ? '/recruiter/assessments' : '/candidate/assessments';
		}
		case 'interview_scheduled':
		case 'interview_confirmed':
		case 'ai_interview_invited': {
			return isRecruiter ? '/recruiter/interviews' : '/candidate/interviews';
		}
		case 'offer_received': {
			return isRecruiter ? '/recruiter/offers' : '/candidate/offers';
		}
		default:
			return null;
	}
}

export function NotificationCenter({ className }: { className?: string }) {
	const [open, setOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { isRecruiter } = useAuth();

	// Close on click outside
	useEffect(() => {
		if (!open) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [open ]);
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [loading, setLoading] = useState(false);
	const [playingId, setPlayingId] = useState<string | null>(null);
	const [audioError, setAudioError] = useState<string | null>(null);

	const unreadCount = notifications.filter((n) => !n.read).length;

	const loadNotifications = async (showLoading = true) => {
		if (showLoading) setLoading(true);
		try {
			const data = await apiCall<{
				notifications: Array<{
					id: number;
					type: string;
					title: string;
					message: string;
					read: boolean;
					created_at: string;
					metadata?: Record<string, unknown>;
				}>;
				unread_count: number;
			}>('/notifications/in-app?limit=50');

			const mapped: Notification[] = (data.notifications || []).map((n) => {
				// Prefer a server-provided URL; fall back to the type -> route resolver;
				// no action at all when neither yields a destination (no broken links).
				const serverUrl = n.metadata?.url || n.metadata?.invite_url;
				const resolvedUrl = serverUrl
					? String(serverUrl)
					: resolveNotificationUrl(n.type, n.metadata, isRecruiter);
				return {
					id: String(n.id),
					title: n.title,
					message: n.message,
					type: (n.type as Notification['type']) || 'info',
					read: n.read,
					timestamp: n.created_at,
					action: resolvedUrl ? { label: 'View', url: resolvedUrl } : undefined,
				};
			});
			setNotifications(mapped);
		} catch (err) {
			console.error('[NotificationCenter] Load error:', err);
			if (showLoading) setNotifications([]);
		} finally {
			if (showLoading) setLoading(false);
		}
	};

	useEffect(() => {
		if (!open) return;
		loadNotifications();
	}, [open]);

	// Poll for new notifications every 30s so the badge updates without opening the dropdown
	useEffect(() => {
		loadNotifications(false);
		const interval = setInterval(() => loadNotifications(false), 30000);
		return () => clearInterval(interval);
	}, []);

	const markRead = async (id: string) => {
		try {
			await apiCall(`/notifications/in-app/${id}/read`, { method: 'PUT' });
		} catch (err) {
			console.error('[NotificationCenter] Mark read error:', err);
		}
		setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
	};

	const markAllRead = async () => {
		try {
			await apiCall('/notifications/in-app/mark-all-read', { method: 'POST' });
		} catch (err) {
			console.error('[NotificationCenter] Mark all read error:', err);
		}
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
	};

	const deleteNotification = async (id: string) => {
		// ponytail: no backend DELETE for in-app notifications yet; optimistic local remove
		setNotifications((prev) => prev.filter((n) => n.id !== id));
	};

	const playNotification = async (notification: Notification) => {
		// Don't start if already playing this one
		if (playingId === notification.id) return;

		setPlayingId(notification.id);
		setAudioError(null);

		try {
			// Create a cache key from notification content (simple hash)
			const cacheKey = btoa(`${notification.id}:${notification.message}`).replace(
				/[^a-zA-Z0-9]/g,
				'',
			);

			const response = await fetch(`/api/notifications/voice/${cacheKey}`);

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
				});

				if (!genResponse.ok) {
					throw new Error(`Voice generation failed: ${genResponse.status}`);
				}

				const genData = await genResponse.json();
				if (!genData.audio_url) {
					throw new Error('No audio URL returned');
				}

				// Fetch the generated audio
				const audioResponse = await fetch(genData.audio_url);
				if (!audioResponse.ok) {
					throw new Error('Failed to fetch generated audio');
				}

				const audioBlob = await audioResponse.blob();
				const audioUrl = URL.createObjectURL(audioBlob);
				const audio = new Audio(audioUrl);

				audio.onended = () => {
					setPlayingId(null);
					URL.revokeObjectURL(audioUrl);
				};

				audio.onerror = () => {
					setPlayingId(null);
					setAudioError('Failed to play audio');
					URL.revokeObjectURL(audioUrl);
				};

				await audio.play();
				return;
			}

			// Cache hit — play directly
			const audioBlob = await response.blob();
			const audioUrl = URL.createObjectURL(audioBlob);
			const audio = new Audio(audioUrl);

			audio.onended = () => {
				setPlayingId(null);
				URL.revokeObjectURL(audioUrl);
			};

			audio.onerror = () => {
				setPlayingId(null);
				setAudioError('Failed to play audio');
				URL.revokeObjectURL(audioUrl);
			};

			await audio.play();
		} catch (err: any) {
			console.error('[NotificationCenter] Voice playback error:', err);
			setPlayingId(null);
			setAudioError(err.message || 'Voice playback failed');
		}
	};

	const timeAgo = (timestamp: string) => {
		const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	};

	return (
		<div className="relative" ref={dropdownRef}>
			<Button
				variant="ghost"
				size="sm"
				className={cn('relative h-9 w-9 p-0', className)}
				onClick={() => setOpen(!open)}
				aria-label="Notifications"
				aria-expanded={open}
			>
				<Bell className="h-5 w-5" />
				{unreadCount > 0 && (
					<span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-bold">
						{unreadCount > 9 ? '9+' : unreadCount}
					</span>
				)}
			</Button>

			{open && (
				<div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] max-h-[80vh] flex flex-col rounded-lg border bg-background shadow-xl z-50 overflow-hidden">
					<div className="flex flex-row items-center justify-between px-4 py-3 border-b">
						<h3 className="font-semibold text-sm">Notifications</h3>
						{unreadCount > 0 && (
							<Button variant="ghost" size="sm" onClick={markAllRead} className="h-7 text-xs">
								Mark all read
							</Button>
						)}
					</div>

					<div className="flex-1 overflow-y-auto space-y-2 -mx-2 px-2">
						{audioError && (
							<div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md flex items-center gap-2">
								<span className="flex-1">{audioError}</span>
								<button type="button"
									className="text-red-700 hover:text-red-900 font-medium"
									onClick={() => setAudioError(null)}
								>
									Dismiss
								</button>
							</div>
						)}
						{loading ? (
							<div className="space-y-3">
								{[1, 2, 3].map((i) => (
									<div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
								))}
							</div>
						) : notifications.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								<Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
								<p>No notifications yet</p>
							</div>
						) : (
							notifications.map((n) => {
								const config = typeConfig[n.type] || typeConfig.info;
								return (
									<div
										key={n.id}
										className={cn(
											'group relative rounded-lg p-3 transition-colors',
											n.read ? 'bg-muted/50' : 'bg-primary/5 hover:bg-primary/10',
										)}
										onClick={() => {
											markRead(n.id);
											if (n.action) {
												window.location.href = n.action.url;
											}
										}}
									>
										<div className="flex items-start gap-3">
											<div className={cn('mt-0.5', config.color)}>{config.icon}</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<p className={cn('text-sm font-medium', !n.read && 'text-primary')}>
														{n.title}
													</p>
													<Badge className={cn('text-xs', config.badge)}>{config.label ?? n.type}</Badge>
												</div>
												<p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
													{n.message}
												</p>
												<div className="flex items-center justify-between mt-1">
													<span className="text-xs text-muted-foreground">
														{timeAgo(n.timestamp)}
													</span>
													{n.action && (
														<span className="text-xs text-primary flex items-center gap-0.5">
															{n.action.label}
															<ChevronRight className="h-3 w-3" />
														</span>
													)}
												</div>
											</div>
											<Button
												variant="ghost"
												size="sm"
												className={cn(
													'h-6 w-6 p-0 opacity-0 group-hover:opacity-100',
													playingId === n.id && 'opacity-100 text-primary animate-pulse',
												)}
												onClick={(e) => {
													e.stopPropagation();
													playNotification(n);
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
												variant="ghost"
												size="sm"
												className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
												onClick={(e) => {
													e.stopPropagation();
													deleteNotification(n.id);
												}}
											>
												<Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
											</Button>
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>
			)}
		</div>
	);
}
