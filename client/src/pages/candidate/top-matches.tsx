import { Check, ChevronDown, ChevronUp, Lock, Sparkles, Star, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JobCard } from '@/components/domain/job-card';
import { SEO } from '@/components/SEO';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSubscription } from '@/hooks/use-subscription';
import { trackEvent } from '@/lib/analytics';
import { apiCall } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────

interface ApiJob {
	id: number;
	title: string;
	company: string;
	poster_company?: string;
	company_logo?: string;
	location: string;
	remote_type?: 'remote' | 'hybrid' | 'onsite' | 'flexible';
	job_type: string;
	salary_min?: number;
	salary_max?: number;
	salary_range?: string;
	created_at: string;
	skills_required?: string[];
	weighted_score?: number;
	fit_score?: number;
	match_level?: string;
}

// ─── Mock data for free-tier blurred preview ─────────────────────────────

const MOCK_JOBS = [
	{
		id: 'mock-1',
		title: 'Senior Full-Stack Engineer',
		company: 'TechFlow AI',
		companyLogo: '',
		location: 'San Francisco, CA',
		locationType: 'hybrid' as const,
		jobType: 'full-time' as const,
		salaryMin: 160000,
		salaryMax: 220000,
		salaryCurrency: 'USD' as const,
		salaryPeriod: 'year' as const,
		postedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
		tags: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
		matchScore: 94,
	},
	{
		id: 'mock-2',
		title: 'Product Designer',
		company: 'DesignLab',
		companyLogo: '',
		location: 'Remote',
		locationType: 'remote' as const,
		jobType: 'full-time' as const,
		salaryMin: 120000,
		salaryMax: 165000,
		salaryCurrency: 'USD' as const,
		salaryPeriod: 'year' as const,
		postedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
		tags: ['Figma', 'Design Systems', 'User Research'],
		matchScore: 89,
	},
	{
		id: 'mock-3',
		title: 'Staff Backend Engineer',
		company: 'CloudScale',
		companyLogo: '',
		location: 'New York, NY',
		locationType: 'onsite' as const,
		jobType: 'full-time' as const,
		salaryMin: 200000,
		salaryMax: 280000,
		salaryCurrency: 'USD' as const,
		salaryPeriod: 'year' as const,
		postedAt: new Date(Date.now() - 86400000).toISOString(),
		tags: ['Go', 'Kubernetes', 'AWS', 'gRPC'],
		matchScore: 87,
	},
];

const BENEFITS = [
	"See exactly why you're a fit for each role",
	'Get flagged concerns before you apply',
	'Ranked by competitiveness — apply to the best first',
];

const HOW_IT_WORKS = [
	{
		q: 'How does AI ranking work?',
		a: 'Our AI analyzes your profile, skills, experience, and preferences against every active job. It scores matches on skill alignment, salary fit, location compatibility, and company culture — then ranks them so the best fits appear first.',
	},
	{
		q: 'Is my data used to train models?',
		a: 'No. Your profile data is used only for your personal matching. We never use candidate data to train general-purpose AI models or share it with third parties.',
	},
	{
		q: 'How often are matches refreshed?',
		a: 'Matches update in real-time as new jobs are posted and as your profile evolves. Pro users get priority recalculation whenever they update their skills or preferences.',
	},
];

// ─── Components ──────────────────────────────────────────────────────────

