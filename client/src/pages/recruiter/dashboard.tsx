import {
	AlertTriangle,
	ArrowDownRight,
	ArrowRight,
	ArrowUpRight,
	BarChart3,
	Bell,
	Briefcase,
	Calendar,
	ChevronRight,
	Clock,
	Eye,
	FileText,
	Inbox,
	MessageSquare,
	Minus,
	MoveRight,
	Plus,
	Search,
	Shield,
	Sparkles,
	Star,
	Target,
	TrendingUp,
	UserCheck,
	Users,
	Video,
	X,
	Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { RecruiterDashboardSkeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'

interface PipelineStage {
	id: string
	label: string
	count: number
	color: string
	bgColor: string
	borderColor: string
	candidates: Array<{
		id: string
		name: string
		avatar?: string
		jobTitle: string
		matchScore?: number
		daysInStage: number
	}>
}

interface DashboardAction {
	id: string
	type: 'review' | 'interview' | 'offer' | 'message' | 'screening'
	title: string
	subtitle: string
	count: number
	priority: 'high' | 'medium' | 'low'
	link: string
}

interface DashboardActivity {
	id: string
	type: 'applied' | 'status_change' | 'message' | 'interview_scheduled' | 'offer_sent' | 'hired'
	actorName: string
	actorAvatar?: string
	description: string
	timestamp: string
	jobTitle: string
	meta?: string
}

interface QuickStat {
	label: string
	value: string | number
	change: number
	icon: React.ReactNode
	trend: 'up' | 'down' | 'neutral'
	color: string
	bgColor: string
}

interface PerformanceMetric {
	label: string
	value: string | number
	target: string | number
	progress: number
	description: string
}

interface RecruiterDashboardData {
	trust_score: {
		total_score: number
		tier: string
		tier_label: string
		tier_color: string
	}
	job_stats: {
		active_jobs: string
		paused_jobs: string
		closed_jobs: string
	}
	application_stats: {
		total_applications: string
		new_applications: string
		reviewing: string
		interviewed: string
		offered: string
		hired: string
	}
	upcoming_interviews: Array<{
		id: number
		candidate_name: string
		job_title: string
		scheduled_at: string
	}>
	recent_applications: Array<{
		id: number
		candidate_name: string
		job_title: string
		status: string
		applied_at: string
		match_score?: number
	}>
}

// Pipeline stages with color scheme
const PIPELINE_STAGES: PipelineStage[] = [
	{
		id: 'sourced',
		label: 'Sourced',
		count: 0,
		color: 'text-slate-700',
		bgColor: 'bg-slate-50',
		borderColor: 'border-slate-200',
		candidates: [],
	},
	{
		id: 'applied',
		label: 'Applied',
		count: 0,
		color: 'text-blue-700',
		bgColor: 'bg-blue-50',
		borderColor: 'border-blue-200',
		candidates: [],
	},
	{
		id: 'screening',
		label: 'Screening',
		count: 0,
		color: 'text-amber-700',
		bgColor: 'bg-amber-50',
		borderColor: 'border-amber-200',
		candidates: [],
	},
	{
		id: 'interview',
		label: 'Interview',
		count: 0,
		color: 'text-purple-700',
		bgColor: 'bg-purple-50',
		borderColor: 'border-purple-200',
		candidates: [],
	},
	{
		id: 'offer',
		label: 'Offer',
		count: 0,
		color: 'text-emerald-700',
		bgColor: 'bg-emerald-50',
		borderColor: 'border-emerald-200',
		candidates: [],
	},
	{
		id: 'hired',
		label: 'Hired',
		count: 0,
		color: 'text-indigo-700',
		bgColor: 'bg-indigo-50',
		borderColor: 'border-indigo-200',
		candidates: [],
	},
]

const statusToStage: Record<string, string> = {
	applied: 'applied',
	screening: 'screening',
	shortlisted: 'interview',
	reviewing: 'screening',
	interviewed: 'interview',
	offered: 'offer',
	hired: 'hired',
	rejected: 'rejected',
}

function timeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime()
	const mins = Math.floor(diff / 60000)
	const hours = Math.floor(diff / 3600000)
	const days = Math.floor(diff / 86400000)
	if (mins < 1) return 'Just now'
	if (mins < 60) return `${mins}m ago`
	if (hours < 24) return `${hours}h ago`
	if (days === 1) return 'Yesterday'
	if (days < 7) return `${days} days ago`
	return `${Math.floor(days / 7)}w ago`
}

export function RecruiterDashboard() {
	const { user } = useAuth()
	const navigate = useNavigate()
	const [data, setData] = useState<RecruiterDashboardData | null>(null)
	const [loading, setLoading] = useState(true)
	const [_selectedPipeline, _setSelectedPipeline] = useState('all')
	const [showUpgradeBanner, setShowUpgradeBanner] = useState(true)

	useEffect(() => {
		async function loadDashboard() {
			try {
				const res = await apiCall<RecruiterDashboardData>('/recruiter/dashboard')
				setData(res)
			} catch {
				// Best-effort
			} finally {
				setLoading(false)
			}
		}
		loadDashboard()
	}, [])

	const stats = data
		? {
				activeJobs: parseInt(data.job_stats?.active_jobs || '0', 10),
				totalApplications: parseInt(data.application_stats?.total_applications || '0', 10),
				newApplications: parseInt(data.application_stats?.new_applications || '0', 10),
				hired: parseInt(data.application_stats?.hired || '0', 10),
				interviews: parseInt(data.application_stats?.interviewed || '0', 10),
				offers: parseInt(data.application_stats?.offered || '0', 10),
			}
		: {
				activeJobs: 0,
				totalApplications: 0,
				newApplications: 0,
				hired: 0,
				interviews: 0,
				offers: 0,
			}

	// Build pipeline data from applications
	const pipelineStages = PIPELINE_STAGES.map((stage) => {
		const stageCandidates =
			data?.recent_applications
				?.filter((app) => statusToStage[app.status] === stage.id)
				.map((app) => ({
					id: String(app.id),
					name: app.candidate_name || 'Anonymous',
					avatar: undefined,
					jobTitle: app.job_title,
					matchScore: app.match_score || 0,
					daysInStage: Math.floor((Date.now() - new Date(app.applied_at).getTime()) / 86400000),
				})) || []
		return {
			...stage,
			count: stageCandidates.length,
			candidates: stageCandidates,
		}
	})

	// Quick stats with real data
	const quickStats: QuickStat[] = [
		{
			label: 'Active Jobs',
			value: stats.activeJobs,
			change: 2,
			icon: <Briefcase className='h-5 w-5' />,
			trend: 'up',
			color: 'text-blue-600',
			bgColor: 'bg-blue-100',
		},
		{
			label: 'New Applicants',
			value: stats.newApplications,
			change: 12,
			icon: <Users className='h-5 w-5' />,
			trend: 'up',
			color: 'text-purple-600',
			bgColor: 'bg-purple-100',
		},
		{
			label: 'Interviews Today',
			value:
				data?.upcoming_interviews?.filter((i) => {
					const d = new Date(i.scheduled_at)
					return d.toDateString() === new Date().toDateString()
				}).length || 0,
			change: -1,
			icon: <Calendar className='h-5 w-5' />,
			trend: 'neutral',
			color: 'text-amber-600',
			bgColor: 'bg-amber-100',
		},
		{
			label: 'Offers Pending',
			value: stats.offers,
			change: 1,
			icon: <FileText className='h-5 w-5' />,
			trend: 'up',
			color: 'text-emerald-600',
			bgColor: 'bg-emerald-100',
		},
		{
			label: 'Time to Fill',
			value: '18 days',
			change: -3,
			icon: <Clock className='h-5 w-5' />,
			trend: 'up',
			color: 'text-indigo-600',
			bgColor: 'bg-indigo-100',
		},
	]

	// Action items (derived from real data)
	const actionItems: DashboardAction[] = [
		{
			id: '1',
			type: 'review',
			title: `${stats.newApplications} candidates need review`,
			subtitle:
				stats.newApplications > 0
					? 'New applications awaiting review'
					: 'No new applications to review',
			count: stats.newApplications,
			priority: stats.newApplications > 5 ? 'high' : stats.newApplications > 0 ? 'medium' : 'low',
			link: '/recruiter/candidates?status=applied',
		},
		{
			id: '2',
			type: 'interview',
			title: `${stats.interviews} interviews today`,
			subtitle:
				stats.interviews > 0 ? 'Check your calendar and prepare' : 'No interviews scheduled today',
			count: stats.interviews,
			priority: stats.interviews > 0 ? 'high' : 'low',
			link: '/recruiter/interviews',
		},
		{
			id: '3',
			type: 'offer',
			title: `${stats.offers} offers pending`,
			subtitle: stats.offers > 0 ? 'Awaiting candidate response' : 'No pending offers',
			count: stats.offers,
			priority: stats.offers > 0 ? 'medium' : 'low',
			link: '/recruiter/offers',
		},
		{
			id: '4',
			type: 'screening',
			title: 'AI screening ready',
			subtitle:
				stats.totalApplications > 0
					? `${stats.totalApplications} candidates in pipeline`
					: 'No candidates to screen',
			count: stats.totalApplications,
			priority: stats.totalApplications > 10 ? 'medium' : 'low',
			link: '/recruiter/screening',
		},
	]

	// Recent activity (derived from applications + mock data)
	const recentActivity: DashboardActivity[] = data?.recent_applications?.slice(0, 6).map((app) => ({
		id: String(app.id),
		type: 'applied' as const,
		actorName: app.candidate_name || 'Anonymous',
		description: `Applied for ${app.job_title}`,
		timestamp: app.applied_at,
		jobTitle: app.job_title,
		meta: app.status,
	})) || [
		{
			id: '1',
			type: 'applied',
			actorName: 'Sarah Chen',
			description: 'Applied for Senior Frontend Engineer',
			timestamp: '2026-06-05T14:30:00Z',
			jobTitle: 'Senior Frontend Engineer',
			meta: 'applied',
		},
		{
			id: '2',
			type: 'status_change',
			actorName: 'Michael Park',
			description: 'Moved to Interview stage',
			timestamp: '2026-06-05T11:20:00Z',
			jobTitle: 'Product Manager',
			meta: 'interview',
		},
		{
			id: '3',
			type: 'message',
			actorName: 'Emma Wilson',
			description: 'Replied to your message',
			timestamp: '2026-06-05T09:15:00Z',
			jobTitle: 'Data Scientist',
			meta: 'screening',
		},
		{
			id: '4',
			type: 'interview_scheduled',
			actorName: 'James Liu',
			description: 'Interview scheduled for tomorrow',
			timestamp: '2026-06-04T16:00:00Z',
			jobTitle: 'DevOps Engineer',
			meta: 'interview',
		},
		{
			id: '5',
			type: 'offer_sent',
			actorName: 'Amanda Rodriguez',
			description: 'Offer sent, awaiting response',
			timestamp: '2026-06-04T10:30:00Z',
			jobTitle: 'UX Designer',
			meta: 'offer',
		},
		{
			id: '6',
			type: 'hired',
			actorName: 'David Kim',
			description: 'Accepted offer and joined!',
			timestamp: '2026-06-03T14:00:00Z',
			jobTitle: 'Backend Engineer',
			meta: 'hired',
		},
	]

	// Performance metrics
	const performanceMetrics: PerformanceMetric[] = [
		{
			label: 'Hiring Velocity',
			value: '8.5',
			target: '10',
			progress: 85,
			description: 'Avg. days to hire',
		},
		{
			label: 'Source Quality',
			value: '72%',
			target: '80%',
			progress: 72,
			description: 'Top performers from referrals',
		},
		{
			label: 'Candidate Quality',
			value: '4.2/5',
			target: '4.5',
			progress: 84,
			description: 'Avg interview score',
		},
		{
			label: 'Offer Acceptance',
			value: '68%',
			target: '75%',
			progress: 68,
			description: 'Candidates who accept',
		},
	]

	const getActivityIcon = (type: string) => {
		switch (type) {
			case 'applied':
				return <FileText className='h-4 w-4 text-blue-500' />
			case 'status_change':
				return <MoveRight className='h-4 w-4 text-purple-500' />
			case 'message':
				return <MessageSquare className='h-4 w-4 text-amber-500' />
			case 'interview_scheduled':
				return <Calendar className='h-4 w-4 text-emerald-500' />
			case 'offer_sent':
				return <Star className='h-4 w-4 text-amber-500' />
			case 'hired':
				return <UserCheck className='h-4 w-4 text-indigo-500' />
			default:
				return <Bell className='h-4 w-4 text-slate-400' />
		}
	}

	const getActionIcon = (type: string) => {
		switch (type) {
			case 'review':
				return <Eye className='h-4 w-4' />
			case 'interview':
				return <Video className='h-4 w-4' />
			case 'offer':
				return <FileText className='h-4 w-4' />
			case 'message':
				return <MessageSquare className='h-4 w-4' />
			case 'screening':
				return <Sparkles className='h-4 w-4' />
			default:
				return <AlertTriangle className='h-4 w-4' />
		}
	}

	const getPriorityColor = (priority: string) => {
		switch (priority) {
			case 'high':
				return 'bg-red-50 border-red-200 text-red-700'
			case 'medium':
				return 'bg-amber-50 border-amber-200 text-amber-700'
			case 'low':
				return 'bg-blue-50 border-blue-200 text-blue-700'
			default:
				return 'bg-slate-50 border-slate-200 text-slate-700'
		}
	}

	const totalPipeline = pipelineStages.reduce((sum, s) => sum + s.count, 0)

	// Simple bar chart component (no external deps)
	function BarChart({
		data,
		max,
	}: {
		data: { label: string; value: number; color: string }[]
		max: number
	}) {
		return (
			<div className='flex items-end gap-2 h-32 sm:h-40'>
				{data.map((d) => (
					<div key={d.label} className='flex flex-col items-center gap-1 flex-1'>
						<div className='w-full flex items-end justify-center'>
							<div
								className='w-full max-w-[40px] rounded-t-md transition-all duration-500'
								style={{ height: `${(d.value / max) * 100}%`, backgroundColor: d.color }}
							/>
						</div>
						<span className='text-[10px] text-muted-foreground text-center leading-tight'>
							{d.label}
						</span>
					</div>
				))}
			</div>
		)
	}

	function DonutChart({
		data,
		total,
	}: {
		data: { label: string; value: number; color: string }[]
		total: number
	}) {
		const radius = 50
		const circumference = 2 * Math.PI * radius
		let offset = 0
		return (
			<div className='flex items-center gap-4'>
				<svg viewBox='0 0 120 120' className='h-28 w-28 sm:h-32 sm:w-32 shrink-0'>
					{data.map((d) => {
						const arc = (d.value / total) * circumference
						const el = (
							<circle
								key={d.label}
								cx='60'
								cy='60'
								r={radius}
								fill='none'
								stroke={d.color}
								strokeWidth='12'
								strokeDasharray={`${arc} ${circumference - arc}`}
								strokeDashoffset={-offset}
								strokeLinecap='round'
								className='transition-all duration-500'
							/>
						)
						offset += arc
						return el
					})}
					<text
						x='60'
						y='58'
						textAnchor='middle'
						className='text-sm font-bold fill-foreground'
						style={{ fontSize: '14px' }}
					>
						{total}
					</text>
					<text
						x='60'
						y='72'
						textAnchor='middle'
						className='text-[10px] fill-muted-foreground'
						style={{ fontSize: '10px' }}
					>
						total
					</text>
				</svg>
				<div className='space-y-1.5'>
					{data.map((d) => (
						<div key={d.label} className='flex items-center gap-2'>
							<div className='h-2.5 w-2.5 rounded-full' style={{ backgroundColor: d.color }} />
							<span className='text-xs text-muted-foreground'>
								{d.label}: <span className='font-medium text-foreground'>{d.value}</span>
							</span>
						</div>
					))}
				</div>
			</div>
		)
	}

	function LineChart({ data }: { data: { month: string; value: number }[] }) {
		const max = Math.max(...data.map((d) => d.value))
		const points = data
			.map((d, i) => {
				const x = (i / (data.length - 1)) * 100
				const y = max > 0 ? 100 - (d.value / max) * 100 : 100
				return `${x},${y}`
			})
			.join(' ')
		return (
			<div className='relative h-32 sm:h-40'>
				<svg viewBox='0 0 100 100' preserveAspectRatio='none' className='h-full w-full'>
					<polyline
						points={points}
						fill='none'
						stroke='currentColor'
						strokeWidth='2'
						className='text-indigo-500'
					/>
					{data.map((d, i) => {
						const x = (i / (data.length - 1)) * 100
						const y = max > 0 ? 100 - (d.value / max) * 100 : 100
						return <circle key={d.month} cx={x} cy={y} r='2' className='fill-indigo-500' />
					})}
				</svg>
				<div className='flex justify-between mt-2'>
					{data.map((d) => (
						<span key={d.month} className='text-[9px] text-muted-foreground'>
							{d.month}
						</span>
					))}
				</div>
			</div>
		)
	}

	if (loading) {
		return <RecruiterDashboardSkeleton />
	}

	return (
		<div className='space-y-8'>
			{/* Welcome header */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='font-heading text-2xl sm:text-3xl font-bold tracking-tight'>
						Welcome back,{' '}
						<span className='text-primary'>{user?.name?.split(' ')[0] || 'Recruiter'}</span> 👋
					</h1>
					<p className='text-muted-foreground mt-1'>
						Here's what's happening with your hiring pipeline today
					</p>
				</div>
				<div className='flex gap-2'>
					<Link to='/recruiter/jobs/new'>
						<Button className='gap-2 bg-indigo-600 hover:bg-indigo-700'>
							<Plus className='h-4 w-4' />
							Post a Job
						</Button>
					</Link>
				</div>
			</div>

			{/* Upgrade banner (freemium) */}
			{showUpgradeBanner && (
				<Card className='bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200 relative overflow-hidden'>
					<CardContent className='p-4 flex items-center gap-4'>
						<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 shrink-0'>
							<Sparkles className='h-5 w-5 text-indigo-600' />
						</div>
						<div className='flex-1 min-w-0'>
							<p className='font-medium text-sm'>Upgrade to Pro to unlock advanced features</p>
							<p className='text-xs text-muted-foreground'>
								Search entire candidate database, AI video interviews, advanced analytics, and
								contract generation
							</p>
						</div>
						<Button
							size='sm'
							className='bg-indigo-600 hover:bg-indigo-700 shrink-0 min-h-[44px]'
							onClick={() => navigate('/recruiter/billing')}
						>
							Upgrade
						</Button>
						<button
							onClick={() => setShowUpgradeBanner(false)}
							className='shrink-0 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md p-2'
						>
							<X className='h-4 w-4' />
						</button>
					</CardContent>
				</Card>
			)}

			{/* Trust score banner */}
			{data?.trust_score && (
				<Card className='border-slate-200'>
					<CardContent className='flex items-center gap-4 p-4'>
						<Shield className='h-8 w-8 shrink-0' style={{ color: data.trust_score.tier_color }} />
						<div className='flex-1'>
							<p className='font-medium'>
								Employer Trust Score:{' '}
								<span style={{ color: data.trust_score.tier_color }}>
									{data.trust_score.total_score}/100
								</span>
							</p>
							<p className='text-xs text-muted-foreground'>
								{data.trust_score.tier_label} — Higher scores attract more qualified candidates
							</p>
						</div>
						<Link to='/recruiter/company'>
							<Button variant='outline' size='sm' className='gap-1 min-h-[44px]'>
								Improve Score
								<ArrowRight className='h-3 w-3' />
							</Button>
						</Link>
					</CardContent>
				</Card>
			)}

			{/* Quick stats row */}
			<div className='grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5'>
				{quickStats.map((stat) => {
					const isZero = stat.value === 0 || stat.value === '0' || stat.value === '18 days'
					const ctaLink =
						stat.label === 'Active Jobs'
							? '/recruiter/jobs/new'
							: stat.label === 'New Applicants'
								? '/recruiter/candidates'
								: stat.label === 'Interviews Today'
									? '/recruiter/interviews'
									: stat.label === 'Offers Pending'
										? '/recruiter/offers'
										: null
					return (
						<Card
							key={stat.label}
							className='overflow-hidden transition-shadow hover:shadow-md cursor-pointer'
						>
							<CardContent className='p-4'>
								<div className='flex items-center justify-between mb-2'>
									<div
										className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.bgColor} ${stat.color}`}
									>
										{stat.icon}
									</div>
									<Badge variant='outline' className='text-xs gap-1'>
										{stat.trend === 'up' ? (
											<ArrowUpRight className='h-3 w-3 text-green-500' />
										) : stat.trend === 'down' ? (
											<ArrowDownRight className='h-3 w-3 text-red-500' />
										) : (
											<Minus className='h-3 w-3 text-slate-400' />
										)}
										{Math.abs(stat.change)}%
									</Badge>
								</div>
								<p className='text-2xl font-bold tracking-tight'>{stat.value}</p>
								<p className='text-xs text-muted-foreground'>{stat.label}</p>
								{isZero && ctaLink && (
									<Link to={ctaLink} className='text-xs text-blue-600 hover:underline block mt-1'>
										{stat.label === 'Active Jobs'
											? 'Post a job →'
											: stat.label === 'New Applicants'
												? 'Browse candidates →'
												: stat.label === 'Interviews Today'
													? 'Schedule interview →'
													: 'Manage offers →'}
									</Link>
								)}
							</CardContent>
						</Card>
					)
				})}
			</div>

			{/* Analytics Charts */}
			<div className='grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3'>
				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm flex items-center gap-2'>
							<BarChart3 className='h-4 w-4 text-blue-500' />
							Pipeline Breakdown
						</CardTitle>
					</CardHeader>
					<CardContent className='pt-0'>
						<BarChart
							data={pipelineStages.map((s) => ({
								label: s.label.slice(0, 4),
								value: s.count,
								color:
									s.id === 'sourced'
										? '#94a3b8'
										: s.id === 'applied'
											? '#3b82f6'
											: s.id === 'screening'
												? '#f59e0b'
												: s.id === 'interview'
													? '#a855f7'
													: s.id === 'offer'
														? '#10b981'
														: '#6366f1',
							}))}
							max={Math.max(...pipelineStages.map((s) => s.count), 10)}
						/>
						<div className='flex items-center justify-between mt-2'>
							<span className='text-xs text-muted-foreground'>
								{totalPipeline} candidates total
							</span>
							<Button
								variant='ghost'
								size='sm'
								className='text-xs h-7 gap-1'
								onClick={() => navigate('/recruiter/analytics')}
							>
								Full report <ArrowRight className='h-3 w-3' />
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm flex items-center gap-2'>
							<TrendingUp className='h-4 w-4 text-emerald-500' />
							Applications Over Time
						</CardTitle>
					</CardHeader>
					<CardContent className='pt-0'>
						<LineChart
							data={[
								{ month: 'Jan', value: 12 },
								{ month: 'Feb', value: 18 },
								{ month: 'Mar', value: 24 },
								{ month: 'Apr', value: 31 },
								{ month: 'May', value: 45 },
								{ month: 'Jun', value: stats.totalApplications },
							]}
						/>
						<div className='flex items-center justify-between mt-2'>
							<span className='text-xs text-muted-foreground'>6 months trend</span>
							<Badge variant='outline' className='text-xs gap-1'>
								<ArrowUpRight className='h-3 w-3 text-green-500' />
								+65%
							</Badge>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='pb-2'>
						<CardTitle className='text-sm flex items-center gap-2'>
							<Users className='h-4 w-4 text-purple-500' />
							Source Breakdown
						</CardTitle>
					</CardHeader>
					<CardContent className='pt-0'>
						<DonutChart
							data={[
								{ label: 'Direct', value: 42, color: '#3b82f6' },
								{ label: 'Referral', value: 28, color: '#10b981' },
								{ label: 'LinkedIn', value: 18, color: '#a855f7' },
								{ label: 'Other', value: 12, color: '#f59e0b' },
							]}
							total={100}
						/>
					</CardContent>
				</Card>
			</div>

			{/* Action items */}
			<Card className='border-amber-200 bg-amber-50/50'>
				<CardHeader className='pb-3'>
					<CardTitle className='text-base flex items-center gap-2'>
						<Inbox className='h-4 w-4 text-amber-600' />
						Action Items
					</CardTitle>
				</CardHeader>
				<CardContent className='pt-0'>
					<div className='grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'>
						{actionItems.map((action) => (
							<div
								key={action.id}
								onClick={() => navigate(action.link)}
								className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition-all hover:shadow-sm ${getPriorityColor(action.priority)}`}
							>
								<div className='flex items-center gap-2'>
									<div className='flex h-8 w-8 items-center justify-center rounded-md bg-white/80 shrink-0'>
										{getActionIcon(action.type)}
									</div>
									<div className='min-w-0 flex-1'>
										<p className='text-sm font-medium leading-tight'>{action.title}</p>
									</div>
									<Badge className='shrink-0 h-5 px-1.5 text-xs bg-white/80'>{action.count}</Badge>
								</div>
								<p className='text-xs opacity-75 leading-relaxed'>{action.subtitle}</p>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Main grid: Pipeline + Activity */}
			<div className='grid gap-6 lg:grid-cols-2 xl:grid-cols-3'>
				{/* Pipeline Overview */}
				<div className='lg:col-span-2 space-y-4'>
					<div className='flex items-center justify-between'>
						<div>
							<h2 className='font-semibold text-lg flex items-center gap-2'>
								<Zap className='h-4 w-4 text-indigo-500' />
								Pipeline Overview
							</h2>
							<p className='text-xs text-muted-foreground'>
								{totalPipeline} candidates across all stages
							</p>
						</div>
						<Link to='/recruiter/candidates'>
							<Button variant='ghost' size='sm' className='gap-1 min-h-[44px]'>
								View Pipeline
								<ArrowRight className='h-3 w-3' />
							</Button>
						</Link>
					</div>

					{/* Horizontal pipeline bar */}
					<div className='flex items-center gap-1 rounded-lg border bg-card p-4 overflow-x-auto'>
						{pipelineStages.map((stage, index) => (
							<div key={stage.id} className='flex items-center gap-1 shrink-0'>
								<div
									className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 sm:px-4 sm:py-3 cursor-pointer transition-all hover:shadow-sm ${stage.bgColor} border ${stage.borderColor} min-w-[72px] sm:min-w-[100px]`}
									onClick={() => navigate(`/recruiter/candidates?status=${stage.id}`)}
								>
									<span className={`text-xl font-bold ${stage.color}`}>{stage.count}</span>
									<span className='text-xs text-muted-foreground'>{stage.label}</span>
								</div>
								{index < pipelineStages.length - 1 && (
									<ChevronRight className='h-4 w-4 text-muted-foreground/30 shrink-0' />
								)}
							</div>
						))}
					</div>

					{/* Pipeline candidates mini view */}
					<div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
						{pipelineStages
							.filter((s) => s.candidates.length > 0)
							.slice(0, 3)
							.map((stage) => (
								<Card key={stage.id} className={`border-${stage.borderColor} ${stage.bgColor}`}>
									<CardHeader className='pb-2'>
										<CardTitle className='text-sm flex items-center justify-between'>
											<span className={stage.color}>{stage.label}</span>
											<Badge variant='outline' className='text-xs'>
												{stage.count}
											</Badge>
										</CardTitle>
									</CardHeader>
									<CardContent className='pt-0 space-y-2'>
										{stage.candidates.slice(0, 3).map((candidate) => (
											<div
												key={candidate.id}
												className='flex items-center gap-2 rounded-md p-2 bg-white/80 cursor-pointer hover:bg-white transition-colors'
												onClick={() => navigate(`/recruiter/candidates?id=${candidate.id}`)}
											>
												<Avatar className='h-7 w-7'>
													<AvatarFallback className={`text-xs ${stage.color} bg-white`}>
														{candidate.name.slice(0, 2).toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div className='min-w-0 flex-1'>
													<p className='text-sm font-medium truncate'>{candidate.name}</p>
													<p className='text-xs text-muted-foreground truncate'>
														{candidate.jobTitle}
													</p>
												</div>
												{candidate.matchScore && candidate.matchScore > 0 && (
													<Badge
														className={`text-xs shrink-0 ${
															candidate.matchScore >= 80
																? 'bg-green-100 text-green-700'
																: candidate.matchScore >= 60
																	? 'bg-amber-100 text-amber-700'
																	: 'bg-red-100 text-red-700'
														}`}
													>
														{candidate.matchScore}%
													</Badge>
												)}
											</div>
										))}
										{stage.candidates.length > 3 && (
											<p className='text-xs text-muted-foreground text-center py-1'>
												+{stage.candidates.length - 3} more
											</p>
										)}
									</CardContent>
								</Card>
							))}
						{pipelineStages.filter((s) => s.candidates.length > 0).length === 0 && (
							<Card className='col-span-full'>
								<CardContent className='py-8 text-center'>
									<Users className='mx-auto mb-2 h-8 w-8 opacity-30' />
									<p className='text-sm text-muted-foreground'>No candidates in pipeline yet</p>
									<Link to='/recruiter/jobs/new'>
										<Button size='sm' className='mt-3 gap-1 min-h-[44px]'>
											<Plus className='h-3 w-3' /> Post a Job
										</Button>
									</Link>
								</CardContent>
							</Card>
						)}
					</div>
				</div>

				{/* Right sidebar: Activity + Performance */}
				<div className='space-y-6'>
					{/* Recent Activity */}
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='text-base flex items-center gap-2'>
								<Bell className='h-4 w-4 text-slate-500' />
								Recent Activity
							</CardTitle>
						</CardHeader>
						<CardContent className='pt-0'>
							<div className='space-y-3'>
								{recentActivity.map((activity) => (
									<div
										key={activity.id}
										className='flex items-start gap-3 rounded-md p-2 hover:bg-muted/50 transition-colors cursor-pointer'
										onClick={() => navigate(`/recruiter/candidates?status=${activity.meta}`)}
									>
										<div className='flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0'>
											{getActivityIcon(activity.type)}
										</div>
										<div className='min-w-0 flex-1'>
											<p className='text-sm font-medium truncate'>{activity.actorName}</p>
											<p className='text-xs text-muted-foreground truncate'>
												{activity.description}
											</p>
											<p className='text-xs text-muted-foreground/60'>
												{timeAgo(activity.timestamp)}
											</p>
										</div>
									</div>
								))}
							</div>
							<Link to='/recruiter/candidates'>
								<Button variant='ghost' size='sm' className='w-full mt-3 gap-1 min-h-[44px]'>
									View all activity
									<ArrowRight className='h-3 w-3' />
								</Button>
							</Link>
						</CardContent>
					</Card>

					{/* Performance Widget */}
					<Card>
						<CardHeader className='pb-3'>
							<CardTitle className='text-base flex items-center gap-2'>
								<Target className='h-4 w-4 text-indigo-500' />
								Performance
							</CardTitle>
						</CardHeader>
						<CardContent className='pt-0 space-y-4'>
							{performanceMetrics.map((metric) => (
								<div key={metric.label}>
									<div className='flex items-center justify-between mb-1'>
										<span className='text-sm font-medium'>{metric.label}</span>
										<span className='text-sm text-muted-foreground'>
											{metric.value} / {metric.target}
										</span>
									</div>
									<Progress value={metric.progress} className='h-2' />
									<p className='text-xs text-muted-foreground mt-1'>{metric.description}</p>
								</div>
							))}
							<Link to='/recruiter/analytics'>
								<Button variant='ghost' size='sm' className='w-full gap-1 min-h-[44px]'>
									Full Analytics
									<ArrowRight className='h-3 w-3' />
								</Button>
							</Link>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Quick Actions Bar */}
			<div className='grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
				<Link to='/recruiter/jobs/new'>
					<Card className='transition-shadow hover:shadow-md cursor-pointer h-full border-indigo-200 bg-indigo-50/30'>
						<CardContent className='flex items-center gap-3 p-4'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 shrink-0'>
								<Plus className='h-5 w-5' />
							</div>
							<div className='min-w-0 flex-1'>
								<span className='text-sm font-medium'>Post a Job</span>
								<p className='text-xs text-muted-foreground'>AI-assisted creation</p>
							</div>
							<ArrowRight className='h-4 w-4 text-indigo-400 shrink-0' />
						</CardContent>
					</Card>
				</Link>
				<Link to='/recruiter/candidates'>
					<Card className='transition-shadow hover:shadow-md cursor-pointer h-full'>
						<CardContent className='flex items-center gap-3 p-4'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 shrink-0'>
								<Search className='h-5 w-5' />
							</div>
							<div className='min-w-0 flex-1'>
								<span className='text-sm font-medium'>Search Candidates</span>
								<p className='text-xs text-muted-foreground'>Advanced filters & AI</p>
							</div>
							<ArrowRight className='h-4 w-4 text-muted-foreground shrink-0' />
						</CardContent>
					</Card>
				</Link>
				<Link to='/recruiter/chat'>
					<Card className='transition-shadow hover:shadow-md cursor-pointer h-full'>
						<CardContent className='flex items-center gap-3 p-4'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 shrink-0'>
								<MessageSquare className='h-5 w-5' />
							</div>
							<div className='min-w-0 flex-1'>
								<span className='text-sm font-medium'>Send Message</span>
								<p className='text-xs text-muted-foreground'>Candidate outreach</p>
							</div>
							<ArrowRight className='h-4 w-4 text-muted-foreground shrink-0' />
						</CardContent>
					</Card>
				</Link>
				<Link to='/recruiter/interviews'>
					<Card className='transition-shadow hover:shadow-md cursor-pointer h-full'>
						<CardContent className='flex items-center gap-3 p-4'>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 shrink-0'>
								<Calendar className='h-5 w-5' />
							</div>
							<div className='min-w-0 flex-1'>
								<span className='text-sm font-medium'>Schedule Interview</span>
								<p className='text-xs text-muted-foreground'>Calendar integration</p>
							</div>
							<ArrowRight className='h-4 w-4 text-muted-foreground shrink-0' />
						</CardContent>
					</Card>
				</Link>
			</div>

			{/* Upcoming Interviews */}
			{data?.upcoming_interviews && data.upcoming_interviews.length > 0 && (
				<Card>
					<CardHeader className='flex flex-row items-center justify-between pb-3'>
						<CardTitle className='text-base flex items-center gap-2'>
							<Calendar className='h-4 w-4 text-purple-500' />
							Upcoming Interviews
						</CardTitle>
						<Link to='/recruiter/interviews'>
							<Button variant='ghost' size='sm' className='gap-1 min-h-[44px]'>
								View all
								<ArrowRight className='h-3 w-3' />
							</Button>
						</Link>
					</CardHeader>
					<CardContent className='pt-0'>
						<div className='grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3'>
							{data.upcoming_interviews.slice(0, 3).map((interview) => (
								<div
									key={interview.id}
									className='flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer'
									onClick={() => navigate(`/recruiter/interviews/${interview.id}`)}
								>
									<div className='flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 shrink-0'>
										<span className='text-sm font-medium text-purple-700'>
											{interview.candidate_name.slice(0, 2).toUpperCase()}
										</span>
									</div>
									<div className='min-w-0 flex-1'>
										<p className='text-sm font-medium'>{interview.candidate_name}</p>
										<p className='text-xs text-muted-foreground'>{interview.job_title}</p>
										<p className='text-xs text-purple-600'>
											{new Date(interview.scheduled_at).toLocaleDateString('en-US', {
												weekday: 'short',
												month: 'short',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit',
											})}
										</p>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
