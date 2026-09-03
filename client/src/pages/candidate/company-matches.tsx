import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	BarChart3,
	Briefcase,
	Building2,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronUp,
	Copy,
	Crown,
	Globe,
	Lightbulb,
	Linkedin,
	Loader2,
	Lock,
	Mail,
	Megaphone,
	PenLine,
	RotateCcw,
	Search,
	Send,
	Sparkles,
	Target,
	TrendingUp,
	User,
	Users,
	X,
	Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ValueProposition } from '@/components/domain/value-proposition';
import { SEO } from '@/components/SEO';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────────

interface CompanyMatch {
	id: number;
	name: string;
	industry: string;
	logo_url?: string;
	match_score: number;
	value_hook: string;
	match_reason: string;
	outreach_difficulty: 'easy' | 'medium' | 'hard';
}

interface MatchesResponse {
	success: boolean;
	matches: CompanyMatch[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

interface CompanyAnalysis {
	company_id: number;
	company_name: string;
	company_summary: string;
	culture_fit: string;
	growth_opportunities: string;
	key_decision_makers: string[];
	recommended_approach: string;
}

interface OutreachStrategy {
	company_id: number;
	company_name: string;
	personalized_hook: string;
	email_template: string;
	linkedin_connection_message: string;
	follow_up_strategy: string;
	best_contact_method: 'email' | 'linkedin' | 'referral';
}

interface Profile {
	headline?: string;
	bio?: string;
	skills?: Array<{ skill_name: string; level: number }>;
	experience?: Array<{ title: string; company_name: string }>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const BENEFIT_CARDS = [
	{
		title: 'Top 10 Remote Employers',
		description:
			'Get a curated list of the best remote-first companies actively hiring in your field, ranked by culture, compensation, and growth opportunities.',
	},
	{
		title: 'Personalized Value Hooks',
		description:
			'AI-crafted talking points that highlight your unique fit for each company — use them in cover letters, outreach, and interviews.',
	},
	{
		title: 'Decision Maker Contacts',
		description:
			'Access verified contact details for hiring managers and recruiters so you can skip the ATS and go straight to the source.',
	},
	{
		title: 'Outreach Playbooks',
		description:
			'Proven email and LinkedIn templates with step-by-step follow-up sequences designed to get responses, not ghosted.',
	},
];

const STEPS = [
	{ num: 1, label: 'Positioning', icon: User },
	{ num: 2, label: 'Matches', icon: Search },
	{ num: 3, label: 'Analysis', icon: Lightbulb },
	{ num: 4, label: 'Outreach', icon: Send },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function difficultyBadgeClass(difficulty: string): string {
	switch (difficulty) {
		case 'easy':
			return 'bg-emerald-100 text-emerald-700 border-emerald-200';
		case 'hard':
			return 'bg-red-100 text-red-700 border-red-200';
		default:
			return 'bg-amber-100 text-amber-700 border-amber-200';
	}
}

function difficultyLabel(difficulty: string): string {
	switch (difficulty) {
		case 'easy':
			return 'Easy Reach';
		case 'hard':
			return 'Hard Reach';
		default:
			return 'Medium Reach';
	}
}

function scoreColorClass(score: number): string {
	if (score >= 80) return 'text-emerald-600';
	if (score >= 60) return 'text-amber-600';
	if (score >= 40) return 'text-orange-600';
	return 'text-red-600';
}

function scoreBgClass(score: number): string {
	if (score >= 80) return 'bg-emerald-50 border-emerald-200';
	if (score >= 60) return 'bg-amber-50 border-amber-200';
	if (score >= 40) return 'bg-orange-50 border-orange-200';
	return 'bg-red-50 border-red-200';
}

// ── Copy Button ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback
			const textarea = document.createElement('textarea');
			textarea.value = text;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}, [text]);

	return (
		<Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-8 text-xs shrink-0">
			{copied ? (
				<>
					<Check className="h-3.5 w-3.5 text-emerald-500" />
					Copied
				</>
			) : (
				<>
					<Copy className="h-3.5 w-3.5" />
					Copy
				</>
			)}
		</Button>
	);
}

// ── Progress Stepper ────────────────────────────────────────────────────────

function Stepper({ currentStep }: { currentStep: number }) {
	return (
		<div className="w-full max-w-2xl mx-auto">
			<div className="flex items-center justify-between">
				{STEPS.map((step, i) => {
					const isActive = currentStep === step.num;
					const isCompleted = currentStep > step.num;
					const Icon = step.icon;
					return (
						<div key={step.num} className="flex flex-col items-center gap-1.5 flex-1 relative">
							{/* Connector line */}
							{i < STEPS.length - 1 && (
								<div
									className={cn(
										'absolute top-4 left-1/2 w-full h-0.5',
										isCompleted ? 'bg-primary' : 'bg-muted',
									)}
									style={{ transform: 'translateX(50%)' }}
								/>
							)}
							<div
								className={cn(
									'relative z-10 h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors',
									isActive
										? 'bg-primary border-primary text-primary-foreground'
										: isCompleted
											? 'bg-primary border-primary text-primary-foreground'
											: 'bg-background border-muted-foreground/30 text-muted-foreground',
								)}
							>
								<Icon className="h-4 w-4" />
							</div>
							<span
								className={cn(
									'text-[10px] sm:text-xs font-medium',
									isActive ? 'text-primary' : 'text-muted-foreground',
								)}
							>
								{step.label}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Stats Strip ─────────────────────────────────────────────────────────────

function StatsStrip() {
	const stats = [
		{ icon: Lock, value: '85%', label: 'of jobs are hidden' },
		{ icon: Building2, value: 'Top 10', label: 'employers matched' },
		{ icon: Users, value: '2-3', label: 'contacts per company' },
	];

	return (
		<div className="grid grid-cols-3 gap-3">
			{stats.map((stat) => (
				<Card key={stat.label} className="border-indigo-100 dark:border-indigo-900/40">
					<CardContent className="p-3 sm:p-4 flex flex-col items-center text-center gap-1">
						<stat.icon className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-500 shrink-0" />
						<span className="text-sm sm:text-lg font-bold text-foreground">{stat.value}</span>
						<span className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
							{stat.label}
						</span>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

// ── Problem / Solution Section ──────────────────────────────────────────────

function ProblemSolutionSection() {
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			<Card className="border-slate-200 bg-slate-50/50 dark:bg-slate-900/30">
				<CardContent className="p-4 sm:p-5 space-y-3">
					<div className="flex items-center gap-2">
						<X className="h-4 w-4 text-red-500 shrink-0" />
						<h3 className="font-semibold text-sm">Traditional Job Search</h3>
					</div>
					<ul className="space-y-2 text-sm text-muted-foreground">
						<li className="flex items-start gap-2">
							<span className="text-red-400 mt-0.5">•</span>
							<span>Apply to hundreds of jobs and pray for a response</span>
						</li>
						<li className="flex items-start gap-2">
							<span className="text-red-400 mt-0.5">•</span>
							<span>Compete with thousands of applicants for posted roles</span>
						</li>
						<li className="flex items-start gap-2">
							<span className="text-red-400 mt-0.5">•</span>
							<span>No visibility into company culture or decision makers</span>
						</li>
						<li className="flex items-start gap-2">
							<span className="text-red-400 mt-0.5">•</span>
							<span>Generic outreach that gets ignored</span>
						</li>
					</ul>
				</CardContent>
			</Card>

			<Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-purple-50/30 dark:from-indigo-950/20 dark:to-purple-950/10">
				<CardContent className="p-4 sm:p-5 space-y-3">
					<div className="flex items-center gap-2">
						<Zap className="h-4 w-4 text-indigo-500 shrink-0" />
						<h3 className="font-semibold text-sm">Rekrut AI Approach</h3>
					</div>
					<ul className="space-y-2 text-sm text-muted-foreground">
						<li className="flex items-start gap-2">
							<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
							<span>Targeted outreach to companies that match your profile</span>
						</li>
						<li className="flex items-start gap-2">
							<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
							<span>Access the hidden job market — 85% of roles never posted</span>
						</li>
						<li className="flex items-start gap-2">
							<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
							<span>AI-identified decision makers with contact strategies</span>
						</li>
						<li className="flex items-start gap-2">
							<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
							<span>Personalized hooks and templates that get responses</span>
						</li>
					</ul>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function CompanyMatchesPage() {
	const navigate = useNavigate();
	const [step, setStep] = useState(1);

	// Step 1: Profile / Positioning
	const [profile, setProfile] = useState<Profile | null>(null);
	const [positioning, setPositioning] = useState('');
	const [profileLoading, setProfileLoading] = useState(false);

	// Step 2: Matches
	const [matches, setMatches] = useState<CompanyMatch[]>([]);
	const [matchesPage, setMatchesPage] = useState(1);
	const [matchesTotalPages, setMatchesTotalPages] = useState(1);
	const [matchesLoading, setMatchesLoading] = useState(false);
	const [expandedMatchId, setExpandedMatchId] = useState<number | null>(null);
	const [selectedCompany, setSelectedCompany] = useState<CompanyMatch | null>(null);

	// Step 3: Analysis
	const [analysis, setAnalysis] = useState<CompanyAnalysis | null>(null);
	const [analysisLoading, setAnalysisLoading] = useState(false);

	// Step 4: Outreach
	const [outreach, setOutreach] = useState<OutreachStrategy | null>(null);
	const [outreachLoading, setOutreachLoading] = useState(false);

	// Error state
	const [error, setError] = useState<string | null>(null);

	// ── Load Profile ──
	const loadProfile = useCallback(async () => {
		setProfileLoading(true);
		try {
			const data = await apiCall<{ success: boolean; profile: Profile }>('/candidate/profile');
			const p = data.profile;
			setProfile(p);
			// Build a default positioning statement from headline + bio
			const defaultPositioning = p.headline
				? `${p.headline}${p.bio ? ` — ${p.bio.slice(0, 200)}` : ''}`
				: p.bio || '';
			setPositioning(defaultPositioning);
		} catch (err: any) {
			setError(err?.message || 'Failed to load profile');
		} finally {
			setProfileLoading(false);
		}
	}, []);

	// ── Load Matches ──
	const loadMatches = useCallback(async (page = 1) => {
		setMatchesLoading(true);
		setError(null);
		try {
			const data = await apiCall<MatchesResponse>(
				`/candidate/company-matches?page=${page}&limit=20`,
			);
			setMatches(data.matches || []);
			setMatchesPage(data.page || 1);
			setMatchesTotalPages(data.totalPages || 1);
		} catch (err: any) {
			const code = (err as Error & { code?: string }).code;
			if (code === 'UPGRADE_REQUIRED') {
				setStep(0); // Will show upgrade UI
			} else {
				setError(err?.message || 'Failed to load company matches');
			}
		} finally {
			setMatchesLoading(false);
		}
	}, []);

	// ── Analyze Company ──
	const analyzeCompany = useCallback(async (companyId: number) => {
		setAnalysisLoading(true);
		setAnalysis(null);
		setError(null);
		try {
			const data = await apiCall<{ success: boolean } & CompanyAnalysis>(
				`/candidate/company-matches/${companyId}/analyze`,
				{ method: 'POST' },
			);
			setAnalysis(data);
			setStep(3);
		} catch (err: any) {
			setError(err?.message || 'Failed to analyze company');
		} finally {
			setAnalysisLoading(false);
		}
	}, []);

	// ── Generate Outreach ──
	const generateOutreach = useCallback(async (companyId: number) => {
		setOutreachLoading(true);
		setOutreach(null);
		setError(null);
		try {
			const data = await apiCall<{ success: boolean } & OutreachStrategy>(
				`/candidate/company-matches/${companyId}/outreach`,
				{ method: 'POST' },
			);
			setOutreach(data);
			setStep(4);
		} catch (err: any) {
			setError(err?.message || 'Failed to generate outreach strategy');
		} finally {
			setOutreachLoading(false);
		}
	}, []);

	// ── Step Navigation ──
	const goToStep = useCallback(
		(targetStep: number) => {
			setError(null);
			if (targetStep === 1) {
				setSelectedCompany(null);
				setAnalysis(null);
				setOutreach(null);
			}
			if (targetStep === 2) {
				loadMatches(matchesPage);
			}
			setStep(targetStep);
		},
		[loadMatches, matchesPage],
	);

	// ── Initial Load ──
	useEffect(() => {
		loadProfile();
	}, [loadProfile]);

	// ── Render ──

	return (
		<div className="min-h-[calc(100dvh-4rem)] flex flex-col">
			<SEO
				title="Company Matches — Find Your Perfect Employer"
				description="Discover top remote employers, personalized value hooks, decision maker contacts, and outreach playbooks with Rekrut AI."
				canonical="/candidate/company-matches"
			/>

			{/* Header */}
			<div className="shrink-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 px-4 py-6 sm:py-8">
				<div className="max-w-4xl mx-auto">
					<h1 className="text-white text-xl sm:text-2xl font-bold flex items-center gap-2">
						<Building2 className="h-5 w-5 shrink-0" />
						<span>Company Matches</span>
					</h1>
					<p className="text-indigo-100 text-sm mt-1">
						Discover the best remote employers and how to reach them
					</p>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 px-3 sm:px-4 py-6 max-w-4xl mx-auto w-full space-y-6">
				{/* Stats Strip */}
				<StatsStrip />

				{/* Progress Stepper */}
				{step >= 1 && step <= 4 && (
					<div className="py-2">
						<Stepper currentStep={step} />
					</div>
				)}

				{/* Error Banner */}
				{error && (
					<Card className="border-red-200 bg-red-50/50">
						<CardContent className="p-4 flex items-start gap-3">
							<AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
							<div className="flex-1">
								<p className="text-sm text-red-700">{error}</p>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setError(null)}
									className="mt-1 h-7 text-xs text-red-600 hover:text-red-700"
								>
									Dismiss
								</Button>
							</div>
						</CardContent>
					</Card>
				)}

				{/* ── STEP 1: Define Your Positioning ── */}
				{step === 1 && (
					<div className="space-y-6">
						<Card>
							<CardContent className="p-5 sm:p-6 space-y-5">
								<div className="flex items-center gap-3">
									<div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
										<Target className="h-5 w-5 text-indigo-600" />
									</div>
									<div>
										<h2 className="text-lg font-semibold">Define Your Positioning</h2>
										<p className="text-sm text-muted-foreground">
											Your positioning statement is how companies will see your value
										</p>
									</div>
								</div>

								{profileLoading ? (
									<div className="flex items-center justify-center py-8">
										<Loader2 className="h-6 w-6 animate-spin text-primary" />
									</div>
								) : (
									<>
										{/* Profile Preview */}
										{profile && (
											<div className="rounded-lg bg-muted/50 p-4 space-y-3">
												<div className="flex items-center gap-2 text-sm font-medium">
													<User className="h-4 w-4 text-muted-foreground" />
													Your Profile Summary
												</div>
												{profile.headline && (
													<p className="text-sm font-semibold">{profile.headline}</p>
												)}
												{profile.skills && profile.skills.length > 0 && (
													<div className="flex flex-wrap gap-1.5">
														{profile.skills.slice(0, 8).map((s) => (
															<Badge
																key={s.skill_name}
																variant="secondary"
																className="text-[10px] h-5"
															>
																{s.skill_name}
															</Badge>
														))}
														{profile.skills.length > 8 && (
															<Badge variant="outline" className="text-[10px] h-5">
																+{profile.skills.length - 8}
															</Badge>
														)}
													</div>
												)}
												{profile.experience && profile.experience.length > 0 && (
													<p className="text-xs text-muted-foreground">
														<Briefcase className="h-3 w-3 inline mr-1" />
														{profile.experience[0].title} at {profile.experience[0].company_name}
														{profile.experience.length > 1 &&
															` + ${profile.experience.length - 1} more`}
													</p>
												)}
											</div>
										)}

										{/* Positioning Editor */}
										<div className="space-y-2">
											<label className="text-sm font-medium flex items-center gap-1.5">
												<PenLine className="h-3.5 w-3.5" />
												Positioning Statement
											</label>
											<Textarea
												value={positioning}
												onChange={(e) => setPositioning(e.target.value)}
												placeholder="e.g., Senior Full-Stack Engineer with 8 years of experience building scalable SaaS products..."
												rows={4}
												className="resize-none"
											/>
											<p className="text-xs text-muted-foreground">
												This statement will be used by AI to craft personalized value hooks for each
												company.
											</p>
										</div>

										<div className="flex items-center justify-end gap-3 pt-2">
											<Button
												onClick={() => goToStep(2)}
												className="gap-2 min-h-[44px]"
												disabled={profileLoading}
											>
												Continue
												<ArrowRight className="h-4 w-4" />
											</Button>
										</div>
									</>
								)}
							</CardContent>
						</Card>

						<ProblemSolutionSection />
					</div>
				)}

				{/* ── STEP 2: Analyze Company Data ── */}
				{step === 2 && (
					<div className="space-y-5">
						<div className="flex items-center justify-between flex-wrap gap-2">
							<div>
								<h2 className="text-lg font-semibold flex items-center gap-2">
									<Search className="h-5 w-5 text-primary" />
									Your Company Matches
								</h2>
								<p className="text-sm text-muted-foreground">
									{matches.length} companies ranked by match score
								</p>
							</div>
							<Button variant="outline" size="sm" onClick={() => goToStep(1)} className="gap-1.5">
								<ChevronLeft className="h-4 w-4" />
								Back
							</Button>
						</div>

						{matchesLoading ? (
							<div className="flex items-center justify-center py-16">
								<Loader2 className="h-8 w-8 animate-spin text-primary" />
							</div>
						) : matches.length === 0 ? (
							<Card>
								<CardContent className="p-8 text-center space-y-3">
									<Building2 className="h-12 w-12 text-muted-foreground mx-auto" />
									<p className="font-semibold">No matches found</p>
									<p className="text-sm text-muted-foreground">
										Complete your profile to get personalized company matches.
									</p>
									<Button onClick={() => navigate('/candidate/profile')} className="gap-2 mt-2">
										<User className="h-4 w-4" />
										Complete Profile
									</Button>
								</CardContent>
							</Card>
						) : (
							<>
								{/* Matches Grid */}
								<div className="grid grid-cols-1 gap-4">
									{matches.map((match) => (
										<Card
											key={match.id}
											className={cn(
												'overflow-hidden transition-all cursor-pointer hover:shadow-md',
												selectedCompany?.id === match.id
													? 'ring-2 ring-primary border-primary'
													: 'border',
											)}
											onClick={() => setSelectedCompany(match)}
										>
											<CardContent className="p-4 sm:p-5">
												<div className="flex items-start gap-4">
													{/* Logo / Initial */}
													<div className="shrink-0">
														{match.logo_url ? (
															<img
																src={match.logo_url}
																alt={match.name}
																className="h-12 w-12 rounded-lg object-contain bg-white border"
															/>
														) : (
															<div className="h-12 w-12 rounded-lg bg-indigo-100 flex items-center justify-center">
																<Building2 className="h-6 w-6 text-indigo-500" />
															</div>
														)}
													</div>

													{/* Info */}
													<div className="flex-1 min-w-0">
														<div className="flex items-start justify-between gap-2 flex-wrap">
															<div className="min-w-0">
																<h3 className="font-semibold text-sm sm:text-base truncate">
																	{match.name}
																</h3>
																<p className="text-xs text-muted-foreground flex items-center gap-1">
																	<Globe className="h-3 w-3" />
																	{match.industry || 'Technology'}
																</p>
															</div>
															<div className="flex items-center gap-2 shrink-0">
																<Badge
																	className={cn(
																		'text-[10px] h-5 border',
																		difficultyBadgeClass(match.outreach_difficulty),
																	)}
																>
																	{difficultyLabel(match.outreach_difficulty)}
																</Badge>
															</div>
														</div>

														{/* Match Score */}
														<div className="mt-3 flex items-center gap-3">
															<div className="flex-1">
																<div className="flex items-center justify-between mb-1">
																	<span className="text-xs text-muted-foreground">Match Score</span>
																	<span
																		className={cn(
																			'text-xs font-bold tabular-nums',
																			scoreColorClass(match.match_score),
																		)}
																	>
																		{match.match_score}%
																	</span>
																</div>
																<Progress value={match.match_score} className="h-1.5" />
															</div>
														</div>

														{/* Value Hook */}
														<div className="mt-3 flex items-start gap-2">
															<Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
															<p className="text-xs text-muted-foreground leading-relaxed">
																{match.value_hook}
															</p>
														</div>

														{/* Expandable Match Reason */}
														<button type="button"
															onClick={(e) => {
																e.stopPropagation();
																setExpandedMatchId(expandedMatchId === match.id ? null : match.id);
															}}
															className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
														>
															{expandedMatchId === match.id ? (
																<>
																	<ChevronUp className="h-3 w-3" /> Hide reason
																</>
															) : (
																<>
																	<ChevronDown className="h-3 w-3" /> Why this match?
																</>
															)}
														</button>
														{expandedMatchId === match.id && (
															<div className="mt-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
																{match.match_reason}
															</div>
														)}
													</div>
												</div>

												{/* Select Action */}
												<div className="mt-4 flex justify-end">
													<Button
														size="sm"
														onClick={(e) => {
															e.stopPropagation();
															setSelectedCompany(match);
															analyzeCompany(match.id);
														}}
														disabled={analysisLoading && selectedCompany?.id === match.id}
														className="gap-1.5 min-h-[40px]"
													>
														{analysisLoading && selectedCompany?.id === match.id ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															<Lightbulb className="h-3.5 w-3.5" />
														)}
														Analyze
													</Button>
												</div>
											</CardContent>
										</Card>
									))}
								</div>

								{/* Pagination */}
								{matchesTotalPages > 1 && (
									<div className="flex items-center justify-center gap-2 py-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const p = Math.max(1, matchesPage - 1);
												setMatchesPage(p);
												loadMatches(p);
											}}
											disabled={matchesPage <= 1 || matchesLoading}
											className="gap-1"
										>
											<ChevronLeft className="h-3.5 w-3.5" />
											Prev
										</Button>
										<span className="text-sm text-muted-foreground px-2">
											Page {matchesPage} of {matchesTotalPages}
										</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const p = Math.min(matchesTotalPages, matchesPage + 1);
												setMatchesPage(p);
												loadMatches(p);
											}}
											disabled={matchesPage >= matchesTotalPages || matchesLoading}
											className="gap-1"
										>
											Next
											<ArrowRight className="h-3.5 w-3.5" />
										</Button>
									</div>
								)}
							</>
						)}
					</div>
				)}

				{/* ── STEP 3: Identify Value Hooks ── */}
				{step === 3 && selectedCompany && analysis && (
					<div className="space-y-5">
						<div className="flex items-center justify-between flex-wrap gap-2">
							<div className="flex items-center gap-3">
								{selectedCompany.logo_url ? (
									<img
										src={selectedCompany.logo_url}
										alt={selectedCompany.name}
										className="h-10 w-10 rounded-lg object-contain bg-white border"
									/>
								) : (
									<div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
										<Building2 className="h-5 w-5 text-indigo-500" />
									</div>
								)}
								<div>
									<h2 className="text-lg font-semibold">{selectedCompany.name}</h2>
									<p className="text-xs text-muted-foreground">{selectedCompany.industry}</p>
								</div>
							</div>
							<Button variant="outline" size="sm" onClick={() => goToStep(2)} className="gap-1.5">
								<ChevronLeft className="h-4 w-4" />
								Back to Matches
							</Button>
						</div>

						{analysisLoading ? (
							<div className="flex items-center justify-center py-16">
								<Loader2 className="h-8 w-8 animate-spin text-primary" />
							</div>
						) : (
							<div className="space-y-4">
								{/* Match Score Banner */}
								<Card className={cn('border-2', scoreBgClass(selectedCompany.match_score))}>
									<CardContent className="p-4 flex items-center gap-4">
										<div className="text-center">
											<div
												className={cn(
													'text-3xl font-bold tabular-nums',
													scoreColorClass(selectedCompany.match_score),
												)}
											>
												{selectedCompany.match_score}
											</div>
											<div className="text-[10px] text-muted-foreground">Match Score</div>
										</div>
										<div className="flex-1">
											<p className="text-sm font-medium">{selectedCompany.value_hook}</p>
										</div>
									</CardContent>
								</Card>

								{/* Company Summary */}
								<Card>
									<CardContent className="p-4 sm:p-5 space-y-3">
										<div className="flex items-center gap-2">
											<BarChart3 className="h-4 w-4 text-indigo-500" />
											<h3 className="font-semibold text-sm">Company Summary</h3>
										</div>
										<p className="text-sm text-muted-foreground leading-relaxed">
											{analysis.company_summary}
										</p>
									</CardContent>
								</Card>

								{/* Two-column: Culture Fit + Growth */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<Card>
										<CardContent className="p-4 sm:p-5 space-y-3">
											<div className="flex items-center gap-2">
												<Users className="h-4 w-4 text-emerald-500" />
												<h3 className="font-semibold text-sm">Culture Fit</h3>
											</div>
											<p className="text-sm text-muted-foreground leading-relaxed">
												{analysis.culture_fit}
											</p>
										</CardContent>
									</Card>

									<Card>
										<CardContent className="p-4 sm:p-5 space-y-3">
											<div className="flex items-center gap-2">
												<TrendingUp className="h-4 w-4 text-amber-500" />
												<h3 className="font-semibold text-sm">Growth Opportunities</h3>
											</div>
											<p className="text-sm text-muted-foreground leading-relaxed">
												{analysis.growth_opportunities}
											</p>
										</CardContent>
									</Card>
								</div>

								{/* Key Decision Makers */}
								<Card>
									<CardContent className="p-4 sm:p-5 space-y-3">
										<div className="flex items-center gap-2">
											<Target className="h-4 w-4 text-purple-500" />
											<h3 className="font-semibold text-sm">Key Decision Makers</h3>
										</div>
										<div className="flex flex-wrap gap-2">
											{analysis.key_decision_makers.map((role, i) => (
												<Badge key={i} variant="secondary" className="text-xs h-6 gap-1">
													<User className="h-3 w-3" />
													{role}
												</Badge>
											))}
										</div>
									</CardContent>
								</Card>

								{/* Recommended Approach */}
								<Card>
									<CardContent className="p-4 sm:p-5 space-y-3">
										<div className="flex items-center gap-2">
											<Megaphone className="h-4 w-4 text-blue-500" />
											<h3 className="font-semibold text-sm">Recommended Approach</h3>
										</div>
										<p className="text-sm text-muted-foreground leading-relaxed">
											{analysis.recommended_approach}
										</p>
									</CardContent>
								</Card>

								{/* Action */}
								<div className="flex justify-end pt-2">
									<Button
										onClick={() => generateOutreach(selectedCompany.id)}
										disabled={outreachLoading}
										className="gap-2 min-h-[44px]"
									>
										{outreachLoading ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Send className="h-4 w-4" />
										)}
										Get Outreach Strategy
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				{/* ── STEP 4: Get Outreach Strategy ── */}
				{step === 4 && selectedCompany && outreach && (
					<div className="space-y-5">
						<div className="flex items-center justify-between flex-wrap gap-2">
							<div className="flex items-center gap-3">
								{selectedCompany.logo_url ? (
									<img
										src={selectedCompany.logo_url}
										alt={selectedCompany.name}
										className="h-10 w-10 rounded-lg object-contain bg-white border"
									/>
								) : (
									<div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
										<Building2 className="h-5 w-5 text-indigo-500" />
									</div>
								)}
								<div>
									<h2 className="text-lg font-semibold">{selectedCompany.name}</h2>
									<p className="text-xs text-muted-foreground">Outreach Strategy</p>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<Button variant="outline" size="sm" onClick={() => goToStep(2)} className="gap-1.5">
									<RotateCcw className="h-3.5 w-3.5" />
									Back to Matches
								</Button>
							</div>
						</div>

						{outreachLoading ? (
							<div className="flex items-center justify-center py-16">
								<Loader2 className="h-8 w-8 animate-spin text-primary" />
							</div>
						) : (
							<div className="space-y-4">
								{/* Personalized Hook */}
								<Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-purple-50/30">
									<CardContent className="p-4 sm:p-5 space-y-3">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Sparkles className="h-4 w-4 text-indigo-500" />
												<h3 className="font-semibold text-sm">Personalized Hook</h3>
											</div>
											<CopyButton text={outreach.personalized_hook} />
										</div>
										<p className="text-sm font-medium text-indigo-900 dark:text-indigo-100 leading-relaxed">
											&ldquo;{outreach.personalized_hook}&rdquo;
										</p>
									</CardContent>
								</Card>

								{/* Best Contact Method */}
								<div className="flex items-center gap-2">
									<Badge
										className={cn(
											'text-xs h-6 gap-1',
											outreach.best_contact_method === 'email'
												? 'bg-blue-100 text-blue-700 border-blue-200'
												: outreach.best_contact_method === 'linkedin'
													? 'bg-indigo-100 text-indigo-700 border-indigo-200'
													: 'bg-emerald-100 text-emerald-700 border-emerald-200',
										)}
									>
										{outreach.best_contact_method === 'email' ? (
											<Mail className="h-3 w-3" />
										) : outreach.best_contact_method === 'linkedin' ? (
											<Linkedin className="h-3 w-3" />
										) : (
											<Users className="h-3 w-3" />
										)}
										Best via {outreach.best_contact_method}
									</Badge>
								</div>

								{/* Email Template */}
								<Card>
									<CardContent className="p-4 sm:p-5 space-y-3">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Mail className="h-4 w-4 text-blue-500" />
												<h3 className="font-semibold text-sm">Email Template</h3>
											</div>
											<CopyButton text={outreach.email_template} />
										</div>
										<div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
											{outreach.email_template}
										</div>
									</CardContent>
								</Card>

								{/* LinkedIn Message */}
								<Card>
									<CardContent className="p-4 sm:p-5 space-y-3">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Linkedin className="h-4 w-4 text-indigo-500" />
												<h3 className="font-semibold text-sm">LinkedIn Connection Message</h3>
											</div>
											<CopyButton text={outreach.linkedin_connection_message} />
										</div>
										<div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
											{outreach.linkedin_connection_message}
										</div>
									</CardContent>
								</Card>

								{/* Follow-up Strategy */}
								<Card>
									<CardContent className="p-4 sm:p-5 space-y-3">
										<div className="flex items-center gap-2">
											<RotateCcw className="h-4 w-4 text-amber-500" />
											<h3 className="font-semibold text-sm">Follow-Up Strategy</h3>
										</div>
										<p className="text-sm text-muted-foreground leading-relaxed">
											{outreach.follow_up_strategy}
										</p>
									</CardContent>
								</Card>

								{/* Actions */}
								<div className="flex items-center justify-between pt-2 flex-wrap gap-3">
									<Button variant="outline" onClick={() => goToStep(3)} className="gap-1.5">
										<ArrowLeft className="h-4 w-4" />
										Back to Analysis
									</Button>
									<Button onClick={() => goToStep(2)} className="gap-2">
										<Search className="h-4 w-4" />
										Explore More Companies
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				{/* ── UPGRADE REQUIRED (step 0) ── */}
				{step === 0 && (
					<Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
						<CardContent className="p-8 flex flex-col items-center text-center gap-4">
							<div className="p-3 rounded-full bg-amber-100">
								<Crown className="h-8 w-8 text-amber-600" />
							</div>
							<div>
								<h2 className="text-lg font-semibold">Upgrade to Pro</h2>
								<p className="text-sm text-muted-foreground mt-1 max-w-md">
									Company Matches is a Pro feature. Upgrade your plan to unlock AI-powered company
									matching, analysis, and outreach strategies.
								</p>
							</div>
							<Button
								onClick={() => navigate('/pricing')}
								className="gap-2 bg-amber-600 hover:bg-amber-700"
							>
								<Crown className="h-4 w-4" />
								Upgrade to Pro
							</Button>
							<Button variant="ghost" size="sm" onClick={() => goToStep(1)}>
								Go Back
							</Button>
						</CardContent>
					</Card>
				)}

				{/* ── Bottom Section: Always visible ── */}
				<div className="space-y-6 pt-4 border-t">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Sparkles className="h-4 w-4 text-indigo-500" />
						<span>AI-curated company intelligence for your job search</span>
					</div>

					<ValueProposition
						title="What You Will Receive"
						cards={BENEFIT_CARDS}
						lockedTeaser="Advanced company intelligence and outreach automation are available with Rekrut AI Pro."
						lockedSubtext="Upgrade to unlock real-time company matching, automated outreach sequences, and priority contact access."
					/>
				</div>
			</div>
		</div>
	);
}

export default CompanyMatchesPage;
