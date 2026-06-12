import {
	ArrowRight,
	Baby,
	Briefcase,
	Calendar,
	CheckCircle,
	Clock,
	Coffee,
	DollarSign,
	Dumbbell,
	Globe,
	GraduationCap,
	HeartPulse,
	Laptop,
	MapPin,
	Plane,
	Shield,
	Sparkles,
	Star,
	TrendingUp,
	Users,
	Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EmptyState } from '@/components/domain/empty-state'
import { Skeleton } from '@/components/domain/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { trackEvent } from '@/lib/analytics'
import { apiCall } from '@/lib/api'

export type CareerPageData = {
	company: {
		id: string
		name: string
		logo?: string
		coverImage?: string
		tagline: string
		description: string
		website: string
		location: string
		size: string
		industry: string
		founded: string
		trustscore: number
		rating: number
		reviewCount: number
	}
	culture: {
		values: string[]
		benefits: Array<{ icon: string; label: string; description: string }>
		photos: string[]
		videoUrl?: string
	}
	team: Array<{
		id: string
		name: string
		role: string
		avatar?: string
		quote?: string
	}>
	jobs: Array<{
		id: string
		title: string
		department: string
		location: string
		type: string
		salary: string
		postedAt: string
		matchScore?: number
	}>
	stats: {
		openPositions: number
		avgTimeToHire: number
		employees: number
		growthRate: number
	}
}

const benefitIcons: Record<string, React.ReactNode> = {
	health: <HeartPulse className='h-5 w-5' />,
	dental: <HeartPulse className='h-5 w-5' />,
	vision: <HeartPulse className='h-5 w-5' />,
	gym: <Dumbbell className='h-5 w-5' />,
	remote: <Laptop className='h-5 w-5' />,
	vacation: <Plane className='h-5 w-5' />,
	flexible: <Clock className='h-5 w-5' />,
	learning: <GraduationCap className='h-5 w-5' />,
	parental: <Baby className='h-5 w-5' />,
	equity: <TrendingUp className='h-5 w-5' />,
	bonus: <DollarSign className='h-5 w-5' />,
	coffee: <Coffee className='h-5 w-5' />,
	events: <Calendar className='h-5 w-5' />,
	wellness: <HeartPulse className='h-5 w-5' />,
	default: <Sparkles className='h-5 w-5' />,
}

