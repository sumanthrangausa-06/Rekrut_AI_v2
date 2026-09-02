import {
	AlertTriangle,
	ArrowLeft,
	CheckCircle2,
	Clock,
	Loader2,
	MessageSquare,
	Shield,
	Star,
	TrendingDown,
	TrendingUp,
	X,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apiCall } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────

interface V1Score {
	total_score: number;
	verification: number;
	job_authenticity: number;
	hiring_ratio: number;
	feedback: number;
	behavior: number;
	tier: string;
	tier_label: string;
	tier_color: string;
}

interface V2Factor {
	type: string;
	score: number;
	max: number;
	label: string;
	description: string;
	data_sufficient: boolean;
}

interface V2Recommendation {
	priority: 'high' | 'medium' | 'low';
	factor: string;
	title: string;
	current_score: number;
	max_score: number;
	tip: string;
	potential_gain: number;
}

interface ScoreHistoryItem {
	previous_score: number;
	new_score: number;
	change_amount: number;
	change_reason: string;
	created_at: string;
}

interface BreakdownResponse {
	success: boolean;
	current: V1Score;
	v2: {
		total_score: number;
		v1_score: number;
		v2_score: number;
		employee_satisfaction: number;
		interview_experience: number;
		offer_acceptance_rate: number;
		time_to_hire: number;
		response_rate: number;
		salary_competitiveness: number;
		diversity_metrics: number;
		career_growth: number;
		tier: string;
		tier_label: string;
		tier_color: string;
		data_sufficiency?: {
			overall: number;
			factors: Record<string, boolean>;
		};
	};
	breakdown: Array<{
		type: string;
		score: number;
		max: number;
		label: string;
		description: string;
	}>;
	v2_breakdown: V2Factor[];
	recommendations: Array<{
		type: string;
		priority: 'high' | 'medium' | 'low';
		title: string;
		description: string;
		potential_gain: number;
	}>;
	v2_recommendations: V2Recommendation[];
	history: ScoreHistoryItem[];
	analytics: {
		active_jobs: number;
		total_applications: number;
		interviews: number;
		offers: number;
		hires: number;
	};
}

type ToastType = 'success' | 'error' | 'info';

interface Toast {
	id: string;
	message: string;
	type: ToastType;
}

