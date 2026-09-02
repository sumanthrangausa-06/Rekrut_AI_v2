import {
	AlertTriangle,
	ArrowLeft,
	BarChart3,
	CheckCircle,
	Clock,
	Download,
	Search,
	Shield,
	TrendingUp,
	Users,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiCall } from '@/lib/api';

interface AttemptResult {
	id: number;
	candidate_id: number;
	candidate_name: string;
	candidate_email: string;
	score: number;
	max_score: number;
	percentile: number | null;
	anti_cheat_score: number;
	passed: boolean;
	status: string;
	time_spent_seconds: number;
	completed_at: string;
	tab_switches: number;
	copy_paste_attempts: number;
}

interface ScoreDistribution {
	bucket: string;
	count: number;
}

interface CategoryBreakdown {
	category: string;
	total_answers: number;
	correct_answers: number;
	accuracy_pct: number;
}

interface TestStats {
	total_attempts: number;
	completed_count: number;
	timed_out_count: number;
	avg_score: number | null;
	avg_max_score: number | null;
	avg_percentile: number | null;
	highest_score: number;
	lowest_score: number;
	avg_anti_cheat_score: number | null;
	avg_time_spent: number | null;
}

export function RecruiterAptitudeTestResultsPage() {
	const { id: testId } = useParams();
	const navigate = useNavigate();
	const [attempts, setAttempts] = useState<AttemptResult[]>([]);
	const [stats, setStats] = useState<TestStats | null>(null);
	const [distribution, setDistribution] = useState<ScoreDistribution[]>([]);
	const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState('');

	const loadData = useCallback(async () => {
		if (!testId) return;
		try {
			const statsRes = await apiCall<{
				stats: TestStats;
				scoreDistribution: ScoreDistribution[];
				categoryBreakdown: CategoryBreakdown[];
			}>(`/recruiter/aptitude-tests/stats?testId=${testId}`);
			setStats(statsRes.stats || null);
			setDistribution(statsRes.scoreDistribution || []);
			setCategories(statsRes.categoryBreakdown || []);

			// Attempt to load individual results if endpoint exists
			try {
				const resultsRes = await apiCall<{ results: AttemptResult[] }>(
					`/recruiter/aptitude-tests/${testId}/results`,
				);
				setAttempts(resultsRes.results || []);
			} catch {
				// Endpoint may not exist; show stats only
				setAttempts([]);
			}
		} catch {
			// silent
		} finally {
			setLoading(false);
		}
	}, [testId]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	function exportCSV() {
		if (!attempts.length) return;
		const rows = [
			[
				'Candidate',
				'Email',
				'Score',
				'Max Score',
				'Percentage',
				'Percentile',
				'Passed',
				'Anti-Cheat',
				'Time (min)',
				'Completed At',
			],
			...attempts.map((a) => {
				const pct = a.max_score > 0 ? Math.round((a.score / a.max_score) * 100) : 0;
				return [
					a.candidate_name,
					a.candidate_email,
					String(a.score),
					String(a.max_score),
					`${pct}%`,
					a.percentile !== null ? `${a.percentile}%` : 'N/A',
					a.passed ? 'Yes' : 'No',
					`${a.anti_cheat_score}%`,
					String(Math.round((a.time_spent_seconds || 0) / 60)),
					new Date(a.completed_at).toLocaleString(),
				];
			}),
		];
		const csv = rows
			.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `aptitude-results-test-${testId}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	const filtered = useMemo(() => {
		if (!searchQuery) return attempts;
		const q = searchQuery.toLowerCase();
		return attempts.filter(
			(a) =>
				(a.candidate_name || '').toLowerCase().includes(q) ||
				(a.candidate_email || '').toLowerCase().includes(q),
		);
	}, [attempts, searchQuery]);

	const maxDistCount = Math.max(...distribution.map((d) => d.count), 1);

	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
				<div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<p className="text-muted-foreground">Loading results...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					className="gap-1"
					onClick={() => navigate('/recruiter/aptitude-tests')}
				>
					<ArrowLeft className="h-4 w-4" /> Back to Tests
				</Button>
			</div>

			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<div>
					<h1 className="font-heading text-2xl font-bold">Test Results</h1>
					<p className="text-muted-foreground">Candidate performance and analytics</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="gap-1"
					onClick={exportCSV}
					disabled={!attempts.length}
				>
					<Download className="h-4 w-4" /> Export CSV
				</Button>
			</div>

			{/* Stats */}
			{stats && (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Card>
						<CardContent className="p-4 text-center">
							<Users className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
							<p className="text-2xl font-bold">{stats.total_attempts || 0}</p>
							<p className="text-xs text-muted-foreground">Total Attempts</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-4 text-center">
							<TrendingUp className="mx-auto h-5 w-5 text-blue-500 mb-1" />
							<p className="text-2xl font-bold text-blue-600">
								{stats.avg_score !== null ? stats.avg_score : '—'}
							</p>
							<p className="text-xs text-muted-foreground">Avg Score</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-4 text-center">
							<CheckCircle className="mx-auto h-5 w-5 text-emerald-500 mb-1" />
							<p className="text-2xl font-bold text-emerald-600">{stats.completed_count || 0}</p>
							<p className="text-xs text-muted-foreground">Completed</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-4 text-center">
							<Shield className="mx-auto h-5 w-5 text-purple-500 mb-1" />
							<p className="text-2xl font-bold text-purple-600">
								{stats.avg_anti_cheat_score !== null ? `${stats.avg_anti_cheat_score}%` : '—'}
							</p>
							<p className="text-xs text-muted-foreground">Avg Integrity</p>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Score Distribution */}
			{distribution.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2">
							<BarChart3 className="h-4 w-4" /> Score Distribution
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{distribution.map((d) => {
								const pct = maxDistCount > 0 ? (d.count / maxDistCount) * 100 : 0;
								return (
									<div key={d.bucket}>
										<div className="flex items-center justify-between mb-1">
											<span className="text-sm">{d.bucket}</span>
											<span className="text-sm font-medium">{d.count}</span>
										</div>
										<div className="h-4 rounded-full bg-muted overflow-hidden">
											<div
												className="h-full rounded-full bg-primary transition-all"
												style={{ width: `${pct}%` }}
											/>
										</div>
									</div>
								);
							})}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Category Breakdown */}
			{categories.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Performance by Category</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{categories.map((cat) => (
							<div key={cat.category}>
								<div className="flex items-center justify-between mb-1">
									<span className="text-sm font-medium capitalize">{cat.category}</span>
									<span className="text-sm text-muted-foreground">
										{cat.correct_answers}/{cat.total_answers} ({cat.accuracy_pct}%)
									</span>
								</div>
								<div className="h-2 rounded-full bg-muted overflow-hidden">
									<div
										className={`h-full rounded-full transition-all ${
											cat.accuracy_pct >= 70
												? 'bg-emerald-500'
												: cat.accuracy_pct >= 50
													? 'bg-amber-500'
													: 'bg-destructive'
										}`}
										style={{ width: `${cat.accuracy_pct}%` }}
									/>
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			)}

			{/* Search */}
			<div className="relative max-w-md">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
				<Input
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder="Search by candidate name or email..."
					className="pl-9"
				/>
			</div>

			{/* Attempts list */}
			{filtered.length === 0 ? (
				<EmptyState
					icon={BarChart3}
					title="No results yet"
					description="Candidates who complete this test will appear here."
				/>
			) : (
				<div className="space-y-3">
					<p className="text-xs text-muted-foreground">
						{filtered.length} result{filtered.length !== 1 ? 's' : ''}
					</p>
					{filtered.map((a) => {
						const pct = a.max_score > 0 ? Math.round((a.score / a.max_score) * 100) : 0;
						return (
							<Card key={a.id} className="hover:shadow-sm transition-shadow">
								<CardContent className="p-4">
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 mb-1">
												<h4 className="font-medium">{a.candidate_name || 'Unknown'}</h4>
												{a.passed ? (
													<Badge variant="success" className="gap-1">
														<CheckCircle className="h-3 w-3" /> Passed
													</Badge>
												) : (
													<Badge variant="destructive" className="gap-1">
														<XCircle className="h-3 w-3" /> Failed
													</Badge>
												)}
												{a.anti_cheat_score < 70 && (
													<Badge
														variant="outline"
														className="gap-1 text-amber-600 border-amber-300"
													>
														<AlertTriangle className="h-3 w-3" /> Low Integrity
													</Badge>
												)}
											</div>
											<p className="text-xs text-muted-foreground">{a.candidate_email}</p>
											<div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
												<span>
													Score:{' '}
													<strong className="text-foreground">
														{a.score}/{a.max_score}
													</strong>
												</span>
												{a.percentile !== null && <span>Percentile: {a.percentile}%</span>}
												<span className="flex items-center gap-1">
													<Clock className="h-3 w-3" />
													{Math.round((a.time_spent_seconds || 0) / 60)} min
												</span>
												<span className="flex items-center gap-1">
													<Shield className="h-3 w-3" />
													{a.anti_cheat_score}%
												</span>
												<span>{new Date(a.completed_at).toLocaleDateString()}</span>
											</div>
										</div>
										<div className="text-right">
											<div
												className={`text-2xl font-bold ${a.passed ? 'text-emerald-600' : 'text-destructive'}`}
											>
												{pct}%
											</div>
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
