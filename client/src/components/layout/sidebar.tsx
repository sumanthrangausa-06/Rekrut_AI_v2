import {
	BarChart3,
	Bookmark,
	Brain,
	Briefcase,
	Building2,
	ClipboardList,
	CreditCard,
	Crown,
	DollarSign,
	File,
	FileText,
	GraduationCap,
	LayoutDashboard,
	Linkedin,
	LogOut,
	MessageSquare,
	Settings,
	Shield,
	Sparkles,
	Star,
	Target,
	User,
	UserCheck,
	UserPlus,
	Users,
	Video,
	Wallet,
	X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Logo } from '@/components/ui/logo'
import { useAuth } from '@/contexts/auth-context'
import { apiCall } from '@/lib/api'
import { cn } from '@/lib/utils'

interface SidebarProps {
	open: boolean
	onClose: () => void
}

interface NavItem {
	label: string
	href: string
	icon: React.ElementType
	count?: number
	isNew?: boolean
}

interface NavSection {
	title: string
	items: NavItem[]
}

/* ── Candidate: grouped sections (Jobgether-style) ─────────────────────── */

const candidateSections: NavSection[] = [
	{
		title: 'OPPORTUNITIES',
		items: [
			{ label: 'Dashboard', href: '/candidate', icon: LayoutDashboard },
			{ label: 'Job Board', href: '/candidate/jobs', icon: Briefcase, count: 0 },
			{ label: 'Applications', href: '/candidate/applications', icon: FileText, count: 0 },
			{
				label: 'Top Matches',
				href: '/candidate/top-matches',
				icon: Sparkles,
				count: 0,
				isNew: true,
			},
			{
				label: 'Company Matches',
				href: '/candidate/company-matches',
				icon: Building2,
				isNew: true,
			},
			{ label: 'Saved Jobs', href: '/candidate/saved-jobs', icon: Bookmark, count: 0 },
			{ label: 'AI Search', href: '/candidate/ai-search', icon: Brain },
		],
	},
	{
		title: 'IMPROVE YOUR PROFILE',
		items: [
			{ label: 'Profile', href: '/candidate/profile', icon: User },
			{ label: 'CV Review', href: '/candidate/cv-review', icon: FileText, isNew: true },
			{
				label: 'LinkedIn Optimizer',
				href: '/candidate/linkedin-optimizer',
				icon: Linkedin,
				isNew: true,
			},
			{ label: 'Career Diagnosis', href: '/candidate/career-diagnosis', icon: Target, isNew: true },
			{ label: 'Coaching', href: '/candidate/ai-coaching', icon: MessageSquare },
			{ label: 'Assessments', href: '/candidate/assessments', icon: GraduationCap },
			{ label: 'OmniScore', href: '/candidate/omniscore', icon: Star },
		],
	},
	{
		title: 'OTHER',
		items: [
			{ label: 'Interviews', href: '/candidate/interviews', icon: Video },
			{ label: 'Offers', href: '/candidate/offers', icon: DollarSign },
			{ label: 'Documents', href: '/candidate/documents', icon: File },
			{ label: 'Pay & Compensation', href: '/candidate/payroll', icon: Wallet },
			{ label: 'Onboarding', href: '/candidate/onboarding', icon: ClipboardList },
			{ label: 'Settings', href: '/candidate/settings', icon: Settings },
		],
	},
]

/* ── Recruiter: flat list (unchanged) ──────────────────────────────────── */

const recruiterNav: NavItem[] = [
	{ label: 'Dashboard', href: '/recruiter', icon: LayoutDashboard },
	{ label: 'Jobs', href: '/recruiter/jobs', icon: Briefcase },
	{ label: 'Applications', href: '/recruiter/applications', icon: FileText },
	{ label: 'Assessments', href: '/recruiter/assessments', icon: GraduationCap },
	{ label: 'Candidates', href: '/recruiter/candidates', icon: Users },
	{ label: 'Interviews', href: '/recruiter/interviews', icon: MessageSquare },
	{ label: 'Offers', href: '/recruiter/offers', icon: CreditCard },
	{ label: 'Onboarding', href: '/recruiter/onboarding', icon: UserCheck },
	{ label: 'OmniScore', href: '/recruiter/omniscore', icon: Star },
	{ label: 'Analytics', href: '/recruiter/analytics', icon: BarChart3 },
	{ label: 'Compliance (EU AI Act)', href: '/recruiter/compliance', icon: Shield },
	{ label: 'Company', href: '/recruiter/company', icon: Building2 },
	{ label: 'Team', href: '/recruiter/team', icon: Users },
	{ label: 'Payroll', href: '/recruiter/payroll', icon: Wallet },
]

/* ── Component ─────────────────────────────────────────────────────────── */

