import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
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
	Gavel,
	Heart,
	History,
	Lightbulb,
	Loader2,
	Mail,
	MessageSquare,
	PenTool,
	Phone,
	Scale,
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type FitBreakdown = {
	skills_match: number
	experience_match: number
	education_match: number
	location_match: number
	salary_match: number
	culture_fit_estimate: number
}

export type RedFlag = {
	type: string
	severity: 'high' | 'medium' | 'low'
	description: string
	follow_up?: string
}

export type AuditLogEntry = {
	id: number
	screening_id: number
	action: string
	actor_id: number | null
	metadata: Record<string, unknown>
	created_at: string
}

export type HumanReview = {
	id: number
	screening_id: number
	reviewer_id: number
	decision: 'interview' | 'reject' | 'more_info' | 'hold'
	reason: string
	created_at: string
}

export type ScreeningResult = {
	screening_id: number
	job_id: number
	candidate_id: number
	candidate_name: string
	candidate_email?: string
	candidate_avatar?: string
	candidate_headline?: string
	job_title?: string
	job_company?: string
	fit_score: number
	fit_breakdown: FitBreakdown
	recommendation: 'interview' | 'reject' | 'more_info' | 'hold'
	recommendation_reason: string
	matched_skills: string[]
	missing_skills: string[]
	strengths: string[]
	concerns: string[]
	red_flags: RedFlag[]
	screening_questions: string[]
	interview_focus_areas: string[]
	estimated_success_probability: number | null
	human_review_status: 'pending' | 'approved' | 'overridden' | 'requested'
	created_at: string
	updated_at: string
	omni_score?: number | null
}

const recommendationConfig: Record<
	ScreeningResult['recommendation'],
	{
		color: string
		icon: React.ReactNode
		label: string
		bg: string
		border: string
		actionLabel: string
	}
