/**
 * Task 9 (#322) — unified interview session report (recruiter view).
 *
 * Route: /recruiter/interviews/report/:sessionId
 * Shows the AI evaluation report, full transcript, frame-analysis timeline,
 * and a link to the session's recording playback (the existing full-featured
 * playback page — not duplicated here).
 *
 * S-087 (#790): the session is loaded from the gated single-session
 * endpoint (GET /interview-sessions/:id), not by fetching the whole
 * candidate session list — the list no longer carries full session data.
 */
import { ArrowLeft, CalendarClock, Clapperboard, Loader2, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { InterviewerAssessment } from '@/components/domain/InterviewerAssessment';
import type { UnifiedSession } from '@/components/domain/InterviewPanel';
import { ObserverAnalysis } from '@/components/domain/ObserverAnalysis';
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

/**
 * S-039 (#686): observer/status channel (S-087) — section states are
 * resolved SERVER-side through the canonical lib/observerReportStates.js;
 * the recruiter notice is the audience-split metadata line (the decline
 * reason is never named on this surface). Report `version` is the §4.3
 * projection shape version, shown in view metadata only.
 */
interface ObserverStatusResponse {
	success: boolean;
	observer_enabled: boolean;
	report: {
		id: number;
		consent_state: string;
		created_at: string;
		version: number | null;
	} | null;
	section_states: Record<string, { state: string; label?: string; explanation?: string }>;
	recruiter_notice: { kind: 'disabled' | 'none' | 'presence' | 'neutral'; copy: string | null };
}

function formatDuration(sec: number | null): string {
	if (sec == null) return '—';
	const m = Math.floor(sec / 60);
	const s = Math.round(sec % 60);
	return `${m}:${String(s).padStart(2, '0')}`;
}

export function InterviewReportPage() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();

	const [session, setSession] = useState<UnifiedSession | null>(null);
	const [recording, setRecording] = useState<SessionRecording | null>(null);
	const [observerStatus, setObserverStatus] = useState<ObserverStatusResponse | null>(null);
	const [renderedAt] = useState(() => new Date());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!sessionId) {
			setError('Missing session reference.');
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const res = await apiCall<{ success: boolean; session: UnifiedSession }>(
				`/interviews/interview-sessions/${encodeURIComponent(sessionId)}`,
			);
			const found = res.session;
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
			// S-039: observer section states come from the gated status
			// channel (server-resolved, S-087) — never derived client-side
			// from the raw session payload. Human sessions only; best-effort
			// like the recording lookup (the side-by-side region simply
			// does not render if the channel fails).
			if (found.type === 'human' || found.type === 'human_scheduled') {
				try {
					const statusRes = await apiCall<ObserverStatusResponse>(
						`/interviews/interview-sessions/${found.id}/observer/status`,
					);
					setObserverStatus(statusRes?.section_states ? statusRes : null);
				} catch {
					setObserverStatus(null);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load the report');
		} finally {
			setLoading(false);
		}
	}, [sessionId]);

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

	// S-039: side-by-side derivation. The two-column layout activates only
	// when a section resolved `present` (panel surface form); otherwise the
	// human column stands alone with the metadata strip. The left column
	// receives NO data today — scorecards are schema-only and unserved —
	// so it renders its honest `missing` state, never a substitute.
	const isHumanSession = session.type === 'human' || session.type === 'human_scheduled';
	const observerNotice = observerStatus?.recruiter_notice ?? null;
	const observerSectionStates = observerStatus?.section_states ?? null;
	const anyObserverSectionPresent = observerSectionStates
		? Object.values(observerSectionStates).some((s) => s.state === 'present')
		: false;
	const twoColumn = !!observerStatus && observerNotice?.kind === 'none' && anyObserverSectionPresent;

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

			{/* S-039: side-by-side report (human interviews). Metadata strip
			    carries the audience-split notice + projection version /
			    rendered-at (view metadata only, never persisted). */}
			{isHumanSession && observerStatus && (
				<>
					<div
						data-testid="report-metadata"
						role="status"
						className="rounded-lg border bg-muted/40 px-4 py-3 space-y-1"
					>
						{observerNotice?.copy && <p className="text-sm">{observerNotice.copy}</p>}
						{/* The version line is suppressed under the neutral
						    notice: a report row existing at all is consent
						    history, and neutral-case metadata must stay
						    indistinguishable (privacy B-1). */}
						{observerStatus.report && observerNotice?.kind !== 'neutral' && (
							<p className="text-xs text-muted-foreground">
								Observer report version {observerStatus.report.version ?? '—'} · Rendered{' '}
								{renderedAt.toLocaleString()}
							</p>
						)}
					</div>
					{twoColumn ? (
						<div data-testid="side-by-side" className="grid grid-cols-1 md:grid-cols-2 gap-6">
							<InterviewerAssessment assessment={{ state: 'missing' }} />
							{/* No neutralCopy prop here (privacy S-3): this
							    column mounts only when the notice kind is
							    'none', so the page enforces the collapse by
							    not mounting it in neutral cases — the
							    metadata strip carries the sentence. The
							    component's own neutral branch is its
							    defensive contract for direct consumers. */}
							<ObserverAnalysis sectionStates={observerSectionStates} report={null} />
						</div>
					) : (
						<InterviewerAssessment assessment={{ state: 'missing' }} />
					)}
				</>
			)}

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
