import {
	AlertTriangle,
	Building2,
	CheckCircle2,
	MessageCircle,
	Search,
	Shield,
	ThumbsUp,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { CompanyBrief } from './types';

export function CompanyResearchTab() {
	const [companyId, setCompanyId] = useState('');
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<{
		company: {
			id: number;
			name: string;
			industry: string;
			size: string;
			headquarters: string;
			isVerified: boolean;
		};
		trustscore: { score: number; tier: string; breakdown: Record<string, number> } | null;
		feedback: { averageRating: string; count: number } | null;
		activeJobs: number;
		brief: CompanyBrief;
	} | null>(null);
	const [error, setError] = useState('');

	async function handleResearch() {
		if (!companyId.trim()) return;
		setLoading(true);
		setError('');
		try {
			const res = await fetch('/api/career-coach/company-research', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ companyId: Number(companyId) }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to research company');
			setResult(data);
		} catch (err: any) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	}

	const verdictIcon = (verdict: string) => {
		switch (verdict) {
			case 'strong_recommend':
				return <ThumbsUp className="h-5 w-5 text-green-500" />;
			case 'recommend':
				return <CheckCircle2 className="h-5 w-5 text-blue-500" />;
			case 'caution':
				return <AlertTriangle className="h-5 w-5 text-amber-500" />;
			case 'avoid':
				return <AlertTriangle className="h-5 w-5 text-red-500" />;
			default:
				return null;
		}
	};

	const verdictColor = (verdict: string) => {
		switch (verdict) {
			case 'strong_recommend':
				return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200';
			case 'recommend':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200';
			case 'caution':
				return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
			case 'avoid':
				return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200';
			default:
				return 'bg-gray-100 text-gray-800';
		}
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Building2 className="h-5 w-5 text-indigo-500" />
						Company Research Assistant
					</CardTitle>
					<CardDescription>
						Get a pre-interview brief on any company — TrustScore, culture, salary benchmarks, and
						recommended questions.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="company-id">Company ID</Label>
						<div className="flex gap-2">
							<Input
								id="company-id"
								type="number"
								placeholder="Enter company ID from a job posting"
								value={companyId}
								onChange={(e) => setCompanyId(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
							/>
							<Button
								onClick={handleResearch}
								disabled={loading || !companyId.trim()}
								className="bg-indigo-500 hover:bg-indigo-600"
							>
								<Search className="h-4 w-4 mr-1" />
								{loading ? '...' : 'Research'}
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Tip: Find the company ID on any job detail page.
						</p>
					</div>
					{error && (
						<div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
							<AlertTriangle className="h-4 w-4 shrink-0" />
							{error}
						</div>
					)}
				</CardContent>
			</Card>

			{loading && (
				<div className="space-y-4">
					<Skeleton className="h-32 w-full" />
					<Skeleton className="h-48 w-full" />
				</div>
			)}

			{result && (
				<div className="space-y-6">
					{/* Company Header */}
					<Card>
						<CardContent className="py-5">
							<div className="flex items-start justify-between">
								<div>
									<h2 className="text-xl font-bold">{result.company.name}</h2>
									<div className="mt-1 flex flex-wrap gap-2">
										{result.company.industry && (
											<Badge variant="outline">{result.company.industry}</Badge>
										)}
										{result.company.size && <Badge variant="outline">{result.company.size}</Badge>}
										{result.company.headquarters && (
											<Badge variant="outline">{result.company.headquarters}</Badge>
										)}
										{result.company.isVerified && (
											<Badge className="bg-green-500 hover:bg-green-600">Verified</Badge>
										)}
										<Badge variant="secondary">{result.activeJobs} open jobs</Badge>
									</div>
								</div>
								<div className="flex items-center gap-2">
									{verdictIcon(result.brief.verdict)}
									<Badge className={verdictColor(result.brief.verdict)}>
										{result.brief.verdict.replace('_', ' ')}
									</Badge>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* TrustScore */}
					{result.trustscore && (
						<Card>
							<CardHeader>
								<CardTitle className="text-base flex items-center gap-2">
									<Shield className="h-4 w-4 text-indigo-500" />
									TrustScore: {result.trustscore.score}/1000
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
									{Object.entries(result.trustscore.breakdown).map(([key, val]) => (
										<div key={key} className="rounded-md bg-muted p-2 text-center">
											<p className="text-xs text-muted-foreground capitalize">
												{key.replace(/_/g, ' ')}
											</p>
											<p className="text-lg font-bold">{val}</p>
										</div>
									))}
								</div>
								{result.brief.trustscore_analysis && (
									<div className="mt-4 space-y-2">
										{result.brief.trustscore_analysis.strengths.length > 0 && (
											<div>
												<p className="text-xs font-medium text-green-700 dark:text-green-300">
													Strengths
												</p>
												<ul className="ml-4 list-disc text-xs text-muted-foreground">
													{result.brief.trustscore_analysis.strengths.map((s, i) => (
														<li key={i}>{s}</li>
													))}
												</ul>
											</div>
										)}
										{result.brief.trustscore_analysis.red_flags.length > 0 && (
											<div>
												<p className="text-xs font-medium text-red-700 dark:text-red-300">
													Red Flags
												</p>
												<ul className="ml-4 list-disc text-xs text-muted-foreground">
													{result.brief.trustscore_analysis.red_flags.map((s, i) => (
														<li key={i}>{s}</li>
													))}
												</ul>
											</div>
										)}
									</div>
								)}
							</CardContent>
						</Card>
					)}

					{/* Culture & Interview */}
					<div className="grid gap-4 md:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Culture</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3 text-sm">
								<p>{result.brief.culture?.overview}</p>
								{result.brief.culture?.work_life_balance && (
									<div>
										<p className="font-medium">Work-Life Balance</p>
										<p className="text-muted-foreground">
											{result.brief.culture.work_life_balance}
										</p>
									</div>
								)}
								{result.brief.culture?.growth_opportunities && (
									<div>
										<p className="font-medium">Growth</p>
										<p className="text-muted-foreground">
											{result.brief.culture.growth_opportunities}
										</p>
									</div>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className="text-base">Interview Process</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								{result.brief.interview_process?.stages && (
									<div className="space-y-1">
										{result.brief.interview_process.stages.map((stage, i) => (
											<div key={i} className="flex items-center gap-2 text-sm">
												<span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
													{i + 1}
												</span>
												{stage}
											</div>
										))}
									</div>
								)}
								{result.brief.interview_process?.typical_timeline && (
									<p className="text-xs text-muted-foreground">
										Timeline: {result.brief.interview_process.typical_timeline}
									</p>
								)}
								{result.brief.interview_process?.tips && (
									<div className="mt-2 rounded-md bg-muted p-2">
										<p className="mb-1 text-xs font-medium">Tips</p>
										<ul className="ml-4 list-disc text-xs text-muted-foreground">
											{result.brief.interview_process.tips.map((t, i) => (
												<li key={i}>{t}</li>
											))}
										</ul>
									</div>
								)}
							</CardContent>
						</Card>
					</div>

					{/* Recommended Questions */}
					{result.brief.recommended_questions && result.brief.recommended_questions.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-base flex items-center gap-2">
									<MessageCircle className="h-4 w-4 text-indigo-500" />
									Questions to Ask
								</CardTitle>
							</CardHeader>
							<CardContent>
								<ScrollArea className="h-64">
									<div className="space-y-3">
										{result.brief.recommended_questions.map((q, i) => (
											<div key={i} className="rounded-lg border p-3">
												<Badge variant="outline" className="mb-2 text-xs">
													{q.category}
												</Badge>
												<p className="text-sm font-medium">"{q.question}"</p>
												<p className="mt-1 text-xs text-muted-foreground">Why: {q.why_ask}</p>
											</div>
										))}
									</div>
								</ScrollArea>
							</CardContent>
						</Card>
					)}
				</div>
			)}
		</div>
	);
}