function HowItWorksAccordion() {
	const [openIndex, setOpenIndex] = useState<number | null>(null);

	return (
		<div className="space-y-2">
			{HOW_IT_WORKS.map((item, i) => {
				const isOpen = openIndex === i;
				return (
					<div
						key={i}
						className="border rounded-lg overflow-hidden bg-white/50 dark:bg-slate-900/50"
					>
						<button
							onClick={() => setOpenIndex(isOpen ? null : i)}
							className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
						>
							{item.q}
							{isOpen ? (
								<ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
							) : (
								<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
							)}
						</button>
						{isOpen && (
							<div className="px-4 pb-3 text-sm text-muted-foreground leading-relaxed">
								{item.a}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ─── Page ────────────────────────────────────────────────────────────────

export function CandidateTopMatchesPage() {
	const navigate = useNavigate();
	const { canUseFeature } = useSubscription();
	const isPremium = canUseFeature('top_matches');

	const [jobs, setJobs] = useState<ApiJob[]>([]);
	const [loading, setLoading] = useState(isPremium);
	const [error, setError] = useState(false);

	// ponytail: static counter, no need for randomization per render
	const matchCount = useMemo(() => 9, []);

	useEffect(() => {
		if (!isPremium) {
			trackEvent('top_matches_unlock_cta_shown');
			return;
		}

		let cancelled = false;
		setLoading(true);
		apiCall<{ data: ApiJob[]; pagination: { total: number } }>(
			'/candidate/jobs?sort=match_score&limit=10',
		)
			.then((res) => {
				if (cancelled) return;
				const data = res?.data || [];
				setJobs(data);
				trackEvent('top_matches_view', { count: data.length });
			})
			.catch(() => {
				if (!cancelled) setError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [isPremium]);

	const handleUpgrade = () => {
		trackEvent('top_matches_upgrade_click');
		navigate('/pricing');
	};

	// ─── Premium view ─────────────────────────────────────────────────────
	if (isPremium) {
		return (
			<div className="min-h-[calc(100dvh-4rem)] flex flex-col">
				<SEO
					title="Top Matches — AI-Ranked Jobs for You"
					description="See your highest-ranked job matches, powered by AI. Prioritize the best opportunities first."
					canonical="/candidate/top-matches"
				/>

				{/* Header */}
				<div className="shrink-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 px-4 py-6 sm:py-8">
					<div className="max-w-4xl mx-auto">
						<h1 className="text-white text-xl sm:text-2xl font-bold flex items-center gap-2">
							<Sparkles className="h-5 w-5 shrink-0" />
							<span>Top Matches</span>
							<Badge className="bg-white/20 text-white border-0 text-xs ml-2">Pro</Badge>
						</h1>
						<p className="text-indigo-100 text-sm mt-1">
							AI-ranked jobs tailored for you — apply to the best first
						</p>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 px-3 sm:px-4 py-4 max-w-4xl mx-auto w-full">
					{loading ? (
						<div className="flex items-center justify-center py-16">
							<div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
						</div>
					) : error ? (
						<div className="py-16 text-center">
							<p className="text-muted-foreground">
								Failed to load matches. Please try again later.
							</p>
						</div>
					) : jobs.length === 0 ? (
						<div className="py-16 text-center">
							<div className="rounded-full bg-indigo-50 dark:bg-indigo-900/20 p-4 mb-4 inline-block">
								<Star className="h-12 w-12 text-indigo-300" />
							</div>
							<p className="text-foreground font-semibold text-base">No top matches yet</p>
							<p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
								Complete your profile to get personalized AI-ranked job matches
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{jobs.map((job) => (
								<JobCard
									key={job.id}
									id={String(job.id)}
									title={job.title}
									company={job.company || job.poster_company || 'Company'}
									companyLogo={job.company_logo}
									location={job.location}
									locationType={job.remote_type || 'hybrid'}
									jobType={(job.job_type?.replace('-', '_') as any) || 'full_time'}
									salaryMin={job.salary_min}
									salaryMax={job.salary_max}
									postedAt={job.created_at}
									tags={job.skills_required || []}
									matchScore={
										job.fit_score != null
											? Math.round(job.fit_score)
											: job.weighted_score != null
												? Math.round(job.weighted_score)
												: null
									}
								/>
							))}
						</div>
					)}
				</div>
			</div>
		);
	}

	// ─── Free tier view ───────────────────────────────────────────────────
	return (
		<div className="min-h-[calc(100dvh-4rem)] flex flex-col">
			<SEO
				title="Top Matches — Unlock AI-Ranked Jobs"
				description="Unlock personalized AI-ranked job matches with Rekrut AI Pro. See why you fit each role before applying."
				canonical="/candidate/top-matches"
			/>

			{/* Header */}
			<div className="shrink-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 px-4 py-6 sm:py-8">
				<div className="max-w-4xl mx-auto">
					<h1 className="text-white text-xl sm:text-2xl font-bold flex items-center gap-2">
						<Sparkles className="h-5 w-5 shrink-0" />
						Top Matches
					</h1>
					<p className="text-indigo-100 text-sm mt-1">AI-ranked jobs tailored for you</p>
				</div>
			</div>

			{/* Content with blur overlay */}
			<div className="flex-1 px-3 sm:px-4 py-4 max-w-4xl mx-auto w-full relative">
				{/* Blurred preview cards */}
				<div className="space-y-3 relative">
					{MOCK_JOBS.map((job) => (
						<JobCard key={job.id} {...job} />
					))}

					{/* Frosted glass overlay */}
					<div className="absolute inset-0 backdrop-blur-md bg-white/30 dark:bg-slate-950/40 rounded-lg z-10" />
				</div>

				{/* Centered CTA card */}
				<div className="absolute inset-0 z-20 flex items-center justify-center px-4">
					<Card className="w-full max-w-md shadow-2xl border-indigo-200 dark:border-indigo-800">
						<CardContent className="p-6 sm:p-8 space-y-5">
							{/* Lock + counter */}
							<div className="text-center space-y-2">
								<div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-indigo-100 dark:bg-indigo-900/40 mb-1">
									<Lock className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
								</div>
								<h2 className="text-xl sm:text-2xl font-bold text-foreground">
									{matchCount} Personalized Matches Waiting
								</h2>
								<p className="text-sm text-muted-foreground">
									Upgrade to Pro to see your AI-ranked opportunities
								</p>
							</div>

							{/* Benefit checklist */}
							<div className="space-y-2.5">
								{BENEFITS.map((b) => (
									<div key={b} className="flex items-start gap-2.5">
										<div className="mt-0.5 shrink-0 h-5 w-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
											<Check className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
										</div>
										<span className="text-sm text-foreground">{b}</span>
									</div>
								))}
							</div>

							{/* How it works accordion */}
							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
									How Top Match Works
								</p>
								<HowItWorksAccordion />
							</div>

							{/* CTAs */}
							<div className="space-y-2.5 pt-1">
								<Button
									onClick={handleUpgrade}
									className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm"
								>
									<Zap className="h-4 w-4 mr-1.5" />
									Upgrade to Pro
								</Button>
								<Button
									variant="outline"
									onClick={handleUpgrade}
									className="w-full h-11 font-semibold"
								>
									Start Free Trial
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
