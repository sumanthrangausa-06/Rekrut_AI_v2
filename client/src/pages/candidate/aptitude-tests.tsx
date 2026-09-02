import { AlertTriangle, BarChart3, Brain, Clock, Lock, Play, Shield, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/domain/empty-state';
import { Skeleton } from '@/components/domain/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiCall } from '@/lib/api';

interface AptitudeTest {
	id: number;
	title: string;
	description: string | null;
	duration_minutes: number;
	question_count: number;
	pass_score: number;
	retake_lockout_days: number;
	is_active: boolean;
	available_questions: number;
	completed_count: number;
	last_completed_at: string | null;
	can_retake: boolean;
}

interface AptitudeResult {
	id: number;
	test_id: number;
	title: string;
	score: number;
	max_score: number;
	percentile: number | null;
	anti_cheat_score: number;
	passed: boolean;
	status: string;
	time_spent_seconds: number;
	completed_at: string;
}

function getRetakeCountdown(lastCompletedAt: string | null, lockoutDays: number): string | null {
	if (!lastCompletedAt || lockoutDays <= 0) return null;
	const lockoutEnd = new Date(lastCompletedAt);
	lockoutEnd.setDate(lockoutEnd.getDate() + lockoutDays);
	const now = new Date();
	if (now >= lockoutEnd) return null;
	const diff = lockoutEnd.getTime() - now.getTime();
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));
	const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
	if (days > 0) return `${days}d ${hours}h`;
	return `${hours}h`;
}

