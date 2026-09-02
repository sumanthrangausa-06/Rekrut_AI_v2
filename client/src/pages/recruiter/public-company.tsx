import {
	AlertTriangle,
	ArrowRight,
	Award,
	Briefcase,
	Building2,
	Calendar,
	CheckCircle,
	Globe,
	Heart,
	Linkedin,
	MapPin,
	MessageSquare,
	Shield,
	Sparkles,
	Star,
	ThumbsUp,
	Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apiCall } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────

interface PublicCompany {
	id: number;
	name: string;
	slug: string;
	description: string;
	industry: string;
	company_size: string;
	website: string;
	linkedin_url: string;
	headquarters: string;
	founded_year: number;
	logo_url: string;
	is_verified: boolean;
	culture_description: string;
	core_values: string[];
	benefits: string[];
	office_locations: string[];
	trust_score: number;
	score_tier: string;
	total_ratings: number;
	avg_rating: number;
	avg_overall: number;
	avg_interview: number;
	avg_communication: number;
	avg_transparency: number;
	avg_culture: number;
	avg_growth: number;
}

interface PublicTrustScoreV2 {
	score: number;
	tier: string;
	tier_label: string;
	tier_color: string;
	insufficient_data: boolean;
	data_sufficiency_score: number;
}

interface V2Factor {
	score: number;
	max: number;
	sufficient?: boolean;
	message?: string;
}

interface PublicTrustScoreResponse {
	success: boolean;
	company: PublicCompany;
	trustscore: PublicTrustScoreV2;
	factors: Record<string, V2Factor>;
	ai_summary: string | null;
	badges: Array<{ type: string; label: string }>;
	reviews: PublicReview[];
	company_responses: CompanyResponse[];
}

interface PublicJob {
	id: number;
	title: string;
	location: string;
	salary_range: string;
	job_type: string;
	created_at: string;
	match_score?: number;
}

interface PublicReview {
	overall_rating: number;
	interview_experience: number;
	communication: number;
	review_text: string;
	pros: string;
	cons: string;
	created_at: string;
	reviewer_name: string;
}

interface CompanyResponse {
	review_id: number;
	response_text: string;
	created_at: string;
}

interface TeamMember {
	id: number;
	name: string;
	role: string;
	avatar_url?: string;
}

// ─── Helpers ────────────────────────────────────────────────

const tierColors: Record<string, string> = {
	exceptional: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
	excellent: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
	trusted: 'bg-green-500/10 text-green-600 border-green-500/30',
	good: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
	building: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
	new: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
};

const factorLabels: Record<string, string> = {
	verification: 'Company Verification',
	job_authenticity: 'Job Authenticity',
	hiring_ratio: 'Hiring Ratio',
	feedback: 'Candidate Feedback',
	behavior: 'Platform Behavior',
	employee_satisfaction: 'Employee Satisfaction',
	interview_experience: 'Interview Experience',
	offer_acceptance_rate: 'Offer Acceptance Rate',
	time_to_hire: 'Time to Hire',
	response_rate: 'Response Rate',
	salary_competitiveness: 'Salary Competitiveness',
	diversity_metrics: 'Diversity Metrics',
	career_growth: 'Career Growth',
};

const factorOrder = [
	'response_rate',
	'interview_experience',
	'employee_satisfaction',
	'offer_acceptance_rate',
	'time_to_hire',
	'salary_competitiveness',
	'career_growth',
	'diversity_metrics',
];

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
	const s = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
	return (
		<div className="flex gap-0.5">
			{[1, 2, 3, 4, 5].map((i) => (
				<Star
					key={i}
					className={`${s} ${i <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`}
				/>
			))}
		</div>
	);
}

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime();
	const days = Math.floor(diff / 86400000);
	if (days === 0) return 'Today';
	if (days === 1) return '1 day ago';
	if (days < 30) return `${days} days ago`;
	if (days < 365) return `${Math.floor(days / 30)} months ago`;
	return `${Math.floor(days / 365)} years ago`;
}

// ─── Main Component ─────────────────────────────────────────

