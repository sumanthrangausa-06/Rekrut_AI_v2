import {
	BarChart3,
	Briefcase,
	Building2,
	ClipboardCheck,
	CreditCard,
	FileText,
	GraduationCap,
	LayoutDashboard,
	MessageSquare,
	Settings,
	Sparkles,
	Star,
	UserCheck,
	Users,
	Wallet,
} from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Logo } from '@/components/ui/logo'
import { useAuth } from '@/contexts/auth-context'
import { cn } from '@/lib/utils'

interface SidebarProps {
	open: boolean
	onClose: () => void
}

interface NavItem {
	label: string
	href: string
	icon: React.ElementType
}

const candidateNav: NavItem[] = [
	{ label: 'Dashboard', href: '/candidate', icon: LayoutDashboard },
	{ label: 'Job Board', href: '/candidate/jobs', icon: Briefcase },
	{ label: 'Applications', href: '/candidate/applications', icon: FileText },
	{ label: 'Profile', href: '/candidate/profile', icon: UserCheck },
	{ label: 'Assessments', href: '/candidate/assessments', icon: GraduationCap },
	{ label: 'Interviews', href: '/candidate/interviews', icon: MessageSquare },
	{ label: 'AI Coaching', href: '/candidate/ai-coaching', icon: Sparkles },
	{ label: 'Offers', href: '/candidate/offers', icon: CreditCard },
	{ label: 'Onboarding', href: '/candidate/onboarding', icon: ClipboardCheck },
	{ label: 'Pay & Compensation', href: '/candidate/payroll', icon: CreditCard },
	{ label: 'OmniScore', href: '/candidate/omniscore', icon: Star },
]

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
	{ label: 'Company', href: '/recruiter/company', icon: Building2 },
	{ label: 'Payroll', href: '/recruiter/payroll', icon: Wallet },
]

export function Sidebar({ open, onClose }: SidebarProps) {
	const { isRecruiter } = useAuth()
	const _location = useLocation()
	const navItems = isRecruiter ? recruiterNav : candidateNav

	useEffect(() => {
		onClose()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onClose])

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
				<div className='flex h-16 items-center border-b px-6'>
					<NavLink
						to={isRecruiter ? '/recruiter' : '/candidate'}
						className='flex items-center gap-2'
					>
						<Logo size='sm' />
						<span className='font-heading text-lg font-bold'>Rekrut AI</span>
					</NavLink>
				</div>

				<nav className='flex-1 space-y-1 overflow-y-auto p-3'>
					{navItems.map((item) => (
						<NavLink
							key={item.href}
							to={item.href}
							end={item.href === '/candidate' || item.href === '/recruiter'}
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
				</nav>

				<div className='border-t p-3'>
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
				</div>
			</aside>
		</>
	)
}
