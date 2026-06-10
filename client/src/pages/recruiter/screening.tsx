import {
	AlertTriangle,
	ArrowRight,
	Award,
	Ban,
	BarChart3,
	BrainCircuit,
	Briefcase,
	Calendar,
	CheckCircle2,
	ChevronRight,
	ClipboardList,
	Clock,
	FileText,
	Heart,
	Lightbulb,
	Loader2,
	Mail,
	MessageSquare,
	PenTool,
	Phone,
	Send,
	ShieldAlert,
	Sparkles,
	Star,
	StickyNote,
	Target,
	ThumbsDown,
	ThumbsUp,
	TrendingDown,
	TrendingUp,
	UserCheck,
	UserX,
	Video,
	XCircle,
	Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

export type ScreeningResult = {
	id: string
	candidateId: string
	candidateName: string
	candidateAvatar?: string
	candidateHeadline?: string
	jobId: string
	jobTitle: string
	overallScore: number
	recommendation: 'strong_hire' | 'hire' | 'consider' | 'pass' | 'strong_pass'
	skillMatch: {
		required: string[]
		matched: string[]
		missing: string[]
		partial?: string[]
		score: number
	}
	experienceMatch: {
		requiredYears: number
		candidateYears: number
		score: number
		gap: string
	}
	cultureFit: {
		score: number
		alignment: string[]
		concerns: string[]
	}
	strengths: string[]
	concerns: string[]
	autoQuestions: string[]
	aiExplanation: string
	generatedAt: string
	status: 'pending' | 'completed' | 'reviewed'
	redFlags?: {
		employmentGaps?: string[]
		frequentJobChanges?: boolean
		missingCredentials?: string[]
		notes?: string
	}
	scorecard?: {
		technicalSkills: number
		communication: number
		problemSolving: number
		culturalFit: number
		experienceDepth: number
		overallPotential: number
		notes?: string
	}
	aiNotes?: string[]
}

const recommendationConfig: Record<
	string,
	{
		color: string
		icon: React.ReactNode
		label: string
		bg: string
		border: string
		actionLabel: string
	}
> = {
	strong_hire: {
		color: 'text-emerald-600',
		icon: <Star className='h-4 w-4' />,
		label: 'Strong Hire',
		bg: 'bg-emerald-50 dark:bg-emerald-900/20',
		border: 'border-emerald-200 dark:border-emerald-800',
		actionLabel: 'Shortlist',
	},
	hire: {
		color: 'text-green-600',
		icon: <UserCheck className='h-4 w-4' />,
		label: 'Hire',
		bg: 'bg-green-50 dark:bg-green-900/20',
		border: 'border-green-200 dark:border-green-800',
		actionLabel: 'Shortlist',
	},
	consider: {
		color: 'text-amber-600',
		icon: <AlertTriangle className='h-4 w-4' />,
		label: 'Consider',
		bg: 'bg-amber-50 dark:bg-amber-900/20',
		border: 'border-amber-200 dark:border-amber-800',
		actionLabel: 'Review',
	},
	pass: {
		color: 'text-orange-600',
		icon: <Ban className='h-4 w-4' />,
		label: 'Pass',
		bg: 'bg-orange-50 dark:bg-orange-900/20',
		border: 'border-orange-200 dark:border-orange-800',
		actionLabel: 'Reject',
	},
	strong_pass: {
		color: 'text-red-600',
		icon: <XCircle className='h-4 w-4' />,
		label: 'Strong Pass',
		bg: 'bg-red-50 dark:bg-red-900/20',
		border: 'border-red-200 dark:border-red-800',
		actionLabel: 'Reject',
	},
}

export function RecruiterScreeningPage() {
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const [screenings, setScreenings] = useState<ScreeningResult[]>([])
	const [loading, setLoading] = useState(true)
	const [selectedTab, setSelectedTab] = useState('all')
	const [selectedScreening, setSelectedScreening] = useState<ScreeningResult | null>(null)
	const [runningScreening, setRunningScreening] = useState(false)

	const candidateId = searchParams.get('candidate')
	const jobId = searchParams.get('job')

	useEffect(() => {
		async function loadScreenings() {
			setLoading(true)
			try {
				const params = new URLSearchParams()
				if (candidateId) params.append('candidateId', candidateId)
				if (jobId) params.append('jobId', jobId)
				const data = await apiCall<{ screenings: ScreeningResult[] }>(
					`/recruiter/screenings?${params}`,
				)
				setScreenings(data.screenings || [])
			} catch (err) {
				console.error('Failed to load screenings:', err)
			} finally {
				setLoading(false)
			}
		}
		loadScreenings()
	}, [candidateId, jobId])

	const runScreening = async (candidateId: string, jobId: string) => {
		setRunningScreening(true)
		try {
			const data = await apiCall<{ screening: ScreeningResult }>('/recruiter/screenings/run', {
				method: 'POST',
				body: { candidateId, jobId },
			})
			setScreenings((prev) => [data.screening, ...prev])
			setSelectedScreening(data.screening)
			trackEvent('screening_run', {
				candidate_id: candidateId,
				job_id: jobId,
				score: data.screening.overallScore,
			})
		} catch (err) {
			console.error('Screening failed:', err)
		} finally {
			setRunningScreening(false)
		}
	}

	const filteredScreenings = screenings.filter((s) => {
		if (selectedTab === 'all') return true
		return s.recommendation === selectedTab || s.status === selectedTab
	})

	const tabCounts = {
		all: screenings.length,
		strong_hire: screenings.filter((s) => s.recommendation === 'strong_hire').length,
		hire: screenings.filter((s) => s.recommendation === 'hire').length,
		consider: screenings.filter((s) => s.recommendation === 'consider').length,
		pass: screenings.filter(
			(s) => s.recommendation === 'pass' || s.recommendation === 'strong_pass',
		).length,
	}

	if (selectedScreening) {
		return (
			<ScreeningDetail screening={selectedScreening} onBack={() => setSelectedScreening(null)} />
		)
	}

	return (
		<div className='space-y-6'>
			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl font-bold'>AI Screener</h1>
					<p className='text-muted-foreground'>AI-powered candidate analysis and fit scoring</p>
				</div>
				<div className='flex gap-2'>
					<Button variant='outline' size='sm' onClick={() => navigate('/recruiter/candidates')}>
						View Candidates
					</Button>
					<Button
						size='sm'
						className='gap-1'
						onClick={() => runScreening(candidateId || '', jobId || '')}
						disabled={runningScreening}
					>
						{runningScreening ? (
							<Loader2 className='h-4 w-4 animate-spin' />
						) : (
							<Sparkles className='h-4 w-4' />
						)}
						Run Screening
					</Button>
				</div>
			</div>

			{/* Stats */}
			<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold'>{screenings.length}</p>
								<p className='text-xs text-muted-foreground'>Screenings</p>
							</div>
							<BrainCircuit className='h-8 w-8 text-muted-foreground/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-emerald-600'>
									{tabCounts.strong_hire + tabCounts.hire}
								</p>
								<p className='text-xs text-muted-foreground'>Recommended</p>
							</div>
							<CheckCircle2 className='h-8 w-8 text-emerald-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-amber-600'>{tabCounts.consider}</p>
								<p className='text-xs text-muted-foreground'>Consider</p>
							</div>
							<AlertTriangle className='h-8 w-8 text-amber-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-red-600'>{tabCounts.pass}</p>
								<p className='text-xs text-muted-foreground'>Not Fit</p>
							</div>
							<XCircle className='h-8 w-8 text-red-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold'>
									{screenings.length > 0
										? Math.round(
												screenings.reduce((s, c) => s + c.overallScore, 0) / screenings.length,
											)
										: 0}
									%
								</p>
								<p className='text-xs text-muted-foreground'>Avg Score</p>
							</div>
							<Target className='h-8 w-8 text-muted-foreground/50' />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='all'>
						All{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.all}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='strong_hire'>
						Strong Hire{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.strong_hire}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='hire'>
						Hire{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.hire}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='consider'>
						Consider{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.consider}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='pass'>
						Pass{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.pass}
						</Badge>
					</TabsTrigger>
				</TabsList>

				<TabsContent value={selectedTab} className='mt-4'>
					{loading ? (
						<Skeleton count={3} variant='card' />
					) : filteredScreenings.length === 0 ? (
						<EmptyState
							icon={BrainCircuit}
							title='No screenings yet'
							description='Select a candidate and job to run AI screening'
							action={{
								label: 'Go to candidates',
								onClick: () => navigate('/recruiter/candidates'),
							}}
						/>
					) : (
						<div className='grid gap-4'>
							{filteredScreenings.map((screening) => {
								const rec = recommendationConfig[screening.recommendation]
								return (
									<Card
										key={screening.id}
										className='overflow-hidden cursor-pointer hover:shadow-md transition-all'
										onClick={() => setSelectedScreening(screening)}
									>
										<CardContent className='p-4'>
											<div className='flex items-start gap-4'>
												<Avatar className='h-12 w-12 border'>
													<AvatarImage
														src={screening.candidateAvatar}
														alt={screening.candidateName}
													/>
													<AvatarFallback className='bg-primary/10 text-primary font-semibold'>
														{screening.candidateName.slice(0, 2).toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div className='flex-1 min-w-0 space-y-2'>
													<div className='flex items-center justify-between'>
														<div>
															<h3 className='font-semibold'>{screening.candidateName}</h3>
															<p className='text-sm text-muted-foreground'>
																{screening.candidateHeadline}
															</p>
														</div>
														<Badge className={`${rec.bg} ${rec.color} border-0`}>
															{rec.icon}
															<span className='ml-1'>{rec.label}</span>
														</Badge>
													</div>
													<div className='flex items-center gap-2 text-sm text-muted-foreground'>
														<span>For: {screening.jobTitle}</span>
														<span>•</span>
														<span>{new Date(screening.generatedAt).toLocaleDateString()}</span>
													</div>
													<div className='flex items-center gap-4'>
														<div className='flex-1'>
															<div className='flex items-center justify-between text-xs mb-1'>
																<span>Overall Fit</span>
																<span className='font-semibold'>{screening.overallScore}%</span>
															</div>
															<Progress value={screening.overallScore} className='h-2' />
														</div>
														<ChevronRight className='h-4 w-4 text-muted-foreground' />
													</div>
												</div>
											</div>
										</CardContent>
									</Card>
								)
							})}
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}

/* ────────────────────────────
   Circular Score Component
   ──────────────────────────── */
function CircularScore({
	score,
	size = 120,
	strokeWidth = 10,
	label,
	sublabel,
	color,
}: {
	score: number
	size?: number
	strokeWidth?: number
	label: string
	sublabel?: string
	color?: string
}) {
	const radius = (size - strokeWidth) / 2
	const circumference = 2 * Math.PI * radius
	const offset = circumference * (1 - score / 100)
	const defaultColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'
	const strokeColor = color || defaultColor

	return (
		<div className='flex flex-col items-center gap-1'>
			<div className='relative' style={{ width: size, height: size }}>
				<svg className='h-full w-full -rotate-90'>
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill='none'
						stroke='currentColor'
						strokeWidth={strokeWidth}
						className='text-muted/20'
					/>
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill='none'
						stroke={strokeColor}
						strokeWidth={strokeWidth}
						strokeLinecap='round'
						strokeDasharray={circumference}
						strokeDashoffset={offset}
						className='transition-all duration-1000'
					/>
				</svg>
				<div className='absolute inset-0 flex flex-col items-center justify-center'>
					<span className='text-2xl font-bold' style={{ color: strokeColor }}>
						{score}%
					</span>
				</div>
			</div>
			<span className='text-xs font-medium text-muted-foreground'>{label}</span>
			{sublabel && <span className='text-[10px] text-muted-foreground/60'>{sublabel}</span>}
		</div>
	)
}

/* ────────────────────────────
   Score Breakdown Bar
   ──────────────────────────── */
function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
	return (
		<div className='space-y-1.5'>
			<div className='flex items-center justify-between text-xs'>
				<span className='font-medium'>{label}</span>
				<span className='font-semibold' style={{ color }}>
					{score}%
				</span>
			</div>
			<div className='h-2 w-full rounded-full bg-muted/50 overflow-hidden'>
				<div
					className='h-full rounded-full transition-all duration-700'
					style={{ width: `${score}%`, backgroundColor: color }}
				/>
			</div>
		</div>
	)
}

/* ────────────────────────────
   Skill Badge
   ──────────────────────────── */
function SkillBadge({
	skill,
	variant,
}: {
	skill: string
	variant: 'match' | 'partial' | 'missing'
}) {
	const configs = {
		match: {
			bg: 'bg-emerald-50 dark:bg-emerald-900/20',
			text: 'text-emerald-700 dark:text-emerald-400',
			border: 'border-emerald-200',
			icon: <CheckCircle2 className='h-3 w-3' />,
		},
		partial: {
			bg: 'bg-amber-50 dark:bg-amber-900/20',
			text: 'text-amber-700 dark:text-amber-400',
			border: 'border-amber-200',
			icon: <AlertTriangle className='h-3 w-3' />,
		},
		missing: {
			bg: 'bg-red-50 dark:bg-red-900/20',
			text: 'text-red-700 dark:text-red-400',
			border: 'border-red-200',
			icon: <XCircle className='h-3 w-3' />,
		},
	}
	const c = configs[variant]
	return (
		<Badge
			variant='outline'
			className={`${c.bg} ${c.text} ${c.border} gap-1 font-normal text-xs py-1 px-2`}
		>
			{c.icon}
			{skill}
		</Badge>
	)
}

/* ────────────────────────────
   Question Card
   ──────────────────────────── */
function QuestionCard({ q, index }: { q: string; index: number }) {
	const categories = [
		{
			icon: <Zap className='h-3.5 w-3.5' />,
			label: 'Technical',
			color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
		},
		{
			icon: <Lightbulb className='h-3.5 w-3.5' />,
			label: 'Behavioral',
			color: 'bg-amber-50 text-amber-700 border-amber-200',
		},
		{
			icon: <Briefcase className='h-3.5 w-3.5' />,
			label: 'Experience',
			color: 'bg-blue-50 text-blue-700 border-blue-200',
		},
		{
			icon: <Heart className='h-3.5 w-3.5' />,
			label: 'Culture Fit',
			color: 'bg-pink-50 text-pink-700 border-pink-200',
		},
	]
	const category = categories[index % categories.length]

	return (
		<div className='group rounded-xl border bg-card p-4 hover:shadow-md transition-all hover:border-indigo-200'>
			<div className='flex items-start gap-3'>
				<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary'>
					{index + 1}
				</div>
				<div className='flex-1 space-y-2'>
					<p className='text-sm font-medium leading-relaxed'>{q}</p>
					<div className='flex items-center gap-2'>
						<Badge
							variant='outline'
							className={`${category.color} text-[10px] py-0.5 px-1.5 gap-1`}
						>
							{category.icon}
							{category.label}
						</Badge>
						<span className='text-[10px] text-muted-foreground'>AI-generated</span>
					</div>
				</div>
			</div>
		</div>
	)
}

/* ────────────────────────────
   Red Flag Card
   ──────────────────────────── */
function RedFlagItem({
	icon,
	title,
	description,
	severity,
}: {
	icon: React.ReactNode
	title: string
	description: string
	severity: 'high' | 'medium' | 'low'
}) {
	const severityConfig = {
		high: {
			bg: 'bg-red-50 dark:bg-red-900/20',
			border: 'border-red-200',
			iconColor: 'text-red-500',
			text: 'text-red-700',
		},
		medium: {
			bg: 'bg-amber-50 dark:bg-amber-900/20',
			border: 'border-amber-200',
			iconColor: 'text-amber-500',
			text: 'text-amber-700',
		},
		low: {
			bg: 'bg-orange-50 dark:bg-orange-900/20',
			border: 'border-orange-200',
			iconColor: 'text-orange-500',
			text: 'text-orange-700',
		},
	}
	const s = severityConfig[severity]

	return (
		<div className={`flex items-start gap-3 rounded-lg border ${s.border} ${s.bg} p-3`}>
			<div className={`${s.iconColor} shrink-0 mt-0.5`}>{icon}</div>
			<div className='flex-1 min-w-0'>
				<p className={`text-sm font-medium ${s.text}`}>{title}</p>
				<p className='text-xs text-muted-foreground mt-0.5'>{description}</p>
			</div>
			<Badge variant='outline' className={`${s.text} ${s.border} text-[10px] shrink-0`}>
				{severity}
			</Badge>
		</div>
	)
}

/* ────────────────────────────
   Interview Scorecard
   ──────────────────────────── */
function InterviewScorecard({ scorecard }: { scorecard?: ScreeningResult['scorecard'] }) {
	const defaultScorecard = {
		technicalSkills: 0,
		communication: 0,
		problemSolving: 0,
		culturalFit: 0,
		experienceDepth: 0,
		overallPotential: 0,
	}
	const sc = scorecard || defaultScorecard

	const criteria = [
		{
			key: 'technicalSkills' as const,
			label: 'Technical Skills',
			icon: <Zap className='h-4 w-4' />,
		},
		{
			key: 'communication' as const,
			label: 'Communication',
			icon: <MessageSquare className='h-4 w-4' />,
		},
		{
			key: 'problemSolving' as const,
			label: 'Problem Solving',
			icon: <BrainCircuit className='h-4 w-4' />,
		},
		{ key: 'culturalFit' as const, label: 'Cultural Fit', icon: <Heart className='h-4 w-4' /> },
		{
			key: 'experienceDepth' as const,
			label: 'Experience Depth',
			icon: <Briefcase className='h-4 w-4' />,
		},
		{
			key: 'overallPotential' as const,
			label: 'Overall Potential',
			icon: <TrendingUp className='h-4 w-4' />,
		},
	]

	return (
		<Card>
			<CardHeader>
				<CardTitle className='text-lg flex items-center gap-2'>
					<ClipboardList className='h-5 w-5 text-indigo-500' />
					Interview Scorecard
				</CardTitle>
			</CardHeader>
			<CardContent className='space-y-4'>
				{criteria.map((criterion) => {
					const score = sc[criterion.key]
					const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'
					return (
						<div key={criterion.key} className='space-y-2'>
							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-2'>
									<span className='text-muted-foreground'>{criterion.icon}</span>
									<span className='text-sm font-medium'>{criterion.label}</span>
								</div>
								<div className='flex items-center gap-2'>
									<span className='text-sm font-bold' style={{ color }}>
										{score}/100
									</span>
									<Award
										className='h-4 w-4'
										style={{ color: score >= 80 ? '#fbbf24' : '#d1d5db' }}
									/>
								</div>
							</div>
							<Progress value={score} className='h-2' />
						</div>
					)
				})}
				{scorecard?.notes && (
					<div className='mt-4 rounded-lg bg-muted/50 p-3'>
						<p className='text-xs font-medium mb-1'>Interviewer Notes</p>
						<p className='text-sm text-muted-foreground'>{scorecard.notes}</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

/* ────────────────────────────
   Screening Detail
   ──────────────────────────── */
function ScreeningDetail({
	screening,
	onBack,
}: {
	screening: ScreeningResult
	onBack: () => void
}) {
	const rec = recommendationConfig[screening.recommendation]
	const navigate = useNavigate()
	const [activeTab, setActiveTab] = useState('overview')

	// Derived partial skills (not in matched or missing)
	const partialSkills = screening.skillMatch.partial || []

	// Derive red flags from available data if not explicitly provided
	const redFlags = screening.redFlags || {
		employmentGaps: screening.experienceMatch.gap?.toLowerCase().includes('gap')
			? [screening.experienceMatch.gap]
			: undefined,
		frequentJobChanges: screening.concerns.some(
			(c) => c.toLowerCase().includes('job change') || c.toLowerCase().includes('tenure'),
		),
		missingCredentials:
			screening.skillMatch.missing.length > 0
				? [`Missing ${screening.skillMatch.missing.length} required skills`]
				: undefined,
		notes: screening.concerns.length > 0 ? screening.concerns[0] : undefined,
	}

	const handleAction = (action: 'shortlist' | 'reject' | 'interview') => {
		trackEvent('screening_action', {
			screening_id: screening.id,
			action,
			candidate_id: screening.candidateId,
			job_id: screening.jobId,
		})
		// In a real implementation, these would call API endpoints
		if (action === 'interview') {
			navigate(
				`/recruiter/interviews/schedule?candidate=${screening.candidateId}&job=${screening.jobId}`,
			)
		}
	}

	const scoreBreakdown = [
		{ label: 'Skill Match', score: screening.skillMatch.score, color: '#6366f1' },
		{ label: 'Experience', score: screening.experienceMatch.score, color: '#8b5cf6' },
		{ label: 'Culture Fit', score: screening.cultureFit.score, color: '#ec4899' },
	]

	return (
		<div className='space-y-6'>
			{/* Breadcrumb */}
			<Button variant='ghost' size='sm' onClick={onBack} className='gap-1'>
				<ArrowRight className='h-4 w-4 rotate-180' />
				Back to screenings
			</Button>

			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-start'>
				<Avatar className='h-16 w-16 border-2 border-primary/20'>
					<AvatarImage src={screening.candidateAvatar} alt={screening.candidateName} />
					<AvatarFallback className='bg-primary/10 text-primary text-lg font-semibold'>
						{screening.candidateName.slice(0, 2).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<div className='flex-1 min-w-0'>
					<div className='flex items-center gap-2 flex-wrap'>
						<h1 className='font-heading text-2xl font-bold'>{screening.candidateName}</h1>
						<Badge className={`${rec.bg} ${rec.color} ${rec.border} border text-sm px-3 py-1`}>
							{rec.icon}
							<span className='ml-1'>{rec.label}</span>
						</Badge>
					</div>
					<p className='text-muted-foreground'>{screening.candidateHeadline}</p>
					<p className='text-sm text-muted-foreground mt-1'>
						Screening for: <span className='font-medium text-foreground'>{screening.jobTitle}</span>
						<span className='mx-2'>•</span>
						<span>{new Date(screening.generatedAt).toLocaleDateString()}</span>
					</p>
				</div>
				<div className='flex flex-wrap gap-2 shrink-0'>
					<Button size='sm' variant='outline' className='gap-1'>
						<Mail className='h-4 w-4' />
						Message
					</Button>
					<Button
						size='sm'
						variant='outline'
						className='gap-1'
						onClick={() => handleAction('interview')}
					>
						<Video className='h-4 w-4' />
						Schedule Video
					</Button>
				</div>
			</div>

			{/* Action Bar */}
			<div className='flex flex-wrap gap-2 p-4 rounded-xl bg-muted/30 border'>
				<Button
					size='sm'
					className='gap-1 bg-emerald-600 hover:bg-emerald-700'
					onClick={() => handleAction('shortlist')}
				>
					<ThumbsUp className='h-4 w-4' />
					Shortlist
				</Button>
				<Button
					size='sm'
					variant='default'
					className='gap-1 bg-indigo-600 hover:bg-indigo-700'
					onClick={() => handleAction('interview')}
				>
					<Calendar className='h-4 w-4' />
					Schedule Interview
				</Button>
				<Button
					size='sm'
					variant='outline'
					className='gap-1 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700'
					onClick={() => handleAction('reject')}
				>
					<ThumbsDown className='h-4 w-4' />
					Reject
				</Button>
				<div className='flex-1' />
				<Button size='sm' variant='ghost' className='gap-1 text-muted-foreground'>
					<PenTool className='h-4 w-4' />
					Add Notes
				</Button>
				<Button size='sm' variant='ghost' className='gap-1 text-muted-foreground'>
					<Send className='h-4 w-4' />
					Share
				</Button>
			</div>

			{/* Tab Navigation */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='overview' className='gap-1'>
						<BarChart3 className='h-3.5 w-3.5' />
						Overview
					</TabsTrigger>
					<TabsTrigger value='skills' className='gap-1'>
						<Target className='h-3.5 w-3.5' />
						Skills
					</TabsTrigger>
					<TabsTrigger value='interview' className='gap-1'>
						<MessageSquare className='h-3.5 w-3.5' />
						Interview Prep
					</TabsTrigger>
					<TabsTrigger value='scorecard' className='gap-1'>
						<ClipboardList className='h-3.5 w-3.5' />
						Scorecard
					</TabsTrigger>
				</TabsList>

				{/* ── Overview Tab ── */}
				<TabsContent value='overview' className='mt-6 space-y-6'>
					{/* Enhanced Score Display */}
					<div className='grid gap-6 lg:grid-cols-3'>
						{/* Main Score */}
						<Card className='lg:col-span-1'>
							<CardContent className='p-6 flex flex-col items-center'>
								<CircularScore
									score={screening.overallScore}
									size={140}
									strokeWidth={12}
									label='Overall Fit'
									sublabel={`${screening.aiExplanation?.slice(0, 60)}...`}
								/>
								<div className='mt-4 w-full space-y-3'>
									{scoreBreakdown.map((item) => (
										<ScoreBar key={item.label} {...item} />
									))}
								</div>
							</CardContent>
						</Card>

						{/* AI Explanation & Quick Stats */}
						<Card className='lg:col-span-2'>
							<CardHeader>
								<CardTitle className='text-lg flex items-center gap-2'>
									<Sparkles className='h-5 w-5 text-indigo-500' />
									AI Assessment Summary
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-4'>
								<p className='text-sm leading-relaxed'>{screening.aiExplanation}</p>
								<div className='grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2'>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-indigo-600'>
											{screening.skillMatch.score}%
										</p>
										<p className='text-xs text-muted-foreground'>Skills</p>
									</div>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-purple-600'>
											{screening.experienceMatch.score}%
										</p>
										<p className='text-xs text-muted-foreground'>Experience</p>
									</div>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-pink-600'>{screening.cultureFit.score}%</p>
										<p className='text-xs text-muted-foreground'>Culture</p>
									</div>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-emerald-600'>
											{screening.skillMatch.matched.length}
										</p>
										<p className='text-xs text-muted-foreground'>Matched Skills</p>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>

					{/* Strengths & Concerns */}
					<div className='grid gap-6 lg:grid-cols-2'>
						<Card>
							<CardHeader>
								<CardTitle className='text-lg flex items-center gap-2'>
									<TrendingUp className='h-5 w-5 text-emerald-500' />
									Key Strengths
								</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className='space-y-3'>
									{screening.strengths.map((item, i) => (
										<li key={i} className='flex items-start gap-2 text-sm'>
											<CheckCircle2 className='h-4 w-4 text-emerald-500 mt-0.5 shrink-0' />
											<span>{item}</span>
										</li>
									))}
								</ul>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle className='text-lg flex items-center gap-2'>
									<TrendingDown className='h-5 w-5 text-amber-500' />
									Concerns
								</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className='space-y-3'>
									{screening.concerns.map((item, i) => (
										<li key={i} className='flex items-start gap-2 text-sm'>
											<AlertTriangle className='h-4 w-4 text-amber-500 mt-0.5 shrink-0' />
											<span>{item}</span>
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					</div>

					{/* Red Flags */}
					{(redFlags.employmentGaps ||
						redFlags.frequentJobChanges ||
						redFlags.missingCredentials) && (
						<Card className='border-red-200 dark:border-red-800'>
							<CardHeader>
								<CardTitle className='text-lg flex items-center gap-2 text-red-700 dark:text-red-400'>
									<ShieldAlert className='h-5 w-5' />
									Red Flags
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3'>
								{redFlags.employmentGaps?.map((gap, i) => (
									<RedFlagItem
										key={`gap-${i}`}
										icon={<Clock className='h-4 w-4' />}
										title='Employment Gap Detected'
										description={gap}
										severity='medium'
									/>
								))}
								{redFlags.frequentJobChanges && (
									<RedFlagItem
										icon={<Briefcase className='h-4 w-4' />}
										title='Frequent Job Changes'
										description='Candidate has changed jobs multiple times in recent years. Consider probing for stability during interview.'
										severity='medium'
									/>
								)}
								{redFlags.missingCredentials?.map((cred, i) => (
									<RedFlagItem
										key={`cred-${i}`}
										icon={<FileText className='h-4 w-4' />}
										title='Missing Credentials'
										description={cred}
										severity={screening.skillMatch.missing.length > 3 ? 'high' : 'medium'}
									/>
								))}
								{redFlags.notes && (
									<RedFlagItem
										icon={<AlertTriangle className='h-4 w-4' />}
										title='Additional Concern'
										description={redFlags.notes}
										severity='low'
									/>
								)}
							</CardContent>
						</Card>
					)}

					{/* Experience Match */}
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<Briefcase className='h-5 w-5 text-indigo-500' />
								Experience Analysis
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div className='grid grid-cols-1 sm:grid-cols-3 gap-4'>
								<div className='rounded-lg bg-muted/50 p-4 text-center'>
									<p className='text-xs text-muted-foreground mb-1'>Required</p>
									<p className='text-xl font-bold'>
										{screening.experienceMatch.requiredYears} years
									</p>
								</div>
								<div className='rounded-lg bg-muted/50 p-4 text-center'>
									<p className='text-xs text-muted-foreground mb-1'>Candidate</p>
									<p className='text-xl font-bold'>
										{screening.experienceMatch.candidateYears} years
									</p>
								</div>
								<div
									className={`rounded-lg p-4 text-center ${screening.experienceMatch.score >= 80 ? 'bg-emerald-50' : screening.experienceMatch.score >= 60 ? 'bg-amber-50' : 'bg-red-50'}`}
								>
									<p className='text-xs text-muted-foreground mb-1'>Match Score</p>
									<p
										className={`text-xl font-bold ${screening.experienceMatch.score >= 80 ? 'text-emerald-600' : screening.experienceMatch.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}
									>
										{screening.experienceMatch.score}%
									</p>
								</div>
							</div>
							<div className='rounded-lg bg-muted/30 p-3'>
								<p className='text-xs font-medium mb-1'>Gap Analysis</p>
								<p className='text-sm text-muted-foreground'>{screening.experienceMatch.gap}</p>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Skills Tab ── */}
				<TabsContent value='skills' className='mt-6 space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<Target className='h-5 w-5 text-indigo-500' />
								Skill Match Analysis
								<span className='ml-auto text-sm font-normal text-muted-foreground'>
									{screening.skillMatch.score}%
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-6'>
							{/* Matched Skills */}
							<div>
								<div className='flex items-center gap-2 mb-3'>
									<CheckCircle2 className='h-4 w-4 text-emerald-500' />
									<p className='text-sm font-medium'>
										Matched{' '}
										<span className='text-muted-foreground font-normal'>
											({screening.skillMatch.matched.length})
										</span>
									</p>
								</div>
								<div className='flex flex-wrap gap-2'>
									{screening.skillMatch.matched.map((skill) => (
										<SkillBadge key={skill} skill={skill} variant='match' />
									))}
								</div>
							</div>

							{/* Partial Skills */}
							{partialSkills.length > 0 && (
								<div>
									<div className='flex items-center gap-2 mb-3'>
										<AlertTriangle className='h-4 w-4 text-amber-500' />
										<p className='text-sm font-medium'>
											Partial Match{' '}
											<span className='text-muted-foreground font-normal'>
												({partialSkills.length})
											</span>
										</p>
									</div>
									<div className='flex flex-wrap gap-2'>
										{partialSkills.map((skill) => (
											<SkillBadge key={skill} skill={skill} variant='partial' />
										))}
									</div>
								</div>
							)}

							{/* Missing Skills */}
							<div>
								<div className='flex items-center gap-2 mb-3'>
									<XCircle className='h-4 w-4 text-red-500' />
									<p className='text-sm font-medium'>
										Missing{' '}
										<span className='text-muted-foreground font-normal'>
											({screening.skillMatch.missing.length})
										</span>
									</p>
								</div>
								<div className='flex flex-wrap gap-2'>
									{screening.skillMatch.missing.map((skill) => (
										<SkillBadge key={skill} skill={skill} variant='missing' />
									))}
								</div>
							</div>

							{/* Required Skills List */}
							<div className='pt-4 border-t'>
								<p className='text-xs text-muted-foreground mb-2'>All Required Skills</p>
								<div className='flex flex-wrap gap-1.5'>
									{screening.skillMatch.required.map((skill) => {
										const isMatched = screening.skillMatch.matched.includes(skill)
										const isPartial = partialSkills.includes(skill)
										const _isMissing = screening.skillMatch.missing.includes(skill)
										let variant: 'match' | 'partial' | 'missing' = 'missing'
										if (isMatched) variant = 'match'
										else if (isPartial) variant = 'partial'
										return <SkillBadge key={skill} skill={skill} variant={variant} />
									})}
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Culture Fit */}
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<Heart className='h-5 w-5 text-pink-500' />
								Culture Fit
								<span className='ml-auto text-sm font-normal text-muted-foreground'>
									{screening.cultureFit.score}%
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div>
								<p className='text-sm font-medium mb-2 flex items-center gap-1'>
									<TrendingUp className='h-3.5 w-3.5 text-emerald-500' />
									Alignment
								</p>
								<ul className='space-y-2'>
									{screening.cultureFit.alignment.map((item, i) => (
										<li key={i} className='flex items-start gap-2 text-sm'>
											<CheckCircle2 className='h-4 w-4 text-emerald-500 mt-0.5 shrink-0' />
											{item}
										</li>
									))}
								</ul>
							</div>
							<div>
								<p className='text-sm font-medium mb-2 flex items-center gap-1'>
									<TrendingDown className='h-3.5 w-3.5 text-amber-500' />
									Concerns
								</p>
								<ul className='space-y-2'>
									{screening.cultureFit.concerns.map((item, i) => (
										<li key={i} className='flex items-start gap-2 text-sm text-muted-foreground'>
											<AlertTriangle className='h-4 w-4 text-amber-500 mt-0.5 shrink-0' />
											{item}
										</li>
									))}
								</ul>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Interview Prep Tab ── */}
				<TabsContent value='interview' className='mt-6 space-y-6'>
					{/* AI Generated Questions */}
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<MessageSquare className='h-5 w-5 text-indigo-500' />
								AI-Generated Interview Questions
								<Badge variant='secondary' className='ml-auto text-xs'>
									{screening.autoQuestions.length} questions
								</Badge>
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='grid gap-3'>
								{screening.autoQuestions.map((q, i) => (
									<QuestionCard key={i} q={q} index={i} />
								))}
							</div>
						</CardContent>
					</Card>

					{/* AI Interview Notes Placeholder */}
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<StickyNote className='h-5 w-5 text-amber-500' />
								AI Interview Notes
								<Badge variant='outline' className='ml-auto text-xs text-muted-foreground'>
									Auto-generated
								</Badge>
							</CardTitle>
						</CardHeader>
						<CardContent>
							{screening.aiNotes && screening.aiNotes.length > 0 ? (
								<div className='space-y-3'>
									{screening.aiNotes.map((note, i) => (
										<div key={i} className='flex items-start gap-3 p-3 rounded-lg bg-muted/50'>
											<Sparkles className='h-4 w-4 text-indigo-500 mt-0.5 shrink-0' />
											<p className='text-sm'>{note}</p>
										</div>
									))}
								</div>
							) : (
								<div className='text-center py-8 text-muted-foreground'>
									<StickyNote className='h-12 w-12 mx-auto mb-3 opacity-30' />
									<p className='text-sm font-medium'>No AI notes generated yet</p>
									<p className='text-xs mt-1'>
										Notes will appear here after video interviews are conducted
									</p>
									<Button
										size='sm'
										variant='outline'
										className='mt-4 gap-1'
										onClick={() => handleAction('interview')}
									>
										<Video className='h-4 w-4' />
										Schedule Video Interview
									</Button>
								</div>
							)}
						</CardContent>
					</Card>

					{/* Quick Actions */}
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<Phone className='h-5 w-5 text-emerald-500' />
								Next Steps
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
								<Button
									variant='outline'
									className='h-auto py-4 flex-col gap-2 border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300'
									onClick={() => handleAction('interview')}
								>
									<Video className='h-6 w-6 text-indigo-500' />
									<div className='text-center'>
										<p className='text-sm font-medium'>Video Interview</p>
										<p className='text-xs text-muted-foreground'>Schedule now</p>
									</div>
								</Button>
								<Button
									variant='outline'
									className='h-auto py-4 flex-col gap-2 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300'
									onClick={() => handleAction('shortlist')}
								>
									<ThumbsUp className='h-6 w-6 text-emerald-500' />
									<div className='text-center'>
										<p className='text-sm font-medium'>Shortlist</p>
										<p className='text-xs text-muted-foreground'>Move to pipeline</p>
									</div>
								</Button>
								<Button
									variant='outline'
									className='h-auto py-4 flex-col gap-2 border-red-200 hover:bg-red-50 hover:border-red-300'
									onClick={() => handleAction('reject')}
								>
									<UserX className='h-6 w-6 text-red-500' />
									<div className='text-center'>
										<p className='text-sm font-medium'>Reject</p>
										<p className='text-xs text-muted-foreground'>Send feedback</p>
									</div>
								</Button>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Scorecard Tab ── */}
				<TabsContent value='scorecard' className='mt-6 space-y-6'>
					<InterviewScorecard scorecard={screening.scorecard} />

					{/* Additional Scorecard Notes */}
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<PenTool className='h-5 w-5 text-indigo-500' />
								Interviewer Notes
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className='rounded-lg border border-dashed border-muted-foreground/30 p-6 text-center'>
								<PenTool className='h-10 w-10 mx-auto mb-3 text-muted-foreground/30' />
								<p className='text-sm text-muted-foreground'>No interviewer notes yet</p>
								<p className='text-xs text-muted-foreground mt-1'>
									Notes will be added after interviews are completed
								</p>
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}