function ToastContainer({
	toasts,
	onDismiss,
}: {
	toasts: Toast[];
	onDismiss: (id: string) => void;
}) {
	return (
		<div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg animate-in slide-in-from-right fade-in duration-200 ${
						toast.type === 'success'
							? 'bg-emerald-50 border-emerald-200 text-emerald-800'
							: toast.type === 'error'
								? 'bg-red-50 border-red-200 text-red-800'
								: 'bg-blue-50 border-blue-200 text-blue-800'
					}`}
				>
					{toast.type === 'success' ? (
						<CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-600" />
					) : toast.type === 'error' ? (
						<XCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-600" />
					) : (
						<AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-blue-600" />
					)}
					<p className="text-sm flex-1">{toast.message}</p>
					<button type="button"
						onClick={() => onDismiss(toast.id)}
						className="shrink-0 text-muted-foreground hover:text-foreground min-h-[28px] min-w-[28px] flex items-center justify-center rounded"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			))}
		</div>
	);
}

// ─── Helpers ────────────────────────────────────────────────

function scoreColorClass(score: number, max: number): string {
	const pct = max > 0 ? score / max : 0;
	if (pct >= 0.8) return 'text-green-400';
	if (pct >= 0.5) return 'text-yellow-400';
	return 'text-red-400';
}

function _progressColorClass(score: number, max: number): string {
	const pct = max > 0 ? score / max : 0;
	if (pct >= 0.8) return 'bg-green-500';
	if (pct >= 0.5) return 'bg-yellow-500';
	return 'bg-red-500';
}

function tierBadgeClass(tier: string): string {
	switch (tier) {
		case 'exceptional':
			return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
		case 'excellent':
			return 'bg-green-500/20 text-green-400 border-green-500/30';
		case 'trusted':
			return 'bg-lime-500/20 text-lime-400 border-lime-500/30';
		case 'good':
			return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
		case 'building':
			return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
		default:
			return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
	}
}

const factorIcons: Record<string, typeof Shield> = {
	verification: Shield,
	job_authenticity: CheckCircle2,
	hiring_ratio: TrendingUp,
	feedback: Star,
	behavior: Clock,
	employee_satisfaction: Star,
	interview_experience: MessageSquare,
	offer_acceptance_rate: CheckCircle2,
	time_to_hire: Clock,
	response_rate: MessageSquare,
	salary_competitiveness: TrendingUp,
	diversity_metrics: Shield,
	career_growth: TrendingUp,
};

// ─── Component ──────────────────────────────────────────────

export function RecruiterTrustscorePage() {
	const [trustscore, setTrustscore] = useState<V1Score | null>(null);
	const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [toasts, setToasts] = useState<Toast[]>([]);

	const showToast = useCallback((message: string, type: ToastType = 'info') => {
		const id = `${Date.now()}-${Math.random()}`;
		setToasts((prev) => [...prev, { id, message, type }]);
		setTimeout(() => {
			setToasts((prev) => prev.filter((t) => t.id !== id));
		}, 5000);
	}, []);

	const dismissToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [tsData, bdData] = await Promise.all([
				apiCall<{ success: boolean; trustscore: V1Score }>('/trustscore'),
				apiCall<BreakdownResponse>('/trustscore/breakdown'),
			]);
			setTrustscore(tsData.trustscore);
			setBreakdown(bdData);
		} catch (err: unknown) {
			setError(err.message || 'Failed to load TrustScore data');
			showToast(err.message || 'Failed to load TrustScore data', 'error');
		} finally {
			setLoading(false);
		}
	}, [showToast]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-[60vh]">
				<div className="text-center">
					<Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
					<p className="text-muted-foreground">Loading TrustScore...</p>
				</div>
			</div>
		);
	}

	if (error || !trustscore || !breakdown) {
		return (
			<div className="flex items-center justify-center min-h-[60vh]">
				<div className="text-center max-w-md mx-auto px-4">
					<AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
					<h2 className="text-xl font-bold mb-2">Failed to load TrustScore</h2>
					<p className="text-muted-foreground mb-4">{error || 'Something went wrong'}</p>
					<button type="button"
						onClick={loadData}
						className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	const v2 = breakdown.v2;
	const overallScore = v2?.total_score ?? trustscore.total_score;
	const previousScore =
		breakdown.history.length > 0 ? breakdown.history[0].previous_score : overallScore;
	const scoreChange = overallScore - previousScore;

	// Combine v1 + v2 components for display
	const allComponents = [
		...breakdown.breakdown.map((b) => ({
			name: b.label,
			score: b.score,
			max: b.max,
			key: b.type,
			isV2: false,
			sufficient: true,
		})),
		...(breakdown.v2_breakdown || []).map((f) => ({
			name: f.label,
			score: f.score,
			max: f.max,
			key: f.type,
			isV2: true,
			sufficient: f.data_sufficient,
		})),
	];

	// Sort v2 factors by potential gain from recommendations
	const guidance = breakdown.v2_recommendations || [];

	return (
		<div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
			<ToastContainer toasts={toasts} onDismiss={dismissToast} />

			<div className="container mx-auto px-4 py-8 max-w-6xl">
				<div className="mb-6">
					<Link
						to="/recruiter"
						className="text-gray-400 hover:text-white flex items-center gap-2 mb-4"
					>
						<ArrowLeft className="w-4 h-4" />
						Back to Dashboard
					</Link>
				</div>

				{/* Overall Score Card */}
				<Card className="bg-white/10 backdrop-blur-lg border-white/20 mb-8">
					<CardContent className="pt-6">
						<div className="flex flex-col sm:flex-row items-center justify-between gap-6">
							<div className="flex items-center gap-6">
								<div className="relative">
									<div
										className={`w-24 h-24 rounded-full flex items-center justify-center border-4 ${
											overallScore >= 700
												? 'border-green-500/30 bg-green-500/10'
												: overallScore >= 400
													? 'border-yellow-500/30 bg-yellow-500/10'
													: 'border-red-500/30 bg-red-500/10'
										}`}
									>
										<span
											className={`text-4xl font-bold ${
												overallScore >= 700
													? 'text-green-400'
													: overallScore >= 400
														? 'text-yellow-400'
														: 'text-red-400'
											}`}
										>
											{overallScore}
										</span>
									</div>
									<div className="absolute -bottom-1 -right-1 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg">
										{scoreChange > 0 ? (
											<TrendingUp className="w-5 h-5 text-green-500" />
										) : scoreChange < 0 ? (
											<TrendingDown className="w-5 h-5 text-red-500" />
										) : (
											<div className="w-2 h-2 bg-gray-400 rounded-full" />
										)}
									</div>
								</div>
								<div>
									<h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">TrustScore</h1>
									<p className="text-gray-400">
										{scoreChange > 0 ? '+' : ''}
										{scoreChange} from last update
									</p>
									<div className="flex items-center gap-2 mt-2 flex-wrap">
										<Badge className={tierBadgeClass(v2?.tier || trustscore.tier)}>
											<Shield className="w-3 h-3 mr-1" />
											{v2?.tier_label || trustscore.tier_label}
										</Badge>
										<span className="text-sm text-gray-500">Updated daily</span>
									</div>
									{v2?.data_sufficiency && v2.data_sufficiency.overall < 50 && (
										<Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 mt-2">
											<AlertTriangle className="w-3 h-3 mr-1" />
											Insufficient Data ({v2.data_sufficiency.overall}%)
										</Badge>
									)}
								</div>
							</div>
							<div className="text-right">
								<p className="text-sm text-gray-400 mb-1">V1 Score</p>
								<p className="text-2xl font-bold text-white">{trustscore.total_score}</p>
								<p className="text-xs text-gray-500 mt-1">V2: {v2?.v2_score ?? 0} pts</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* V2 Factors Grid */}
				<div className="mb-8">
					<h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
						<Star className="w-5 h-5 text-yellow-400" />
						TrustScore v2 Factors
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
						{allComponents.map((component) => {
							const Icon = factorIcons[component.key] || Shield;
							const pct =
								component.max > 0 ? Math.round((component.score / component.max) * 100) : 0;
							const hasData = component.isV2 ? component.sufficient : true;

							return (
								<Card key={component.key} className="bg-white/10 backdrop-blur-lg border-white/20">
									<CardContent className="pt-5 pb-4">
										<div className="flex items-center justify-between mb-3">
											<div className="flex items-center gap-2">
												<Icon
													className={`w-4 h-4 ${hasData ? 'text-gray-300' : 'text-gray-500'}`}
												/>
												<span
													className={`text-sm font-medium ${
														hasData ? 'text-gray-300' : 'text-gray-500'
													}`}
												>
													{component.name}
												</span>
											</div>
											{component.isV2 && !hasData && (
												<Badge className="bg-gray-700/50 text-gray-400 text-[10px] border-0">
													Not enough data
												</Badge>
											)}
										</div>
										<div className="flex items-baseline gap-1 mb-2">
											<span
												className={`text-2xl font-bold ${
													hasData
														? scoreColorClass(component.score, component.max)
														: 'text-gray-500'
												}`}
											>
												{hasData ? component.score : '—'}
											</span>
											<span className="text-xs text-gray-500">/ {component.max}</span>
										</div>
										<Progress value={hasData ? pct : 0} className="h-1.5" />
										<p className="text-xs text-gray-500 mt-2">{component.name} score</p>
									</CardContent>
								</Card>
							);
						})}
					</div>
				</div>

				{/* Improvement Guidance */}
				{guidance.length > 0 && (
					<div className="mb-8">
						<h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
							<TrendingUp className="w-5 h-5 text-green-400" />
							Improvement Guidance
						</h2>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{guidance.map((g) => (
								<Card key={g.factor} className="bg-white/10 backdrop-blur-lg border-white/20">
									<CardContent className="pt-5 pb-4">
										<div className="flex items-center justify-between mb-2">
											<h3 className="text-white font-medium text-sm">{g.title}</h3>
											<Badge
												className={
													g.priority === 'high'
														? 'bg-red-500/20 text-red-400 border-red-500/30'
														: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
												}
											>
												{g.priority}
											</Badge>
										</div>
										<p className="text-gray-400 text-sm mb-3">{g.tip}</p>
										<div className="flex items-center gap-2">
											<span className="text-xs text-gray-500">
												Current: {g.current_score}/{g.max_score}
											</span>
											<span className="text-xs text-green-400 ml-auto">
												+{g.potential_gain} potential
											</span>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				)}

				{/* Analytics */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
					<Card className="bg-white/10 backdrop-blur-lg border-white/20">
						<CardHeader>
							<CardTitle className="text-white flex items-center gap-2">
								<Shield className="w-5 h-5 text-purple-400" />
								Hiring Analytics
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{[
								{ label: 'Active Jobs', value: breakdown.analytics?.active_jobs ?? 0 },
								{
									label: 'Total Applications',
									value: breakdown.analytics?.total_applications ?? 0,
								},
								{ label: 'Interviews', value: breakdown.analytics?.interviews ?? 0 },
								{ label: 'Offers', value: breakdown.analytics?.offers ?? 0 },
								{ label: 'Hires', value: breakdown.analytics?.hires ?? 0 },
							].map((stat) => (
								<div key={stat.label} className="flex items-center justify-between">
									<span className="text-gray-300">{stat.label}</span>
									<span className="text-white font-bold">{stat.value}</span>
								</div>
							))}
						</CardContent>
					</Card>

					<Card className="bg-white/10 backdrop-blur-lg border-white/20">
						<CardHeader>
							<CardTitle className="text-white flex items-center gap-2">
								<Clock className="w-5 h-5 text-yellow-400" />
								Score History
							</CardTitle>
						</CardHeader>
						<CardContent>
							{breakdown.history.length === 0 ? (
								<p className="text-gray-400 text-center py-4">No score history yet</p>
							) : (
								<div className="space-y-3">
									{breakdown.history.slice(0, 5).map((h, i) => (
										<div
											key={i}
											className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
										>
											<div>
												<p className="text-gray-300 font-medium text-sm">
													{h.change_reason || 'Score update'}
												</p>
												<p className="text-xs text-gray-500">
													{new Date(h.created_at).toLocaleDateString()}
												</p>
											</div>
											<div className="flex items-center gap-2">
												{h.change_amount > 0 ? (
													<TrendingUp className="w-4 h-4 text-green-400" />
												) : h.change_amount < 0 ? (
													<TrendingDown className="w-4 h-4 text-red-400" />
												) : (
													<div className="w-2 h-2 bg-gray-400 rounded-full" />
												)}
												<span
													className={`text-sm font-bold ${
														h.change_amount > 0
															? 'text-green-400'
															: h.change_amount < 0
																? 'text-red-400'
																: 'text-gray-400'
													}`}
												>
													{h.change_amount > 0 ? '+' : ''}
													{h.change_amount}
												</span>
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
