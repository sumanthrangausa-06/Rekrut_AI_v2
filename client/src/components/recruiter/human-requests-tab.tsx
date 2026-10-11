/**
 * HumanRequestsTab — S-061 (#711): "Human Requests" tab for the recruiter
 * interviews page. Lists pending human-interview requests (AC-1) with
 * Approve / Decline actions (AC-2, AC-3). Decided requests leave the list
 * (AC-4). Hiring-team-only access is enforced by the backend
 * (requireHiringRole); this page is recruiter-only (AC-5).
 *
 * Copy reviewed by UX architect (S-061): decision surface must feel fair,
 * not punitive — the recruiter is deciding on someone's accommodation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { apiCall } from '@/lib/api';

interface HumanRequest {
	id: number;
	session_id: number;
	candidate_id: number;
	status: string;
	created_at: string;
	candidate_name: string;
	job_title: string | null;
	session_type: string;
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Human-readable session type labels (storage form → display). */
const SESSION_TYPE_LABELS: Record<string, string> = {
	ai_interview: 'AI interview',
	screening: 'Screening',
	practice: 'Practice',
	human: 'Human',
};

function sessionTypeLabel(t: string): string {
	return SESSION_TYPE_LABELS[t] ?? t;
}

export function HumanRequestsTab() {
	const [requests, setRequests] = useState<HumanRequest[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actingId, setActingId] = useState<number | null>(null);
	const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
	// UX #6: after a decision removes the card, move keyboard focus to the
	// notice so focus isn't dropped to <body>.
	const noticeRef = useRef<HTMLDivElement>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await apiCall<{ requests: HumanRequest[] }>('/interviews/human-requests');
			setRequests(data.requests ?? []);
		} catch {
			setError('Could not load human interview requests. Please try again.');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const decide = useCallback(
		async (id: number, action: 'approve' | 'decline') => {
			setActingId(id);
			setNotice(null);
			try {
				await apiCall(`/interviews/human-requests/${id}/${action}`, { method: 'POST' });
				// AC-4: decided requests leave the pending list immediately.
				setRequests((prev) => prev.filter((r) => r.id !== id));
				setNotice({
					type: 'success',
					text:
						action === 'approve'
							? 'Human interview approved. The candidate has been notified.'
							: 'Request declined. The candidate has been notified.',
				});
			} catch {
				setNotice({
					type: 'error',
					text: `Could not ${action} this request. Please try again.`,
				});
			} finally {
				setActingId(null);
				// UX #6: land keyboard focus on the notice after the card unmounts.
				requestAnimationFrame(() => noticeRef.current?.focus());
			}
		},
		[],
	);

	if (loading) {
		return (
			<div className="space-y-3" role="status" aria-label="Loading human interview requests">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="space-y-3">
				<div role="alert" className="text-sm text-destructive">
					{error}
				</div>
				<Button size="sm" variant="outline" onClick={() => void load()}>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{notice && (
				<div
					ref={noticeRef}
					tabIndex={-1}
					role={notice.type === 'error' ? 'alert' : 'status'}
					className={
						notice.type === 'success'
							? 'text-sm text-emerald-700 dark:text-emerald-400'
							: 'text-sm text-destructive'
					}
				>
					{notice.text}
				</div>
			)}
			{requests.length === 0 ? (
				<EmptyState
					icon={Clock}
					title="No pending requests"
					description="When a candidate requests a human interview instead of biometric screening, it will appear here for your review."
				/>
			) : (
				requests.map((r) => (
					<Card key={r.id}>
						{/* UX #3: stack content above actions on small screens. */}
						<CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
							<div className="min-w-0">
								<p className="text-sm font-medium">
									{r.candidate_name}{' '}
									{r.job_title && (
										<span className="text-xs text-muted-foreground font-normal">
											{r.job_title}
										</span>
									)}
								</p>
								{/* UX #2: session type (decision context) instead of internal session ID. */}
								<p className="text-xs text-muted-foreground mt-1">
									Requested {formatDate(r.created_at)} · {sessionTypeLabel(r.session_type)} session
								</p>
								<Badge variant="warning" className="text-xs mt-1">
									Awaiting your decision
								</Badge>
							</div>
							{/* UX #1: equal visual weight — both decisions are real and consequential. */}
							<div className="flex gap-2 shrink-0">
								<Button
									size="sm"
									variant="outline"
									onClick={() => void decide(r.id, 'approve')}
									disabled={actingId === r.id}
								>
									<Check className="h-4 w-4 mr-1" aria-hidden="true" />
									{actingId === r.id ? 'Working…' : 'Approve'}
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() => void decide(r.id, 'decline')}
									disabled={actingId === r.id}
								>
									<X className="h-4 w-4 mr-1" aria-hidden="true" />
									Decline
								</Button>
							</div>
						</CardContent>
					</Card>
				))
			)}
		</div>
	);
}
