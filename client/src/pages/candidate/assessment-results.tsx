import {
	AlertTriangle,
	ArrowLeft,
	Award,
	BarChart3,
	CheckCircle,
	Clock,
	Shield,
	TrendingUp,
	Trophy,
	XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { apiCall } from '@/lib/api';

interface AssessmentResult {
	id: number;
	session_id: number;
	assessment_id: number;
	score: number | null;
	passed: boolean;
	skill_name: string;
	max_difficulty_reached: number;
	duration_seconds: number;
	answers_given: { isCorrect: boolean }[];
	anti_cheat_score: number | null;
	tab_switches: number;
	copy_paste_attempts: number;
	time_anomalies: number;
	behavioral_flags?:
		| {
				partial?: boolean;
				answers_given?: number;
				total_questions?: number;
				correct_count?: number | null;
				fullscreen_auto_submit?: boolean;
		  }
		| string
		| null;
}

export function AssessmentResultsPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const [result, setResult] = useState<AssessmentResult | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const sessionId = searchParams.get('session');
	const assessmentId = searchParams.get('id');

	useEffect(() => {
		async function loadResults() {
			try {
				if (!sessionId && !assessmentId) {
					setError('No results found');
					setLoading(false);
					return;
				}

				let foundResult: AssessmentResult | null = null;

				if (sessionId) {
					const sessionRes = await apiCall<{ result: AssessmentResult }>(
						`/assessments/session/${sessionId}`,
					);
					if (sessionRes.result) {
						foundResult = sessionRes.result;
					}
				}

				if (!foundResult) {
					const response = await apiCall<{ results: AssessmentResult[] }>('/assessments/results');
					if (assessmentId) {
						foundResult = response.results.find((r) => r.id === parseInt(assessmentId, 10)) || null;
					} else if (sessionId) {
						foundResult =
							response.results.find((r) => r.session_id === parseInt(sessionId, 10)) || null;
					}
					if (!foundResult && response.results.length > 0) {
						foundResult = response.results[0];
					}
				}

				if (!foundResult) {
					setError('Result not found');
				} else {
					setResult(foundResult);
				}
			} catch (err) {
				console.error('Error loading results:', err);
				setError('Failed to load results');
			} finally {
				setLoading(false);
			}
		}

		loadResults();
	}, [sessionId, assessmentId]);

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-[60vh]">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
					<p className="text-muted-foreground">Loading your results...</p>
				</div>
			</div>
		);
	}

	if (error || !result) {
		return (
			<div className="space-y-6 px-4 sm:px-6">
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						onClick={() => navigate('/candidate/assessments')}
						className="min-h-[44px]"
					>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back to Assessments
					</Button>
				</div>
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
						<h2 className="text-xl font-semibold mb-2">No Results Available</h2>
						<p className="text-muted-foreground">{error || 'Could not load assessment results.'}</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const correctCount = Array.isArray(result.answers_given)
		? result.answers_given.filter((a) => a.isCorrect).length
		: 0;

	// Phase B: a partial completion is labelled from its stored flags and
	// is NEVER rendered as a bare score out of 100 or as pass/fail.
	const flags =
		typeof result.behavioral_flags === 'string'
			? JSON.parse(result.behavioral_flags)
			: result.behavioral_flags || {};
	const isPartial = flags.partial === true;
	const answeredCount = flags.answers_given ?? (Array.isArray(result.answers_given) ? result.answers_given.length : 0);
	const totalQuestions = isPartial
		? (flags.total_questions ?? 10)
		: Array.isArray(result.answers_given)
			? result.answers_given.length
			: 10;
	const durationMinutes = Math.floor(result.duration_seconds / 60);
	const durationSeconds = Math.floor(result.duration_seconds % 60);

	// S-111 (#836): absent anti_cheat_score means "not computed" — never
	// present it as 100. A real stored value (including 0) renders as-is.
	const integrityScore = result.anti_cheat_score ?? null;
	const integrityLabel =
		integrityScore === null
			? 'Insufficient data'
			: integrityScore >= 90
				? 'Excellent'
				: integrityScore >= 70
					? 'Good'
					: integrityScore >= 50
						? 'Fair'
						: 'Poor';
	const integrityColor =
		integrityScore === null
			? 'text-muted-foreground'
			: integrityScore >= 90
				? 'text-emerald-500'
				: integrityScore >= 70
					? 'text-blue-500'
					: integrityScore >= 50
						? 'text-amber-500'
						: 'text-red-500';

	return (
		<div className="space-y-6 px-4 sm:px-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						onClick={() => navigate('/candidate/assessments')}
						className="min-h-[44px]"
					>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back to Assessments
					</Button>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						onClick={() => navigate('/candidate/omniscore')}
						className="min-h-[44px]"
					>
						<Trophy className="h-4 w-4 mr-2" />
						View OmniScore
					</Button>
				</div>
			</div>

			{/* Score Hero */}
			<Card className="border-2">
				<CardContent className="pt-6">
					<div className="flex flex-col items-center text-center space-y-4">
						<div className="relative w-40 h-40">
							<svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 180 180">
								<circle
									cx="90"
									cy="90"
									r="80"
									fill="none"
									stroke="hsl(var(--muted))"
									strokeWidth="12"
								/>
								<circle
									cx="90"
									cy="90"
									r="80"
									fill="none"
									stroke="url(#score-gradient)"
									strokeWidth="12"
									strokeDasharray={2 * Math.PI * 80}
									strokeDashoffset={2 * Math.PI * 80 * (1 - (result.score ?? 0) / 100)}
									strokeLinecap="round"
									className="transition-all duration-1000"
								/>
								<defs>
									<linearGradient id="score-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
										<stop offset="0%" stopColor="#10b981" />
										<stop offset="100%" stopColor="#06b6d4" />
									</linearGradient>
								</defs>
							</svg>
							<div className="absolute inset-0 flex flex-col items-center justify-center">
								{isPartial ? (
									<>
										<span className="text-2xl font-bold px-4 text-center">
											{answeredCount === 0 ? 'No score' : `${correctCount} of ${answeredCount}`}
										</span>
										<span className="text-sm text-muted-foreground">
											{answeredCount === 0 ? '' : 'answered correct'}
										</span>
									</>
								) : (
									<>
										<span className="text-4xl font-bold">{result.score}</span>
										<span className="text-sm text-muted-foreground">/100</span>
									</>
								)}
							</div>
						</div>

						<div>
							{isPartial ? (
								<>
									<h2 className="text-2xl font-bold">Partial result</h2>
									{flags.fullscreen_auto_submit && (
										<p className="text-muted-foreground">
											Submitted automatically after leaving full-screen twice. {answeredCount}{' '}
											of {totalQuestions} questions answered.
										</p>
									)}
									{answeredCount === 0 ? (
										<p className="text-muted-foreground">
											You submitted with no questions answered, so there is no score.
										</p>
									) : (
										<p className="text-muted-foreground">
											You answered {answeredCount} of {totalQuestions} questions. Your result is
											based only on those {answeredCount} answered questions: {correctCount} of{' '}
											{answeredCount} correct. The other {totalQuestions - answeredCount}{' '}
											questions were not counted. Because this result is partial, it is not a
											pass, it does not earn Verified, and it does not count toward your
											OmniScore.
										</p>
									)}
									<Badge variant="secondary" className="mt-2">
										Partial — answered {answeredCount} of {totalQuestions}
									</Badge>
								</>
							) : (
								<>
									<h2 className="text-2xl font-bold flex items-center justify-center gap-2">
										{result.passed ? (
											<>
												<CheckCircle className="h-6 w-6 text-emerald-500" />
												Passed!
											</>
										) : (
											<>
												<XCircle className="h-6 w-6 text-red-500" />
												Not Passed
											</>
										)}
									</h2>
									<p className="text-muted-foreground">
										{result.passed
											? 'Great job! Your skill has been verified.'
											: 'Keep practicing and try again.'}
									</p>
								</>
							)}
						</div>

						{result.passed && (
							<Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
								<Award className="h-3 w-3 mr-1" />
								{result.skill_name || 'Skill'} Verified
							</Badge>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<Card>
					<CardContent className="pt-6 text-center">
						<BarChart3 className="h-8 w-8 text-primary mx-auto mb-2" />
						<div className="text-2xl sm:text-3xl font-bold">
							{correctCount}/{totalQuestions}
						</div>
						<div className="text-sm text-muted-foreground">Correct Answers</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="pt-6 text-center">
						<TrendingUp className="h-8 w-8 text-primary mx-auto mb-2" />
						<div className="text-2xl sm:text-3xl font-bold">
							{result.max_difficulty_reached || 2}/5
						</div>
						<div className="text-sm text-muted-foreground">Max Difficulty</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="pt-6 text-center">
						<Clock className="h-8 w-8 text-primary mx-auto mb-2" />
						<div className="text-2xl sm:text-3xl font-bold">
							{durationMinutes}m {durationSeconds}s
						</div>
						<div className="text-sm text-muted-foreground">Time Taken</div>
					</CardContent>
				</Card>
			</div>

			{/* Integrity Report */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Shield className="h-5 w-5" />
						Test Integrity Report
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex items-center gap-4">
						<div className={`text-4xl font-bold ${integrityColor}`}>{integrityScore ?? '—'}</div>
						<div>
							<div className="font-semibold">Assessment Integrity</div>
							<div className="text-sm text-muted-foreground">{integrityLabel}</div>
						</div>
					</div>

					<div className="space-y-3">
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Tab Switches</span>
							<span className="font-medium">{result.tab_switches || 0}</span>
						</div>
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Copy/Paste Attempts</span>
							<span className="font-medium">{result.copy_paste_attempts || 0}</span>
						</div>
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Time Anomalies</span>
							<span className="font-medium">{result.time_anomalies || 0}</span>
						</div>
					</div>

					<Separator />

					<p className="text-sm text-muted-foreground">
						This score reflects test-taking behavior. A high integrity score indicates a clean
						attempt with no suspicious activity. Employers may consider this score alongside your
						assessment results.
					</p>
				</CardContent>
			</Card>

			{/* Achievement Badge */}
			{result.passed && (
				<Card className="bg-emerald-50 border-emerald-200">
					<CardContent className="pt-6">
						<div className="flex items-center gap-3">
							<div className="bg-emerald-100 p-3 rounded-full">
								<Trophy className="h-6 w-6 text-emerald-600" />
							</div>
							<div>
								<h3 className="font-semibold text-emerald-900">Achievement Unlocked</h3>
								<p className="text-sm text-emerald-700">
									{result.skill_name || 'Skill'} Verified — This skill is now verified on your
									profile and will be highlighted to recruiters. Your OmniScore has been updated.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
