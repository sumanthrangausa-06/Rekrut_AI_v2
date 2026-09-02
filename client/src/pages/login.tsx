import { AlertCircle, Briefcase, Eye, EyeOff, LogIn, Moon, Shield, Sun, User, Users } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/ui/logo'
import { getDashboardPath, useAuth } from '@/contexts/auth-context'
import { useTheme } from '@/contexts/theme-context'
import { trackEvent } from '@/lib/analytics'
import { clearTokens, setTokens } from '@/lib/api'

export function LoginPage() {
	const { login, isAuthenticated, user } = useAuth()
	const { theme, toggleTheme } = useTheme()
	const [searchParams, setSearchParams] = useSearchParams()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [rememberMe, setRememberMe] = useState(false)
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const [showPassword, setShowPassword] = useState(false)
	const [oauthStatus, setOauthStatus] = useState<{ google?: boolean; linkedin?: boolean }>({})
	const [oauthChecked, setOauthChecked] = useState(false)

	// Check URL params for OAuth callback or errors
	useEffect(() => {
		const tokenParam = searchParams.get('token')
		const refreshParam = searchParams.get('refresh')
		const errorParam = searchParams.get('error')

		if (errorParam) {
			setError(decodeURIComponent(errorParam))
			const newParams = new URLSearchParams(searchParams)
			newParams.delete('error')
			setSearchParams(newParams, { replace: true })
		}

		if (tokenParam) {
			setTokens(tokenParam, refreshParam || '')
			const newParams = new URLSearchParams(searchParams)
			newParams.delete('token')
			newParams.delete('refresh')
			setSearchParams(newParams, { replace: true })
			window.location.reload()
		}
	}, [searchParams, setSearchParams])

	// Check OAuth availability from backend
	useEffect(() => {
		fetch('/api/auth/oauth/status')
			.then((r) => r.json())
			.then((data) => {
				const status: { google?: boolean; linkedin?: boolean } = {}
				if (data?.google?.configured) status.google = true
				if (data?.linkedin?.configured) status.linkedin = true
				setOauthStatus(status)
			})
			.catch(() => {
				setOauthStatus({ google: true, linkedin: true })
			})
			.finally(() => setOauthChecked(true))
	}, [])

	useEffect(() => {
		trackEvent('page_view_login')
	}, [])

	if (isAuthenticated && user) {
		return <Navigate to={getDashboardPath(user)} replace />
	}

	const hasOAuth = oauthChecked && (oauthStatus.google || oauthStatus.linkedin)

	async function handleSubmit(e: FormEvent) {
		e.preventDefault()
		setError('')
		setLoading(true)

		try {
			trackEvent('login_submit_click')
			clearTokens()
			await login(email, password)
			trackEvent('login_complete')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Login failed'
			setError(message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className='flex min-h-screen'>
			{/* Left panel — Form */}
			<div className='flex w-full lg:w-1/2 flex-col'>
				{/* Header */}
				<div className='flex items-center justify-between p-6 lg:p-8'>
					<Link to='/' className='inline-flex items-center gap-2'>
						<Logo size='lg' />
						<span className='font-heading text-xl font-bold'>Rekrut AI</span>
					</Link>
					<div className='flex items-center gap-4'>
						<p className='hidden sm:block text-sm text-muted-foreground'>
							Don't have an account?{' '}
							<Link to='/register' className='font-medium text-primary hover:underline'>
								Sign up
							</Link>
						</p>
						<button
							type='button'
							onClick={toggleTheme}
							className='inline-flex h-10 w-10 items-center justify-center rounded-full border hover:bg-muted transition-colors'
							aria-label='Toggle theme'
						>
							{theme === 'dark' ? <Sun className='h-5 w-5' /> : <Moon className='h-5 w-5' />}
						</button>
					</div>
				</div>

				<div className='flex flex-1 items-center justify-center px-6 py-8'>
					<div className='w-full max-w-sm'>
						<div className='mb-8'>
							<h2 className='font-heading text-2xl font-bold'>Sign in</h2>
							<p className='mt-1 text-sm text-muted-foreground'>
								Welcome back — pick up where you left off
							</p>
						</div>

						<form onSubmit={handleSubmit} className='space-y-5'>
							{error && (
								<div className='flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
									<AlertCircle className='h-4 w-4 shrink-0' />
									{error}
								</div>
							)}

							<div className='space-y-2'>
								<Label htmlFor='email'>Email</Label>
								<Input
									id='email'
									type='email'
									placeholder='you@company.com'
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
									autoComplete='email'
									className='h-11'
								/>
							</div>

							<div className='space-y-2'>
								<Label htmlFor='password'>Password</Label>
								<div className='relative'>
									<Input
										id='password'
										type={showPassword ? 'text' : 'password'}
										placeholder='Enter at least 8+ characters'
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										autoComplete='current-password'
										className='h-11 pr-10'
									/>
									<button
										type='button'
										onClick={() => setShowPassword(!showPassword)}
										className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
										aria-label={showPassword ? 'Hide password' : 'Show password'}
									>
										{showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
									</button>
								</div>
							</div>

							<div className='flex items-center justify-between'>
								<div className='flex items-center gap-2'>
									<Checkbox
										id='remember'
										checked={rememberMe}
										onCheckedChange={(checked) => setRememberMe(checked === true)}
									/>
									<Label htmlFor='remember' className='text-sm font-normal cursor-pointer'>
										Remember me
									</Label>
								</div>
								<Link
									to='/forgot-password'
									className='text-sm font-medium text-primary hover:underline'
								>
									Forgot password?
								</Link>
							</div>

							<Button
								type='submit'
								className='w-full h-11 bg-[#4F46E5] hover:bg-[#4338ca] text-white'
								disabled={loading}
							>
								{loading ? (
									<div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
								) : (
									<LogIn className='h-4 w-4' />
								)}
								{loading ? 'Signing in...' : 'Sign in'}
							</Button>

							{/* Divider */}
							{hasOAuth && (
								<>
									<div className='relative'>
										<div className='absolute inset-0 flex items-center'>
											<span className='w-full border-t' />
										</div>
										<div className='relative flex justify-center text-xs'>
											<span className='bg-background px-2 text-muted-foreground'>
												Or sign in with
											</span>
										</div>
									</div>

									<div className='grid grid-cols-2 gap-2'>
										{oauthStatus.google && (
											<Button
												type='button'
												variant='outline'
												className='w-full h-11 gap-2'
												onClick={async () => {
																		trackEvent('login_social_click', { provider: 'google' })
																		window.location.href = '/api/auth/google/url'
																	}}
											>
												<svg className='h-4 w-4' viewBox='0 0 24 24'>
													<path
														d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
														fill='#4285F4'
													/>
													<path
														d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
														fill='#34A853'
													/>
													<path
														d='M5.85 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
														fill='#FBBC05'
													/>
													<path
														d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.67 2.84c.86-2.6 3.3-4.53 6.15-4.53z'
														fill='#EA4335'
													/>
												</svg>
												Google
											</Button>
										)}
										{oauthStatus.linkedin && (
											<Button
												type='button'
												variant='outline'
												className='w-full h-11 gap-2'
												onClick={async () => {
																		trackEvent('login_social_click', { provider: 'linkedin' })
																		window.location.href = '/api/auth/linkedin/url'
																	}}
											>
												<svg className='h-4 w-4' fill='#0A66C2' viewBox='0 0 24 24'>
													<path d='M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' />
												</svg>
												LinkedIn
											</Button>
										)}
									</div>
								</>
							)}

							{/* Trust indicators */}
							<div className='pt-4 border-t'>
								<div className='flex items-center justify-center gap-4 text-xs text-muted-foreground'>
									<div className='flex items-center gap-1.5'>
										<Shield className='h-3.5 w-3.5 text-emerald-500' />
										<span>SSL Secured</span>
									</div>
									<div className='flex items-center gap-1.5'>
										<Users className='h-3.5 w-3.5 text-emerald-500' />
										<span>Trusted by 2,000+ companies</span>
									</div>
								</div>
								{/* TODO(copy): Replace with actual partner logos or testimonials */}
								<p className='mt-2 text-center text-[10px] text-muted-foreground/60'>
									SOC 2 Type II compliant &middot; GDPR ready &middot; AES-256 encryption
								</p>
							</div>

							{/* Mobile footer link */}
							<p className='sm:hidden text-center text-sm text-muted-foreground'>
								Don't have an account?{' '}
								<Link to='/register' className='font-medium text-primary hover:underline'>
									Sign up
								</Link>
							</p>
						</form>
					</div>
				</div>
			</div>

			{/* Right panel — Decorative / Branding */}
			<div className='hidden lg:flex lg:w-1/2 relative items-center justify-center overflow-hidden bg-[#4F46E5]'>
				{/* Abstract background shapes */}
				<div className='absolute inset-0 pointer-events-none'>
					<div className='absolute top-10 right-10 h-20 w-20 rounded-full bg-white/10' />
					<div className='absolute bottom-20 left-10 h-32 w-32 rounded-full bg-white/10' />
					<div className='absolute top-1/2 right-1/4 h-16 w-16 rounded-full bg-white/10' />
					<div className='absolute bottom-10 right-20 h-24 w-24 rounded-full bg-white/10' />
					<div className='absolute top-1/3 left-1/4 h-40 w-40 rounded-full bg-white/5' />
					<div className='absolute -bottom-8 -left-8 h-48 w-48 rounded-full bg-white/5' />
				</div>
				<div className='relative z-10 text-center text-white px-12 max-w-lg'>
					<div className='inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 mb-6'>
						<svg
							className='h-8 w-8 text-white'
							fill='none'
							viewBox='0 0 24 24'
							stroke='currentColor'
							strokeWidth={2}
						>
							<path
								strokeLinecap='round'
								strokeLinejoin='round'
								d='M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
							/>
						</svg>
					</div>
					<h3 className='font-heading text-2xl sm:text-3xl font-bold mb-4'>Welcome back!</h3>
					<p className='text-white/80 text-lg max-w-sm mx-auto leading-relaxed'>
						Sign in to access your dashboard, track applications, and continue your interview
						practice.
					</p>

					{/* Role quick links */}
					<div className='mt-10 grid grid-cols-2 gap-4'>
						<Link
							to='/register'
							className='flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors p-4 text-left'
						>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 shrink-0'>
								<User className='h-5 w-5' />
							</div>
							<div>
								<p className='font-medium text-sm'>Job Seeker</p>
								<p className='text-xs text-white/70'>Find your next role</p>
							</div>
						</Link>
						<Link
							to='/register?role=recruiter'
							className='flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors p-4 text-left'
						>
							<div className='flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 shrink-0'>
								<Briefcase className='h-5 w-5' />
							</div>
							<div>
								<p className='font-medium text-sm'>Employer</p>
								<p className='text-xs text-white/70'>Hire top talent</p>
							</div>
						</Link>
					</div>
				</div>
			</div>
		</div>
	)
}
