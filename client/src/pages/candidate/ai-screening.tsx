import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	Clock,
	Gavel,
	History,
	Loader2,
	Scale,
	ShieldAlert,
	Sparkles,
	Target,
	ThumbsDown,
	ThumbsUp,
	TrendingDown,
	TrendingUp,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';

/* ─── Types ─────────────────────────────────────────────────────────────── */

type _FitBreakdown = {
	skills_match: number;
	experience_match: number;
	education_match: number;
	location_match: number;
	salary_match: number;
	culture_fit_estimate: number;
};

type RedFlag = {
	type: string;
	severity: 'high' | 'medium' | 'low';
	description: string;
	follow_up?: string;
};

type CandidateScreening = {
	screening_id: number;
	job_id: number;
	fit_score: number;
	recommendation: 'interview' | 'reject' | 'more_info' | 'hold';
	matched_skills: string[];
	missing_skills: string[];
	strengths: string[];
	concerns: string[];
	red_flags: RedFlag[];
	human_review_status: 'pending' | 'approved' | 'overridden' | 'requested';
	created_at: string;
	job_title: string;
	job_company: string;
};

const recommendationConfig: Record<
	CandidateScreening['recommendation'],
	{
		color: string;
		icon: React.ReactNode;
		label: string;
		bg: string;
		border: string;
	}
> = {
	interview: {
		color: 'text-emerald-600',
		icon: <ThumbsUp className="h-4 w-4" />,
		label: 'Interview Recommended',
		bg: 'bg-emerald-50 dark:bg-emerald-900/20',
		border: 'border-emerald-200 dark:border-emerald-800',
	},
	more_info: {
		color: 'text-amber-600',
		icon: <AlertTriangle className="h-4 w-4" />,
		label: 'More Info Needed',
		bg: 'bg-amber-50 dark:bg-amber-900/20',
		border: 'border-amber-200 dark:border-amber-800',
	},
	hold: {
		color: 'text-orange-600',
		icon: <Clock className="h-4 w-4" />,
		label: 'On Hold',
		bg: 'bg-orange-50 dark:bg-orange-900/20',
		border: 'border-orange-200 dark:border-orange-800',
	},
	reject: {
		color: 'text-red-600',
		icon: <ThumbsDown className="h-4 w-4" />,
		label: 'Not a Fit',
		bg: 'bg-red-50 dark:bg-red-900/20',
		border: 'border-red-200 dark:border-red-800',
	},
};

/* ─── Candidate AI Screening Page ───────────────────────────────────────── */

