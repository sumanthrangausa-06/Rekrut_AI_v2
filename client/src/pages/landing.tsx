import { SEO } from '@/components/SEO'
import {
	ArrowRight,
	ArrowUpRight,
	Award,
	BookOpen,
	Briefcase,
	Building2,
	Calendar,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	EyeOff,
	FileCheck,
	Github,
	Globe,
	Linkedin,
	Lock,
	Mail,
	Menu,
	MessageSquareText,
	Rocket,
	Search,
	Send,
	Shield,
	Sparkles,
	Star,
	Target,
	Twitter,
	User,
	Users,
	Video,
	X,
	Zap,
	MapPin,
	FileText,
	BarChart3,
	Compass,
	ChevronLeft,
	ChevronRight,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Logo } from '@/components/ui/logo'
import { getDashboardPath, useAuth } from '@/contexts/auth-context'
import { trackEvent } from '@/lib/analytics'
import { UNSPLASH_IMAGES } from '@/lib/avatar'

const blogPosts = [
	{
		id: '1',
		title: 'How AI is Changing the Job Search in 2026',
		excerpt:
			'From resume parsing to interview coaching, AI tools are reshaping how candidates find their next role.',
		tag: 'AI Trends',
		author: 'Ranga Sumanth',
		date: 'June 5, 2026',
		readTime: '5 min',
		image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&q=80',
	},
	{
		id: '2',
		title: 'The OmniScore Guide: What Employers Actually See',
		excerpt:
			'Your unified credibility score combines skills, assessments, and interview performance. Here is how to improve it.',
		tag: 'Product',
		author: 'Suga',
		date: 'May 28, 2026',
		readTime: '4 min',
		image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80',
	},
	{
		id: '3',
		title: '5 Mock Interview Mistakes Everyone Makes',
		excerpt:
			'We analyzed 10,000 practice interviews. These are the patterns that predict real interview failure.',
		tag: 'Career Tips',
		author: 'Rekrut AI Team',
		date: 'May 20, 2026',
		readTime: '6 min',
		image: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=800&q=80',
	},
	{
		id: '4',
		title: 'Why We Built KYC In-House Instead of Outsourcing',
		excerpt:
			'Identity verification is a trust signal. Here is why we chose to build it ourselves rather than use a third-party vendor.',
		tag: 'Security',
		author: 'Security Team',
		date: 'May 15, 2026',
		readTime: '7 min',
		image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&q=80',
	},
]

// ─── Data ─────────────────────────────────────────────────────────────

const features = [
	{
		icon: Target,
		title: 'AI Job Matching',
		description:
			'Upload your resume or build a profile. Our AI analyzes your skills, experience, and preferences — then surfaces roles where you have a real shot. Match score included so you know where you stand.',
	},
	{
		icon: Video,
		title: 'Mock Interviews',
		description:
			'Practice unlimited mock interviews with our AI interviewer. Get real-time feedback on your answers, communication style, and pacing. Role-specific questions for tech, product, sales, marketing, and more.',
	},
	{
		icon: MessageSquareText,
		title: 'AI Coaching',
		description:
			'Stuck on salary negotiation? Need help with a career pivot? Our AI coaching gives you personalized, actionable advice based on your profile and goals. No appointments. No fees. Just ask.',
	},
	{
		icon: Award,
		title: 'Skill Assessments',
		description:
			'Take AI-powered skill assessments that actually test your abilities, not your test-taking skills. Showcase verified skills to employers and stand out from the crowd.',
	},
	{
		icon: Star,
		title: 'OmniScore',
		description:
			'Your OmniScore combines your skills, experience, assessments, and interview performance into one trusted metric. Employers see it. You own it. No more being reduced to a resume.',
	},
	{
		icon: Send,
		title: 'Smart Applications',
		description:
			'One-click applications with AI-optimized cover letters tailored to each role. Track every application in one dashboard. Follow-up reminders so nothing falls through the cracks.',
	},
]

const steps = [
	{
		number: '01',
		icon: Users,
		title: 'Build Your Profile',
		description:
			'Upload your resume or answer a few questions. Our AI extracts your skills, experience, and preferences automatically. Takes 2 minutes.',
	},
	{
		number: '02',
		icon: Sparkles,
		title: 'Get Matched & Practice',
		description:
			'See your top job matches with match scores. Practice mock interviews for your target roles. Get coaching on your weak spots.',
	},
	{
		number: '03',
		icon: Rocket,
		title: 'Apply & Get Hired',
		description:
			'Apply with one click. Track your applications. Get feedback from employers. Land the job.',
	},
]

const testimonials = [
	{
		quote:
			'I applied to 200 jobs manually and got 2 callbacks. Used Rekrut AI for 2 weeks, matched with 12 relevant roles, and got 3 offers.',
		author: 'Sarah K.',
		role: 'Product Manager, hired at Stripe',
		avatar: 'SK',
	},
	{
		quote:
			'The mock interviews caught me saying um 47 times and helped me fix my pacing. I crushed my real interview.',
		author: 'Marcus T.',
		role: 'Software Engineer, hired at Netflix',
		avatar: 'MT',
	},
	{
		quote:
			'OmniScore got me noticed by a recruiter who said they never would have found me through keyword search.',
		author: 'Priya R.',
		role: 'Data Scientist, hired at Airbnb',
		avatar: 'PR',
	},
	{
		quote:
			'As a career switcher, I had no idea how to position myself. The AI coaching gave me a roadmap and the confidence to negotiate a $30K higher salary.',
		author: 'James L.',
		role: 'Former Teacher → UX Designer',
		avatar: 'JL',
	},
]

const companyLogos = [
	'Google',
	'Stripe',
	'Airbnb',
	'Netflix',
	'Spotify',
	'Shopify',
	'Notion',
	'Figma',
]

const stats = [
	{ value: '50K+', label: 'Active candidates' },
	{ value: '3x', label: 'Better job matches' },
	{ value: '2 min', label: 'Profile setup' },
	{ value: '94%', label: 'Interview success rate' },
]

