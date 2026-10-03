import { AlertCircle, ArrowRight, ArrowUpRight, Check, FileText, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

export function ApplicationOptimizerTab() {
	const [jobId, setJobId] = useState('');
	const [coverLetter, setCoverLetter] = useState('');
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<{
		job: { id: number; title: string; company: string };
		optimizedCoverLetter: string;
		optimizedAnswers: Array<{
			question: string;
			original: string;
			optimized: string;
			improvement: string;
		}>;
		diffHighlights: Array<{
			type: 'add' | 'remove' | 'keep' | 'rewrite';
			text: string;
			reason: string;
		}>;
		scoreBefore: number;
		scoreAfter: number;
		feedback: {
			strengths: string[];
			weaknesses: string[];
			key_improvements: string[];
			tailoring: string;
		};
	} | null>(null);
	const [error, setError] = useState('');
	const [showDiff, setShowDiff] = useState(true);

	async function handleOptimize() {
		if (!jobId.trim()) return;
		setLoading(true);
		setError('');
		try {
			const res = await fetch('/api/career-coach/application-optimize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jobId: Number(jobId),
					coverLetter: coverLetter || undefined,
					answers: [],
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to optimize application');
			setResult(data);
		} catch (err: any) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<FileText className="h-5 w-5 text-indigo-500" />
						Application Optimizer
					</CardTitle>
					<CardDescription>
						Paste your cover letter and get a concrete, job-specific rewrite with a before/after
						score.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="job-id-ao">Job ID</Label>
						<Input
							id="job-id-ao"
							type="number"
							placeholder="Enter the job ID you are applying for"
							value={jobId}
							onChange={(e) => setJobId(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="cover-letter">Your Cover Letter (optional)</Label>
						<Textarea
							id="cover-letter"
							placeholder="Paste your current cover letter here..."
							value={coverLetter}
							onChange={(e) => setCoverLetter(e.target.value)}
							rows={8}
						/>
						<p className="text-xs text-muted-foreground">
							Leave empty to optimize based on your profile + the job requirements.
						</p>
					</div>
					<Button
						onClick={handleOptimize}
						disabled={loading || !jobId.trim()}
						className="bg-indigo-500 hover:bg-indigo-600"
					>
						{loading ? 'Optimizing...' : 'Optimize Application'}
					</Button>
					{error && (
						<div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
							<AlertCircle className="h-4 w-4 shrink-0" />
							{error}
						</div>
					)}
				</CardContent>
			</Card>

			{loading && (
				<div className="space-y-4">
					<Skeleton className="h-40 w-full" />
					<Skeleton className="h-20 w-full" />
				</div>
			)}

			{result && (
				<div className="space-y-6">
					{/* Score Card */}
					<Card>
						<CardContent className="py-5">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-sm text-muted-foreground">Application Score</p>
									<div className="flex items-center gap-3">
										<span className="text-3xl font-bold text-muted-foreground">
											{result.scoreBefore}
										</span>
										<ArrowRight className="h-5 w-5 text-indigo-500" />
										<span className="text-3xl font-bold text-indigo-500">{result.scoreAfter}</span>
									</div>
								</div>
								<div className="text-right">
									<p className="text-sm font-medium">{result.job.title}</p>
									<p className="text-xs text-muted-foreground">{result.job.company}</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Diff View */}
					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<CardTitle className="text-base">Optimized Cover Letter</CardTitle>
								<Button variant="ghost" size="sm" onClick={() => setShowDiff(!showDiff)}>
									{showDiff ? 'Show clean' : 'Show diff'}
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							{showDiff && result.diffHighlights.length > 0 ? (
								<div className="space-y-2 rounded-md bg-muted p-4 text-sm leading-relaxed">
									{result.diffHighlights.map((d, i) => (
										<span
											key={i}
											className={
												d.type === 'add'
													? 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200'
													: d.type === 'remove'
														? 'bg-red-100 text-red-900 line-through dark:bg-red-900/30 dark:text-red-200'
														: d.type === 'rewrite'
															? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
															: ''
											}
										>
											{d.text}
										</span>
									))}
								</div>
							) : (
								<div className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm leading-relaxed">
									{result.optimizedCoverLetter}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Feedback */}
					{result.feedback && (
						<div className="grid gap-4 md:grid-cols-2">
							<Card>
								<CardHeader>
									<CardTitle className="text-base flex items-center gap-2">
										<Check className="h-4 w-4 text-green-500" />
										Strengths
									</CardTitle>
								</CardHeader>
								<CardContent>
									<ul className="space-y-1">
										{result.feedback.strengths.map((s, i) => (
											<li key={i} className="flex items-start gap-2 text-sm">
												<ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
												{s}
											</li>
										))}
									</ul>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle className="text-base flex items-center gap-2">
										<X className="h-4 w-4 text-red-500" />
										Areas to Improve
									</CardTitle>
								</CardHeader>
								<CardContent>
									<ul className="space-y-1">
										{result.feedback.weaknesses.map((s, i) => (
											<li key={i} className="flex items-start gap-2 text-sm">
												<ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
												{s}
											</li>
										))}
									</ul>
								</CardContent>
							</Card>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