export function CandidateAiScreeningPage() {
	const navigate = useNavigate();
	const [screenings, setScreenings] = useState<CandidateScreening[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedScreening, setSelectedScreening] = useState<CandidateScreening | null>(null);
	const [requestingReview, setRequestingReview] = useState(false);
	const [showRequestDialog, setShowRequestDialog] = useState(false);
	const [requestReason, setRequestReason] = useState('');
	const [requestError, setRequestError] = useState('');

	const loadScreenings = useCallback(async () => {
		setLoading(true);
		try {
			const data = await apiCall<{
				success: boolean;
				screenings: CandidateScreening[];
				total: number;
				advisory_note: string;
			}>('/candidates/me/screenings');
			setScreenings(data.screenings || []);
		} catch (err) {
			console.error('Failed to load screenings:', err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadScreenings();
	}, [loadScreenings]);

	const handleRequestReview = async () => {
		if (!selectedScreening) return;
		setRequestingReview(true);
		setRequestError('');
		try {
			await apiCall(
				`/candidates/me/screenings/${selectedScreening.screening_id}/request-human-review`,
				{
					method: 'POST',
					body: { reason: requestReason.trim() || undefined },
				},
			);
			// Update local state
			setScreenings((prev) =>
				prev.map((s) =>
					s.screening_id === selectedScreening.screening_id
						? { ...s, human_review_status: 'requested' }
						: s,
				),
			);
			setSelectedScreening((prev) => (prev ? { ...prev, human_review_status: 'requested' } : prev));
			setShowRequestDialog(false);
			setRequestReason('');
		} catch (err: any) {
			console.error('Failed to request review:', err);
			setRequestError(err?.message || 'Failed to request human review. Please try again.');
		} finally {
			setRequestingReview(false);
		}
	};

	if (selectedScreening) {
		return (
			<ScreeningDetail
				screening={selectedScreening}
				onBack={() => setSelectedScreening(null)}
				onRequestReview={() => setShowRequestDialog(true)}
			/>
		);
	}

	return (
		<div className="space-y-6">
			{/* Request Review Dialog */}
			<Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Gavel className="h-5 w-5" />
						Request Human Review
					</DialogTitle>
					<DialogDescription>
						Explain why you believe this AI assessment is inaccurate. A recruiter will review your
						case.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					{requestError && (
						<div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
							{requestError}
						</div>
					)}
					<Textarea
						value={requestReason}
						onChange={(e) => setRequestReason(e.target.value)}
						placeholder="I believe this assessment is inaccurate because..."
						rows={4}
					/>
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setShowRequestDialog(false)}
						disabled={requestingReview}
					>
						Cancel
					</Button>
					<Button onClick={handleRequestReview} disabled={requestingReview}>
						{requestingReview ? (
							<Loader2 className="h-4 w-4 animate-spin mr-2" />
						) : (
							<Gavel className="h-4 w-4 mr-2" />
						)}
						Submit Request
					</Button>
				</DialogFooter>
			</Dialog>

			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-heading text-2xl font-bold">My AI Screenings</h1>
					<p className="text-muted-foreground">
						View AI-generated assessments for your job applications
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={() => navigate('/candidate/jobs')}>
					Browse Jobs
				</Button>
			</div>

			{/* Advisory Banner */}
			<div className="rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/20 p-4 flex items-start gap-3">
				<Scale className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
				<div>
					<p className="text-sm font-medium text-indigo-800 dark:text-indigo-300">
						This is an AI-generated assessment. You may request a human review if you believe it is
						inaccurate.
					</p>
					<p className="text-xs text-indigo-700 dark:text-indigo-400 mt-0.5">
						No candidate has been automatically rejected. All decisions require human confirmation.
					</p>
				</div>
			</div>

			{/* Screenings List */}
			{loading ? (
				<Skeleton count={3} variant="card" />
			) : screenings.length === 0 ? (
				<EmptyState
					icon={Sparkles}
					title="No AI screenings yet"
					description="AI screenings will appear here after a recruiter screens your application."
					action={{
						label: 'View Jobs',
						onClick: () => navigate('/candidate/jobs'),
					}}
				/>
			) : (
				<div className="grid gap-4">
					{screenings.map((screening) => {
						const rec = recommendationConfig[screening.recommendation];
						return (
							<Card
								key={screening.screening_id}
								className="overflow-hidden cursor-pointer hover:shadow-md transition-all"
								onClick={() => setSelectedScreening(screening)}
							>
								<CardContent className="p-4">
									<div className="flex flex-col gap-3">
										<div className="flex items-center justify-between">
											<div>
												<h3 className="font-semibold">{screening.job_title}</h3>
												<p className="text-sm text-muted-foreground">{screening.job_company}</p>
											</div>
											<Badge className={`${rec.bg} ${rec.color} border-0`}>
												{rec.icon}
												<span className="ml-1">{rec.label}</span>
											</Badge>
										</div>
										<div className="flex items-center gap-3 text-sm text-muted-foreground">
											<span>{new Date(screening.created_at).toLocaleDateString()}</span>
											{screening.human_review_status === 'requested' && (
												<Badge variant="outline" className="text-amber-600 border-amber-300">
													<History className="h-3 w-3 mr-1" />
													Review Requested
												</Badge>
											)}
											{screening.human_review_status === 'overridden' && (
												<Badge variant="outline" className="text-indigo-600 border-indigo-300">
													<Gavel className="h-3 w-3 mr-1" />
													Human Override
												</Badge>
											)}
										</div>
										<div className="flex items-center gap-4">
											<div className="flex-1">
												<div className="flex items-center justify-between text-xs mb-1">
													<span>Overall Fit</span>
													<span className="font-semibold">{screening.fit_score}%</span>
												</div>
												<Progress value={screening.fit_score} className="h-2" />
											</div>
											<ArrowRight className="h-4 w-4 text-muted-foreground" />
										</div>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}

/* ─── Score Bar ─────────────────────────────────────────────────────────── */

function _ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-xs">
				<span className="font-medium">{label}</span>
				<span className="font-semibold" style={{ color }}>
					{score}%
				</span>
			</div>
			<div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
				<div
					className="h-full rounded-full transition-all duration-700"
					style={{ width: `${score}%`, backgroundColor: color }}
				/>
			</div>
		</div>
	);
}

/* ─── Screening Detail ──────────────────────────────────────────────────── */

function ScreeningDetail({
	screening,
	onBack,
	onRequestReview,
}: {
	screening: CandidateScreening;
	onBack: () => void;
	onRequestReview: () => void;
}) {
	const rec = recommendationConfig[screening.recommendation];
	const [activeTab, setActiveTab] = useState('overview');

	const canRequestReview =
		screening.human_review_status !== 'requested' && screening.human_review_status !== 'overridden';

	return (
		<div className="space-y-6">
			{/* Back Button */}
			<Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
				<ArrowRight className="h-4 w-4 rotate-180" />
				Back to screenings
			</Button>

			{/* Advisory Banner */}
			<div className="rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/20 p-4 flex items-start gap-3">
				<Scale className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
				<div>
					<p className="text-sm font-medium text-indigo-800 dark:text-indigo-300">
						This is an AI-generated assessment. You may request a human review if you believe it is
						inaccurate.
					</p>
				</div>
			</div>

			{/* Header */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<h1 className="font-heading text-2xl font-bold">{screening.job_title}</h1>
						<Badge className={`${rec.bg} ${rec.color} ${rec.border} border text-sm px-3 py-1`}>
							{rec.icon}
							<span className="ml-1">{rec.label}</span>
						</Badge>
						{screening.human_review_status === 'requested' && (
							<Badge
								variant="outline"
								className="text-amber-600 border-amber-300 text-sm px-3 py-1"
							>
								<History className="h-3.5 w-3.5 mr-1" />
								Review Requested
							</Badge>
						)}
						{screening.human_review_status === 'overridden' && (
							<Badge
								variant="outline"
								className="text-indigo-600 border-indigo-300 text-sm px-3 py-1"
							>
								<Gavel className="h-3.5 w-3.5 mr-1" />
								Human Override
							</Badge>
						)}
					</div>
					<p className="text-muted-foreground">{screening.job_company}</p>
					<p className="text-sm text-muted-foreground mt-1">
						Screened on: <span>{new Date(screening.created_at).toLocaleDateString()}</span>
					</p>
				</div>
				{canRequestReview && (
					<Button
						size="sm"
						variant="outline"
						className="gap-1 text-indigo-600 border-indigo-300 hover:bg-indigo-50 shrink-0"
						onClick={onRequestReview}
					>
						<Gavel className="h-4 w-4" />
						Request Human Review
					</Button>
				)}
			</div>

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="flex-wrap h-auto">
					<TabsTrigger value="overview" className="gap-1">
						<Sparkles className="h-3.5 w-3.5" />
						Overview
					</TabsTrigger>
					<TabsTrigger value="skills" className="gap-1">
						<Target className="h-3.5 w-3.5" />
						Skills
					</TabsTrigger>
				</TabsList>

				{/* ── Overview Tab ── */}
				<TabsContent value="overview" className="mt-6 space-y-6">
					{/* Fit Score */}
					<Card>
						<CardContent className="p-6">
							<div className="flex flex-col sm:flex-row items-center gap-6">
								<div className="text-center">
									<div
										className={`text-5xl font-bold ${
											screening.fit_score >= 80
												? 'text-emerald-600'
												: screening.fit_score >= 60
													? 'text-amber-600'
													: 'text-red-600'
										}`}
									>
										{screening.fit_score}%
									</div>
									<p className="text-sm text-muted-foreground mt-1">Overall Fit Score</p>
								</div>
								<div className="flex-1 w-full">
									<Progress value={screening.fit_score} className="h-3" />
									<p className="text-xs text-muted-foreground mt-2">
										This score represents how well your profile matches the job requirements based
										on AI analysis.
									</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Strengths & Concerns */}
					<div className="grid gap-6 lg:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle className="text-lg flex items-center gap-2">
									<TrendingUp className="h-5 w-5 text-emerald-500" />
									Key Strengths
								</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className="space-y-3">
									{screening.strengths?.map((item) => (
										<li key={item} className="flex items-start gap-2 text-sm">
											<CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
											<span>{item}</span>
										</li>
									))}
									{(!screening.strengths || screening.strengths.length === 0) && (
										<p className="text-sm text-muted-foreground italic">No strengths recorded.</p>
									)}
								</ul>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className="text-lg flex items-center gap-2">
									<TrendingDown className="h-5 w-5 text-amber-500" />
									Areas for Improvement
								</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className="space-y-3">
									{screening.concerns?.map((item) => (
										<li key={item} className="flex items-start gap-2 text-sm">
											<AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
											<span>{item}</span>
										</li>
									))}
									{(!screening.concerns || screening.concerns.length === 0) && (
										<p className="text-sm text-muted-foreground italic">No concerns recorded.</p>
									)}
								</ul>
							</CardContent>
						</Card>
					</div>

					{/* Red Flags */}
					{screening.red_flags && screening.red_flags.length > 0 && (
						<Card className="border-red-200 dark:border-red-800">
							<CardHeader>
								<CardTitle className="text-lg flex items-center gap-2 text-red-700 dark:text-red-400">
									<ShieldAlert className="h-5 w-5" />
									Noted Items
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								{screening.red_flags.map((flag, i) => (
									<div
										key={i}
										className={`flex items-start gap-3 rounded-lg border p-3 ${
											flag.severity === 'high'
												? 'bg-red-50 border-red-200'
												: flag.severity === 'medium'
													? 'bg-amber-50 border-amber-200'
													: 'bg-orange-50 border-orange-200'
										}`}
									>
										<AlertTriangle
											className={`h-4 w-4 shrink-0 mt-0.5 ${
												flag.severity === 'high'
													? 'text-red-500'
													: flag.severity === 'medium'
														? 'text-amber-500'
														: 'text-orange-500'
											}`}
										/>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium">{flag.type}</p>
											<p className="text-xs text-muted-foreground mt-0.5">{flag.description}</p>
											{flag.follow_up && (
												<p className="text-xs text-muted-foreground/70 mt-1 italic">
													Follow-up: {flag.follow_up}
												</p>
											)}
										</div>
										<Badge variant="outline" className="text-[10px] shrink-0">
											{flag.severity}
										</Badge>
									</div>
								))}
							</CardContent>
						</Card>
					)}
				</TabsContent>

				{/* ── Skills Tab ── */}
				<TabsContent value="skills" className="mt-6 space-y-6">
					<Card>
						<CardHeader>
							<CardTitle className="text-lg flex items-center gap-2">
								<Target className="h-5 w-5 text-indigo-500" />
								Skill Match
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-6">
							<div>
								<div className="flex items-center gap-2 mb-3">
									<CheckCircle2 className="h-4 w-4 text-emerald-500" />
									<p className="text-sm font-medium">
										Matched Skills{' '}
										<span className="text-muted-foreground font-normal">
											({screening.matched_skills?.length || 0})
										</span>
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									{screening.matched_skills?.map((skill) => (
										<Badge
											key={skill}
											variant="outline"
											className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 font-normal text-xs py-1 px-2"
										>
											<CheckCircle2 className="h-3 w-3" />
											{skill}
										</Badge>
									))}
								</div>
							</div>
							<Separator />
							<div>
								<div className="flex items-center gap-2 mb-3">
									<XCircle className="h-4 w-4 text-red-500" />
									<p className="text-sm font-medium">
										Missing Skills{' '}
										<span className="text-muted-foreground font-normal">
											({screening.missing_skills?.length || 0})
										</span>
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									{screening.missing_skills?.map((skill) => (
										<Badge
											key={skill}
											variant="outline"
											className="bg-red-50 text-red-700 border-red-200 gap-1 font-normal text-xs py-1 px-2"
										>
											<XCircle className="h-3 w-3" />
											{skill}
										</Badge>
									))}
								</div>
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}
