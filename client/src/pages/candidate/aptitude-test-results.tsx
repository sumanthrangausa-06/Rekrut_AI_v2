import {
	ArrowLeft,
	Brain,
	CheckCircle,
	Clock,
	Download,
	Shield,
	Trophy,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiCall } from '@/lib/api';

interface AttemptDetail {
	id: number;
	test_id: number;
	score: number;
	max_score: number;
	percentile: number | null;
	anti_cheat_score: number;
	passed: boolean;
	status: string;
	time_spent_seconds: number;
	started_at: string;
	completed_at: string;
	pass_score: number;
	duration_minutes: number;
	tab_switches: number;
	copy_paste_attempts: number;
	time_anomalies: number;
	title: string;
	detailedAnswers: DetailedAnswer[];
}

interface DetailedAnswer {
	questionId: number;
	questionText?: string;
	answer: string;
	correctAnswer?: string | null;
	isCorrect: boolean;
	timeTaken: number;
	category?: string | null;
	difficulty?: number | null;
	explanation?: string | null;
}

export function CandidateAptitudeTestResultsPage() {
	const { id: attemptId } = useParams();
	const navigate = useNavigate();
	const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
	const [loading, setLoading] = useState(true);

	const loadAttempt = useCallback(async () => {
		if (!attemptId) return;
		try {
			const data = await apiCall<{ attempt: AttemptDetail }>(
				`/aptitude-tests/attempt/${attemptId}`,
			);
			setAttempt(data.attempt);
		} catch {
			// silent
		} finally {
			setLoading(false);
		}
	}, [attemptId]);

	useEffect(() => {
		loadAttempt();
	}, [loadAttempt]);

	function downloadCSV() {
		if (!attempt) return;
		const rows = [
			['Question', 'Category', 'Difficulty', 'Your Answer', 'Correct Answer', 'Result', 'Time (s)'],
			...(attempt.detailedAnswers || []).map((a) => [
				a.questionText || `Q${a.questionId}`,
				a.category || '',
				String(a.difficulty || ''),
				a.answer,
				a.correctAnswer || '',
				a.isCorrect ? 'Correct' : 'Incorrect',
				String(a.timeTaken || 0),
			]),
		];
		const csv = rows
			.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `aptitude-results-${attempt.title}-${attemptId}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
				<div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<p className="text-muted-foreground">Loading results...</p>
			</div>
		);
	}

	if (!attempt) {
		return (
			<div className="py-16 text-center px-4 sm:px-6">
				<p className="text-muted-foreground">Result not found</p>
				<Button className="mt-4 min-h-[44px]" onClick={() => navigate('/aptitude-tests')}>
					<ArrowLeft className="h-4 w-4 mr-1" /> Back to Tests
				</Button>
			</div>
		);
	}

	const pct = attempt.max_score > 0 ? Math.round((attempt.score / attempt.max_score) * 100) : 0;
	const mins = Math.floor((attempt.time_spent_seconds || 0) / 60);
	const secs = Math.round((attempt.time_spent_seconds || 0) % 60);

	// Category breakdown
	const categoryStats: Record<string, { total: number; correct: number }> = {};
	for (const ans of attempt.detailedAnswers || []) {
		const cat = ans.category || 'Unknown';
		if (!categoryStats[cat]) categoryStats[cat] = { total: 0, correct: 0 };
		categoryStats[cat].total++;
		if (ans.isCorrect) categoryStats[cat].correct++;
	}

	return (
		<div className="max-w-3xl mx-auto space-y-6 py-6 px-4 sm:px-6">
			{/* Back button */}
			<Button
				variant="ghost"
				size="sm"
				className="gap-1"
				onClick={() => navigate('/aptitude-tests')}
			>
				<ArrowLeft className="h-4 w-4" /> Back to Tests
			</Button>

			{/* Score Header */}
			<Card>
				<CardContent className="p-6 sm:p-8 text-center">
					{attempt.passed ? (
						<Trophy className="mx-auto h-16 w-16 text-emerald-500 mb-4" />
					) : (
						<XCircle className="mx-auto h-16 w-16 text-destructive mb-4" />
					)}
					<h1 className="font-heading text-2xl font-bold mb-1">{attempt.title}</h1>
					<p className="text-muted-foreground mb-4">
						Completed {new Date(attempt.completed_at).toLocaleDateString()}
					</p>

					<div className="text-5xl font-bold mb-2">
						<span className={attempt.passed ? 'text-emerald-600' : 'text-destructive'}>
							{attempt.score}
						</span>
						<span className="text-muted-foreground text-2xl">/{attempt.max_score}</span>
					</div>
					<div className="text-2xl font-semibold mb-4">
						<span className={attempt.passed ? 'text-emerald-600' : 'text-destructive'}>{pct}%</span>
					</div>

					<Badge variant={attempt.passed ? 'success' : 'destructive'} className="text-sm mb-4">
						{attempt.passed ? 'PASSED' : 'NOT PASSED'} (Pass: {attempt.pass_score}%)
					</Badge>

					{attempt.percentile !== null && (
						<p className="text-sm text-muted-foreground">
							You scored higher than <strong>{attempt.percentile}%</strong> of candidates
						</p>
					)}
				</CardContent>
			</Card>

			{/* Stats Grid */}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardContent className="p-4 text-center">
						<Brain className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
						<p className="text-2xl font-bold">
							{attempt.score}/{attempt.max_score}
						</p>
						<p className="text-xs text-muted-foreground">Score</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<Clock className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
						<p className="text-2xl font-bold">
							{mins}m {secs}s
						</p>
						<p className="text-xs text-muted-foreground">Time Spent</p>
					</CardContent>
				</Card>
				{attempt.percentile !== null && (
					<Card>
						<CardContent className="p-4 text-center">
							<Trophy className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
							<p className="text-2xl font-bold">{attempt.percentile}%</p>
							<p className="text-xs text-muted-foreground">Percentile</p>
						</CardContent>
					</Card>
				)}
				<Card>
					<CardContent className="p-4 text-center">
						<Shield className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
						<p
							className={`text-2xl font-bold ${
								attempt.anti_cheat_score >= 80
									? 'text-emerald-600'
									: attempt.anti_cheat_score >= 50
										? 'text-amber-600'
										: 'text-destructive'
							}`}
						>
							{attempt.anti_cheat_score}%
						</p>
						<p className="text-xs text-muted-foreground">Integrity</p>
					</CardContent>
				</Card>
			</div>

			{/* Anti-cheat flags */}
			{(attempt.tab_switches > 0 ||
				attempt.copy_paste_attempts > 0 ||
				attempt.time_anomalies > 0) && (
				<div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
					<p className="text-sm font-medium text-amber-800 mb-1">Behavioral Flags</p>
					<div className="flex flex-wrap gap-4 text-xs text-amber-700">
						{attempt.tab_switches > 0 && <span>Tab switches: {attempt.tab_switches}</span>}
						{attempt.copy_paste_attempts > 0 && (
							<span>Copy/paste attempts: {attempt.copy_paste_attempts}</span>
						)}
						{attempt.time_anomalies > 0 && <span>Time anomalies: {attempt.time_anomalies}</span>}
					</div>
				</div>
			)}

			{/* Category Breakdown */}
			{Object.keys(categoryStats).length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Category Breakdown</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{Object.entries(categoryStats).map(([cat, stats]) => {
							const catPct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
							return (
								<div key={cat}>
									<div className="flex items-center justify-between mb-1">
										<span className="text-sm font-medium capitalize">{cat}</span>
										<span className="text-sm text-muted-foreground">
											{stats.correct}/{stats.total} ({catPct}%)
										</span>
									</div>
									<div className="h-2 rounded-full bg-muted overflow-hidden">
										<div
											className={`h-full rounded-full transition-all ${
												catPct >= 70
													? 'bg-emerald-500'
													: catPct >= 50
														? 'bg-amber-500'
														: 'bg-destructive'
											}`}
											style={{ width: `${catPct}%` }}
										/>
									</div>
								</div>
							);
						})}
					</CardContent>
				</Card>
			)}

			{/* Question-by-question breakdown */}
			{attempt.detailedAnswers && attempt.detailedAnswers.length > 0 && (
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="text-base">Question Breakdown</CardTitle>
						<Button variant="outline" size="sm" className="gap-1" onClick={downloadCSV}>
							<Download className="h-3 w-3" /> Export CSV
						</Button>
					</CardHeader>
					<CardContent className="space-y-3">
						{attempt.detailedAnswers.map((answer, idx) => (
							<div
								key={idx}
								className={`rounded-lg border p-3 ${
									answer.isCorrect
										? 'border-emerald-200 bg-emerald-50/50'
										: 'border-red-200 bg-red-50/50'
								}`}
							>
								<div className="flex items-start justify-between mb-1">
									<span className="text-xs font-medium">
										Q{idx + 1}
										{answer.category && (
											<span className="text-muted-foreground ml-1 capitalize">
												({answer.category})
											</span>
										)}
									</span>
									<div className="flex items-center gap-2">
										{answer.timeTaken > 0 && (
											<span className="text-xs text-muted-foreground">{answer.timeTaken}s</span>
										)}
										{answer.isCorrect ? (
											<CheckCircle className="h-4 w-4 text-emerald-500" />
										) : (
											<XCircle className="h-4 w-4 text-destructive" />
										)}
									</div>
								</div>
								<p className="text-sm mb-1">
									{answer.questionText || `Question ${answer.questionId}`}
								</p>
								<div className="text-xs space-y-1">
									<p>
										<span className="text-muted-foreground">Your answer: </span>
										<span className={answer.isCorrect ? 'text-emerald-700' : 'text-destructive'}>
											{answer.answer}
										</span>
									</p>
									{!answer.isCorrect && answer.correctAnswer && (
										<p>
											<span className="text-muted-foreground">Correct: </span>
											<span className="text-emerald-700">{answer.correctAnswer}</span>
										</p>
									)}
									{answer.explanation && (
										<p className="text-muted-foreground italic mt-1">{answer.explanation}</p>
									)}
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
