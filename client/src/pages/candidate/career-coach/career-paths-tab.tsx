import { AlertCircle, Briefcase, ChevronRight, Clock, Map as MapIcon, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { CareerPathway } from './types';

export function CareerPathsTab() {
	const [targetRole, setTargetRole] = useState('');
	const [yearsAhead, setYearsAhead] = useState(5);
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<{
		pathways: CareerPathway[];
		summary: string;
		groundedJobs: Array<{
			id: number;
			title: string;
			company: string;
			location: string;
			salaryMin: number | null;
			salaryMax: number | null;
			currency: string;
			jobType: string;
		}>;
	} | null>(null);
	const [error, setError] = useState('');

	async function handleGenerate() {
		setLoading(true);
		setError('');
		try {
			const res = await fetch('/api/career-coach/career-paths', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetRole: targetRole || null, yearsAhead }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to generate career paths');
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
						<MapIcon className="h-5 w-5 text-indigo-500" />
						Career Path Recommendations
					</CardTitle>
					<CardDescription>
						Discover where your profile could take you next, based on real market data and your
						OmniScore.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="target-role">Target role (optional)</Label>
							<Input
								id="target-role"
								placeholder="e.g. Senior Frontend Engineer"
								value={targetRole}
								onChange={(e) => setTargetRole(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="years-ahead">Time horizon (years)</Label>
							<Input
								id="years-ahead"
								type="number"
								min={1}
								max={10}
								value={yearsAhead}
								onChange={(e) => setYearsAhead(Number(e.target.value))}
							/>
						</div>
					</div>
					<Button
						onClick={handleGenerate}
						disabled={loading}
						className="bg-indigo-500 hover:bg-indigo-600"
					>
						{loading ? 'Analyzing...' : 'Generate Career Paths'}
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
					<Skeleton className="h-32 w-full" />
					<Skeleton className="h-32 w-full" />
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

					{result.pathways.map((pathway, pIdx) => (
						<Card key={pIdx}>
							<CardHeader className="pb-3">
								<div className="flex items-center justify-between">
									<CardTitle className="text-lg">{pathway.pathway_name}</CardTitle>
									<div className="flex gap-2">
										<Badge
											variant={
												pathway.overall_confidence === 'high'
													? 'default'
													: pathway.overall_confidence === 'medium'
														? 'secondary'
														: 'outline'
											}
										>
											{pathway.overall_confidence} confidence
										</Badge>
										<Badge variant="outline">
											{pathway.market_trend === 'growing' ? (
												<span className="flex items-center gap-1 text-green-600">
													<TrendingUp className="h-3 w-3" /> Growing market
												</span>
											) : (
												pathway.market_trend
											)}
										</Badge>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								<div className="space-y-4">
									{pathway.steps.map((step) => (
										<div key={step.step_number} className="relative pl-6">
											<div className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
												{step.step_number}
											</div>
											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<h4 className="font-semibold">{step.role}</h4>
													<span className="flex items-center gap-1 text-xs text-muted-foreground">
														<Clock className="h-3 w-3" /> {step.timeframe}
													</span>
												</div>
												{step.avg_salary_range && (
													<p className="text-sm text-muted-foreground">
														Salary: {step.avg_salary_range}
													</p>
												)}
												{step.skills_to_acquire.length > 0 && (
													<div className="flex flex-wrap gap-1">
														{step.skills_to_acquire.map((s) => (
															<Badge key={s} variant="outline" className="text-xs">
																{s}
															</Badge>
														))}
													</div>
												)}
												{step.grounded_jobs.length > 0 && (
													<div className="mt-2 rounded-md bg-muted p-2">
														<p className="mb-1 text-xs font-medium text-muted-foreground">
															Real open jobs matching this step:
														</p>
														<div className="space-y-1">
															{step.grounded_jobs.map((j) => (
																<div key={j.job_id} className="flex items-center gap-2 text-xs">
																	<Briefcase className="h-3 w-3 text-indigo-500" />
																	<span className="font-medium">{j.title}</span>
																	<span className="text-muted-foreground">at {j.company}</span>
																</div>
															))}
														</div>
													</div>
												)}
												{step.action_items.length > 0 && (
													<ul className="mt-2 space-y-1">
														{step.action_items.map((item, i) => (
															<li key={i} className="flex items-start gap-2 text-xs">
																<ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-indigo-500" />
																{item}
															</li>
														))}
													</ul>
												)}
											</div>
											{pIdx < pathway.steps.length - 1 && <Separator className="my-3" />}
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					))}

					{result.groundedJobs.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Open jobs on the platform</CardTitle>
								<CardDescription>These are real jobs you could apply for right now</CardDescription>
							</CardHeader>
							<CardContent>
								<ScrollArea className="h-64">
									<div className="space-y-3">
										{result.groundedJobs.map((job) => (
											<div
												key={job.id}
												className="flex items-center justify-between rounded-lg border p-3"
											>
												<div>
													<p className="font-medium">{job.title}</p>
													<p className="text-sm text-muted-foreground">
														{job.company} • {job.location}
													</p>
												</div>
												<div className="text-right">
													{job.salaryMin && job.salaryMax && (
														<p className="text-sm font-medium">
															${job.salaryMin.toLocaleString()} -{job.salaryMax.toLocaleString()}{' '}
															{job.currency}
														</p>
													)}
													<Badge variant="outline" className="text-xs">
														{job.jobType}
													</Badge>
												</div>
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