export function Sidebar({ open, onClose }: SidebarProps) {
	const { isRecruiter, user, logout } = useAuth()
	const _location = useLocation()
	const [joinRequestCount, setJoinRequestCount] = useState(0)

	// Fetch pending join request count for company owners
	useEffect(() => {
		if (!user?.is_company_owner) return
		async function loadCount() {
			try {
				const data = await apiCall<{ success: boolean; requests: Array<{ id: number }> }>(
					'/company/join-requests',
				)
				setJoinRequestCount(data.requests?.length || 0)
			} catch {
				setJoinRequestCount(0)
			}
		}
		loadCount()
		const interval = setInterval(loadCount, 60000) // Refresh every 60s
		return () => clearInterval(interval)
	}, [user])

	// Close mobile sidebar on route change
	useEffect(() => {
		onClose()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onClose])

	const isProUser = (user as any)?.subscription_tier === 'pro' || (user as any)?.plan === 'pro'
	const showUpgradeCta = !isRecruiter && !isProUser
	const showJoinRequests = isRecruiter && user?.is_company_owner

	return (
		<>
			{open && (
				<div
					className='fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] lg:hidden'
					onClick={onClose}
					aria-hidden='true'
				/>
			)}

			<aside
				id='primary-navigation'
				aria-label='Primary navigation'
				role='navigation'
				className={cn(
					'fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none',
					open ? 'translate-x-0' : '-translate-x-full',
				)}
			>
				{/* Header */}
				<div className='flex h-16 items-center justify-between border-b px-6'>
					<NavLink
						to={isRecruiter ? '/recruiter' : '/candidate'}
						className='flex items-center gap-2'
						onClick={onClose}
					>
						<Logo size='sm' />
						<span className='font-heading text-lg font-bold'>Rekrut AI</span>
					</NavLink>
					<button
						onClick={onClose}
						className='flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 hover:bg-muted lg:hidden'
						aria-label='Close navigation menu'
					>
						<X className='h-5 w-5' />
					</button>
				</div>

				{/* Nav */}
				<nav className='flex-1 overflow-y-auto p-3'>
					{isRecruiter ? (
						/* Recruiter: flat list */
						<div className='space-y-1'>
							{recruiterNav.map((item) => (
								<NavLink
									key={item.href}
									to={item.href}
									end={item.href === '/recruiter'}
									onClick={onClose}
									className={({ isActive }) =>
										cn(
											'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
											isActive
												? 'bg-primary/10 text-primary'
												: 'text-muted-foreground hover:bg-muted hover:text-foreground',
										)
									}
								>
									<item.icon className='h-4 w-4 shrink-0' />
									{item.label}
								</NavLink>
							))}
							{showJoinRequests && (
								<NavLink
									to='/recruiter/team/join-requests'
									onClick={onClose}
									className={({ isActive }) =>
										cn(
											'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
											isActive
												? 'bg-primary/10 text-primary'
												: 'text-muted-foreground hover:bg-muted hover:text-foreground',
										)
									}
								>
									<UserPlus className='h-4 w-4 shrink-0' />
									<span className='flex-1'>Join Requests</span>
									{joinRequestCount > 0 && (
										<span className='rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground'>
											{joinRequestCount > 9 ? '9+' : joinRequestCount}
										</span>
									)}
								</NavLink>
							)}
						</div>
					) : (
						/* Candidate: grouped sections */
						<div className='space-y-1'>
							{candidateSections.map((section) => (
								<div key={section.title}>
									<h3 className='mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
										{section.title}
									</h3>
									<div className='mt-1 space-y-0.5'>
										{section.items.map((item) => (
											<NavLink
												key={item.href}
												to={item.href}
												end={item.href === '/candidate'}
												onClick={onClose}
												className={({ isActive }) =>
													cn(
														'group flex min-h-[44px] items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors',
														isActive
															? 'border-l-2 border-primary bg-primary/10 text-primary'
															: 'rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
													)
												}
											>
												<item.icon className='h-4 w-4 shrink-0' />
												<span className='flex-1'>{item.label}</span>
												{item.count ? (
													<span className='rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
														{item.count}
													</span>
												) : null}
												{item.isNew && !item.count ? (
													<span className='rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'>
														NEW
													</span>
												) : null}
											</NavLink>
										))}
									</div>
								</div>
							))}
						</div>
					)}
				</nav>

				{/* Bottom section */}
				<div className='space-y-2 border-t p-3'>
					{/* Recruiter Settings */}
					{isRecruiter && (
						<NavLink
							to='/settings'
							end
							onClick={onClose}
							className={({ isActive }) =>
								cn(
									'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
									isActive
										? 'bg-primary/10 text-primary'
										: 'text-muted-foreground hover:bg-muted hover:text-foreground',
								)
							}
						>
							<Settings className='h-4 w-4 shrink-0' />
							Settings
						</NavLink>
					)}

					{/* Upgrade to Pro CTA */}
					{showUpgradeCta && (
						<NavLink
							to='/pricing'
							onClick={onClose}
							className='flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90'
						>
							<Crown className='h-4 w-4 shrink-0' />
							Upgrade to Pro
						</NavLink>
					)}

					{/* Logout */}
					<button
						onClick={() => {
							logout()
							onClose()
						}}
						className='flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
					>
						<LogOut className='h-4 w-4 shrink-0' />
						Sign out
					</button>
				</div>
			</aside>
		</>
	)
}