const faq = [
	{
		question: 'Is Rekrut AI really free?',
		answer:
			'Yes. The free tier gives you job matching, limited mock interviews, and basic assessments. No credit card required. No time limit. Pro unlocks unlimited everything.',
	},
	{
		question: 'How is your AI matching different from LinkedIn or Indeed?',
		answer:
			'LinkedIn and Indeed are job boards with keyword search. Our AI understands context, skills, and career trajectory. It does not just match keywords — it matches potential.',
	},
	{
		question: 'Who sees my profile?',
		answer:
			'Only employers you apply to. Your profile is not searchable by random recruiters. No spam. No unsolicited InMails.',
	},
	{
		question: 'Is my data secure?',
		answer:
			'We built KYC and identity verification in-house. Your data is encrypted, never sold, and never shared with third-party vendors. We take security seriously — see our Security page for details.',
	},
	{
		question: 'What is OmniScore?',
		answer:
			'A unified credibility score combining your verified skills, assessment results, interview performance, and experience. It gives employers a complete picture of what you can do.',
	},
	{
		question: 'When will Pro billing be available?',
		answer:
			'Stripe checkout is launching within 1 week. Until then, you can start a free Pro trial with no payment required.',
	},
	{
		question: 'Can employers reach out to me?',
		answer:
			'Only if you apply to their job posting. We do not allow cold outreach. You are in control.',
	},
	{
		question: 'What industries do you cover?',
		answer:
			'Tech, product, design, data, marketing, sales, operations, finance, and healthcare. More industries rolling out monthly.',
	},
]

// ─── Components ─────────────────────────────────────────────────────────

function MobileMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
	if (!isOpen) return null
	return (
		<div className='fixed inset-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90'>
			<div className='mx-auto max-w-6xl px-4 py-4'>
				<div className='flex items-center justify-between'>
					<Link to='/' className='flex items-center gap-2' onClick={onClose}>
						<Logo size='md' />
						<span className='font-heading text-xl font-bold'>Rekrut AI</span>
					</Link>
					<Button variant='ghost' size='icon' onClick={onClose} aria-label='Close menu'>
						<X className='h-5 w-5' />
					</Button>
				</div>
				<nav className='mt-8 flex flex-col gap-4'>
					<Link
						to='/pricing'
						onClick={() => {
							trackEvent('mobile_menu_pricing_click')
							onClose()
						}}
					>
						<Button variant='ghost' className='w-full justify-start text-lg'>
							Pricing
						</Button>
					</Link>
					<Link
						to='/blog'
						onClick={() => {
							trackEvent('mobile_menu_blog_click')
							onClose()
						}}
					>
						<Button variant='ghost' className='w-full justify-start text-lg'>
							Blog
						</Button>
					</Link>
					<Link
						to='/about'
						onClick={() => {
							trackEvent('mobile_menu_about_click')
							onClose()
						}}
					>
						<Button variant='ghost' className='w-full justify-start text-lg'>
							About
						</Button>
					</Link>
					<Link
						to='/contact'
						onClick={() => {
							trackEvent('mobile_menu_contact_click')
							onClose()
						}}
					>
						<Button variant='ghost' className='w-full justify-start text-lg'>
							Contact
						</Button>
					</Link>
					<div className='mt-4 border-t pt-4'>
						<Link
							to='/login'
							onClick={() => {
								trackEvent('mobile_menu_sign_in_click')
								onClose()
							}}
						>
							<Button variant='outline' className='w-full'>
								Sign in
							</Button>
						</Link>
						<Link
							to='/register'
							className='mt-3 block'
							onClick={() => {
								trackEvent('mobile_menu_get_started_click')
								onClose()
							}}
						>
							<Button className='w-full'>Get started</Button>
						</Link>
					</div>
				</nav>
			</div>
		</div>
	)
}

function Header() {
	const { isAuthenticated, user } = useAuth()
	const dashboardPath = user ? getDashboardPath(user) : '/login'
	const [mobileOpen, setMobileOpen] = useState(false)

	return (
		<>
			<header className='sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
				<div className='mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0'>
					<Link
						to='/'
						className='flex items-center gap-2'
						onClick={() => trackEvent('nav_logo_click', { destination: 'home' })}
					>
						<Logo size='md' />
						<span className='font-heading text-xl font-bold'>Rekrut AI</span>
					</Link>

					{/* Desktop nav */}
					<nav className='hidden items-center gap-1 sm:flex'>
						<Link to='/pricing' onClick={() => trackEvent('header_pricing_click')}>
							<Button variant='ghost' size='sm'>
								Pricing
							</Button>
						</Link>
						<Link to='/blog' onClick={() => trackEvent('header_blog_click')}>
							<Button variant='ghost' size='sm'>
								Blog
							</Button>
						</Link>
						<Link to='/about' onClick={() => trackEvent('header_about_click')}>
							<Button variant='ghost' size='sm'>
								About
							</Button>
						</Link>
						<Link to='/contact' onClick={() => trackEvent('header_contact_click')}>
							<Button variant='ghost' size='sm'>
								Contact
							</Button>
						</Link>
					</nav>

					<div className='hidden items-center gap-3 sm:flex'>
						{isAuthenticated && user ? (
							<Link
								to={dashboardPath}
								onClick={() => trackEvent('header_dashboard_click', { role: user.role })}
							>
								<Button size='sm' className='gap-2'>
									Dashboard
									<ArrowRight className='h-4 w-4' />
								</Button>
							</Link>
						) : (
							<>
								<Link to='/login' onClick={() => trackEvent('header_sign_in_click')}>
									<Button variant='ghost' size='sm'>
										Sign in
									</Button>
								</Link>
								<Link to='/register' onClick={() => trackEvent('header_get_started_click')}>
									<Button size='sm'>Get started</Button>
								</Link>
							</>
						)}
					</div>

					{/* Mobile hamburger */}
					<Button
						variant='ghost'
						size='icon'
						className='absolute right-4 top-4 sm:hidden'
						onClick={() => setMobileOpen(true)}
						aria-label='Open menu'
					>
						<Menu className='h-5 w-5' />
					</Button>
				</div>
			</header>
			<MobileMenu isOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
		</>
	)
}