export function RecruiterCareerPage() {
	const { companyId } = useParams()
	const [data, setData] = useState<CareerPageData | null>(null)
	const [loading, setLoading] = useState(true)
	const [selectedDept, setSelectedDept] = useState('all')

	useEffect(() => {
		async function load() {
			setLoading(true)
			try {
				const result = await apiCall<CareerPageData>(`/careers/${companyId || 'default'}`)
				setData(result)
			} catch (err) {
				console.error('Failed to load career page:', err)
				// Use mock data
				setData(generateMockData())
			} finally {
				setLoading(false)
			}
		}
		load()
	}, [companyId])

	if (loading) {
		return (
			<div className='min-h-screen bg-background'>
				<div className='h-64 bg-muted animate-pulse' />
				<div className='max-w-5xl mx-auto px-6 py-8 space-y-6'>
					<Skeleton count={3} variant='card' />
				</div>
			</div>
		)
	}

	if (!data) return null

	const { company, culture, team, jobs, stats } = data

	const departments = ['all', ...Array.from(new Set(jobs.map((j) => j.department)))]
	const filteredJobs =
		selectedDept === 'all' ? jobs : jobs.filter((j) => j.department === selectedDept)

	const handleApply = (jobId: string) => {
		trackEvent('career_page_apply', { job_id: jobId, company_id: company.id })
		window.location.href = `/jobs/${jobId}`
	}

	return (
		<div className='min-h-screen bg-background'>
			{/* Hero */}
			<div className='relative h-64 bg-gradient-to-r from-primary/20 to-primary/10 flex items-end'>
				<div className='max-w-5xl mx-auto px-6 pb-6 w-full'>
					<div className='flex items-end gap-4'>
						<Avatar className='h-20 w-20 border-4 border-background shadow-lg'>
							<AvatarImage src={company.logo} alt={company.name} />
							<AvatarFallback className='bg-primary text-primary-foreground text-2xl font-bold'>
								{company.name.slice(0, 2).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<div className='flex-1'>
							<h1 className='text-2xl font-bold'>{company.name}</h1>
							<p className='text-muted-foreground'>{company.tagline}</p>
							<div className='flex items-center gap-3 mt-1 text-sm text-muted-foreground'>
								<span className='flex items-center gap-1'>
									<MapPin className='h-3.5 w-3.5' />
									{company.location}
								</span>
								<span className='flex items-center gap-1'>
									<Users className='h-3.5 w-3.5' />
									{company.size}
								</span>
								<span className='flex items-center gap-1'>
									<Globe className='h-3.5 w-3.5' />
									<a
										href={company.website}
										target='_blank'
										rel='noopener noreferrer'
										className='hover:underline'
									>
										Website
									</a>
								</span>
							</div>
						</div>
						<div className='text-right'>
							<div className='flex items-center gap-1'>
								<Star className='h-5 w-5 text-amber-500 fill-amber-500' />
								<span className='text-xl font-bold'>{company.rating}</span>
							</div>
							<p className='text-xs text-muted-foreground'>{company.reviewCount} reviews</p>
							<div className='mt-1 flex items-center gap-1'>
								<Shield className='h-3.5 w-3.5 text-emerald-500' />
								<span className='text-xs text-emerald-600 font-medium'>
									TrustScore {company.trustscore}
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className='max-w-5xl mx-auto px-6 py-8 space-y-10'>
				{/* Stats */}
				<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
					<Card>
						<CardContent className='p-4'>
							<div className='flex items-center justify-between'>
								<div>
									<p className='text-2xl font-bold'>{stats.openPositions}</p>
									<p className='text-xs text-muted-foreground'>Open Positions</p>
								</div>
								<Briefcase className='h-8 w-8 text-muted-foreground/50' />
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='p-4'>
							<div className='flex items-center justify-between'>
								<div>
									<p className='text-2xl font-bold'>{stats.employees}</p>
									<p className='text-xs text-muted-foreground'>Employees</p>
								</div>
								<Users className='h-8 w-8 text-muted-foreground/50' />
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='p-4'>
							<div className='flex items-center justify-between'>
								<div>
									<p className='text-2xl font-bold'>{stats.avgTimeToHire}d</p>
									<p className='text-xs text-muted-foreground'>Avg Time to Hire</p>
								</div>
								<Clock className='h-8 w-8 text-muted-foreground/50' />
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className='p-4'>
							<div className='flex items-center justify-between'>
								<div>
									<p className='text-2xl font-bold text-green-600'>+{stats.growthRate}%</p>
									<p className='text-xs text-muted-foreground'>YoY Growth</p>
								</div>
								<TrendingUp className='h-8 w-8 text-green-500/50' />
							</div>
						</CardContent>
					</Card>
				</div>

				{/* About */}
				<div className='space-y-4'>
					<h2 className='font-heading text-xl font-bold'>About {company.name}</h2>
					<p className='text-muted-foreground leading-relaxed'>{company.description}</p>
					<div className='flex flex-wrap gap-2'>
						{culture.values.map((value) => (
							<Badge key={value} variant='secondary' className='text-sm px-3 py-1'>
								<CheckCircle className='h-3.5 w-3.5 mr-1' />
								{value}
							</Badge>
						))}
					</div>
				</div>

				{/* Benefits */}
				<div className='space-y-4'>
					<h2 className='font-heading text-xl font-bold'>Benefits & Perks</h2>
					<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
						{culture.benefits.map((benefit) => (
							<Card key={benefit.label}>
								<CardContent className='p-4'>
									<div className='flex items-start gap-3'>
										<div className='h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
											{benefitIcons[benefit.icon] || benefitIcons.default}
										</div>
										<div>
											<p className='font-medium'>{benefit.label}</p>
											<p className='text-sm text-muted-foreground'>{benefit.description}</p>
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</div>

				{/* Team */}
				<div className='space-y-4'>
					<h2 className='font-heading text-xl font-bold'>Meet the Team</h2>
					<div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
						{team.map((member) => (
							<Card key={member.id} className='overflow-hidden'>
								<CardContent className='p-4 text-center'>
									<Avatar className='h-16 w-16 mx-auto mb-3'>
										<AvatarImage src={member.avatar} alt={member.name} />
										<AvatarFallback className='bg-primary/10 text-primary text-lg font-bold'>
											{member.name.slice(0, 2).toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<p className='font-medium'>{member.name}</p>
									<p className='text-sm text-muted-foreground'>{member.role}</p>
									{member.quote && (
										<p className='text-xs text-muted-foreground mt-2 italic'>"{member.quote}"</p>
									)}
								</CardContent>
							</Card>
						))}
					</div>
				</div>

				{/* Open Positions */}
				<div className='space-y-4'>
					<div className='flex items-center justify-between'>
						<h2 className='font-heading text-xl font-bold'>Open Positions</h2>
						<div className='flex gap-1'>
							{departments.map((dept) => (
								<Button
									key={dept}
									variant={selectedDept === dept ? 'default' : 'outline'}
									size='sm'
									onClick={() => setSelectedDept(dept)}
									className='capitalize'
								>
									{dept}
								</Button>
							))}
						</div>
					</div>

					{filteredJobs.length === 0 ? (
						<EmptyState
							icon={Briefcase}
							title='No open positions'
							description='Check back later for new opportunities'
						/>
					) : (
						<div className='grid gap-4'>
							{filteredJobs.map((job) => (
								<Card
									key={job.id}
									className='cursor-pointer hover:shadow-md transition-all'
									onClick={() => handleApply(job.id)}
								>
									<CardContent className='p-4'>
										<div className='flex items-start justify-between'>
											<div className='space-y-1'>
												<h3 className='font-semibold'>{job.title}</h3>
												<div className='flex items-center gap-2 text-sm text-muted-foreground'>
													<Badge variant='outline' className='text-xs'>
														{job.department}
													</Badge>
													<span className='flex items-center gap-1'>
														<MapPin className='h-3.5 w-3.5' />
														{job.location}
													</span>
													<span className='flex items-center gap-1'>
														<Clock className='h-3.5 w-3.5' />
														{job.type}
													</span>
												</div>
												<p className='text-sm font-medium text-primary'>{job.salary}</p>
											</div>
											<div className='flex items-center gap-2'>
												{job.matchScore && (
													<Badge className='bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'>
														<Zap className='h-3 w-3 mr-1' />
														{job.matchScore}% match
													</Badge>
												)}
												<Button size='sm' className='gap-1'>
													Apply
													<ArrowRight className='h-4 w-4' />
												</Button>
											</div>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

function generateMockData(): CareerPageData {
	return {
		company: {
			id: 'techcorp',
			name: 'TechCorp',
			tagline: 'Building the future of AI-powered hiring',
			description:
				"TechCorp is a leading technology company focused on AI-powered recruitment solutions. We believe in hiring the best talent regardless of background, and our platform uses cutting-edge AI to eliminate bias while matching candidates with their ideal roles. Founded in 2018, we've grown to 500+ employees across 12 countries.",
			website: 'https://techcorp.example.com',
			location: 'San Francisco, CA (Remote-friendly)',
			size: '500-1000 employees',
			industry: 'Technology / SaaS',
			founded: '2018',
			trustscore: 87,
			rating: 4.6,
			reviewCount: 243,
		},
		culture: {
			values: ['Innovation', 'Diversity', 'Transparency', 'Growth', 'Impact'],
			benefits: [
				{
					icon: 'health',
					label: 'Health Insurance',
					description: '100% coverage for you and dependents',
				},
				{ icon: 'remote', label: 'Remote Work', description: 'Work from anywhere, async-friendly' },
				{ icon: 'flexible', label: 'Flexible Hours', description: 'Choose your own schedule' },
				{
					icon: 'learning',
					label: 'Learning Budget',
					description: '$5,000/year for courses and conferences',
				},
				{
					icon: 'equity',
					label: 'Equity',
					description: 'Meaningful stock options for all employees',
				},
				{ icon: 'vacation', label: 'Unlimited PTO', description: 'Take time when you need it' },
				{ icon: 'parental', label: 'Parental Leave', description: '20 weeks paid for all parents' },
				{ icon: 'gym', label: 'Wellness', description: '$100/month gym or wellness stipend' },
			],
			photos: [],
		},
		team: [
			{
				id: '1',
				name: 'Sarah Chen',
				role: 'CEO & Founder',
				quote: "We're building the future of work",
			},
			{
				id: '2',
				name: 'James Wilson',
				role: 'CTO',
				quote: 'AI should augment, not replace, human judgment',
			},
			{
				id: '3',
				name: 'Maria Garcia',
				role: 'Head of People',
				quote: 'Culture is our competitive advantage',
			},
			{
				id: '4',
				name: 'David Kim',
				role: 'VP Engineering',
				quote: 'Great engineers want to solve hard problems',
			},
		],
		jobs: [
			{
				id: '1',
				title: 'Senior Frontend Engineer',
				department: 'Engineering',
				location: 'Remote',
				type: 'Full-time',
				salary: '$140k - $180k',
				postedAt: '2024-01-15',
				matchScore: 92,
			},
			{
				id: '2',
				title: 'Product Manager',
				department: 'Product',
				location: 'San Francisco',
				type: 'Full-time',
				salary: '$130k - $160k',
				postedAt: '2024-01-14',
				matchScore: 85,
			},
			{
				id: '3',
				title: 'AI Research Scientist',
				department: 'Engineering',
				location: 'Remote',
				type: 'Full-time',
				salary: '$160k - $220k',
				postedAt: '2024-01-13',
			},
			{
				id: '4',
				title: 'Sales Development Rep',
				department: 'Sales',
				location: 'Austin',
				type: 'Full-time',
				salary: '$60k - $80k + OTE',
				postedAt: '2024-01-12',
			},
			{
				id: '5',
				title: 'UX Designer',
				department: 'Design',
				location: 'Remote',
				type: 'Full-time',
				salary: '$110k - $140k',
				postedAt: '2024-01-11',
				matchScore: 78,
			},
		],
		stats: {
			openPositions: 12,
			avgTimeToHire: 18,
			employees: 523,
			growthRate: 34,
		},
	}
}
