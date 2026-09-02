import { AlertCircle, BookOpen, Briefcase, ChevronRight, Target, Zap } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { SkillGap } from './types';

export function SkillGapsTab() {
	const [targetRole, setTargetRole] = useState('');
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<{
		targetRole: string;
		gapAnalysis: SkillGap[];
		qualifyingJobsNow: Array<{
			id: number;
			title: string;
			company: string;
			missingSkills: string[];
		}>;
		qualifyingJobsAfter: Array<{ id: number; title: string; company: string }>;
		actionPlan: Array<{
			skill: string;
			estimated_hours: number;
			priority: string;
			resource_suggestions: string[];
			milestone: string;
		}>;
		summary: string;
	} | null>(null);
	const [error, setError] = useState('');

	async function handleAnalyze() {
		if (!targetRole.trim()) return;
		setLoading(true);
		setError('');
		try {
			const res = await fetch('/api/career-coach/skill-gaps', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetRole }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to analyze skill gaps');
			setResult(data);
		} catch (err: unknown) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	}

	const priorityColor = (p: string) => {
		switch (p) {
			case 'critical':
				return 'bg-red-500';
			case 'high':
				return 'bg-orange-500';
			case 'medium':
				return 'bg-yellow-500';
			default:
				return 'bg-green-500';
		}
	};

	const priorityBadge = (p: string) => {
		switch (p) {
			case 'critical':
				return 'destructive';
			case 'high':
				return 'secondary';
			default:
				return 'outline';
		}
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Target className="h-5 w-5 text-indigo-500" />
						Skill Gap Analysis
					</CardTitle>
					<CardDescription>
						Enter a target role to see what skills you're missing and which real jobs you'd qualify
						for.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="target-role-sg">Target role</Label>
						<Input
							id="target-role-sg"
							placeholder="e.g. Data Engineer, Product Manager"
							value={targetRole}
							onChange={(e) => setTargetRole(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
						/>
					</div>
					<Button
						onClick={handleAnalyze}
						disabled={loading || !targetRole.trim()}
						className="bg-indigo-500 hover:bg-indigo-600"
					>
						{loading ? 'Analyzing...' : 'Analyze Skill Gaps'}
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
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-24 w-full" />
				</div>
			)}

			{result && (
				<div className="space-y-6">
					{result.summary && (
						<Card className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20">
							<CardContent className="py-4">
								<p className="text-sm text-indigo-900 dark:text-indigo-100">{result.summary}</p>
							</CardContent>
						</Card>
					)}

					{/* Gap Analysis */}
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Skill Gaps</CardTitle>
							<CardDescription>Skills you need to reach {result.targetRole}</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{result.gapAnalysis.map((gap) => (
								<div key={gap.skill} className="space-y-2">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<span className="font-medium">{gap.skill}</span>
											<Badge variant={priorityBadge(gap.priority) as any} className="text-xs">
												{gap.priority}
											</Badge>
										</div>
										<span className="text-xs text-muted-foreground">
											L{gap.current_level} → L{gap.required_level}
										</span>
									</div>
									<Progress
										value={(gap.current_level / Math.max(gap.required_level, 1)) * 100}
										className={`h-2 ${priorityColor(gap.priority)}`}
									/>
									{gap.jobs_requiring_it.length > 0 && (
										<div className="flex flex-wrap gap-1 pt-1">
											{gap.jobs_requiring_it.slice(0, 3).map((j) => (
												<Badge key={j.job_id} variant="outline" className="text-xs">
													<Briefcase className="mr-1 h-3 w-3" />
													{j.title} at {j.company}
												</Badge>
											))}
										</div>
									)}
								</div>
							))}
						</CardContent>
					</Card>

					{/* Action Plan */}
					{result.actionPlan.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-base flex items-center gap-2">
									<Zap className="h-4 w-4 text-indigo-500" />
									Action Plan
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									{result.actionPlan.map((item, i) => (
										<div key={i} className="flex items-start justify-between rounded-lg border p-3">
											<div className="space-y-1">
												<div className="flex items-center gap-2">
													<span className="font-medium">{item.skill}</span>
													<Badge variant={priorityBadge(item.priority) as any} className="text-xs">
														{item.priority}
													</Badge>
												</div>
												<p className="text-xs text-muted-foreground">
													<BookOpen className="inline h-3 w-3 mr-1" />
													{item.estimated_hours} hours • {item.milestone}
												</p>
												{item.resource_suggestions.length > 0 && (
													<div className="flex flex-wrap gap-1 pt-1">
														{item.resource_suggestions.map((r, ri) => (
															<Badge key={ri} variant="outline" className="text-xs">
																{r}
															</Badge>
														))}
													</div>
												)}
											</div>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}

					{/* Qualifying Jobs */}
					<div className="grid gap-4 md:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Jobs you qualify for now</CardTitle>
							</CardHeader>
							<CardContent>
								{result.qualifyingJobsNow.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No qualifying jobs found yet. Focus on the skill gaps above.
									</p>
								) : (
									<div className="space-y-2">
										{result.qualifyingJobsNow.map((job) => (
											<div key={job.id} className="rounded-lg border p-3">
												<div className="flex items-center justify-between">
													<p className="font-medium text-sm">{job.title}</p>
													<Badge variant="outline" className="text-xs">
														{job.missingSkills.length} gaps
													</Badge>
												</div>
												<p className="text-xs text-muted-foreground">{job.company}</p>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className="text-base">Jobs after closing gaps</CardTitle>
							</CardHeader>
							<CardContent>
								{result.qualifyingJobsAfter.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										Focus on building the required skills to unlock more opportunities.
									</p>
								) : (
									<div className="space-y-2">
										{result.qualifyingJobsAfter.map((job) => (
											<div key={job.id} className="flex items-center gap-2 rounded-lg border p-3">
												<ChevronRight className="h-4 w-4 text-green-500" />
												<div>
													<p className="font-medium text-sm">{job.title}</p>
													<p className="text-xs text-muted-foreground">{job.company}</p>
												</div>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>
					</div>
				</div>
			)}
		</div>
	);
}
