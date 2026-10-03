import {
	Activity,
	Briefcase,
	Calendar,
	ClipboardCheck,
	FileText,
	MessageCircle,
	Star,
	UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ActivityItem {
	id: number;
	job_id: number;
	user_id: number;
	action_type: string;
	description: string;
	metadata: Record<string, unknown>;
	created_at: string;
	user_name: string;
	user_avatar: string | null;
}

interface ActivityFeedProps {
	jobId: number;
}

function timeAgo(timestamp: string) {
	const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

const actionConfig: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
	comment: {
		icon: <MessageCircle className="h-4 w-4" />,
		color: 'text-blue-600',
		bg: 'bg-blue-50 dark:bg-blue-900/20',
	},
	note: {
		icon: <FileText className="h-4 w-4" />,
		color: 'text-amber-600',
		bg: 'bg-amber-50 dark:bg-amber-900/20',
	},
	rating: {
		icon: <Star className="h-4 w-4" />,
		color: 'text-yellow-600',
		bg: 'bg-yellow-50 dark:bg-yellow-900/20',
	},
	application_review: {
		icon: <ClipboardCheck className="h-4 w-4" />,
		color: 'text-green-600',
		bg: 'bg-green-50 dark:bg-green-900/20',
	},
	interview_scheduled: {
		icon: <Calendar className="h-4 w-4" />,
		color: 'text-purple-600',
		bg: 'bg-purple-50 dark:bg-purple-900/20',
	},
	candidate_added: {
		icon: <UserPlus className="h-4 w-4" />,
		color: 'text-indigo-600',
		bg: 'bg-indigo-50 dark:bg-indigo-900/20',
	},
	job_posted: {
		icon: <Briefcase className="h-4 w-4" />,
		color: 'text-emerald-600',
		bg: 'bg-emerald-50 dark:bg-emerald-900/20',
	},
	default: {
		icon: <Activity className="h-4 w-4" />,
		color: 'text-muted-foreground',
		bg: 'bg-muted',
	},
};

export function ActivityFeed({ jobId }: ActivityFeedProps) {
	const [activities, setActivities] = useState<ActivityItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [offset, setOffset] = useState(0);
	const [hasMore, setHasMore] = useState(true);
	const limit = 50;

	const load = useCallback(
		async (append = false) => {
			setLoading(true);
			try {
				const currentOffset = append ? offset : 0;
				const data = await apiCall<{
					activities: ActivityItem[];
					total: number;
					limit: number;
					offset: number;
				}>(`/collaboration/activity/${jobId}?limit=${limit}&offset=${currentOffset}`);

				if (append) {
					setActivities((prev) => [...prev, ...(data.activities || [])]);
				} else {
					setActivities(data.activities || []);
				}

				const totalLoaded = currentOffset + (data.activities || []).length;
				setHasMore(totalLoaded < data.total);
				setOffset(currentOffset + limit);
			} catch (err) {
				console.error('[ActivityFeed] Load error:', err);
			} finally {
				setLoading(false);
			}
		},
		[jobId, offset],
	);

	useEffect(() => {
		setOffset(0);
		setHasMore(true);
		load(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [load]);

	return (
		<div className="space-y-3">
			{loading && activities.length === 0 ? (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
					))}
				</div>
			) : activities.length === 0 ? (
				<div className="text-center py-8 text-muted-foreground text-sm">
					No activity yet for this job.
				</div>
			) : (
				<>
					{activities.map((a) => {
						const config = actionConfig[a.action_type] || actionConfig.default;
						return (
							<Card key={a.id} className="overflow-hidden">
								<CardContent className="pt-4 pb-4">
									<div className="flex items-start gap-3">
										<div
											className={cn(
												'flex items-center justify-center rounded-full h-8 w-8 shrink-0',
												config.bg,
												config.color,
											)}
										>
											{config.icon}
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="text-sm font-medium">{a.user_name || 'Unknown'}</span>
												<span className="text-xs text-muted-foreground">
													{timeAgo(a.created_at)}
												</span>
											</div>
											<p className="text-sm text-foreground mt-0.5">{a.description}</p>
										</div>
										<Avatar
											src={a.user_avatar}
											fallback={a.user_name || '?'}
											size="sm"
											seed={a.user_id}
										/>
									</div>
								</CardContent>
							</Card>
						);
					})}

					{hasMore && (
						<div className="flex justify-center pt-2">
							<button type="button"
								onClick={() => load(true)}
								disabled={loading}
								className="text-sm text-primary hover:underline disabled:opacity-50"
							>
								{loading ? 'Loading...' : 'Load more'}
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
