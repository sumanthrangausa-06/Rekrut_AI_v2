import {
	AlertCircle,
	CheckCircle,
	Clock,
	Eye,
	Flag,
	Loader2,
	Shield,
	User,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';

interface ProctoringEvent {
	id: number;
	event_type: string;
	severity: 'low' | 'medium' | 'high';
	details: Record<string, unknown>;
	created_at: string;
}

interface ProctoringFlag {
	id: number;
	flag_type: string;
	description: string;
	severity: string;
	review_decision: string;
	review_notes: string | null;
	reviewed_by: number | null;
	reviewer_name: string | null;
	created_at: string;
	updated_at: string;
}

interface ProctoringSession {
	id: number;
	application_id: number;
	candidate_id: number;
	status: string;
	consent_given: boolean;
	consent_timestamp: string | null;
	consent_ip: string | null;
	started_at: string | null;
	ended_at: string | null;
	created_at: string;
	candidate_name: string;
	candidate_email: string;
	job_title: string | null;
	job_id: number | null;
}

export function RecruiterProctoringFlagDetailPage() {
	const { flagId } = useParams<{ flagId: string }>();
	const navigate = useNavigate();
	const [session, setSession] = useState<ProctoringSession | null>(null);
	const [events, setEvents] = useState<ProctoringEvent[]>([]);
	const [flag, setFlag] = useState<ProctoringFlag | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected' | ''>('');
	const [reviewNotes, setReviewNotes] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const loadData = useCallback(async () => {
		try {
			setLoading(true);
			// We need the session_id to fetch session details. First get flag details via flags list,
			// but since we only have flagId here, we can use a workaround: call the flags endpoint
			// or we could fetch all flags and find this one. Better approach: we'll get the session
			// from the flag by calling the flags list with a high limit and filtering client-side,
			// OR we can modify the API. For now, let's fetch the session through the session endpoint
			// if we can derive it. Actually, let me call the flags endpoint with all status and search.

			// First try: load flags list and find the one we need
			const flagsData = await apiCall<{
				success: boolean;
				flags: Array<{
					flag_id: number;
					session_id: number;
					flag_type: string;
					description: string;
					severity: string;
					review_decision: string;
					review_notes: string | null;
					reviewed_by: number | null;
					reviewer_name: string | null;
					flagged_at: string;
					session_status: string;
					started_at: string | null;
					ended_at: string | null;
					candidate_id: number;
					candidate_name: string;
					candidate_email: string;
					job_id: number | null;
					job_title: string | null;
				}>;
			}>(`/proctoring/flags?status=all&limit=1000&offset=0`);

			const found = flagsData.flags.find((f) => f.flag_id === Number(flagId));
			if (!found) {
				setError('Flag not found');
				setLoading(false);
				return;
			}

			// Now fetch the full session with events
			const sessionData = await apiCall<{
				success: boolean;
				session: ProctoringSession;
				events: ProctoringEvent[];
				flags: ProctoringFlag[];
			}>(`/proctoring/session/${found.session_id}`);

			setSession(sessionData.session);
			setEvents(sessionData.events);
			const matchedFlag = sessionData.flags.find((f) => f.id === Number(flagId));
			setFlag(matchedFlag || null);
			setReviewDecision((matchedFlag?.review_decision as 'approved' | 'rejected') || '');
			setReviewNotes(matchedFlag?.review_notes || '');
		} catch (err: unknown) {
			setError(err.message || 'Failed to load flag details');
		} finally {
			setLoading(false);
		}
	}, [flagId]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	async function submitReview() {
		if (!reviewDecision) return;
		setSubmitting(true);
		try {
			await apiCall(`/proctoring/flags/${flagId}/review`, {
				method: 'POST',
				body: { decision: reviewDecision, notes: reviewNotes },
			});
			await loadData();
		} catch (err: unknown) {
			setError(err.message || 'Failed to submit review');
		} finally {
			setSubmitting(false);
		}
	}

	function eventIcon(type: string) {
		switch (type) {
			case 'tab_switch':
			case 'fullscreen_exit':
			case 'window_blur':
				return <Eye className="w-4 h-4" />;
			case 'no_face':
			case 'multiple_faces':
				return <Shield className="w-4 h-4" />;
			case 'copy_paste':
			case 'right_click':
			case 'suspicious_keypress':
				return <AlertCircle className="w-4 h-4" />;
			case 'audio_anomaly':
			case 'timing_anomaly':
				return <Clock className="w-4 h-4" />;
			default:
				return <Shield className="w-4 h-4" />;
		}
	}

	function severityClass(severity: string) {
		switch (severity) {
			case 'high':
				return 'bg-red-100 text-red-700 border-red-200';
			case 'medium':
				return 'bg-amber-100 text-amber-700 border-amber-200';
			default:
				return 'bg-slate-100 text-slate-600 border-slate-200';
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-[60vh]">
				<Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
			</div>
		);
	}

	if (error && !session) {
		return (
			<div className="p-6">
				<Card>
					<CardContent className="p-8 text-center space-y-4">
						<AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
						<h2 className="text-xl font-semibold text-slate-900">Error</h2>
						<p className="text-slate-600">{error}</p>
						<Button onClick={() => navigate('/recruiter/proctoring')} variant="outline">
							Back to Review Queue
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!session || !flag) return null;

	const isReviewed = flag.review_decision !== 'pending';

	return (
		<div className="p-4 sm:p-6 lg:p-8 space-y-6">
			{/* Back + header */}
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" onClick={() => navigate('/recruiter/proctoring')}>
					← Back to Queue
				</Button>
			</div>

			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-slate-900">Flag Review Detail</h1>
					<p className="text-sm text-slate-500 mt-1">Session #{session.id}</p>
				</div>
				<div className="flex items-center gap-2">
					{flag.severity === 'high' ? (
						<Badge className="bg-red-100 text-red-700 border-red-200">
							<Flag className="w-3 h-3 mr-1" /> High Severity
						</Badge>
					) : (
						<Badge className="bg-amber-100 text-amber-700 border-amber-200">
							<Flag className="w-3 h-3 mr-1" /> {flag.severity} Severity
						</Badge>
					)}
					{isReviewed ? (
						<Badge
							className={
								flag.review_decision === 'approved'
									? 'bg-green-100 text-green-700'
									: 'bg-red-100 text-red-700'
							}
						>
							{flag.review_decision === 'approved' ? (
								<CheckCircle className="w-3 h-3 mr-1" />
							) : (
								<XCircle className="w-3 h-3 mr-1" />
							)}
							{flag.review_decision}
						</Badge>
					) : (
						<Badge className="bg-amber-100 text-amber-700 border-amber-200">
							<Clock className="w-3 h-3 mr-1" /> Pending Review
						</Badge>
					)}
				</div>
			</div>

			{error && (
				<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-3">
					<AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
					{error}
				</div>
			)}

			{/* Candidate & Job Info */}
			<Card>
				<CardContent className="p-6 space-y-4">
					<h2 className="text-lg font-semibold text-slate-900">Candidate & Session Info</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div className="space-y-1">
							<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
								Candidate
							</p>
							<p className="text-sm text-slate-900 flex items-center gap-2">
								<User className="w-4 h-4 text-slate-400" />
								{session.candidate_name || session.candidate_email}
							</p>
						</div>
						<div className="space-y-1">
							<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Job</p>
							<p className="text-sm text-slate-900">
								{session.job_title || `Job #${session.job_id}`}
							</p>
						</div>
						<div className="space-y-1">
							<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Started</p>
							<p className="text-sm text-slate-900">
								{session.started_at ? new Date(session.started_at).toLocaleString() : 'Not started'}
							</p>
						</div>
						<div className="space-y-1">
							<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Ended</p>
							<p className="text-sm text-slate-900">
								{session.ended_at ? new Date(session.ended_at).toLocaleString() : 'In progress'}
							</p>
						</div>
						<div className="space-y-1">
							<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
								Consent IP
							</p>
							<p className="text-sm text-slate-900 font-mono">{session.consent_ip || 'N/A'}</p>
						</div>
						<div className="space-y-1">
							<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
								Consent Time
							</p>
							<p className="text-sm text-slate-900">
								{session.consent_timestamp
									? new Date(session.consent_timestamp).toLocaleString()
									: 'Not given'}
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Event Timeline */}
			<Card>
				<CardContent className="p-6 space-y-4">
					<h2 className="text-lg font-semibold text-slate-900">Event Timeline ({events.length})</h2>
					{events.length === 0 ? (
						<div className="text-center py-8 text-slate-500">
							<Shield className="w-8 h-8 mx-auto mb-2 text-slate-300" />
							<p className="text-sm">No events recorded</p>
						</div>
					) : (
						<div className="space-y-2">
							{events.map((event) => (
								<div
									key={event.id}
									className={`flex items-start gap-3 rounded-lg border p-3 ${severityClass(
										event.severity,
									)}`}
								>
									<div className="mt-0.5">{eventIcon(event.event_type)}</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center justify-between gap-2">
											<span className="text-sm font-medium capitalize">
												{event.event_type.replace(/_/g, ' ')}
											</span>
											<span className="text-xs text-slate-500 flex-shrink-0">
												{new Date(event.created_at).toLocaleString()}
											</span>
										</div>
										{event.details && Object.keys(event.details).length > 0 && (
											<p className="text-xs text-slate-500 mt-1 font-mono break-all">
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

			{/* Review Decision */}
			<Card className={isReviewed ? 'border-green-200' : 'border-indigo-200'}>
				<CardContent className="p-6 space-y-4">
					<h2 className="text-lg font-semibold text-slate-900">Human Review Decision</h2>
					{isReviewed ? (
						<div className="space-y-3">
							<div className="flex items-center gap-2">
								{flag.review_decision === 'approved' ? (
									<CheckCircle className="w-5 h-5 text-green-600" />
								) : (
									<XCircle className="w-5 h-5 text-red-600" />
								)}
								<span
									className={`font-medium ${
										flag.review_decision === 'approved' ? 'text-green-700' : 'text-red-700'
									}`}
								>
									Decision: {flag.review_decision}
								</span>
							</div>
							{flag.review_notes && (
								<div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700">
									{flag.review_notes}
								</div>
							)}
							{flag.reviewer_name && (
								<p className="text-xs text-slate-400">
									Reviewed by {flag.reviewer_name} on {new Date(flag.updated_at).toLocaleString()}
								</p>
							)}
						</div>
					) : (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								Review the event timeline above and submit your decision. Remember:{' '}
								<strong>never auto-reject</strong> a candidate based solely on automated flags.
							</p>
							<div className="flex gap-3">
								<Button
									variant={reviewDecision === 'approved' ? 'default' : 'outline'}
									onClick={() => setReviewDecision('approved')}
									className={`min-h-[44px] flex-1 ${
										reviewDecision === 'approved'
											? 'bg-green-600 hover:bg-green-700'
											: 'border-green-300 text-green-700 hover:bg-green-50'
									}`}
								>
									<CheckCircle className="w-4 h-4 mr-2" />
									Approve — Allow
								</Button>
								<Button
									variant={reviewDecision === 'rejected' ? 'default' : 'outline'}
									onClick={() => setReviewDecision('rejected')}
									className={`min-h-[44px] flex-1 ${
										reviewDecision === 'rejected'
											? 'bg-red-600 hover:bg-red-700'
											: 'border-red-300 text-red-700 hover:bg-red-50'
									}`}
								>
									<XCircle className="w-4 h-4 mr-2" />
									Reject — Disqualify
								</Button>
							</div>
							<div className="space-y-2">
								<label className="text-sm font-medium text-slate-700">Review Notes</label>
								<Textarea
									placeholder="Explain your decision..."
									value={reviewNotes}
									onChange={(e) => setReviewNotes(e.target.value)}
									className="min-h-[100px]"
								/>
							</div>
							<Button
								onClick={submitReview}
								disabled={!reviewDecision || submitting}
								className="min-h-[44px] w-full sm:w-auto"
							>
								{submitting ? (
									<>
										<Loader2 className="w-4 h-4 animate-spin mr-2" />
										Submitting...
									</>
								) : (
									<>Submit Review</>
								)}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
