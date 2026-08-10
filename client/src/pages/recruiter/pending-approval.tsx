import {
	Building2,
	CheckCircle,
	Clock,
	Loader2,
	Mail,
	Shield,
	Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Logo } from '@/components/ui/logo'
import { useAuth } from '@/contexts/auth-context'

/**
 * Pending Approval Holding Screen (Issue #152)
 *
 * Displayed when a recruiter registers with a company domain that already
 * exists. Their account is in `pending_approval` state until the company
 * owner/admin approves the join request.
 *
 * Features:
 * - Branded empty-state illustration
 * - Company info (name + domain)
 * - Contact info for company owner/admin
 * - Estimated wait time messaging
 * - Auto-refresh every 30 seconds to poll for approval
 * - Auto-redirect to dashboard once approved
 */

export function RecruiterPendingApprovalPage() {
	const { user, isPendingApproval, refreshUser, logout } = useAuth()
	const navigate = useNavigate()
	const [lastChecked, setLastChecked] = useState<Date>(new Date())
	const [checking, setChecking] = useState(false)
	const [nextCheckIn, setNextCheckIn] = useState(30)

	// Auto-refresh status every 30 seconds
	useEffect(() => {
		// If no longer pending, redirect to dashboard immediately
		if (!isPendingApproval && user) {
			navigate('/recruiter', { replace: true })
			return
		}

		const interval = setInterval(() => {
			setChecking(true)
			refreshUser()
				.then(() => {
					setLastChecked(new Date())
				})
				.finally(() => {
					setChecking(false)
					setNextCheckIn(30)
				})
		}, 30_000)

		return () => clearInterval(interval)
	}, [isPendingApproval, user, refreshUser, navigate])

	// Countdown timer for next auto-check
	useEffect(() => {
		const timer = setInterval(() => {
			setNextCheckIn((prev) => (prev > 0 ? prev - 1 : 30))
		}, 1000)
		return () => clearInterval(timer)
	}, [lastChecked])

	// Manual refresh handler
	const handleManualRefresh = async () => {
		setChecking(true)
		await refreshUser()
		setLastChecked(new Date())
		setNextCheckIn(30)
		setChecking(false)
	}

	// Extract domain from email for display
	const emailDomain = user?.email ? user.email.split('@')[1] : ''
	const companyDisplayName = user?.company_name || emailDomain || 'your company'

	return (
		<div className='flex min-h-dvh-safe flex-col bg-background'>
			{/* Top header bar */}
			<header className='sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/60 lg:px-6'>
				<div className='flex items-center gap-2'>
					<Logo size='sm' />
					<span className='font-heading text-lg font-bold'>Rekrut AI</span>
				</div>
				<div className='flex items-center gap-3'>
					<span className='hidden sm:inline-flex items-center gap-1.5 rounded-full border bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'>
						<Clock className='h-3 w-3' />
						Pending Approval
					</span>
					<Button variant='ghost' size='sm' onClick={logout}>
						Sign out
					</Button>
				</div>
			</header>

			{/* Main content */}
			<main className='flex flex-1 items-center justify-center p-4 sm:p-8'>
				<div className='w-full max-w-lg space-y-6'>
					{/* Hero illustration / empty state */}
					<div className='flex flex-col items-center text-center space-y-4'>
						<div className='relative'>
							<div className='flex h-24 w-24 items-center justify-center rounded-full bg-indigo-50 ring-8 ring-indigo-50/50 dark:bg-indigo-950/30 dark:ring-indigo-950/20'>
								<Shield className='h-12 w-12 text-indigo-500' />
							</div>
							<div className='absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 ring-2 ring-background dark:bg-amber-950/40'>
								<Clock className='h-4 w-4 text-amber-600' />
							</div>
						</div>

						<div>
							<h1 className='font-heading text-2xl sm:text-3xl font-bold tracking-tight'>
								Awaiting Approval
							</h1>
							<p className='mt-2 text-muted-foreground max-w-sm mx-auto'>
								Your request to join{' '}
								<strong className='text-foreground'>{companyDisplayName}</strong>{' '}
								is pending review by the company administrator.
							</p>
						</div>
					</div>

					{/* Status card */}
					<Card className='border-indigo-200 bg-indigo-50/30 dark:bg-indigo-950/10'>
						<CardHeader className='pb-3'>
							<CardTitle className='text-base flex items-center gap-2'>
								<Sparkles className='h-4 w-4 text-indigo-500' />
								What happens next?
							</CardTitle>
						</CardHeader>
						<CardContent className='pt-0 space-y-4'>
							<div className='flex gap-3'>
								<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30'>
									<span className='text-xs font-bold text-indigo-600 dark:text-indigo-400'>1</span>
								</div>
								<div>
									<p className='text-sm font-medium'>Request sent</p>
									<p className='text-xs text-muted-foreground'>
										Your join request has been submitted to the company
										administrator.
									</p>
								</div>
							</div>
							<div className='flex gap-3'>
								<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30'>
									<span className='text-xs font-bold text-indigo-600 dark:text-indigo-400'>2</span>
								</div>
								<div>
									<p className='text-sm font-medium'>Admin review</p>
									<p className='text-xs text-muted-foreground'>
										The company owner or admin will review your request and
										verify your email domain ({emailDomain}).
									</p>
								</div>
							</div>
							<div className='flex gap-3'>
								<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30'>
									<span className='text-xs font-bold text-indigo-600 dark:text-indigo-400'>3</span>
								</div>
								<div>
									<p className='text-sm font-medium'>Access granted</p>
									<p className='text-xs text-muted-foreground'>
										Once approved, you will be automatically redirected to your
										recruiter dashboard.
									</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Company info card */}
					<Card>
						<CardContent className='p-4'>
							<div className='flex items-start gap-3'>
								<div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
									<Building2 className='h-5 w-5 text-muted-foreground' />
								</div>
								<div className='flex-1 min-w-0'>
									<p className='text-sm font-medium'>Company</p>
									<p className='text-sm text-muted-foreground truncate'>
										{companyDisplayName}
									</p>
								</div>
								<div className='shrink-0'>
									<span className='inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'>
										<Clock className='h-2.5 w-2.5' />
										Pending
									</span>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Contact & wait time info */}
					<div className='grid gap-3 sm:grid-cols-2'>
						<Card>
							<CardContent className='p-4'>
								<div className='flex items-center gap-3'>
									<div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30'>
										<Mail className='h-4 w-4' />
									</div>
									<div>
										<p className='text-xs text-muted-foreground'>Contact</p>
										<p className='text-sm font-medium'>Company Admin</p>
									</div>
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className='p-4'>
								<div className='flex items-center gap-3'>
									<div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30'>
										<CheckCircle className='h-4 w-4' />
									</div>
									<div>
										<p className='text-xs text-muted-foreground'>Est. wait time</p>
										<p className='text-sm font-medium'>Usually within 24h</p>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>

					{/* Auto-refresh indicator */}
					<div className='flex items-center justify-between rounded-lg border bg-card p-3'>
						<div className='flex items-center gap-2 text-sm text-muted-foreground'>
							{checking ? (
								<>
									<Loader2 className='h-4 w-4 animate-spin text-indigo-500' />
									Checking approval status...
								</>
							) : (
								<>
									<Clock className='h-4 w-4' />
									Auto-checking in {nextCheckIn}s
								</>
							)}
						</div>
						<Button
							variant='ghost'
							size='sm'
							onClick={handleManualRefresh}
							disabled={checking}
							className='text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400'
						>
							{checking ? (
								<Loader2 className='h-4 w-4 animate-spin' />
							) : (
								'Check now'
							)}
						</Button>
					</div>

					{/* Last checked timestamp */}
					<p className='text-center text-xs text-muted-foreground'>
						Last checked: {lastChecked.toLocaleTimeString()}
					</p>
				</div>
			</main>
		</div>
	)
}