function HeroSection() {
	const { isAuthenticated, user } = useAuth()
	const dashboardPath = user ? getDashboardPath(user) : '/login'

	return (
		<section className='relative overflow-hidden'>
			{/* Background gradient blobs */}
			<div className='absolute inset-0 overflow-hidden pointer-events-none'>
				<div className='absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl' />
				<div className='absolute top-20 -left-20 h-72 w-72 rounded-full bg-purple-500/10 blur-3xl' />
				<div className='absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-indigo-400/10 blur-3xl' />
			</div>

			<div className='relative mx-auto max-w-7xl px-4 py-16 sm:py-24 lg:py-32'>
				<div className='mx-auto max-w-4xl text-center'>
					<Badge
						variant='secondary'
						className='mb-6 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium'
					>
						<Sparkles className='h-3.5 w-3.5 text-primary' />
						AI-powered career companion for candidates who want to get hired faster
					</Badge>

					<h1 className='font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl'>
						Your AI-Powered <span className='text-primary'>Career Companion</span>
					</h1>

					<p className='mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl'>
						Match with jobs that fit your skills. Practice interviews with AI. Get hired faster — no
						spam, no noise.
					</p>

					{/* Hero search bar — dual input: job title + location */}
					<div className='mx-auto mt-8 max-w-2xl'>
						<div className='flex flex-col sm:flex-row items-stretch gap-1 rounded-xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20'>
							<div className='flex flex-1 items-center gap-2 px-3 py-2'>
								<Search className='h-5 w-5 text-muted-foreground shrink-0' />
								<input
									id='hero-search-title'
									type='text'
									placeholder='Job title, keywords, or company'
									className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											const title = (e.target as HTMLInputElement).value
											const locInput = document.getElementById('hero-search-location') as HTMLInputElement
											const loc = locInput?.value || ''
											if (title.trim()) {
												trackEvent('hero_search_submit', { query: title, location: loc })
												window.location.href = `/candidate/jobs?q=${encodeURIComponent(title)}&location=${encodeURIComponent(loc)}`
											}
										}
									}}
								/>
							</div>
							<div className='hidden sm:block w-px bg-border self-stretch my-1' />
							<div className='flex flex-1 items-center gap-2 px-3 py-2'>
								<MapPin className='h-5 w-5 text-muted-foreground shrink-0' />
								<input
									id='hero-search-location'
									type='text'
									placeholder='Location'
									className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											const loc = (e.target as HTMLInputElement).value
											const titleInput = document.getElementById('hero-search-title') as HTMLInputElement
											const title = titleInput?.value || ''
											if (title.trim()) {
												trackEvent('hero_search_submit', { query: title, location: loc })
												window.location.href = `/candidate/jobs?q=${encodeURIComponent(title)}&location=${encodeURIComponent(loc)}`
											}
										}
									}}
								/>
							</div>
							<Button
								size='sm'
								className='shrink-0 gap-2 px-4'
								onClick={() => {
									const title = (document.getElementById('hero-search-title') as HTMLInputElement)?.value || ''
									const loc = (document.getElementById('hero-search-location') as HTMLInputElement)?.value || ''
									if (title.trim()) {
										trackEvent('hero_search_submit', { query: title, location: loc })
										window.location.href = `/candidate/jobs?q=${encodeURIComponent(title)}&location=${encodeURIComponent(loc)}`
									}
								}}
							>
								<Search className='h-4 w-4' />
								<span className='hidden sm:inline'>Search</span>
							</Button>
						</div>
					</div>

					<div className='mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center'>
						{isAuthenticated && user ? (
							<Link
								to={dashboardPath}
								onClick={() => trackEvent('hero_dashboard_click', { role: user.role })}
							>
								<Button size='lg' className='gap-2 px-8'>
									Go to Dashboard
									<ArrowRight className='h-4 w-4' />
								</Button>
							</Link>
						) : (
							<>
								<Link to='/register' onClick={() => trackEvent('hero_get_started_click')}>
									<Button size='lg' className='gap-2 px-8'>
										Get Started Free
										<ArrowRight className='h-4 w-4' />
									</Button>
								</Link>
								<Link
									to='/register?role=candidate'
									onClick={() => trackEvent('hero_find_jobs_click')}
								>
									<Button variant='outline' size='lg' className='px-8'>
										See How It Works
									</Button>
								</Link>
							</>
						)}
					</div>

					<p className='mt-4 text-sm text-muted-foreground'>
						No credit card required. Free forever. Upgrade when you are ready.
					</p>

					{/* Trust bar */}
					<div className='mt-8 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground'>
						<span className='flex items-center gap-1'>
							<Shield className='h-3.5 w-3.5' /> Bank-grade security
						</span>
						<span className='flex items-center gap-1'>
							<CheckCircle2 className='h-3.5 w-3.5' /> In-house KYC
						</span>
						<span className='flex items-center gap-1'>
							<Users className='h-3.5 w-3.5' /> 50,000+ active candidates
						</span>
						<span className='flex items-center gap-1'>
							<Zap className='h-3.5 w-3.5' /> AI-matched to real jobs
						</span>
					</div>
				</div>

				{/* Hero visual — browser mockup dashboard preview */}
				<div className='mx-auto mt-16 max-w-5xl'>
					<div className='relative rounded-2xl border bg-card shadow-2xl overflow-hidden'>
						{/* Browser chrome */}
						<div className='relative z-10 bg-muted/80 border-b px-4 py-2 flex items-center gap-2'>
							<div className='flex gap-1.5'>
								<div className='h-3 w-3 rounded-full bg-red-400' />
								<div className='h-3 w-3 rounded-full bg-amber-400' />
								<div className='h-3 w-3 rounded-full bg-green-400' />
							</div>
							<div className='flex-1 flex justify-center'>
								<div className='bg-background rounded-md px-3 py-1 text-xs text-muted-foreground max-w-xs truncate'>
									rekrutai.co/dashboard
								</div>
							</div>
						</div>
						<div className='absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5' />
						<div className='relative p-6 sm:p-10'>
							<div className='grid gap-6 sm:grid-cols-3'>
								<Card className='border-0 bg-background/80 shadow-sm'>
									<CardContent className='p-4'>
										<div className='flex items-center gap-3'>
											<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10'>
												<Users className='h-5 w-5 text-primary' />
											</div>
											<div>
												<p className='text-sm font-medium'>Active Candidates</p>
												<p className='text-2xl font-bold text-primary'>50,000+</p>
											</div>
										</div>
									</CardContent>
								</Card>
								<Card className='border-0 bg-background/80 shadow-sm'>
									<CardContent className='p-4'>
										<div className='flex items-center gap-3'>
											<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10'>
												<Briefcase className='h-5 w-5 text-green-600' />
											</div>
											<div>
												<p className='text-sm font-medium'>Open Positions</p>
												<p className='text-2xl font-bold text-green-600'>2,400+</p>
											</div>
										</div>
									</CardContent>
								</Card>
								<Card className='border-0 bg-background/80 shadow-sm'>
									<CardContent className='p-4'>
										<div className='flex items-center gap-3'>
											<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10'>
												<Star className='h-5 w-5 text-amber-600' />
											</div>
											<div>
												<p className='text-sm font-medium'>Avg. Match Score</p>
												<p className='text-2xl font-bold text-amber-600'>87%</p>
											</div>
										</div>
									</CardContent>
								</Card>
							</div>
							<div className='mt-6 rounded-xl border bg-background/60 p-4'>
								<div className='flex items-center gap-2 mb-3'>
									<div className='h-2 w-2 rounded-full bg-green-500' />
									<span className='text-xs font-medium text-muted-foreground'>
										AI Matching Engine Active
									</span>
								</div>
								<div className='space-y-2'>
									{[
										{ name: 'Senior React Developer at Stripe', score: 94, match: 'Top match' },
										{ name: 'Product Manager at Netflix', score: 91, match: 'Strong fit' },
										{ name: 'UX Designer at Airbnb', score: 89, match: 'Great fit' },
									].map((job) => (
										<div key={job.name} className='flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2'>
											<div className='flex items-center gap-3 min-w-0 overflow-hidden'>
												<div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary shrink-0'>
													{job.name
														.split(' ')
														.slice(0, 2)
														.map((n) => n[0])
														.join('')}
												</div>
												<span className='text-sm font-medium min-w-0 truncate'>{job.name}</span>
											</div>
											<div className='flex items-center gap-3 shrink-0'>
												<Badge variant='outline' className='text-xs'>
													{job.match}
												</Badge>
												<span className='text-sm font-bold text-primary'>{job.score}%</span>
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Stats bar */}
				<div className='mx-auto mt-12 grid max-w-4xl gap-4 sm:mt-16 sm:grid-cols-4 sm:gap-6'>
					{stats.map((stat) => (
						<div key={stat.label} className='rounded-2xl border bg-card p-5 text-center shadow-sm'>
							<p className='font-heading text-2xl font-bold text-primary sm:text-3xl'>
								{stat.value}
							</p>
							<p className='mt-1 text-sm text-muted-foreground'>{stat.label}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}

function CompanyTrustBarSection() {
	return (
		<section className='border-y bg-muted/30 py-10 sm:py-12'>
			<div className='mx-auto max-w-7xl px-4'>
				<p className='text-center text-xs font-medium uppercase tracking-wider text-muted-foreground mb-6'>
					Trusted by candidates at top companies
				</p>
				<div className='flex flex-wrap items-center justify-center gap-x-3 gap-y-3 sm:gap-x-6'>
					{companyLogos.map((name) => (
						<div
							key={name}
							className='flex items-center gap-2 rounded-lg bg-background border px-3 py-2 shadow-sm'
						>
							<Building2 className='h-4 w-4 text-indigo-500' />
							<span className='text-sm font-semibold text-foreground'>{name}</span>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}

function LiveStatsSection() {
	const [counts, setCounts] = useState({ candidates: 0, positions: 0, score: 0 })

	useEffect(() => {
		const targets = { candidates: 50000, positions: 2400, score: 87 }
		const duration = 1500
		const steps = 30
		let step = 0
		const interval = setInterval(() => {
			step++
			const progress = step / steps
			setCounts({
				candidates: Math.round(targets.candidates * progress),
				positions: Math.round(targets.positions * progress),
				score: Math.round(targets.score * progress),
			})
			if (step >= steps) clearInterval(interval)
		}, duration / steps)
		return () => clearInterval(interval)
	}, [])

	return (
		<section className='py-16 sm:py-20'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>Live Stats</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Join thousands already hiring smarter
					</h2>
				</div>
				<div className='mt-12 grid gap-6 sm:grid-cols-3'>
					{[
						{ value: counts.candidates.toLocaleString() + '+', label: 'Active candidates', icon: Users },
						{ value: counts.positions.toLocaleString() + '+', label: 'Open positions', icon: Briefcase },
						{ value: counts.score + '%', label: 'Avg. match score', icon: Star },
					].map((stat) => (
						<Card key={stat.label} className='border-0 bg-card shadow-sm text-center'>
							<CardContent className='p-8'>
								<div className='flex justify-center'>
									<div className='flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10'>
										<stat.icon className='h-6 w-6 text-indigo-500' />
									</div>
								</div>
								<p className='mt-4 font-heading text-3xl font-bold text-indigo-500 sm:text-4xl'>
									{stat.value}
								</p>
								<p className='mt-2 text-sm text-muted-foreground'>{stat.label}</p>
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</section>
	)
}

const tabFeatures = [
	{
		id: 'cv-review',
		label: 'CV Review',
		icon: FileText,
		title: 'AI-Powered CV Review',
		description:
			'Upload your resume and get instant, actionable feedback. Our AI analyzes structure, keywords, and impact — then suggests improvements that actually get you noticed.',
	},
	{
		id: 'auto-apply',
		label: 'Auto-Apply',
		icon: Send,
		title: 'One-Click Auto Apply',
		description:
			'Set your preferences once and let Rekrut AI apply to matched roles automatically. Tailored cover letters, optimized applications, zero manual effort.',
	},
	{
		id: 'match-feedback',
		label: 'Match Feedback',
		icon: BarChart3,
		title: 'Detailed Match Feedback',
		description:
			'Understand why you matched — or did not. Get breakdowns of skill gaps, experience alignment, and personalized steps to improve your match score.',
	},
	{
		id: 'career-nav',
		label: 'Career Navigator',
		icon: Compass,
		title: 'AI Career Navigator',
		description:
			'Map your career trajectory with AI. Explore paths, compare roles, and get step-by-step guidance on skills to build next to reach your target position.',
	},
]

function FeatureTabsSection() {
	const [activeTab, setActiveTab] = useState(tabFeatures[0].id)
	const active = tabFeatures.find((t) => t.id === activeTab) || tabFeatures[0]

	return (
		<section className='border-y bg-muted/30 py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>Product</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						One platform, every career need
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						From polishing your CV to landing the offer — everything in one place.
					</p>
				</div>

				<div className='mt-14'>
					<div className='flex flex-wrap justify-center gap-2'>
						{tabFeatures.map((tab) => {
							const isActive = tab.id === activeTab
							return (
								<button
									key={tab.id}
									onClick={() => setActiveTab(tab.id)}
									className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
										isActive
											? 'bg-indigo-500 text-white shadow-sm'
											: 'bg-background border text-muted-foreground hover:text-foreground'
									}`}
								>
									<tab.icon className='h-4 w-4' />
									{tab.label}
								</button>
							)
						})}
					</div>

					<Card className='mt-8 border-0 bg-card shadow-sm'>
						<CardContent className='p-8 sm:p-12'>
							<div className='flex flex-col items-center text-center'>
								<div className='flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10'>
									<active.icon className='h-8 w-8 text-indigo-500' />
								</div>
								<h3 className='mt-6 font-heading text-2xl font-bold'>{active.title}</h3>
								<p className='mt-3 max-w-xl text-base leading-relaxed text-muted-foreground'>
									{active.description}
								</p>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</section>
	)
}

function FeaturesSection() {
	return (
		<section className='border-y bg-muted/30 py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>
						Features
					</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Everything you need to land your next job
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						From AI matching to mock interviews to coaching — one platform, zero noise.
					</p>
				</div>

				<div className='mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
					{features.map((feature) => (
						<Card
							key={feature.title}
							className='group border-0 bg-card shadow-sm transition-all hover:shadow-md'
						>
							<CardContent className='p-6'>
								<div className='flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/15'>
									<feature.icon className='h-6 w-6 text-primary' />
								</div>
								<h3 className='mt-5 font-heading text-lg font-semibold'>{feature.title}</h3>
								<p className='mt-2 text-sm leading-relaxed text-muted-foreground'>
									{feature.description}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</section>
	)
}

function HowItWorksSection() {
	return (
		<section className='py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>
						How it works
					</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						From sign-up to hired in 3 steps
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						No complex setup. Just a faster path to your next role.
					</p>
				</div>

				<div className='mt-14 grid gap-8 lg:grid-cols-3'>
					{steps.map((step, index) => (
						<div key={step.title} className='relative'>
							{index < steps.length - 1 && (
								<div className='hidden lg:block absolute top-12 left-[60%] w-[80%] border-t-2 border-dashed border-muted-foreground/20' />
							)}
							<Card className='border-0 bg-card shadow-sm h-full'>
								<CardContent className='p-8'>
									<div className='flex items-center justify-between'>
										<div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10'>
											<step.icon className='h-6 w-6 text-primary' />
										</div>
										<span className='font-heading text-4xl font-bold text-muted-foreground/30'>
											{step.number}
										</span>
									</div>
									<h3 className='mt-6 font-heading text-xl font-semibold'>{step.title}</h3>
									<p className='mt-3 text-sm leading-relaxed text-muted-foreground'>
										{step.description}
									</p>
								</CardContent>
							</Card>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}

function SocialProofSection() {
	const scrollRef = useRef<HTMLDivElement>(null)

	const scroll = (dir: 'left' | 'right') => {
		const el = scrollRef.current
		if (!el) return
		const w = el.offsetWidth
		el.scrollBy({ left: dir === 'left' ? -w * 0.8 : w * 0.8, behavior: 'smooth' })
	}

	return (
		<section className='border-y bg-muted/30 py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>Testimonials</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Success stories from real candidates
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						See how Rekrut AI helped people land their dream jobs.
					</p>
				</div>

				<div className='mt-14 relative'>
					<div
						ref={scrollRef}
						className='flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth'
						style={{ scrollbarWidth: 'none' }}
					>
						{testimonials.map((t, i) => (
							<Card
								key={t.author}
								className='min-w-[280px] sm:min-w-[360px] flex-shrink-0 snap-start border-0 bg-card shadow-sm'
							>
								<CardContent className='p-6'>
									<div className='flex gap-1'>
										{[1, 2, 3, 4, 5].map((s) => (
											<Star key={s} className='h-4 w-4 fill-amber-400 text-amber-400' />
										))}
									</div>
									<p className='mt-4 text-sm leading-relaxed text-foreground'>"{t.quote}"</p>
									<div className='mt-6 flex items-center gap-3'>
										<img
											src={UNSPLASH_IMAGES[`testimonial${i + 1}` as keyof typeof UNSPLASH_IMAGES]}
											alt={t.author}
											className='h-10 w-10 rounded-full object-cover'
											loading='lazy'
										/>
										<div>
											<p className='text-sm font-semibold'>{t.author}</p>
											<p className='text-xs text-muted-foreground'>{t.role}</p>
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>

					<div className='mt-4 flex items-center justify-center gap-3'>
						<Button
							variant='outline'
							size='icon'
							onClick={() => scroll('left')}
							aria-label='Previous testimonial'
						>
							<ChevronLeft className='h-4 w-4' />
						</Button>
						<Button
							variant='outline'
							size='icon'
							onClick={() => scroll('right')}
							aria-label='Next testimonial'
						>
							<ChevronRight className='h-4 w-4' />
						</Button>
					</div>
				</div>
			</div>
		</section>
	)
}

function PricingTeaserSection() {
	return (
		<section className='py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>
						Pricing
					</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Start free. Upgrade when you are ready.
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						No hidden fees, no long-term contracts. Free forever. Pro when you need more power.
					</p>
				</div>

				<div className='mt-14 grid gap-6 lg:grid-cols-3'>
					{/* Free plan */}
					<Card className='border-0 bg-card shadow-sm'>
						<CardContent className='p-8'>
							<h3 className='font-heading text-xl font-semibold'>Free</h3>
							<p className='mt-2 text-sm text-muted-foreground'>For individuals getting started.</p>
							<div className='mt-6'>
								<span className='font-heading text-4xl font-bold'>$0</span>
								<span className='text-muted-foreground'>/month</span>
							</div>
							<ul className='mt-6 space-y-3'>
								{[
									'AI job matching (up to 20 matches/day)',
									'3 mock interviews per month',
									'Basic skill assessments',
									'Standard application tracking',
									'AI coaching (limited)',
								].map((item) => (
									<li key={item} className='flex items-start gap-2 text-sm'>
										<CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-primary' />
										{item}
									</li>
								))}
							</ul>
							<Link to='/register' onClick={() => trackEvent('pricing_free_click')}>
								<Button variant='outline' className='mt-8 w-full'>
									Get started free
								</Button>
							</Link>
						</CardContent>
					</Card>

					{/* Pro plan */}
					<Card className='relative border-2 border-primary shadow-md'>
						<div className='absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground z-10'>
							Most popular
						</div>
						<CardContent className='p-8'>
							<h3 className='font-heading text-xl font-semibold'>Pro</h3>
							<p className='mt-2 text-sm text-muted-foreground'>
								For candidates who want unlimited everything.
							</p>
							<div className='mt-6'>
								<span className='font-heading text-4xl font-bold'>$19</span>
								<span className='text-muted-foreground'>/month</span>
							</div>
							<p className='mt-1 text-xs text-muted-foreground'>$149/year (2 months free)</p>
							<ul className='mt-6 space-y-3'>
								{[
									'Everything in Free, plus:',
									'Unlimited AI job matching',
									'Unlimited mock interviews',
									'Advanced skill assessments + OmniScore',
									'AI coaching (unlimited)',
									'Priority application boosting',
									'Resume & cover letter AI optimizer',
								].map((item) => (
									<li key={item} className='flex items-start gap-2 text-sm'>
										<CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-primary' />
										{item}
									</li>
								))}
							</ul>
							<Link to='/register' onClick={() => trackEvent('pricing_pro_click')}>
								<Button className='mt-8 w-full gap-2'>
									Start Pro trial
									<ArrowRight className='h-4 w-4' />
								</Button>
							</Link>
						</CardContent>
					</Card>

					{/* Teams plan */}
					<Card className='border-0 bg-card shadow-sm'>
						<CardContent className='p-8'>
							<h3 className='font-heading text-xl font-semibold'>Teams</h3>
							<p className='mt-2 text-sm text-muted-foreground'>For employers hiring at scale.</p>
							<div className='mt-6'>
								<span className='font-heading text-4xl font-bold'>Custom</span>
							</div>
							<ul className='mt-6 space-y-3'>
								{[
									'Everything in Pro, plus:',
									'Post jobs to candidate marketplace',
									'AI candidate sourcing & screening',
									'Interview scheduling & analytics',
									'Dedicated account manager',
								].map((item) => (
									<li key={item} className='flex items-start gap-2 text-sm'>
										<CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-primary' />
										{item}
									</li>
								))}
							</ul>
							<Link to='/contact' onClick={() => trackEvent('pricing_teams_click')}>
								<Button variant='outline' className='mt-8 w-full'>
									Contact sales
								</Button>
							</Link>
						</CardContent>
					</Card>
				</div>

				<div className='mt-8 text-center'>
					<p className='text-sm text-muted-foreground'>
						Stripe checkout launching in ~1 week. Until then, Pro features available via free trial.
						No credit card required.
					</p>
					<Link to='/pricing' onClick={() => trackEvent('pricing_full_page_click')}>
						<Button variant='ghost' className='gap-2 text-primary'>
							View full pricing details
							<ArrowUpRight className='h-4 w-4' />
						</Button>
					</Link>
				</div>
			</div>
		</section>
	)
}

function SecurityTrustSection() {
	return (
		<section className='border-y bg-muted/30 py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>
						Security & Trust
					</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Your data is yours. Period.
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						We built everything in-house. No third-party vendors. No data selling. No compromises.
					</p>
				</div>

				<div className='mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4'>
					{[
						{
							icon: Shield,
							title: 'In-House KYC',
							description:
								'We verify identity ourselves — no third-party vendors, no data sharing. Your documents stay in our encrypted vault.',
						},
						{
							icon: Lock,
							title: 'Bank-Grade Encryption',
							description:
								'AES-256 encryption at rest, TLS 1.3 in transit. Your data is locked down like a bank vault.',
						},
						{
							icon: EyeOff,
							title: 'Zero Data Selling',
							description:
								'We do not sell your profile to recruiters. We do not monetize your data. We make money when you upgrade — that is it.',
						},
						{
							icon: FileCheck,
							title: 'GDPR & CCPA Compliant',
							description:
								'Full data export, deletion, and portability. You control your information. SOC 2 Type II in progress.',
						},
					].map((item) => (
						<Card key={item.title} className='border-0 bg-card shadow-sm'>
							<CardContent className='p-6'>
								<div className='flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10'>
									<item.icon className='h-6 w-6 text-primary' />
								</div>
								<h3 className='mt-5 font-heading text-lg font-semibold'>{item.title}</h3>
								<p className='mt-2 text-sm leading-relaxed text-muted-foreground'>
									{item.description}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</section>
	)
}

function FAQSection() {
	const [openIndex, setOpenIndex] = useState<number | null>(0)

	return (
		<section className='border-y bg-muted/30 py-20 sm:py-24'>
			<div className='mx-auto max-w-3xl px-4'>
				<div className='text-center'>
					<Badge variant='outline' className='mb-4'>
						FAQ
					</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Frequently asked questions
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						Everything you need to know about Rekrut AI. Can not find what you are looking for?{' '}
						<Link
							to='/contact'
							className='text-primary underline underline-offset-4 hover:text-primary/80'
							onClick={() => trackEvent('faq_contact_click')}
						>
							Contact us
						</Link>
						.
					</p>
				</div>

				<div className='mt-12 space-y-4'>
					{faq.map((item, index) => (
						<Card key={item.question} className='border-0 bg-card shadow-sm'>
							<CardContent className='p-0'>
								<button
									className='flex w-full items-center justify-between p-6 text-left'
									onClick={() => {
										setOpenIndex(openIndex === index ? null : index)
										trackEvent('faq_click', { question: item.question, open: openIndex !== index })
									}}
								>
									<span className='font-heading font-semibold pr-4 min-w-0 break-words'>
										{item.question}
									</span>
									{openIndex === index ? (
										<ChevronUp className='h-5 w-5 shrink-0 text-muted-foreground' />
									) : (
										<ChevronDown className='h-5 w-5 shrink-0 text-muted-foreground' />
									)}
								</button>
								{openIndex === index && (
									<div className='px-6 pb-6 max-h-[60vh] overflow-y-auto'>
										<p className='text-sm leading-relaxed text-muted-foreground'>{item.answer}</p>
									</div>
								)}
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</section>
	)
}

function CTABannerSection() {
	const { isAuthenticated, user } = useAuth()
	const dashboardPath = user ? getDashboardPath(user) : '/login'

	return (
		<section className='py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='relative overflow-hidden rounded-3xl bg-primary p-8 text-center text-primary-foreground sm:p-12 lg:p-16'>
					<div className='absolute inset-0 pointer-events-none'>
						<div className='absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-3xl' />
						<div className='absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-white/10 blur-3xl' />
					</div>
					<div className='relative'>
						<h2 className='font-heading text-2xl font-bold sm:text-3xl lg:text-4xl'>
							Stop applying to black holes. Start getting matched.
						</h2>
						<p className='mx-auto mt-4 max-w-xl text-primary-foreground/80 lg:text-lg'>
							Join 50,000+ candidates using AI to find their next job. Free forever. No spam. No
							noise.
						</p>
						<div className='mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center'>
							{isAuthenticated && user ? (
								<Link
									to={dashboardPath}
									onClick={() => trackEvent('bottom_cta_dashboard_click', { role: user.role })}
								>
									<Button variant='secondary' size='lg' className='gap-2 px-8'>
										Go to Dashboard
										<ArrowRight className='h-4 w-4' />
									</Button>
								</Link>
							) : (
								<>
									<Link to='/register' onClick={() => trackEvent('bottom_cta_start_click')}>
										<Button variant='secondary' size='lg' className='gap-2 px-8'>
											Get Started Free — 2 Minutes
											<ArrowRight className='h-4 w-4' />
										</Button>
									</Link>
									<Link to='/pricing' onClick={() => trackEvent('bottom_cta_pricing_click')}>
										<Button
											variant='outline'
											size='lg'
											className='border-primary-foreground/30 bg-transparent px-8 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground'
										>
											See Pricing
										</Button>
									</Link>
								</>
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}

function BlogSection() {
	return (
		<section className='py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<Badge variant='outline' className='mb-4'>
						Blog
					</Badge>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Latest insights from the team
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						AI trends, career tips, and product updates from the people building Rekrut AI.
					</p>
				</div>

				<div className='mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4'>
					{blogPosts.map((post) => (
						<Card
							key={post.id}
							className='group overflow-hidden border-0 bg-card shadow-sm transition-all hover:shadow-md'
						>
							<div className='aspect-video overflow-hidden'>
								<img
									src={post.image}
									alt={post.title}
									className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-105'
									loading='lazy'
								/>
							</div>
							<CardContent className='p-5'>
								<div className='flex items-center gap-2 text-xs text-muted-foreground'>
									<Badge variant='secondary' className='text-xs'>
										{post.tag}
									</Badge>
									<span>•</span>
									<span className='flex items-center gap-1'>
										<Calendar className='h-3 w-3' />
										{post.date}
									</span>
								</div>
								<h3 className='mt-3 font-heading text-base font-semibold leading-snug line-clamp-2'>
									{post.title}
								</h3>
								<p className='mt-2 text-sm text-muted-foreground line-clamp-2'>{post.excerpt}</p>
								<div className='mt-4 flex items-center gap-2 text-xs text-muted-foreground'>
									<User className='h-3 w-3' />
									<span>{post.author}</span>
									<span>•</span>
									<span className='flex items-center gap-1'>
										<Clock className='h-3 w-3' />
										{post.readTime}
									</span>
								</div>
							</CardContent>
						</Card>
					))}
				</div>

				<div className='mt-10 text-center'>
					<Link to='/blog' onClick={() => trackEvent('blog_view_all_click')}>
						<Button variant='ghost' className='gap-2 text-primary'>
							View all articles
							<ArrowRight className='h-4 w-4' />
						</Button>
					</Link>
				</div>
			</div>
		</section>
	)
}

function NewsletterSection() {
	const [email, setEmail] = useState('')
	const [submitted, setSubmitted] = useState(false)

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		if (email.trim()) {
			trackEvent('newsletter_subscribe', { email_domain: email.split('@')[1] })
			setSubmitted(true)
			setEmail('')
		}
	}

	return (
		<section className='border-y bg-muted/30 py-20 sm:py-24'>
			<div className='mx-auto max-w-7xl px-4'>
				<div className='mx-auto max-w-2xl text-center'>
					<div className='flex items-center justify-center gap-2 mb-4'>
						<BookOpen className='h-5 w-5 text-primary' />
						<Badge variant='outline'>Newsletter</Badge>
					</div>
					<h2 className='font-heading text-3xl font-bold tracking-tight sm:text-4xl'>
						Get AI hiring insights in your inbox
					</h2>
					<p className='mt-4 text-lg text-muted-foreground'>
						Weekly updates on AI trends, career tips, and product features. No spam. Unsubscribe
						anytime.
					</p>

					{submitted ? (
						<div className='mt-8 inline-flex items-center gap-2 rounded-xl bg-green-50 px-6 py-4 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400'>
							<CheckCircle2 className='h-5 w-5' />
							<span>Thanks for subscribing! Check your inbox for confirmation.</span>
						</div>
					) : (
						<form onSubmit={handleSubmit} className='mt-8 mx-auto max-w-md'>
							<div className='flex items-center gap-2 rounded-xl border bg-background px-4 py-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20'>
								<Mail className='h-5 w-5 text-muted-foreground shrink-0' />
								<input
									type='email'
									placeholder='Enter your email address'
									className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
								/>
								<Button type='submit' size='sm' className='shrink-0'>
									<Send className='h-4 w-4 mr-1' />
									Subscribe
								</Button>
							</div>
						</form>
					)}
				</div>
			</div>
		</section>
	)
}

function Footer() {
	const productLinks = [
		{ label: 'Features', href: '/#features', event: 'footer_features_click' },
		{ label: 'Pricing', href: '/pricing', event: 'footer_pricing_click' },
		{ label: 'AI Matching', href: '/#features', event: 'footer_ai_matching_click' },
		{ label: 'OmniScore', href: '/#features', event: 'footer_omniscore_click' },
		{ label: 'Video Interviews', href: '/#features', event: 'footer_video_interviews_click' },
	]

	const companyLinks = [
		{ label: 'About us', href: '/about', event: 'footer_about_click' },
		{ label: 'Blog', href: '/blog', event: 'footer_blog_click' },
		{ label: 'Careers', href: '/contact', event: 'footer_careers_click' },
		{ label: 'Contact', href: '/contact', event: 'footer_contact_click' },
	]

	const legalLinks = [
		{ label: 'Privacy Policy', href: '/privacy', event: 'footer_privacy_click' },
		{ label: 'Terms of Service', href: '/terms', event: 'footer_terms_click' },
		{ label: 'Cookie Policy', href: '/privacy', event: 'footer_cookie_click' },
	]

	const resourceLinks = [
		{ label: 'Help Center', href: '/contact', event: 'footer_help_click' },
		{ label: 'API Docs', href: '/contact', event: 'footer_api_click' },
		{ label: 'Status', href: '/contact', event: 'footer_status_click' },
	]

	return (
		<footer className='border-t bg-muted/30'>
			<div className='mx-auto max-w-7xl px-4 py-12 sm:py-16'>
				<div className='grid gap-8 sm:grid-cols-2 lg:grid-cols-5'>
					{/* Brand column */}
					<div className='lg:col-span-2'>
						<Link
							to='/'
							className='flex items-center gap-2'
							onClick={() => trackEvent('footer_logo_click')}
						>
							<Logo size='md' />
							<span className='font-heading text-xl font-bold'>Rekrut AI</span>
						</Link>
						<p className='mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground'>
							AI-native recruitment platform connecting candidates and recruiters. Built in 2026 by
							Ranga Sumanth and Suga. Hiring smarter, faster, and more transparently.
						</p>
						<div className='mt-6 flex items-center gap-3'>
							<a
								href='https://twitter.com/rekrutai'
								target='_blank'
								rel='noopener noreferrer'
								onClick={() => trackEvent('footer_social_twitter')}
								className='flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10'
							>
								<Twitter className='h-4 w-4 text-muted-foreground' />
							</a>
							<a
								href='https://linkedin.com/company/rekrutai'
								target='_blank'
								rel='noopener noreferrer'
								onClick={() => trackEvent('footer_social_linkedin')}
								className='flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10'
							>
								<Linkedin className='h-4 w-4 text-muted-foreground' />
							</a>
							<a
								href='https://github.com/rekrutai'
								target='_blank'
								rel='noopener noreferrer'
								onClick={() => trackEvent('footer_social_github')}
								className='flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10'
							>
								<Github className='h-4 w-4 text-muted-foreground' />
							</a>
							<a
								href='mailto:hello@rekrutai.co'
								onClick={() => trackEvent('footer_social_email')}
								className='flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-sm transition-colors hover:bg-primary/10'
							>
								<Mail className='h-4 w-4 text-muted-foreground' />
							</a>
						</div>
					</div>

					{/* Product */}
					<div>
						<h4 className='font-heading text-sm font-semibold'>Product</h4>
						<ul className='mt-4 space-y-2.5'>
							{productLinks.map((link) => (
								<li key={link.label}>
									<Link
										to={link.href}
										onClick={() => trackEvent(link.event)}
										className='text-sm text-muted-foreground transition-colors hover:text-foreground'
									>
										{link.label}
									</Link>
								</li>
							))}
						</ul>
					</div>

					{/* Company */}
					<div>
						<h4 className='font-heading text-sm font-semibold'>Company</h4>
						<ul className='mt-4 space-y-2.5'>
							{companyLinks.map((link) => (
								<li key={link.label}>
									<Link
										to={link.href}
										onClick={() => trackEvent(link.event)}
										className='text-sm text-muted-foreground transition-colors hover:text-foreground'
									>
										{link.label}
									</Link>
								</li>
							))}
						</ul>
					</div>

					{/* Resources & Legal */}
					<div>
						<h4 className='font-heading text-sm font-semibold'>Resources</h4>
						<ul className='mt-4 space-y-2.5'>
							{resourceLinks.map((link) => (
								<li key={link.label}>
									<Link
										to={link.href}
										onClick={() => trackEvent(link.event)}
										className='text-sm text-muted-foreground transition-colors hover:text-foreground'
									>
										{link.label}
									</Link>
								</li>
							))}
						</ul>
						<h4 className='mt-6 font-heading text-sm font-semibold'>Legal</h4>
						<ul className='mt-4 space-y-2.5'>
							{legalLinks.map((link) => (
								<li key={link.label}>
									<Link
										to={link.href}
										onClick={() => trackEvent(link.event)}
										className='text-sm text-muted-foreground transition-colors hover:text-foreground'
									>
										{link.label}
									</Link>
								</li>
							))}
						</ul>
					</div>
				</div>

				<div className='mt-12 border-t pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground'>
					<p>© {new Date().getFullYear()} Rekrut AI (formerly HireLoop). All rights reserved.</p>
					<div className='flex items-center gap-1.5'>
						<Globe className='h-3.5 w-3.5' />
						<span>Made with care in India. Hiring globally.</span>
					</div>
				</div>
			</div>
		</footer>
	)
}

// ─── Main Page ────────────────────────────────────────────────────────

export function LandingPage() {
	useEffect(() => {
		trackEvent('page_view_landing')
	}, [])

	return (
		<div className='min-h-dvh-safe bg-background'>
			<SEO
				title='AI-Powered Career Companion — Find Your Next Job Faster'
				description='Rekrut AI matches you with jobs that fit your skills. Practice interviews with AI, get coaching, and get hired faster — no spam, no noise.'
				canonical='/'
				jsonLd={{
					'@context': 'https://schema.org',
					'@type': 'WebSite',
					name: 'Rekrut AI',
					url: 'https://rekrutai.co',
					potentialAction: {
						'@type': 'SearchAction',
						target: {
							'@type': 'EntryPoint',
							urlTemplate: 'https://rekrutai.co/candidate/jobs?q={search_term_string}',
						},
						'query-input': 'required name=search_term_string',
					},
				}}
			/>
			<Header />
			<main>
				<HeroSection />
				<CompanyTrustBarSection />
				<LiveStatsSection />
				<div id='features'>
					<FeaturesSection />
				</div>
				<FeatureTabsSection />
				<HowItWorksSection />
				<SocialProofSection />
				<PricingTeaserSection />
				<SecurityTrustSection />
				<BlogSection />
				<FAQSection />
				<NewsletterSection />
				<CTABannerSection />
			</main>
			<Footer />
		</div>
	)
}