export function CandidateAptitudeTestsPage() {
	const navigate = useNavigate();
	const [tab, setTab] = useState('available');
	const [tests, setTests] = useState<AptitudeTest[]>([]);
	const [results, setResults] = useState<AptitudeResult[]>([]);
	const [loading, setLoading] = useState(true);
	const [starting, setStarting] = useState<number | null>(null);

	const loadData = useCallback(async () => {
		try {
			const [testsRes, resultsRes] = await Promise.allSettled([
				apiCall<{ tests: AptitudeTest[] }>('/aptitude-tests/available'),
				apiCall<{ results: AptitudeResult[] }>('/aptitude-tests/results'),
			]);
			if (testsRes.status === 'fulfilled') setTests(testsRes.value.tests || []);
			if (resultsRes.status === 'fulfilled') setResults(resultsRes.value.results || []);
		} catch {
			// silent
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	async function startTest(testId: number) {
		setStarting(testId);
		try {
			const data = await apiCall<{
				attemptId: number;
				test: { id: number; title: string; durationMinutes: number; passScore: number };
				totalQuestions: number;
				maxScore: number;
				currentQuestion: {
					id: number;
					text: string;
					category: string;
					difficulty: number;
					options: string[];
					timeLimit: number;
					questionNumber: number;
				};
			}>(`/aptitude-tests/${testId}/start`, { method: 'POST' });

			// Store initial question in sessionStorage for the take page to pick up
			sessionStorage.setItem(
				`aptitude_${data.attemptId}`,
				JSON.stringify({
					question: data.currentQuestion,
					test: data.test,
					totalQuestions: data.totalQuestions,
					maxScore: data.maxScore,
				}),
			);
			navigate(`/aptitude-tests/${testId}/take?attempt=${data.attemptId}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to start test';
			alert(msg);
		} finally {
			setStarting(null);
		}
	}

	const activeTests = tests.filter((t) => t.is_active);

	return (
		<div className="space-y-6 px-4 sm:px-6">
			<div>
				<h1 className="font-heading text-2xl font-bold">Aptitude Tests</h1>
				<p className="text-muted-foreground">
					Timed cognitive assessments to showcase your abilities
				</p>
			</div>

			{/* Stats */}
			<div className="grid gap-3 sm:grid-cols-3">
				<Card>
					<CardContent className="p-4 text-center">
						<p className="text-2xl font-bold">{results.length}</p>
						<p className="text-xs text-muted-foreground">Tests Taken</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<p className="text-2xl font-bold text-emerald-600">
							{results.filter((r) => r.passed).length}
						</p>
						<p className="text-xs text-muted-foreground">Passed</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<p className="text-2xl font-bold text-blue-600">
							{results.length > 0
								? Math.round(
										results.reduce((sum, r) => sum + (r.score / r.max_score) * 100, 0) /
											results.length,
									)
								: 0}
							%
						</p>
						<p className="text-xs text-muted-foreground">Avg Score</p>
					</CardContent>
				</Card>
			</div>

			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					<TabsTrigger value="available">Available Tests</TabsTrigger>
					<TabsTrigger value="results">My Results</TabsTrigger>
				</TabsList>

				<TabsContent value="available">
					{loading ? (
						<div className="space-y-4 mt-4">
							<Skeleton variant="card" count={3} />
						</div>
					) : activeTests.length === 0 ? (
						<EmptyState
							icon={Brain}
							title="No aptitude tests available"
							description="Check back later for new cognitive assessment opportunities."
							className="mt-4"
						/>
					) : (
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
							{activeTests.map((test) => {
								const countdown = getRetakeCountdown(
									test.last_completed_at,
									test.retake_lockout_days,
								);
								const isLocked = !!countdown;
								const hasCompleted = test.completed_count > 0;

								return (
									<Card key={test.id} className="relative">
										<CardContent className="p-4">
											<div className="flex items-start justify-between mb-2">
												<div className="flex items-center gap-2">
													<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono font-bold text-xs">
														<Brain className="h-4 w-4" />
													</div>
													<div>
														<h4 className="font-medium text-sm">{test.title}</h4>
														<p className="text-xs text-muted-foreground">
															{test.duration_minutes} min · {test.question_count} questions
														</p>
													</div>
												</div>
											</div>
											<p className="text-xs text-muted-foreground mb-3">
												{test.description ||
													'A timed cognitive assessment covering logic, verbal, and numerical reasoning.'}
											</p>

											<div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
												<span className="flex items-center gap-1">
													<Clock className="h-3 w-3" />
													{test.duration_minutes} min
												</span>
												<span className="flex items-center gap-1">
													<BarChart3 className="h-3 w-3" />
													{test.question_count} Qs
												</span>
												<span className="flex items-center gap-1">
													<Trophy className="h-3 w-3" />
													Pass: {test.pass_score}%
												</span>
											</div>

											{hasCompleted && !isLocked && (
												<p className="text-xs text-emerald-600 mb-2">
													Completed {test.completed_count} time
													{test.completed_count !== 1 ? 's' : ''}
												</p>
											)}

											{isLocked ? (
												<div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700 mb-2">
													<Lock className="h-3 w-3 shrink-0" />
													<span>
														Retake locked — available in <strong>{countdown}</strong>
													</span>
												</div>
											) : null}

											<Button
												size="sm"
												variant={hasCompleted ? 'outline' : 'default'}
												className="w-full gap-1 min-h-[44px]"
												onClick={() => startTest(test.id)}
												disabled={starting === test.id || isLocked}
											>
												{starting === test.id ? (
													<div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
												) : (
													<Play className="h-3 w-3" />
												)}
												{hasCompleted ? 'Retake Test' : 'Start Test'}
											</Button>
										</CardContent>
									</Card>
								);
							})}
						</div>
					)}
				</TabsContent>

				<TabsContent value="results">
					{results.length === 0 ? (
						<EmptyState
							icon={Trophy}
							title="No aptitude test results yet"
							description="Take an aptitude test to see your cognitive assessment scores and percentile ranking."
							action={{ label: 'Take a Test', onClick: () => setTab('available') }}
							className="mt-4"
						/>
					) : (
						<div className="space-y-3 mt-4">
							{results.map((r) => {
								const pct = r.max_score > 0 ? Math.round((r.score / r.max_score) * 100) : 0;
								return (
									<Card key={r.id} className="hover:shadow-sm transition-shadow">
										<CardContent className="p-4">
											<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2 mb-1">
														<h4 className="font-medium">{r.title}</h4>
														{r.passed ? (
															<Badge variant="success" className="gap-1">
																<Trophy className="h-3 w-3" /> Passed
															</Badge>
														) : (
															<Badge variant="destructive" className="gap-1">
																<AlertTriangle className="h-3 w-3" /> Failed
															</Badge>
														)}
													</div>
													<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
														<span>
															Score:{' '}
															<strong className="text-foreground">
																{r.score}/{r.max_score}
															</strong>
														</span>
														{r.percentile !== null && <span>Percentile: {r.percentile}%</span>}
														<span className="flex items-center gap-1">
															<Clock className="h-3 w-3" />
															{Math.round((r.time_spent_seconds || 0) / 60)} min
														</span>
														<span className="flex items-center gap-1">
															<Shield className="h-3 w-3" />
															{r.anti_cheat_score}%
														</span>
														<span>{new Date(r.completed_at).toLocaleDateString()}</span>
													</div>
												</div>
												<div className="text-right">
													<div
														className={`text-2xl font-bold ${r.passed ? 'text-emerald-600' : 'text-destructive'}`}
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
				</TabsContent>
			</Tabs>
		</div>
	);
}
