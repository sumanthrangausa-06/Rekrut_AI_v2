import {
	AlertCircle,
	CheckCircle,
	ChevronLeft,
	Clock,
	Eye,
	EyeOff,
	FileText,
	Lock,
	MessageSquare,
	Save,
	Send,
	Star,
	Users,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

interface PanelMember {
	id: number;
	user_id: number;
	panel_id: number;
	role: string;
	status: string;
	name: string;
	email: string;
	avatar_url?: string;
	joined_at?: string;
}

interface Panel {
	id: number;
	job_id: number;
	interview_session_id: number | null;
	status: string;
	created_at: string;
	job_title: string;
	members: PanelMember[];
}

interface Note {
	id: number;
	content: string;
	visibility: string;
	created_at: string;
	author_name: string;
	author_avatar?: string;
}

interface Criterion {
	id: number;
	criterion_name: string;
	description?: string;
	weight: number;
	required: boolean;
	sort_order: number;
}

interface ScorecardItem {
	criterion_name: string;
	rating: number | null;
	comment: string | null;
	weight: number;
}

interface Scorecard {
	id: number;
	interviewer_id: number;
	interviewer_name: string;
	status: string;
	overall_recommendation: string | null;
	submitted_at: string | null;
	items?: ScorecardItem[];
}

interface AggregateResult {
	aggregate_recommendation: string;
	avg_score: number;
	distribution: Record<string, number>;
	criteria_averages: Array<{ criterion_name: string; avg_rating: number; rating_count: number }>;
	total_members: number;
	submitted_count: number;
}

const recommendationConfig: Record<
	string,
	{ label: string; color: string; badge: 'default' | 'success' | 'warning' | 'destructive' }
> = {
	strong_hire: { label: 'Strong Hire', color: 'text-green-600', badge: 'success' },
	hire: { label: 'Hire', color: 'text-green-500', badge: 'success' },
	lean_hire: { label: 'Lean Hire', color: 'text-blue-600', badge: 'default' },
	neutral: { label: 'Neutral', color: 'text-gray-600', badge: 'default' },
	lean_no_hire: { label: 'Lean No Hire', color: 'text-yellow-600', badge: 'warning' },
	no_hire: { label: 'No Hire', color: 'text-orange-600', badge: 'warning' },
	strong_no_hire: { label: 'Strong No Hire', color: 'text-red-600', badge: 'destructive' },
};

const roleBadge: Record<string, { label: string; color: string }> = {
	lead: { label: 'Lead', color: 'bg-indigo-100 text-indigo-700' },
	panelist: { label: 'Panelist', color: 'bg-blue-100 text-blue-700' },
	hiring_manager: { label: 'Hiring Manager', color: 'bg-green-100 text-green-700' },
	observer: { label: 'Observer', color: 'bg-gray-100 text-gray-700' },
};

function RatingStars({
	rating,
	onChange,
	readonly,
	size = 'md',
}: {
	rating: number;
	onChange?: (r: number) => void;
	readonly?: boolean;
	size?: 'sm' | 'md' | 'lg';
}) {
	const starSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';
	return (
		<div className="flex gap-0.5">
			{[1, 2, 3, 4, 5].map((n) => (
				<button
					key={n}
					onClick={() => onChange?.(n)}
					disabled={readonly}
					className={`p-0.5 min-h-[32px] ${readonly ? 'cursor-default' : 'cursor-pointer'}`}
					type="button"
				>
					<Star
						className={`${starSize} transition-colors ${
							rating >= n ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'
						}`}
					/>
				</button>
			))}
		</div>
	);
}

export function RecruiterPanelRoomPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { user } = useAuth();
	const panelId = Number(id);

	const [panel, setPanel] = useState<Panel | null>(null);
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
	const [activeTab, setActiveTab] = useState('participants');

	// Notes
	const [sharedNotes, setSharedNotes] = useState<Note[]>([]);
	const [privateNotes, setPrivateNotes] = useState<Note[]>([]);
	const [noteInput, setNoteInput] = useState('');
	const [noteVisibility, setNoteVisibility] = useState<'shared' | 'private'>('shared');
	const [sendingNote, setSendingNote] = useState(false);

	// Scorecard
	const [criteria, setCriteria] = useState<Criterion[]>([]);
	const [myScorecard, setMyScorecard] = useState<{ scorecard: any; items: ScorecardItem[] } | null>(
		null,
	);
	const [scorecardItems, setScorecardItems] = useState<
		Record<string, { rating: number; comment: string }>
	>({});
	const [overallRec, setOverallRec] = useState('');
	const [savingScorecard, setSavingScorecard] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);

	// All scorecards (revealed after all submit)
	const [allScorecards, setAllScorecards] = useState<{
		revealed: boolean;
		scorecards: Scorecard[];
		total_members: number;
		submitted_count: number;
	} | null>(null);
	const [showAggregate, setShowAggregate] = useState(false);
	const [aggregate, setAggregate] = useState<AggregateResult | null>(null);
	const [loadingAggregate, setLoadingAggregate] = useState(false);

	// Poll interval ref
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (message) {
			const t = setTimeout(() => setMessage(null), 4000);
			return () => clearTimeout(t);
		}
	}, [message]);

	const loadPanel = useCallback(async () => {
		try {
			const res = await apiCall<{ panel: Panel }>(`/panels/${panelId}`);
			setPanel(res.panel);
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to load panel' });
		} finally {
			setLoading(false);
		}
	}, [panelId]);

	const loadNotes = useCallback(async () => {
		try {
			const [sharedRes, privateRes] = await Promise.all([
				apiCall<{ notes: Note[] }>(`/panels/${panelId}/notes`),
				apiCall<{ notes: Note[] }>(`/panels/${panelId}/private-notes`),
			]);
			setSharedNotes(sharedRes.notes || []);
			setPrivateNotes(privateRes.notes || []);
		} catch (err) {
			// Silently ignore — panel may not be accessible yet
			console.error('Notes poll error:', err);
		}
	}, [panelId]);

	const loadCriteriaAndScorecard = useCallback(async () => {
		if (!panel) return;
		try {
			// Load criteria for this job
			const criteriaRes = await apiCall<{ criteria: Criterion[] }>(
				`/panels/criteria/${panel.job_id}`,
			);
			setCriteria(criteriaRes.criteria || []);

			// Load my scorecard
			const myRes = await apiCall<{ scorecard: any; items: ScorecardItem[] }>(
				`/panels/${panelId}/my-scorecard`,
			);
			setMyScorecard(myRes);
			setSubmitted(myRes.scorecard?.status === 'submitted');
			setOverallRec(myRes.scorecard?.overall_recommendation || '');

			// Initialize scorecard items from existing data
			const itemsMap: Record<string, { rating: number; comment: string }> = {};
			for (const item of myRes.items || []) {
				if (item.criterion_name) {
					itemsMap[item.criterion_name] = {
						rating: item.rating || 0,
						comment: item.comment || '',
					};
				}
			}
			// Pre-fill with default ratings for criteria that don't have items yet
			for (const c of criteriaRes.criteria || []) {
				if (!itemsMap[c.criterion_name]) {
					itemsMap[c.criterion_name] = { rating: 0, comment: '' };
				}
			}
			setScorecardItems(itemsMap);
		} catch (err) {
			console.error('Load criteria error:', err);
		}
	}, [panel, panelId]);

	const loadAllScorecards = useCallback(async () => {
		try {
			const res = await apiCall<{
				revealed: boolean;
				scorecards: Scorecard[];
				total_members: number;
				submitted_count: number;
			}>(`/panels/${panelId}/scorecards`);
			setAllScorecards(res);
		} catch (err: any) {
			// 403 expected when not all submitted
			console.error('Scorecards error:', err);
		}
	}, [panelId]);

	const loadAggregate = useCallback(async () => {
		setLoadingAggregate(true);
		try {
			const res = await apiCall<AggregateResult>(`/panels/${panelId}/aggregate`);
			setAggregate(res);
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Aggregate not available yet' });
		} finally {
			setLoadingAggregate(false);
		}
	}, [panelId]);

	useEffect(() => {
		loadPanel();
	}, [loadPanel]);

	useEffect(() => {
		if (panel) {
			loadCriteriaAndScorecard();
			loadNotes();
			loadAllScorecards();
		}
	}, [panel, loadCriteriaAndScorecard, loadNotes, loadAllScorecards]);

	// Poll notes every 5 seconds
	useEffect(() => {
		if (!panel) return;
		pollRef.current = setInterval(() => {
			loadNotes();
		}, 5000);
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [panel, loadNotes]);

	async function sendNote() {
		if (!noteInput.trim()) return;
		setSendingNote(true);
		try {
			await apiCall(`/panels/${panelId}/notes`, {
				method: 'POST',
				body: { content: noteInput.trim(), visibility: noteVisibility },
			});
			setNoteInput('');
			await loadNotes();
			setMessage({ type: 'success', text: 'Note added' });
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to add note' });
		} finally {
			setSendingNote(false);
		}
	}

	function updateCriterionRating(criterionName: string, rating: number) {
		setScorecardItems((prev) => ({
			...prev,
			[criterionName]: { ...(prev[criterionName] || { comment: '' }), rating },
		}));
	}

	function updateCriterionComment(criterionName: string, comment: string) {
		setScorecardItems((prev) => ({
			...prev,
			[criterionName]: { ...(prev[criterionName] || { rating: 0 }), comment },
		}));
	}

	async function saveScorecard() {
		setSavingScorecard(true);
		try {
			const items = Object.entries(scorecardItems).map(([criterion_name, data]) => ({
				criterion_name,
				rating: data.rating > 0 ? data.rating : null,
				comment: data.comment || null,
				weight: criteria.find((c) => c.criterion_name === criterion_name)?.weight || 1,
			}));
			await apiCall(`/panels/${panelId}/scorecards`, {
				method: 'POST',
				body: {
					items,
					overall_recommendation: overallRec || undefined,
				},
			});
			setMessage({ type: 'success', text: 'Scorecard saved' });
			await loadCriteriaAndScorecard();
			await loadAllScorecards();
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to save scorecard' });
		} finally {
			setSavingScorecard(false);
		}
	}

	async function submitScorecard() {
		setSubmitting(true);
		try {
			// First save any pending changes
			await saveScorecard();
			await apiCall(`/panels/${panelId}/scorecards/submit`, { method: 'POST' });
			setSubmitted(true);
			setMessage({ type: 'success', text: 'Scorecard submitted!' });
			await loadCriteriaAndScorecard();
			await loadAllScorecards();
		} catch (err: any) {
			setMessage({ type: 'error', text: err.message || 'Failed to submit scorecard' });
		} finally {
			setSubmitting(false);
		}
	}

	async function openAggregate() {
		setShowAggregate(true);
		await loadAggregate();
	}

	const allSubmitted = allScorecards?.revealed === true;
	const mySubmitted = myScorecard?.scorecard?.status === 'submitted' || submitted;

	if (loading) {
		return (
			<div className="space-y-6 px-4 sm:px-6">
				<div className="flex items-center gap-2">
					<div className="h-8 w-8 rounded bg-muted animate-pulse" />
					<div className="h-6 w-48 rounded bg-muted animate-pulse" />
				</div>
				<Skeleton variant="card" />
				<Skeleton variant="list" count={3} />
			</div>
		);
	}

	if (!panel) {
		return (
			<div className="px-4 sm:px-6">
				<EmptyState
					icon={AlertCircle}
					title="Panel not found"
					description="The panel you are looking for does not exist or you do not have access."
					action={{ label: 'Back to Panels', href: '/recruiter/panels' }}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-6 px-4 sm:px-6">
			{/* Toast */}
			{message && (
				<div
					className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
						message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-destructive text-white'
					}`}
				>
					{message.type === 'success' ? (
						<CheckCircle className="h-4 w-4" />
					) : (
						<AlertCircle className="h-4 w-4" />
					)}
					{message.text}
				</div>
			)}

			{/* Header */}
			<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => navigate('/recruiter/panels')}
						className="min-h-[44px] min-w-[44px] p-2"
					>
						<ChevronLeft className="h-5 w-5" />
					</Button>
					<div>
						<h1 className="text-2xl font-heading font-bold">Panel Room #{panel.id}</h1>
						<p className="text-muted-foreground text-sm">
							{panel.job_title} • {panel.members?.filter((m) => m.status === 'joined').length || 0}{' '}
							joined
						</p>
					</div>
				</div>
				<div className="flex gap-2 flex-wrap">
					{!mySubmitted && (
						<Button onClick={submitScorecard} disabled={submitting} className="min-h-[44px]">
							<Send className="h-4 w-4 mr-2" />
							{submitting ? 'Submitting...' : 'Submit Scorecard'}
						</Button>
					)}
					<Button
						variant="outline"
						onClick={openAggregate}
						disabled={!allSubmitted}
						className="min-h-[44px]"
					>
						<Eye className="h-4 w-4 mr-2" />
						{allSubmitted ? 'View Results' : 'Waiting...'}
					</Button>
				</div>
			</div>

			{/* Waiting banner */}
			{!allSubmitted && mySubmitted && (
				<div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800">
					<Clock className="h-4 w-4 shrink-0" />
					<p className="text-sm">
						Your scorecard is submitted. Waiting for{' '}
						{(allScorecards?.total_members || panel.members?.length || 0) -
							(allScorecards?.submitted_count || 0)}{' '}
						more panel member(s) to submit before results are revealed.
					</p>
				</div>
			)}

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="flex-wrap h-auto">
					<TabsTrigger value="participants">
						<Users className="h-3.5 w-3.5 mr-1" /> Participants
					</TabsTrigger>
					<TabsTrigger value="notes">
						<MessageSquare className="h-3.5 w-3.5 mr-1" /> Shared Notes
						{sharedNotes.length > 0 && (
							<span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">
								{sharedNotes.length}
							</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="private-notes">
						<Lock className="h-3.5 w-3.5 mr-1" /> Private Notes
					</TabsTrigger>
					<TabsTrigger value="scorecard">
						<Star className="h-3.5 w-3.5 mr-1" /> Scorecard
						{mySubmitted && <CheckCircle className="h-3 w-3 ml-1 text-green-600" />}
					</TabsTrigger>
				</TabsList>

				{/* Participants tab */}
				<TabsContent value="participants">
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{panel.members?.map((member) => {
							const role = roleBadge[member.role] || roleBadge.panelist;
							const isCurrentUser = member.user_id === user?.id;
							return (
								<Card key={member.id} className={isCurrentUser ? 'border-indigo-300' : ''}>
									<CardContent className="p-4">
										<div className="flex items-center gap-3">
											<div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-medium text-indigo-700 shrink-0">
												{member.name?.charAt(0)?.toUpperCase() || '?'}
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 flex-wrap">
													<p className="font-medium text-sm truncate">
														{member.name}
														{isCurrentUser && (
															<span className="text-xs text-muted-foreground ml-1">(You)</span>
														)}
													</p>
												</div>
												<p className="text-xs text-muted-foreground truncate">{member.email}</p>
											</div>
											<div className="flex flex-col gap-1 items-end">
												<Badge className={`text-xs ${role.color}`}>{role.label}</Badge>
												<Badge
													variant={member.status === 'joined' ? 'success' : 'secondary'}
													className="text-xs"
												>
													{member.status}
												</Badge>
											</div>
										</div>
									</CardContent>
								</Card>
							);
						})}
					</div>
				</TabsContent>

				{/* Shared Notes tab */}
				<TabsContent value="notes">
					<div className="space-y-4">
						{/* Note input */}
						<Card>
							<CardContent className="p-4 space-y-3">
								<div className="flex gap-2 flex-wrap">
									<button
										onClick={() => setNoteVisibility('shared')}
										className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-h-[36px] ${
											noteVisibility === 'shared'
												? 'bg-indigo-100 text-indigo-700'
												: 'bg-muted text-muted-foreground'
										}`}
									>
										<MessageSquare className="h-3.5 w-3.5" /> Shared
									</button>
									<button
										onClick={() => setNoteVisibility('private')}
										className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-h-[36px] ${
											noteVisibility === 'private'
												? 'bg-amber-100 text-amber-700'
												: 'bg-muted text-muted-foreground'
										}`}
									>
										<Lock className="h-3.5 w-3.5" /> Private
									</button>
								</div>
								<Textarea
									value={noteInput}
									onChange={(e) => setNoteInput(e.target.value)}
									placeholder={`Write a ${noteVisibility} note...`}
									rows={3}
								/>
								<div className="flex justify-end">
									<Button
										onClick={sendNote}
										disabled={sendingNote || !noteInput.trim()}
										className="min-h-[44px]"
									>
										{sendingNote ? 'Saving...' : 'Add Note'}
									</Button>
								</div>
							</CardContent>
						</Card>

						{/* Shared notes list */}
						{sharedNotes.length === 0 ? (
							<EmptyState
								icon={MessageSquare}
								title="No shared notes yet"
								description="Add notes to share with the panel. Notes update every 5 seconds."
							/>
						) : (
							<div className="space-y-3">
								{sharedNotes.map((note) => (
									<Card key={note.id}>
										<CardContent className="p-4">
											<div className="flex items-start gap-3">
												<div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-medium text-indigo-700 shrink-0">
													{note.author_name?.charAt(0)?.toUpperCase() || '?'}
												</div>
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2 flex-wrap">
														<span className="text-sm font-medium">{note.author_name}</span>
														<span className="text-xs text-muted-foreground">
															{new Date(note.created_at).toLocaleString()}
														</span>
														<Badge variant="secondary" className="text-xs">
															<MessageSquare className="h-3 w-3 mr-0.5" /> Shared
														</Badge>
													</div>
													<p className="text-sm mt-1 whitespace-pre-wrap">{note.content}</p>
												</div>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</div>
				</TabsContent>

				{/* Private Notes tab */}
				<TabsContent value="private-notes">
					<div className="space-y-4">
						<div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800">
							<Lock className="h-4 w-4 shrink-0" />
							<p className="text-sm">These notes are only visible to you.</p>
						</div>

						{/* Note input (redirects to shared notes composer) */}
						<Card>
							<CardContent className="p-4 space-y-3">
								<div className="flex gap-2 flex-wrap">
									<button
										onClick={() => {
											setNoteVisibility('private');
											setActiveTab('notes');
										}}
										className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-amber-100 text-amber-700 min-h-[36px]"
									>
										<Lock className="h-3.5 w-3.5" /> Switch to Private Note Composer
									</button>
								</div>
							</CardContent>
						</Card>

						{privateNotes.length === 0 ? (
							<EmptyState
								icon={Lock}
								title="No private notes yet"
								description="Your private notes will appear here. Only you can see them."
							/>
						) : (
							<div className="space-y-3">
								{privateNotes.map((note) => (
									<Card key={note.id}>
										<CardContent className="p-4">
											<div className="flex items-start gap-3">
												<div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center text-xs font-medium text-amber-700 shrink-0">
													{note.author_name?.charAt(0)?.toUpperCase() || '?'}
												</div>
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2 flex-wrap">
														<span className="text-sm font-medium">{note.author_name}</span>
														<span className="text-xs text-muted-foreground">
															{new Date(note.created_at).toLocaleString()}
														</span>
														<Badge className="text-xs bg-amber-100 text-amber-700">
															<Lock className="h-3 w-3 mr-0.5" /> Private
														</Badge>
													</div>
													<p className="text-sm mt-1 whitespace-pre-wrap">{note.content}</p>
												</div>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						)}
					</div>
				</TabsContent>

				{/* Scorecard tab */}
				<TabsContent value="scorecard">
					<div className="space-y-4">
						{/* Scorecard status banner */}
						{mySubmitted ? (
							<div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-800">
								<CheckCircle className="h-4 w-4 shrink-0" />
								<p className="text-sm font-medium">
									Your scorecard has been submitted.{' '}
									{allSubmitted
										? 'All panelists have submitted — view results below.'
										: 'Waiting for other panelists to submit.'}
								</p>
							</div>
						) : (
							<div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-blue-800">
								<FileText className="h-4 w-4 shrink-0" />
								<p className="text-sm">
									Rate each criterion and provide comments. Your scores will be hidden from others
									until everyone submits.
								</p>
							</div>
						)}

						{/* Overall recommendation */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">Overall Recommendation</CardTitle>
							</CardHeader>
							<CardContent className="p-4">
								{mySubmitted ? (
									<div className="flex items-center gap-2">
										<span className="text-sm">Your recommendation:</span>
										{overallRec && (
											<Badge variant={recommendationConfig[overallRec]?.badge || 'default'}>
												{recommendationConfig[overallRec]?.label || overallRec}
											</Badge>
										)}
									</div>
								) : (
									<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
										{Object.entries(recommendationConfig).map(([key, config]) => (
											<button
												key={key}
												onClick={() => setOverallRec(key)}
												className={`p-2 rounded-lg border text-sm font-medium transition-colors min-h-[44px] ${
													overallRec === key
														? 'border-indigo-500 bg-indigo-50 text-indigo-700'
														: 'border-border hover:bg-muted/50'
												}`}
											>
												{config.label}
											</button>
										))}
									</div>
								)}
							</CardContent>
						</Card>

						{/* Criteria ratings */}
						{criteria.length === 0 ? (
							<EmptyState
								icon={Star}
								title="No criteria defined"
								description="Configure scorecard criteria for this job first."
								action={{
									label: 'Configure Criteria',
									onClick: () => navigate(`/recruiter/jobs/${panel.job_id}/panel-criteria`),
								}}
							/>
						) : (
							<div className="space-y-3">
								{criteria.map((criterion) => {
									const item = scorecardItems[criterion.criterion_name] || {
										rating: 0,
										comment: '',
									};
									return (
										<Card key={criterion.id}>
											<CardContent className="p-4 space-y-3">
												<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
													<div>
														<div className="flex items-center gap-2 flex-wrap">
															<h4 className="font-medium text-sm">{criterion.criterion_name}</h4>
															{criterion.required && (
																<Badge variant="destructive" className="text-xs">
																	Required
																</Badge>
															)}
															<Badge variant="secondary" className="text-xs">
																Weight: {criterion.weight}
															</Badge>
														</div>
														{criterion.description && (
															<p className="text-xs text-muted-foreground mt-0.5">
																{criterion.description}
															</p>
														)}
													</div>
													{!mySubmitted && (
														<RatingStars
															rating={item.rating}
															onChange={(r) => updateCriterionRating(criterion.criterion_name, r)}
														/>
													)}
													{mySubmitted && item.rating > 0 && (
														<RatingStars rating={item.rating} readonly />
													)}
												</div>
												{!mySubmitted && (
													<Textarea
														value={item.comment}
														onChange={(e) =>
															updateCriterionComment(criterion.criterion_name, e.target.value)
														}
														placeholder="Add a comment..."
														rows={2}
													/>
												)}
												{mySubmitted && item.comment && (
													<p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">
														{item.comment}
													</p>
												)}
											</CardContent>
										</Card>
									);
								})}
							</div>
						)}

						{/* Save button */}
						{!mySubmitted && criteria.length > 0 && (
							<div className="flex gap-2 justify-end">
								<Button
									onClick={saveScorecard}
									disabled={savingScorecard}
									variant="outline"
									className="min-h-[44px]"
								>
									<Save className="h-4 w-4 mr-2" />
									{savingScorecard ? 'Saving...' : 'Save Draft'}
								</Button>
								<Button onClick={submitScorecard} disabled={submitting} className="min-h-[44px]">
									<Send className="h-4 w-4 mr-2" />
									{submitting ? 'Submitting...' : 'Submit Scorecard'}
								</Button>
							</div>
						)}
					</div>
				</TabsContent>
			</Tabs>

			{/* Aggregate Results Dialog */}
			<Dialog open={showAggregate} onClose={() => setShowAggregate(false)}>
				<DialogHeader>
					<DialogTitle>Panel Aggregate Results</DialogTitle>
					<DialogDescription>
						Average scores and recommendation across all panelists
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 mt-4 max-h-[70vh] overflow-y-auto">
					{loadingAggregate ? (
						<div className="space-y-3">
							<Skeleton variant="card" />
							<Skeleton variant="list" />
						</div>
					) : aggregate ? (
						<>
							{/* Overall recommendation */}
							<div className="p-4 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg border border-indigo-100">
								<div className="flex items-center justify-between mb-2">
									<span className="font-semibold text-lg">Aggregate Recommendation</span>
									<Badge
										variant={
											recommendationConfig[aggregate.aggregate_recommendation]?.badge || 'default'
										}
										className="text-sm"
									>
										{recommendationConfig[aggregate.aggregate_recommendation]?.label ||
											aggregate.aggregate_recommendation}
									</Badge>
								</div>
								<div className="text-3xl font-bold text-indigo-700">
									{aggregate.avg_score > 0 ? '+' : ''}
									{aggregate.avg_score}
								</div>
								<p className="text-xs text-muted-foreground mt-1">
									Based on {aggregate.submitted_count} of {aggregate.total_members} panelists
								</p>

								{/* Distribution */}
								<div className="mt-3 space-y-1">
									{Object.entries(aggregate.distribution).map(([rec, count]) => (
										<div key={rec} className="flex items-center gap-2 text-sm">
											<span className="w-24 truncate">
												{recommendationConfig[rec]?.label || rec}
											</span>
											<div className="flex-1 h-2 bg-white rounded-full overflow-hidden">
												<div
													className="h-full bg-indigo-500 rounded-full"
													style={{
														width: `${(count / aggregate.submitted_count) * 100}%`,
													}}
												/>
											</div>
											<span className="text-xs text-muted-foreground w-6 text-right">{count}</span>
										</div>
									))}
								</div>
							</div>

							{/* Criteria averages */}
							{aggregate.criteria_averages.length > 0 && (
								<div>
									<h4 className="font-medium text-sm mb-2">Average per Criterion</h4>
									<div className="space-y-2">
										{aggregate.criteria_averages.map((ca) => (
											<div key={ca.criterion_name}>
												<div className="flex items-center justify-between text-sm mb-1">
													<span>{ca.criterion_name}</span>
													<span className="font-medium">{ca.avg_rating.toFixed(1)} / 5</span>
												</div>
												<div className="h-2 bg-muted rounded-full overflow-hidden">
													<div
														className="h-full bg-indigo-500 rounded-full"
														style={{
															width: `${(ca.avg_rating / 5) * 100}%`,
														}}
													/>
												</div>
											</div>
										))}
									</div>
								</div>
							)}

							{/* Individual scorecards */}
							{allScorecards?.revealed && allScorecards.scorecards.length > 0 && (
								<div>
									<h4 className="font-medium text-sm mb-2">Individual Scorecards</h4>
									<div className="space-y-2">
										{allScorecards.scorecards.map((sc) => (
											<Card key={sc.id}>
												<CardContent className="p-3">
													<div className="flex items-center justify-between">
														<span className="text-sm font-medium">{sc.interviewer_name}</span>
														{sc.overall_recommendation && (
															<Badge
																variant={
																	recommendationConfig[sc.overall_recommendation]?.badge ||
																	'default'
																}
																className="text-xs"
															>
																{recommendationConfig[sc.overall_recommendation]?.label ||
																	sc.overall_recommendation}
															</Badge>
														)}
													</div>
													{sc.items && sc.items.length > 0 && (
														<div className="mt-2 flex flex-wrap gap-1">
															{sc.items
																.filter((i) => i.rating != null)
																.map((item) => (
																	<Badge
																		key={item.criterion_name}
																		variant="secondary"
																		className="text-xs"
																	>
																		{item.criterion_name}: {item.rating}
																	</Badge>
																))}
														</div>
													)}
												</CardContent>
											</Card>
										))}
									</div>
								</div>
							)}
						</>
					) : (
						<div className="p-4 bg-muted rounded-lg text-center">
							<p className="text-sm text-muted-foreground">
								Aggregate results not available yet. All panelists must submit first.
							</p>
						</div>
					)}
				</div>
				<div className="flex justify-end mt-4">
					<Button
						variant="outline"
						onClick={() => setShowAggregate(false)}
						className="min-h-[44px]"
					>
						Close
					</Button>
				</div>
			</Dialog>
		</div>
	);
}