> = {
	interview: {
		color: 'text-emerald-600',
		icon: <UserCheck className='h-4 w-4' />,
		label: 'Interview Recommended',
		bg: 'bg-emerald-50 dark:bg-emerald-900/20',
		border: 'border-emerald-200 dark:border-emerald-800',
		actionLabel: 'Schedule Interview',
	},
	more_info: {
		color: 'text-amber-600',
		icon: <AlertTriangle className='h-4 w-4' />,
		label: 'More Info Needed',
		bg: 'bg-amber-50 dark:bg-amber-900/20',
		border: 'border-amber-200 dark:border-amber-800',
		actionLabel: 'Request Info',
	},
	hold: {
		color: 'text-orange-600',
		icon: <Clock className='h-4 w-4' />,
		label: 'On Hold',
		bg: 'bg-orange-50 dark:bg-orange-900/20',
		border: 'border-orange-200 dark:border-orange-800',
		actionLabel: 'Hold',
	},
	reject: {
		color: 'text-red-600',
		icon: <Ban className='h-4 w-4' />,
		label: 'Not a Fit',
		bg: 'bg-red-50 dark:bg-red-900/20',
		border: 'border-red-200 dark:border-red-800',
		actionLabel: 'Reject',
	},
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */

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
				if (!jobId) {
					setScreenings([])
					setLoading(false)
					return
				}
				const data = await apiCall<{
					success: boolean
					screenings: ScreeningResult[]
					total: number
				}>(`/jobs/${jobId}/screenings`)
				setScreenings(data.screenings || [])
			} catch (err) {
				console.error('Failed to load screenings:', err)
			} finally {
				setLoading(false)
			}
		}
		loadScreenings()
	}, [jobId])

	const runScreening = async (cId: string, jId: string) => {
		setRunningScreening(true)
		try {
			const data = await apiCall<{
				success: boolean
				screening: ScreeningResult
			}>(`/jobs/${jId}/screen/${cId}`, {
				method: 'POST',
			})
			setScreenings((prev) => [data.screening, ...prev])
			setSelectedScreening(data.screening)
			trackEvent('screening_run', {
				candidate_id: cId,
				job_id: jId,
				score: data.screening.fit_score,
			})
		} catch (err) {
			console.error('Screening failed:', err)
			alert('Screening failed. Please try again.')
		} finally {
			setRunningScreening(false)
		}
	}

	const filteredScreenings = screenings.filter((s) => {
		if (selectedTab === 'all') return true
		return s.recommendation === selectedTab
	})

	const tabCounts = {
		all: screenings.length,
		interview: screenings.filter((s) => s.recommendation === 'interview').length,
		more_info: screenings.filter((s) => s.recommendation === 'more_info').length,
		hold: screenings.filter((s) => s.recommendation === 'hold').length,
		reject: screenings.filter((s) => s.recommendation === 'reject').length,
	}

	if (selectedScreening) {
		return (
			<ScreeningDetail
				screening={selectedScreening}
				onBack={() => setSelectedScreening(null)}
				onUpdate={(updated) => {
					setScreenings((prev) =>
						prev.map((s) =>
							s.screening_id === updated.screening_id ? updated : s,
						),
					)
					setSelectedScreening(updated)
				}}
			/>
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
						onClick={() => {
							if (!candidateId || !jobId) {
								alert('Please select a candidate and job first.')
								return
							}
							runScreening(candidateId, jobId)
						}}
						disabled={runningScreening || !candidateId || !jobId}
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

			{/* Advisory Banner */}
			<div className='rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3'>
				<Scale className='h-5 w-5 text-amber-600 shrink-0 mt-0.5' />
				<div>
					<p className='text-sm font-medium text-amber-800 dark:text-amber-300'>
						This is an AI-generated recommendation. A human must make the final decision.
					</p>
					<p className='text-xs text-amber-700 dark:text-amber-400 mt-0.5'>
						No candidate has been automatically rejected. All scores are advisory and require human
						review.
					</p>
				</div>
			</div>

			{/* Job Selector Hint */}
			{!jobId && (
				<Card className='border-dashed'>
					<CardContent className='p-6 text-center space-y-3'>
						<Briefcase className='h-10 w-10 text-muted-foreground/40 mx-auto' />
						<p className='text-sm font-medium text-muted-foreground'>
							Select a job to view screenings
						</p>
						<Button
							size='sm'
							variant='outline'
							onClick={() => navigate('/recruiter/jobs')}
						>
							Browse Jobs
						</Button>
					</CardContent>
				</Card>
			)}

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
								<p className='text-2xl font-bold text-emerald-600'>{tabCounts.interview}</p>
								<p className='text-xs text-muted-foreground'>Interview</p>
							</div>
							<CheckCircle2 className='h-8 w-8 text-emerald-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-amber-600'>{tabCounts.more_info}</p>
								<p className='text-xs text-muted-foreground'>More Info</p>
							</div>
							<AlertTriangle className='h-8 w-8 text-amber-500/50' />
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent className='p-4'>
						<div className='flex items-center justify-between'>
							<div>
								<p className='text-2xl font-bold text-red-600'>{tabCounts.reject}</p>
								<p className='text-xs text-muted-foreground'>Not a Fit</p>
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
												screenings.reduce((s, c) => s + c.fit_score, 0) /
													screenings.length,
											)
										: 0}
									%
								</p>
								<p className='text-xs text-muted-foreground'>Avg Fit Score</p>
							</div>
							<Target className='h-8 w-8 text-muted-foreground/50' />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Adverse Impact Placeholder */}
			{jobId && (
				<Card className='border-indigo-100 dark:border-indigo-800'>
					<CardContent className='p-4 flex items-start gap-3'>
						<Scale className='h-5 w-5 text-indigo-500 shrink-0 mt-0.5' />
						<div>
							<p className='text-sm font-medium'>Adverse Impact Tracking</p>
							<p className='text-xs text-muted-foreground mt-0.5'>
								Per-posting adverse impact reporting is monitored. Screening decisions are logged
								for compliance review.
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className='flex-wrap h-auto'>
					<TabsTrigger value='all'>
						All{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.all}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='interview'>
						Interview{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.interview}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='more_info'>
						More Info{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.more_info}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='hold'>
						On Hold{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.hold}
						</Badge>
					</TabsTrigger>
					<TabsTrigger value='reject'>
						Not a Fit{' '}
						<Badge variant='secondary' className='ml-1 h-5 px-1.5 text-xs'>
							{tabCounts.reject}
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
							description={
								jobId
									? 'Run an AI screening to see results here'
									: 'Select a job and candidate to run AI screening'
							}
							action={
								!jobId
									? {
											label: 'Go to jobs',
											onClick: () => navigate('/recruiter/jobs'),
										}
									: undefined
							}
						/>
					) : (
						<div className='grid gap-4'>
							{filteredScreenings.map((screening) => {
								const rec = recommendationConfig[screening.recommendation]
								return (
									<Card
										key={screening.screening_id}
										className='overflow-hidden cursor-pointer hover:shadow-md transition-all'
										onClick={() => setSelectedScreening(screening)}
									>
										<CardContent className='p-4'>
											<div className='flex items-start gap-4'>
												<Avatar className='h-12 w-12 border'>
													<AvatarImage
														src={screening.candidate_avatar}
														alt={screening.candidate_name}
													/>
													<AvatarFallback className='bg-primary/10 text-primary font-semibold'>
														{screening.candidate_name.slice(0, 2).toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div className='flex-1 min-w-0 space-y-2'>
													<div className='flex items-center justify-between'>
														<div>
															<h3 className='font-semibold'>{screening.candidate_name}</h3>
															<p className='text-sm text-muted-foreground'>
																{screening.candidate_headline}
															</p>
														</div>
														<Badge className={`${rec.bg} ${rec.color} border-0`}>
															{rec.icon}
															<span className='ml-1'>{rec.label}</span>
														</Badge>
													</div>
													<div className='flex items-center gap-2 text-sm text-muted-foreground'>
														<span>For: {screening.job_title}</span>
														<span>•</span>
														<span>
															{new Date(screening.created_at).toLocaleDateString()}
														</span>
														{screening.human_review_status === 'overridden' && (
															<Badge
																variant='outline'
																className='text-indigo-600 border-indigo-300'
															>
																<Gavel className='h-3 w-3 mr-1' />
																Human Override
															</Badge>
														)}
														{screening.human_review_status === 'requested' && (
															<Badge
																variant='outline'
																className='text-amber-600 border-amber-300'
															>
																<History className='h-3 w-3 mr-1' />
																Review Requested
															</Badge>
														)}
													</div>
													<div className='flex items-center gap-4'>
														<div className='flex-1'>
															<div className='flex items-center justify-between text-xs mb-1'>
																<span>Overall Fit</span>
																<span className='font-semibold'>
																	{screening.fit_score}%
																</span>
															</div>
															<Progress value={screening.fit_score} className='h-2' />
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
	variant: 'match' | 'missing'
}) {
	const configs = {
		match: {
			bg: 'bg-emerald-50 dark:bg-emerald-900/20',
			text: 'text-emerald-700 dark:text-emerald-400',
			border: 'border-emerald-200',
			icon: <CheckCircle2 className='h-3 w-3' />,
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
	followUp,
}: {
	icon: React.ReactNode
	title: string
	description: string
	severity: 'high' | 'medium' | 'low'
	followUp?: string
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
				{followUp && (
					<p className='text-xs text-muted-foreground/70 mt-1 italic'>
						Follow-up: {followUp}
					</p>
				)}
			</div>
			<Badge variant='outline' className={`${s.text} ${s.border} text-[10px] shrink-0`}>
				{severity}
			</Badge>
		</div>
	)
}

/* ────────────────────────────
   Audit Log Entry
   ──────────────────────────── */
function AuditLogEntryCard({ entry }: { entry: AuditLogEntry }) {
	const actionLabels: Record<string, string> = {
		ai_screening: 'AI Screening Run',
		ai_screening_batch: 'Batch AI Screening',
		human_review: 'Human Review Override',
		candidate_requested_human_review: 'Candidate Requested Review',
	}

	const actionColors: Record<string, string> = {
		ai_screening: 'text-indigo-600 bg-indigo-50 border-indigo-200',
		ai_screening_batch: 'text-indigo-600 bg-indigo-50 border-indigo-200',
		human_review: 'text-emerald-600 bg-emerald-50 border-emerald-200',
		candidate_requested_human_review: 'text-amber-600 bg-amber-50 border-amber-200',
	}

	const color = actionColors[entry.action] || 'text-muted-foreground bg-muted border-muted'
	const label = actionLabels[entry.action] || entry.action

	return (
		<div className='flex items-start gap-3 py-3 border-b last:border-0'>
			<div className='shrink-0 mt-0.5'>
				<Badge variant='outline' className={`${color} text-[10px]`}>
					{label}
				</Badge>
			</div>
			<div className='flex-1 min-w-0'>
				<p className='text-xs text-muted-foreground'>
					{new Date(entry.created_at).toLocaleString()}
				</p>
				{entry.metadata && Object.keys(entry.metadata).length > 0 && (
					<p className='text-xs text-muted-foreground/70 mt-0.5'>
						{JSON.stringify(entry.metadata)}
					</p>
				)}
			</div>
		</div>
	)
}

/* ────────────────────────────
   Screening Detail
   ──────────────────────────── */
function ScreeningDetail({
	screening,
	onBack,
	onUpdate,
}: {
	screening: ScreeningResult
	onBack: () => void
	onUpdate: (updated: ScreeningResult) => void
}) {
	const navigate = useNavigate()
	const rec = recommendationConfig[screening.recommendation]
	const [activeTab, setActiveTab] = useState('overview')
	const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
	const [auditLoading, setAuditLoading] = useState(false)
	const [showHumanReviewDialog, setShowHumanReviewDialog] = useState(false)
	const [humanReviewDecision, setHumanReviewDecision] = useState('')
	const [humanReviewReason, setHumanReviewReason] = useState('')
	const [submittingReview, setSubmittingReview] = useState(false)

	const loadAuditLog = async () => {
		setAuditLoading(true)
		try {
			const data = await apiCall<{
				success: boolean
				logs: AuditLogEntry[]
			}>(`/screenings/${screening.screening_id}/audit-log`)
			setAuditLogs(data.logs || [])
		} catch (err) {
			console.error('Failed to load audit log:', err)
		} finally {
			setAuditLoading(false)
		}
	}

	useEffect(() => {
		if (activeTab === 'audit') {
			loadAuditLog()
		}
	}, [activeTab])

	const handleHumanReview = async () => {
		if (!humanReviewDecision || !humanReviewReason.trim()) return
		setSubmittingReview(true)
		try {
			await apiCall(`/screenings/${screening.screening_id}/human-review`, {
				method: 'POST',
				body: {
					decision: humanReviewDecision,
					reason: humanReviewReason.trim(),
				},
			})
			// Update local state
			const updated: ScreeningResult = {
				...screening,
				human_review_status: 'overridden',
			}
			onUpdate(updated)
			setShowHumanReviewDialog(false)
			setHumanReviewDecision('')
			setHumanReviewReason('')
			trackEvent('screening_human_review', {
				screening_id: screening.screening_id,
				decision: humanReviewDecision,
			})
		} catch (err) {
			console.error('Human review failed:', err)
			alert('Failed to submit human review. Please try again.')
		} finally {
			setSubmittingReview(false)
		}
	}

	const handleAction = (action: 'shortlist' | 'reject' | 'interview') => {
		trackEvent('screening_action', {
			screening_id: screening.screening_id,
			action,
			candidate_id: screening.candidate_id,
			job_id: screening.job_id,
		})
		if (action === 'interview') {
			navigate(
				`/recruiter/interviews/schedule?candidate=${screening.candidate_id}&job=${screening.job_id}`,
			)
		}
	}

	const breakdown = screening.fit_breakdown || {}

	const scoreBreakdown = [
		{ label: 'Skills Match', score: breakdown.skills_match ?? 0, color: '#6366f1' },
		{ label: 'Experience', score: breakdown.experience_match ?? 0, color: '#8b5cf6' },
		{ label: 'Education', score: breakdown.education_match ?? 0, color: '#06b6d4' },
		{ label: 'Location', score: breakdown.location_match ?? 0, color: '#f59e0b' },
		{ label: 'Salary', score: breakdown.salary_match ?? 0, color: '#10b981' },
		{ label: 'Culture Fit', score: breakdown.culture_fit_estimate ?? 0, color: '#ec4899' },
	]

	return (
		<div className='space-y-6'>
			{/* Human Review Dialog */}
			<Dialog open={showHumanReviewDialog} onOpenChange={setShowHumanReviewDialog}>
				<DialogHeader>
					<DialogTitle className='flex items-center gap-2'>
						<Gavel className='h-5 w-5' />
						Override AI Recommendation
					</DialogTitle>
					<DialogDescription>
						Your decision will be logged in the audit trail. Please provide a reason.
					</DialogDescription>
				</DialogHeader>
				<div className='space-y-4'>
					<div>
						<label className='text-sm font-medium mb-1.5 block'>Decision</label>
						<Select
							placeholder='Select a decision...'
							value={humanReviewDecision}
							onValueChange={setHumanReviewDecision}
						>
							<option value='interview'>Interview</option>
							<option value='reject'>Reject</option>
							<option value='more_info'>More Info Needed</option>
							<option value='hold'>Hold</option>
						</Select>
					</div>
					<div>
						<label className='text-sm font-medium mb-1.5 block'>Reason</label>
						<Textarea
							value={humanReviewReason}
							onChange={(e) => setHumanReviewReason(e.target.value)}
							placeholder='Explain why you are overriding the AI recommendation...'
							rows={4}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button
						variant='outline'
						onClick={() => setShowHumanReviewDialog(false)}
						disabled={submittingReview}
					>
						Cancel
					</Button>
					<Button
						onClick={handleHumanReview}
						disabled={
							!humanReviewDecision || !humanReviewReason.trim() || submittingReview
						}
					>
						{submittingReview ? (
							<Loader2 className='h-4 w-4 animate-spin mr-2' />
						) : (
							<Gavel className='h-4 w-4 mr-2' />
						)}
						Submit Override
					</Button>
				</DialogFooter>
			</Dialog>

			{/* Breadcrumb */}
			<Button variant='ghost' size='sm' onClick={onBack} className='gap-1'>
				<ArrowLeft className='h-4 w-4' />
				Back to screenings
			</Button>

			{/* Advisory Banner */}
			<div className='rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3'>
				<Scale className='h-5 w-5 text-amber-600 shrink-0 mt-0.5' />
				<div>
					<p className='text-sm font-medium text-amber-800 dark:text-amber-300'>
						This is an AI-generated recommendation. A human must make the final decision.
					</p>
					<p className='text-xs text-amber-700 dark:text-amber-400 mt-0.5'>
						No candidate has been automatically rejected. All scores are advisory and require human
						review.
					</p>
				</div>
			</div>

			{/* Header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-start'>
				<Avatar className='h-16 w-16 border-2 border-primary/20'>
					<AvatarImage src={screening.candidate_avatar} alt={screening.candidate_name} />
					<AvatarFallback className='bg-primary/10 text-primary text-lg font-semibold'>
						{screening.candidate_name.slice(0, 2).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<div className='flex-1 min-w-0'>
					<div className='flex items-center gap-2 flex-wrap'>
						<h1 className='font-heading text-2xl font-bold'>{screening.candidate_name}</h1>
						<Badge
							className={`${rec.bg} ${rec.color} ${rec.border} border text-sm px-3 py-1`}
						>
							{rec.icon}
							<span className='ml-1'>{rec.label}</span>
						</Badge>
						{screening.human_review_status === 'overridden' && (
							<Badge
								variant='outline'
								className='text-indigo-600 border-indigo-300 text-sm px-3 py-1'
							>
								<Gavel className='h-3.5 w-3.5 mr-1' />
								Human Override
							</Badge>
						)}
					</div>
					<p className='text-muted-foreground'>{screening.candidate_headline}</p>
					<p className='text-sm text-muted-foreground mt-1'>
						Screening for:{" "}
						<span className='font-medium text-foreground'>{screening.job_title}</span>
						<span className='mx-2'>•</span>
						<span>{new Date(screening.created_at).toLocaleDateString()}</span>
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
				<Button
					size='sm'
					variant='outline'
					className='gap-1 text-indigo-600 border-indigo-300 hover:bg-indigo-50'
					onClick={() => setShowHumanReviewDialog(true)}
				>
					<Gavel className='h-4 w-4' />
					Override AI
				</Button>
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
					<TabsTrigger value='audit' className='gap-1'>
						<History className='h-3.5 w-3.5' />
						Audit Log
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
									score={screening.fit_score}
									size={140}
									strokeWidth={12}
									label='Overall Fit'
									sublabel={screening.recommendation_reason?.slice(0, 60) + '...'}
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
								<p className='text-sm leading-relaxed'>
									{screening.recommendation_reason}
								</p>
								<div className='grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2'>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-indigo-600'>
											{breakdown.skills_match ?? 0}%
										</p>
										<p className='text-xs text-muted-foreground'>Skills</p>
									</div>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-purple-600'>
											{breakdown.experience_match ?? 0}%
										</p>
										<p className='text-xs text-muted-foreground'>Experience</p>
									</div>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-pink-600'>
											{breakdown.culture_fit_estimate ?? 0}%
										</p>
										<p className='text-xs text-muted-foreground'>Culture</p>
									</div>
									<div className='rounded-lg bg-muted/50 p-3 text-center'>
										<p className='text-lg font-bold text-emerald-600'>
											{screening.matched_skills?.length || 0}
										</p>
										<p className='text-xs text-muted-foreground'>Matched Skills</p>
									</div>
								</div>
								{screening.estimated_success_probability !== null && (
									<div className='rounded-lg bg-indigo-50 dark:bg-indigo-900/20 p-3 flex items-center gap-3'>
										<Target className='h-5 w-5 text-indigo-500' />
										<div>
											<p className='text-sm font-medium text-indigo-800 dark:text-indigo-300'>
												Estimated Success Probability
											</p>
											<p className='text-xs text-indigo-600 dark:text-indigo-400'>
												{screening.estimated_success_probability}% chance of success if
												hired
											</p>
										</div>
									</div>
								)}
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
									{screening.strengths?.map((item) => (
										<li key={item} className='flex items-start gap-2 text-sm'>
											<CheckCircle2 className='h-4 w-4 text-emerald-500 mt-0.5 shrink-0' />
											<span>{item}</span>
										</li>
									))}
									{(!screening.strengths || screening.strengths.length === 0) && (
										<p className='text-sm text-muted-foreground italic'>
											No strengths recorded.
										</p>
									)}
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
									{screening.concerns?.map((item) => (
										<li key={item} className='flex items-start gap-2 text-sm'>
											<AlertTriangle className='h-4 w-4 text-amber-500 mt-0.5 shrink-0' />
											<span>{item}</span>
										</li>
									))}
									{(!screening.concerns || screening.concerns.length === 0) && (
										<p className='text-sm text-muted-foreground italic'>
											No concerns recorded.
										</p>
									)}
								</ul>
							</CardContent>
						</Card>
					</div>

					{/* Red Flags */}
					{screening.red_flags && screening.red_flags.length > 0 && (
						<Card className='border-red-200 dark:border-red-800'>
							<CardHeader>
								<CardTitle className='text-lg flex items-center gap-2 text-red-700 dark:text-red-400'>
									<ShieldAlert className='h-5 w-5' />
									Red Flags
								</CardTitle>
							</CardHeader>
							<CardContent className='space-y-3'>
								{screening.red_flags.map((flag, i) => (
									<RedFlagItem
										key={i}
										icon={<AlertTriangle className='h-4 w-4' />}
										title={flag.type}
										description={flag.description}
										severity={flag.severity}
										followUp={flag.follow_up}
									/>
								))}
							</CardContent>
						</Card>
					)}

					{/* Interview Focus Areas */}
					{screening.interview_focus_areas &&
						screening.interview_focus_areas.length > 0 && (
							<Card>
								<CardHeader>
									<CardTitle className='text-lg flex items-center gap-2'>
										<ClipboardList className='h-5 w-5 text-indigo-500' />
										Interview Focus Areas
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className='flex flex-wrap gap-2'>
										{screening.interview_focus_areas.map((area) => (
											<Badge
												key={area}
												variant='outline'
												className='bg-indigo-50 text-indigo-700 border-indigo-200'
											>
												{area}
											</Badge>
										))}
									</div>
								</CardContent>
							</Card>
						)}
				</TabsContent>

				{/* ── Skills Tab ── */}
				<TabsContent value='skills' className='mt-6 space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<Target className='h-5 w-5 text-indigo-500' />
								Skill Match Analysis
								<span className='ml-auto text-sm font-normal text-muted-foreground'>
									{breakdown.skills_match ?? 0}%
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
											({screening.matched_skills?.length || 0})
										</span>
									</p>
								</div>
								<div className='flex flex-wrap gap-2'>
									{screening.matched_skills?.map((skill) => (
										<SkillBadge key={skill} skill={skill} variant='match' />
									))}
								</div>
							</div>

							{/* Missing Skills */}
							<div>
								<div className='flex items-center gap-2 mb-3'>
									<XCircle className='h-4 w-4 text-red-500' />
									<p className='text-sm font-medium'>
										Missing{' '}
										<span className='text-muted-foreground font-normal'>
											({screening.missing_skills?.length || 0})
										</span>
									</p>
								</div>
								<div className='flex flex-wrap gap-2'>
									{screening.missing_skills?.map((skill) => (
										<SkillBadge key={skill} skill={skill} variant='missing' />
									))}
								</div>
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
								AI-Generated Screening Questions
								<Badge variant='secondary' className='ml-auto text-xs'>
									{screening.screening_questions?.length || 0} questions
								</Badge>
							</CardTitle>
						</CardHeader>
						<CardContent>
							{screening.screening_questions && screening.screening_questions.length > 0 ? (
								<div className='grid gap-3'>
									{screening.screening_questions.map((q, i) => (
										<QuestionCard key={i} q={q} index={i} />
									))}
								</div>
							) : (
								<div className='text-center py-8 text-muted-foreground'>
									<StickyNote className='h-12 w-12 mx-auto mb-3 opacity-30' />
									<p className='text-sm font-medium'>No screening questions generated</p>
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

				{/* ── Audit Log Tab ── */}
				<TabsContent value='audit' className='mt-6 space-y-6'>
					<Card>
						<CardHeader>
							<CardTitle className='text-lg flex items-center gap-2'>
								<History className='h-5 w-5 text-indigo-500' />
								Audit Trail
							</CardTitle>
						</CardHeader>
						<CardContent>
							{auditLoading ? (
								<div className='flex items-center justify-center py-8'>
									<Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
								</div>
							) : auditLogs.length === 0 ? (
								<div className='text-center py-8 text-muted-foreground'>
									<History className='h-12 w-12 mx-auto mb-3 opacity-30' />
									<p className='text-sm font-medium'>No audit entries yet</p>
								</div>
							) : (
								<div className='divide-y'>
									{auditLogs.map((entry) => (
										<AuditLogEntryCard key={entry.id} entry={entry} />
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}
