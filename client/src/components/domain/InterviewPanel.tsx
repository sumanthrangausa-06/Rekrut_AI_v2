/**
 * Task 9 (#322) — unified interview panel for the candidate profile (recruiter view).
 *
 * One panel showing every interview artifact for a candidate: auto-sent
 * screening, recruiter-triggered AI interviews, practice sessions, and
 * human-scheduled interviews (read-linked from scheduled_interviews /
 * interview_events by the backend).
 */
import { CalendarClock, FileText, Loader2, Play, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiCall } from '@/lib/api';

export interface UnifiedSession {
	id: number;
	type: 'screening' | 'ai_interview' | 'practice' | 'human_scheduled' | string;
	status: string;
	source: 'interview_session' | 'scheduled_interviews' | 'interview_events' | string;
	created_at?: string;
	started_at?: string | null;
	completed_at?: string | null;
	scheduled_at?: string | null;
	config?: {
		report?: { overall_score?: number | null } | null;
		question_source?: string;
	} | null;
	conversation?: Array<{ role?: string; text?: string; timestamp?: string; phase?: string }> | null;
}

const TYPE_META: Record<string, { label: string; className: string }> = {
	screening: { label: 'AI Screening', className: 'bg-purple-100 text-purple-800 border-purple-200' },
	ai_interview: { label: 'AI Interview', className: 'bg-blue-100 text-blue-800 border-blue-200' },
	practice: { label: 'Practice', className: 'bg-gray-100 text-gray-700 border-gray-200' },
	human_scheduled: {
		label: 'Human Interview',
		className: 'bg-cyan-100 text-cyan-800 border-cyan-200',
	},
};

function typeBadge(type: string) {
	const meta = TYPE_META[type] || { label: type, className: '' };
	return (
		<Badge variant="outline" className={meta.className}>
			{meta.label}
		</Badge>
	);
}

function statusBadge(status: string) {
	const variant =
		status === 'completed' ? 'success' : status === 'in_progress' ? 'warning' : 'secondary';
	return <Badge variant={variant}>{status?.replace('_', ' ') || 'unknown'}</Badge>;
}

function sessionDate(s: UnifiedSession): string {
	const raw = s.scheduled_at || s.completed_at || s.started_at || s.created_at;
	if (!raw) return '—';
	return new Date(raw).toLocaleDateString();
}

interface InterviewPanelProps {
	candidateId: number;
	applicationId: number;
	onViewReport: (session: UnifiedSession) => void;
}

export function InterviewPanel({ candidateId, applicationId, onViewReport }: InterviewPanelProps) {
	const [sessions, setSessions] = useState<UnifiedSession[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [triggering, setTriggering] = useState(false);
	const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

	const load = useCallback(async () => {
		setError(null);
		try {
			const res = await apiCall<{ success: boolean; sessions: UnifiedSession[] }>(
				`/interviews/interview-sessions?candidate_id=${candidateId}`,
			);
			setSessions(res.sessions || []);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load interviews');
			setSessions([]);
		}
	}, [candidateId]);

	useEffect(() => {
		load();
	}, [load]);

	async function triggerAiInterview() {
		setTriggering(true);
		setTriggerMsg(null);
		try {
			const res = await apiCall<{ success: boolean; already_triggered?: boolean }>(
				'/interviews/interview-sessions/trigger',
				{ method: 'POST', body: { application_id: applicationId } },
			);
			setTriggerMsg(
				res.already_triggered
					? 'An AI interview was already triggered for this application.'
					: 'AI interview triggered — the candidate has been notified.',
			);
			await load();
		} catch (err) {
			setTriggerMsg(err instanceof Error ? err.message : 'Failed to trigger AI interview');
		} finally {
			setTriggering(false);
		}
	}

	if (sessions === null) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-xs text-muted-foreground">
					{sessions.length === 0
						? 'No interviews yet.'
						: `${sessions.length} interview${sessions.length === 1 ? '' : 's'}`}
				</p>
				<Button
					size="sm"
					variant="outline"
					className="gap-1 text-xs min-h-[44px]"
					onClick={triggerAiInterview}
					disabled={triggering}
				>
					{triggering ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Sparkles className="h-3.5 w-3.5" />
					)}
					{triggering ? 'Triggering…' : 'Start AI interview'}
				</Button>
			</div>
			{triggerMsg && <p className="text-xs text-muted-foreground">{triggerMsg}</p>}
			{error && <p className="text-xs text-red-600">{error}</p>}

			{sessions.length === 0 && !error ? (
				<EmptyState
					icon={CalendarClock}
					title="No interviews"
					description="Screening invitations, AI interviews, and scheduled interviews will appear here."
				/>
			) : (
				<div className="space-y-2">
					{sessions.map((s) => {
						const score = s.config?.report?.overall_score;
						const isUnified = s.source === 'interview_session';
						return (
							<div
								key={`${s.source}-${s.id}`}
								className="flex items-center gap-3 rounded-lg border p-3"
							>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 flex-wrap">
										{typeBadge(s.type)}
										{statusBadge(s.status)}
										{score != null && (
											<span className="text-xs font-bold text-muted-foreground">
												{score}/100
											</span>
										)}
									</div>
									<p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
										<CalendarClock className="h-3 w-3" />
										{sessionDate(s)}
										{s.source !== 'interview_session' && (
											<span className="ml-1">(scheduled separately)</span>
										)}
									</p>
								</div>
								{isUnified && s.status === 'completed' && (
									<Button
										size="sm"
										variant="outline"
										className="gap-1 text-xs shrink-0 min-h-[44px]"
										onClick={() => onViewReport(s)}
									>
										<FileText className="h-3.5 w-3.5" /> Report
									</Button>
								)}
								{isUnified && s.status !== 'completed' && (
									<span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
										<Play className="h-3 w-3" /> Awaiting candidate
									</span>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