export function PublicCompanyPage() {
	const { slug } = useParams();
	const [company, setCompany] = useState<PublicCompany | null>(null);
	const [trustscoreV2, setTrustscoreV2] = useState<PublicTrustScoreResponse | null>(null);
	const [jobs, setJobs] = useState<PublicJob[]>([]);
	const [reviews, setReviews] = useState<PublicReview[]>([]);
	const [team, setTeam] = useState<TeamMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [companyData, jobsData, reviewsData, teamData] = await Promise.allSettled([
				apiCall<{ company: PublicCompany }>(`/company/public/${slug}`),
				apiCall<{ jobs: PublicJob[] }>(`/company/${slug}/jobs`),
				apiCall<{ reviews: PublicReview[] }>(`/company/${slug}/reviews`),
				apiCall<{ team: TeamMember[] }>(`/company/${slug}/team`),
			]);

			if (companyData.status === 'fulfilled') {
				setCompany(companyData.value.company);
			} else {
				setError('Failed to load company profile');
			}
			setJobs(jobsData.status === 'fulfilled' ? jobsData.value.jobs || [] : []);
			setReviews(reviewsData.status === 'fulfilled' ? reviewsData.value.reviews || [] : []);
			setTeam(teamData.status === 'fulfilled' ? teamData.value.team || [] : []);

			// Load TrustScore v2 if we have company ID
			if (companyData.status === 'fulfilled' && companyData.value.company?.id) {
				try {
					const tsData = await apiCall<PublicTrustScoreResponse>(
						`/trustscore/company/${companyData.value.company.id}/public`,
					);
					setTrustscoreV2(tsData);
				} catch {
					// TrustScore v2 is optional — don't block page load
				}
			}
		} catch (_err) {
			setError('Failed to load company profile');
		} finally {
			setLoading(false);
		}
	}, [slug]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
			</div>
		);
	}

	if (!company) {
		return (
			<div className="text-center py-20">
				<Building2 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
				<h2 className="font-heading text-xl font-bold">{error || 'Company Not Found'}</h2>
				<p className="text-muted-foreground mt-2">
					This company profile doesn't exist or has been removed.
				</p>
				<Button className="mt-4" asChild>
					<Link to="/candidate/jobs">Browse Jobs</Link>
				</Button>
			</div>
		);
	}

	const c = company;
	const ts = trustscoreV2?.trustscore;
	const factors = trustscoreV2?.factors || {};

	// Use v2 score if available, fallback to v1
	const displayScore = ts?.score ?? c.trust_score;
	const displayTier = ts?.tier ?? c.score_tier;
	const displayTierLabel =
		ts?.tier_label ??
		(c.score_tier ? c.score_tier.charAt(0).toUpperCase() + c.score_tier.slice(1) : 'New Employer');
	const insufficientData = ts?.insufficient_data ?? false;
	const responseFactor = factors.response_rate;
	const responsePct =
		responseFactor?.sufficient && responseFactor.max > 0
			? Math.round((responseFactor.score / responseFactor.max) * 100)
			: null;

	return (
		<div className="space-y-8">
			{/* Hero Section */}
			<div className="relative bg-gradient-to-br from-primary/5 via-card to-cyan-500/5 rounded-2xl border border-primary/10 overflow-hidden">
				<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
				<div className="relative p-8 md:p-12">
					<div className="flex flex-col md:flex-row items-start gap-6">
						{/* Logo */}
						<div className="h-24 w-24 rounded-2xl bg-white border-2 border-border shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
							{c.logo_url ? (
								<img
									src={c.logo_url}
									alt={c.name}
									className="h-full w-full object-cover"
									loading="lazy"
								/>
							) : (
								<Building2 className="h-10 w-10 text-primary/60" />
							)}
						</div>

						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-3 flex-wrap">
								<h1 className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold">
									{c.name}
								</h1>
								{c.is_verified && (
									<Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
										<CheckCircle className="h-3 w-3" /> Verified
									</Badge>
								)}
							</div>

							<p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
								{c.description}
							</p>

							<div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-muted-foreground">
								{c.industry && (
									<span className="flex items-center gap-1">
										<Briefcase className="h-3.5 w-3.5" /> {c.industry}
									</span>
								)}
								{c.company_size && (
									<span className="flex items-center gap-1">
										<Users className="h-3.5 w-3.5" /> {c.company_size} employees
									</span>
								)}
								{c.headquarters && (
									<span className="flex items-center gap-1">
										<MapPin className="h-3.5 w-3.5" /> {c.headquarters}
									</span>
								)}
								{c.founded_year && (
									<span className="flex items-center gap-1">
										<Calendar className="h-3.5 w-3.5" /> Est. {c.founded_year}
									</span>
								)}
							</div>

							<div className="flex items-center gap-2 mt-4">
								{c.website && (
									<a href={c.website} target="_blank" rel="noopener noreferrer">
										<Button variant="outline" size="sm" className="gap-1.5">
											<Globe className="h-3.5 w-3.5" /> Website
										</Button>
									</a>
								)}
								{c.linkedin_url && (
									<a href={c.linkedin_url} target="_blank" rel="noopener noreferrer">
										<Button variant="outline" size="sm" className="gap-1.5">
											<Linkedin className="h-3.5 w-3.5" /> LinkedIn
										</Button>
									</a>
								)}
								<Button size="sm" className="gap-1.5" asChild>
									<Link to={`/candidate/jobs?company=${c.id}`}>
										<Briefcase className="h-3.5 w-3.5" /> View Jobs
									</Link>
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Stats Bar */}
			<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
				<Card>
					<CardContent className="p-4 text-center">
						<StarRating rating={c.avg_rating} />
						<p className="font-heading text-2xl font-bold mt-1">{c.avg_rating || '—'}</p>
						<p className="text-xs text-muted-foreground">{c.total_ratings} reviews</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<Shield className="h-5 w-5 mx-auto text-primary mb-1" />
						<div className="flex items-center justify-center gap-1">
							<p className="font-heading text-2xl font-bold">{displayScore}</p>
							{insufficientData && <AlertTriangle className="h-4 w-4 text-amber-500" />}
						</div>
						<p className="text-xs text-muted-foreground">TrustScore</p>
						{displayTier && (
							<Badge
								variant="outline"
								className={`mt-1 text-[10px] ${tierColors[displayTier] || tierColors.new}`}
							>
								{displayTierLabel}
							</Badge>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<Briefcase className="h-5 w-5 mx-auto text-emerald-500 mb-1" />
						<p className="font-heading text-2xl font-bold">{jobs.length}</p>
						<p className="text-xs text-muted-foreground">Open Positions</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4 text-center">
						<Users className="h-5 w-5 mx-auto text-blue-500 mb-1" />
						<p className="font-heading text-2xl font-bold">{c.company_size}</p>
						<p className="text-xs text-muted-foreground">Company Size</p>
					</CardContent>
				</Card>
			</div>

			{/* Response Rate — PROMINENT (Ghosting Metric) */}
			<Card className="border-amber-200 bg-amber-50/30">
				<CardContent className="p-5">
					<div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
						<div className="bg-amber-100 p-3 rounded-full shrink-0">
							<MessageSquare className="h-6 w-6 text-amber-700" />
						</div>
						<div className="flex-1">
							<h3 className="font-semibold text-amber-900 flex items-center gap-2">
								Response Rate
								<span className="text-xs font-normal text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
									anti-ghosting metric
								</span>
							</h3>
							<p className="text-sm text-amber-700 mt-0.5">
								{responsePct != null
									? `This company responds to ${responsePct}% of applications. Companies with high response rates are less likely to ghost candidates.`
									: responseFactor?.message ||
										'Not enough data to calculate response rate. This company needs more applicant interactions to show a reliable metric.'}
							</p>
							{responsePct != null && (
								<div className="mt-2 max-w-xs">
									<Progress value={responsePct} className="h-2" />
									<div className="flex justify-between text-xs text-amber-700 mt-1">
										<span>{responsePct}%</span>
										<span>Target: 95%+</span>
									</div>
								</div>
							)}
						</div>
					</div>
				</CardContent>
			</Card>

			{/* AI Summary */}
			{trustscoreV2?.ai_summary && (
				<Card className="bg-gradient-to-r from-indigo-50/50 to-purple-50/50 border-indigo-200/50">
					<CardContent className="p-5">
						<h3 className="font-semibold text-indigo-900 mb-2 flex items-center gap-2">
							<Sparkles className="h-4 w-4 text-indigo-600" />
							What it's like to work here
						</h3>
						<p className="text-sm text-indigo-800/80 leading-relaxed whitespace-pre-wrap">
							{trustscoreV2.ai_summary}
						</p>
					</CardContent>
				</Card>
			)}

			{/* TrustScore v2 Factors */}
			{trustscoreV2 && (
				<Card>
					<CardContent className="p-6">
						<h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
							<Shield className="h-5 w-5 text-primary" />
							TrustScore Breakdown
							{insufficientData && (
								<Badge
									variant="outline"
									className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] ml-1"
								>
									<AlertTriangle className="h-3 w-3 mr-0.5" />
									Insufficient Data
								</Badge>
							)}
						</h2>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
							{factorOrder.map((key) => {
								const factor = factors[key];
								if (!factor) return null;
								const hasData = factor.sufficient !== false;
								const pct = factor.max > 0 ? Math.round((factor.score / factor.max) * 100) : 0;

								return (
									<div key={key} className="space-y-2">
										<div className="flex items-center justify-between">
											<span className="text-sm font-medium">{factorLabels[key] || key}</span>
											{hasData ? (
												<span className="text-sm font-bold">
													{factor.score}/{factor.max}
												</span>
											) : (
												<span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
													Not enough data
												</span>
											)}
										</div>
										<Progress value={hasData ? pct : 0} className="h-1.5" />
										{factor.message && (
											<p className="text-xs text-muted-foreground">{factor.message}</p>
										)}
									</div>
								);
							})}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Ratings Breakdown (legacy) */}
			<Card>
				<CardContent className="p-6">
					<h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
						<ThumbsUp className="h-5 w-5 text-primary" /> Candidate Ratings
					</h2>
					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
						{[
							{ label: 'Overall', value: c.avg_overall },
							{ label: 'Interview', value: c.avg_interview },
							{ label: 'Communication', value: c.avg_communication },
							{ label: 'Transparency', value: c.avg_transparency },
							{ label: 'Culture', value: c.avg_culture },
							{ label: 'Growth', value: c.avg_growth },
						].map((item) => (
							<div key={item.label} className="text-center">
								<StarRating rating={item.value} />
								<p className="font-heading text-xl font-bold mt-1">{item.value || '—'}</p>
								<p className="text-xs text-muted-foreground">{item.label}</p>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Badges */}
			{trustscoreV2?.badges && trustscoreV2.badges.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{trustscoreV2.badges.map((badge) => (
						<Badge key={badge.type} variant="secondary" className="gap-1 h-7 px-3">
							<Shield className="h-3 w-3" />
							{badge.label}
						</Badge>
					))}
				</div>
			)}

			{/* Culture & Values */}
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
				<Card>
					<CardContent className="p-6">
						<h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
							<Heart className="h-5 w-5 text-red-500" /> Our Culture
						</h2>
						<p className="text-muted-foreground leading-relaxed">{c.culture_description}</p>
						{c.core_values && c.core_values.length > 0 && (
							<div className="flex flex-wrap gap-2 mt-4">
								{c.core_values.map((v) => (
									<Badge key={v} variant="secondary" className="gap-1">
										<Sparkles className="h-3 w-3 text-amber-500" /> {v}
									</Badge>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardContent className="p-6">
						<h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
							<Award className="h-5 w-5 text-emerald-500" /> Benefits & Perks
						</h2>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
							{c.benefits.map((b) => (
								<div key={b} className="flex items-center gap-2 text-sm">
									<CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
									<span>{b}</span>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Office Locations */}
			{c.office_locations && c.office_locations.length > 0 && (
				<Card>
					<CardContent className="p-6">
						<h2 className="font-heading text-lg font-bold mb-4 flex items-center gap-2">
							<MapPin className="h-5 w-5 text-primary" /> Office Locations
						</h2>
						<div className="flex flex-wrap gap-2">
							{c.office_locations.map((loc) => (
								<Badge key={loc} variant="outline" className="gap-1">
									<MapPin className="h-3 w-3" /> {loc}
								</Badge>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Open Positions */}
			<div>
				<h2 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
					<Briefcase className="h-5 w-5 text-primary" /> Open Positions
				</h2>
				{jobs.length === 0 ? (
					<Card className="border-dashed">
						<CardContent className="p-8 text-center">
							<Briefcase className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
							<p className="text-muted-foreground">No open positions at this time</p>
						</CardContent>
					</Card>
				) : (
					<div className="space-y-3">
						{jobs.map((job) => (
							<Card key={job.id} className="hover:border-primary/30 transition-colors">
								<CardContent className="p-4">
									<div className="flex items-start justify-between gap-4">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<h3 className="font-semibold">{job.title}</h3>
												{job.match_score && (
													<Badge
														variant="outline"
														className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
													>
														{job.match_score}% Match
													</Badge>
												)}
											</div>
											<div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
												<span className="flex items-center gap-1">
													<MapPin className="h-3.5 w-3.5" /> {job.location}
												</span>
												<span className="flex items-center gap-1">
													<Briefcase className="h-3.5 w-3.5" /> {job.job_type}
												</span>
												{job.salary_range && (
													<span className="flex items-center gap-1 text-emerald-600 font-medium">
														{job.salary_range}
													</span>
												)}
											</div>
										</div>
										<div className="flex flex-col items-end gap-1 shrink-0">
											<Button size="sm" asChild>
												<Link to={`/candidate/jobs/${job.id}`}>
													Apply <ArrowRight className="h-3.5 w-3.5 ml-1" />
												</Link>
											</Button>
											<span className="text-[10px] text-muted-foreground">
												{timeAgo(job.created_at)}
											</span>
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>

			{/* Team */}
			{team.length > 0 && (
				<div>
					<h2 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
						<Users className="h-5 w-5 text-primary" /> Meet the Team
					</h2>
					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
						{team.map((member) => (
							<Card key={member.id} className="text-center">
								<CardContent className="p-4">
									<div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
										<span className="text-lg font-bold text-primary">
											{member.name[0]?.toUpperCase()}
										</span>
									</div>
									<p className="font-medium text-sm truncate">{member.name}</p>
									<p className="text-xs text-muted-foreground">{member.role}</p>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			)}

			{/* Reviews */}
			{reviews.length > 0 && (
				<div>
					<h2 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
						<ThumbsUp className="h-5 w-5 text-primary" /> Candidate Reviews
					</h2>
					<div className="grid gap-4 md:grid-cols-2">
						{reviews.slice(0, 4).map((review, i) => {
							const response = trustscoreV2?.company_responses?.find(
								(r) => r.review_id === i, // rough match — backend would provide proper IDs
							);
							return (
								<Card key={review.created_at || `review-${i}`}>
									<CardContent className="p-4">
										<div className="flex items-center justify-between mb-2">
											<div className="flex items-center gap-2">
												<StarRating rating={review.overall_rating} />
												<span className="text-xs text-muted-foreground">
													{review.reviewer_name}
												</span>
											</div>
											<span className="text-[10px] text-muted-foreground">
												{timeAgo(review.created_at)}
											</span>
										</div>
										<p className="text-sm text-muted-foreground mb-3">{review.review_text}</p>
										<div className="flex gap-4">
											{review.pros && (
												<div className="flex-1">
													<p className="text-[10px] font-medium text-emerald-600 mb-0.5">Pros</p>
													<p className="text-xs text-muted-foreground">{review.pros}</p>
												</div>
											)}
											{review.cons && (
												<div className="flex-1">
													<p className="text-[10px] font-medium text-red-500 mb-0.5">Cons</p>
													<p className="text-xs text-muted-foreground">{review.cons}</p>
												</div>
											)}
										</div>
										{response && (
											<div className="mt-3 pt-3 border-t bg-muted/30 -mx-4 -mb-4 px-4 pb-4 rounded-b-lg">
												<p className="text-[10px] font-medium text-primary mb-1">
													Company Response
												</p>
												<p className="text-xs text-muted-foreground">{response.response_text}</p>
											</div>
										)}
									</CardContent>
								</Card>
							);
						})}
					</div>
				</div>
			)}

			{/* CTA Footer */}
			<Card className="bg-gradient-to-r from-primary/10 to-cyan-500/10 border-primary/20">
				<CardContent className="p-8 text-center">
					<h2 className="font-heading text-xl font-bold mb-2">Interested in joining {c.name}?</h2>
					<p className="text-muted-foreground mb-4">
						Explore open positions and apply with your Rekrut AI profile.
					</p>
					<Button size="lg" className="gap-2" asChild>
						<Link to="/candidate/jobs">
							<Briefcase className="h-4 w-4" /> View All Jobs
						</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
