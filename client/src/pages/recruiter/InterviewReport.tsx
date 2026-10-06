/**
 * Task 9 (#322) — unified interview session report (recruiter view).
 *
 * Route: /recruiter/interviews/report/:sessionId?candidateId=<id>
 * Shows the AI evaluation report, full transcript, frame-analysis timeline,
 * and a link to the session's recording playback (the existing full-featured
 * playback page — not duplicated here).
 */
import { ArrowLeft, CalendarClock, Clapperboard, Loader2, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import type { UnifiedSession } from '@/components/domain/InterviewPanel';
import { type SessionReport, SessionReportBody } from '@/components/domain/SessionReport';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiCall } from '@/lib/api';

interface SessionRecording {
	id: number;
	status: string;
	started_at: string | null;
	stopped_at: string | null;
	duration_seconds: number | null;
}

function formatDuration(sec: number | null): string {
	if (sec == null) return '—';
	const m = Math.floor(sec / 60);
	const s = Math.round(sec % 60);
	return `${m}:${String(s).padStart(2, '0')}`;
}

export function InterviewReportPage() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const [searchParams] = useSearchParams();
	const candidateId = searchParams.get('candidateId');
	const navigate = useNavigate();

	const [session, setSession] = useState<UnifiedSession | null>(null);
	const [recording, setRecording] = useState<SessionRecording | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!sessionId || !candidateId) {
			setError('Missing session or candidate reference.');
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const res = await apiCall<{ success: boolean; sessions: UnifiedSession[] }>(
				`/interviews/interview-sessions?candidate_id=${candidateId}`,
			);
			const found = (res.sessions || []).find((s) => Number(s.id) === Number(sessionId));
			if (!found) {
				setError('Interview session not found.');
				return;
			}
			setSession(found);
			// Recording lookup is best-effort: the report is complete without it.
			try {
				const recRes = await apiCall<{ success: boolean; recording: SessionRecording | null }>(
					`/interviews/interview-sessions/${found.id}/recording`,
				);
				setRecording(recRes.recording);
			} catch {
				setRecording(null);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load the report');
		} finally {
			setLoading(false);
		}
	}, [sessionId, candidateId]);

	useEffect(() => {
		load();
	}, [load]);

	if (loading) {
		return (
			<div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" /> Loading report…
			</div>
		);
	}

	if (error || !session) {
		return (
			<div className="p-6 space-y-4">
				<Button variant="outline" size="sm" onClick={() => navigate(-1)} className="gap-1">
					<ArrowLeft className="h-4 w-4" /> Back
				</Button>
				<EmptyState
					icon={MessageSquare}
					title="Report unavailable"
					description={error || 'Session not found.'}
				/>
			</div>
		);
	}

	const report = (session.config?.report || null) as SessionReport | null;
	const conversation = Array.isArray(session.conversation) ? session.conversation : [];
	const frameAnalysis = (session as unknown as { frame_analysis?: unknown }).frame_analysis as
		| { per_turn?: unknown[]; turn_count?: number }
		| null
		| undefined;
	const frameTurns = Array.isArray(frameAnalysis?.per_turn) ? frameAnalysis.per_turn : [];

	return (
		<div className="p-6 space-y-6 max-w-4xl mx-auto">
			<Button variant="outline" size="sm" onClick={() => navigate(-1)} className="gap-1">
				<ArrowLeft className="h-4 w-4" /> Back
			</Button>

			{/* Header */}
			<div>
				<div className="flex items-center gap-2 flex-wrap">
					<h1 className="text-2xl font-heading font-bold">Interview Report</h1>
					<Badge variant="outline">{session.type?.replace('_', ' ')}</Badge>
					<Badge variant={session.status === 'completed' ? 'success' : 'secondary'}>
						{session.status}
					</Badge>
				</div>
				<p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
					<CalendarClock className="h-3.5 w-3.5" />
					{session.completed_at
						? `Completed ${new Date(session.completed_at).toLocaleString()}`
						: session.started_at
							? `Started ${new Date(session.started_at).toLocaleString()}`
							: 'Not started'}
				</p>
			</div>

			{/* AI evaluation report */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">AI Evaluation</CardTitle>
				</CardHeader>
				<CardContent>
					{report ? (
						<SessionReportBody report={report} />
					) : (
						<p className="text-sm text-muted-foreground">
							No evaluation report yet — it is generated when the session completes.
						</p>
					)}
				</CardContent>
			</Card>

			{/* Recording */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Clapperboard className="h-4 w-4" /> Recording
					</CardTitle>
				</CardHeader>
				<CardContent>
					{recording ? (
						<div className="flex items-center justify-between gap-3 flex-wrap">
							<div className="text-sm">
								<p className="font-medium">
									Status: {recording.status} · Duration: {formatDuration(recording.duration_seconds)}
								</p>
								{recording.started_at && (
									<p className="text-xs text-muted-foreground">
										Recorded {new Date(recording.started_at).toLocaleString()}
									</p>
								)}
							</div>
							<Button
								size="sm"
								variant="outline"
								className="min-h-[44px]"
								onClick={() => navigate(`/recruiter/recordings/${recording.id}/playback`)}
							>
								Open playback
							</Button>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No recording for this session (video was off or not captured).
						</p>
					)}
				</CardContent>
			</Card>

			{/* Transcript */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<MessageSquare className="h-4 w-4" /> Transcript
					</CardTitle>
				</CardHeader>
				<CardContent>
					{conversation.length === 0 ? (
						<p className="text-sm text-muted-foreground">No transcript available.</p>
					) : (
						<div className="space-y-2 max-h-[50vh] overflow-y-auto">
							{conversation.map((turn, i) => {
								const turnClass =
									turn.role === 'candidate' ? 'bg-muted/60 ml-6' : 'bg-primary/5 mr-6';
								return (
									// biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only (timestamp + index fallback)
									<div key={`${turn.timestamp || i}-${i}`} className={`rounded-lg p-3 text-sm ${turnClass}`}>
										<p className="text-[11px] font-medium text-muted-foreground mb-1">
											{turn.role === 'candidate' ? 'Candidate' : 'AI Interviewer'}
											{turn.phase ? ` · ${turn.phase}` : ''}
										</p>
										<p className="whitespace-pre-wrap leading-relaxed">{turn.text}</p>
									</div>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Frame analysis timeline */}
			{frameTurns.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">
							Video Signals{' '}
							<span className="text-xs font-normal text-muted-foreground">
								{frameTurns.length} turn{frameTurns.length === 1 ? '' : 's'} with signals
							</span>
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							{frameTurns.map((indicators, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: frame indicators are positional snapshots with no stable IDs
								<div key={i} className="rounded-lg border p-3">
									<p className="text-xs font-medium text-muted-foreground mb-1">
										Turn {i + 1}
									</p>
									<div className="flex flex-wrap gap-1.5">
										{typeof indicators === 'object' && indicators !== null ? (
											Object.entries(indicators as Record<string, unknown>).map(
												([k, v]) => (
													<Badge key={k} variant="secondary" className="text-xs">
														{k}: {String(v)}
													</Badge>
												),
											)
										) : (
											<span className="text-xs text-muted-foreground">{String(indicators)}</span>
										)}
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
