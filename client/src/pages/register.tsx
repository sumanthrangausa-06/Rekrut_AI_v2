import { AlertCircle, Eye, EyeOff, Mail, Moon, Sun, UserPlus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/ui/logo'
import { Select } from '@/components/ui/select'
import { getDashboardPath, useAuth } from '@/contexts/auth-context'
import { useTheme } from '@/contexts/theme-context'
import { trackEvent } from '@/lib/analytics'
import type { UserRole } from '@/lib/api'
import { clearTokens } from '@/lib/api'

export function RegisterPage() {
	const { register, isAuthenticated, user } = useAuth()
	const { theme, toggleTheme } = useTheme()
	const [searchParams] = useSearchParams()
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [role, setRole] = useState<UserRole>('candidate')
	const [companyName, setCompanyName] = useState('')
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const [showPassword, setShowPassword] = useState(false)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [touched, setTouched] = useState<Record<string, boolean>>({})

	// Read ?role=recruiter from URL and pre-select employer role
	useEffect(() => {
		const urlRole = searchParams.get('role')
		if (urlRole === 'recruiter') {
			setRole('employer')
		}
	}, [searchParams])

	function validateField(field: string, value: string): string {
		switch (field) {
			case 'name':
				return value.trim().length < 2 ? 'Full name must be at least 2 characters' : ''
			case 'email':
				return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Please enter a valid email address'
			case 'password':
				if (value.length < 8) return 'Password must be at least 8 characters'
				if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter'
				if (!/[a-z]/.test(value)) return 'Password must include at least one lowercase letter'
				if (!/[0-9]/.test(value)) return 'Password must include at least one number'
				return ''
			case 'company':
				return role === 'employer' && value.trim().length < 2 ? 'Company name is required for employers' : ''
			default:
				return ''
		}
	}

	function validateAll(): boolean {
		const newErrors: Record<string, string> = {}
		let hasError = false
		;['name', 'email', 'password'].forEach((field) => {
			const error = validateField(field, field === 'name' ? name : field === 'email' ? email : password)
			if (error) {
				newErrors[field] = error
				hasError = true
			}
		})
		if (role === 'employer') {
			const companyError = validateField('company', companyName)
			if (companyError) {
				newErrors.company = companyError
				hasError = true
			}
		}
		setErrors(newErrors)
		return !hasError
	}

	useEffect(() => {
		trackEvent('page_view_signup')
	}, [])

	if (isAuthenticated && user) {
		return <Navigate to={getDashboardPath(user.role)} replace />
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault()
		setTouched({ name: true, email: true, password: true, company: true })
		if (!validateAll()) return
		setError('')
		setLoading(true)

		try {
			clearTokens()
			trackEvent('signup_submit_click', { role, has_company: role === 'employer' })
			await register({
				email,
				password,
				name,
				role,
				company_name: role === 'employer' ? companyName : undefined,
			})
			trackEvent('signup_complete', { role, has_company: role === 'employer' })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Registration failed')
		} finally {
			setLoading(false)
		}
	}

	const handleBlur = (field: string) => {
		setTouched((prev) => ({ ...prev, [field]: true }))
		const value = field === 'name' ? name : field === 'email' ? email : field === 'password' ? password : companyName
		setErrors((prev) => ({ ...prev, [field]: validateField(field, value) }))
	}

	const isRecruiterRole = role === 'employer'

	return (
		<div className='flex min-h-screen'>
			{/* Left panel — Welcome */}
			<div className='hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-muted/20'>
				<div>
					<Link to='/' className='inline-flex items-center gap-2'>
						<Logo size='lg' />
						<span className='font-heading text-xl font-bold'>Rekrut AI</span>
					</Link>
				</div>

				<div className='max-w-md'>
					<div className='mb-6'>
						<div className='inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4'>
							<Mail className='h-6 w-6 text-primary' />
						</div>
						<h1 className='font-heading text-4xl font-bold tracking-tight'>Welcome!</h1>
						<h2 className='font-heading text-2xl sm:text-3xl font-medium text-muted-foreground mt-1'>
							First things first...
						</h2>
					</div>
					<p className='text-muted-foreground leading-relaxed'>
						Create your account to start matching with AI-recommended jobs, practice mock
						interviews, and build your OmniScore.
					</p>
				</div>

				<div className='flex items-center gap-3'>
					<button
						type='button'
						onClick={toggleTheme}
						className='inline-flex h-10 w-10 items-center justify-center rounded-full border hover:bg-muted transition-colors'
						aria-label='Toggle theme'
					>
						{theme === 'dark' ? <Sun className='h-5 w-5' /> : <Moon className='h-5 w-5' />}
					</button>
					<span className='text-sm text-muted-foreground'>
						{theme === 'dark' ? 'Light mode' : 'Dark mode'}
					</span>
				</div>
			</div>

			{/* Right panel — Form */}
			<div className='flex w-full lg:w-1/2 flex-col'>
				{/* Mobile header */}
				<div className='flex items-center justify-between p-6 lg:hidden'>
					<Link to='/' className='inline-flex items-center gap-2'>
						<Logo size='md' />
						<span className='font-heading text-lg font-bold'>Rekrut AI</span>
					</Link>
					<div className='flex items-center gap-2'>
						<button
							type='button'
							onClick={toggleTheme}
							className='inline-flex h-8 w-8 items-center justify-center rounded-full border hover:bg-muted transition-colors'
							aria-label='Toggle theme'
						>
							{theme === 'dark' ? <Sun className='h-4 w-4' /> : <Moon className='h-4 w-4' />}
						</button>
					</div>
				</div>

				<div className='flex flex-1 items-center justify-center px-6 py-8'>
					<div className='w-full max-w-sm'>
						{/* Desktop top-right link */}
						<div className='hidden lg:flex justify-end mb-8'>
							<p className='text-sm text-muted-foreground'>
								Already have an account?{' '}
								<Link to='/login' className='font-medium text-primary hover:underline'>
									Sign in
								</Link>
							</p>
						</div>

						<div className='text-center lg:text-left mb-8'>
							<h2 className='font-heading text-2xl font-bold'>Create an account</h2>
						</div>

						<form onSubmit={handleSubmit} className='space-y-5'>
							{error && (
								<div className='flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
									<AlertCircle className='h-4 w-4 shrink-0' />
									{error}
								</div>
							)}

							{/* Role selector */}
							<div className='space-y-2'>
								<Label htmlFor='role'>I am a</Label>
								<Select
									id='role'
									value={role}
									onValueChange={(value: string) => {
										setRole(value as UserRole)
										trackEvent('signup_role_select', { role: value })
									}}
								>
									<option value='candidate'>Job Seeker</option>
									<option value='employer'>Employer / Recruiter</option>
								</Select>
							</div>

							<div className='space-y-2'>
								<Label htmlFor='name'>Full name</Label>
								<Input
									id='name'
									placeholder='John Doe'
									value={name}
									onChange={(e) => setName(e.target.value)}
									onBlur={() => handleBlur('name')}
									autoComplete='name'
									className={\`h-11 \${errors.name ? 'border-red-500' : ''}\`}
								/>
								{errors.name && <p className='text-xs text-red-500'>{errors.name}</p>}
							</div>

							<div className='space-y-2'>
								<Label htmlFor='email'>Email</Label>
								<Input
									id='email'
									type='email'
									placeholder='example.email@gmail.com'
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									onBlur={() => handleBlur('email')}
									autoComplete='email'
									className={\`h-11 \${errors.email ? 'border-red-500' : ''}\`}
								/>
								{errors.email && <p className='text-xs text-red-500'>{errors.email}</p>}
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
										onBlur={() => handleBlur('password')}
										autoComplete='new-password'
										className={\`h-11 pr-10 \${errors.password ? 'border-red-500' : ''}\`}
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
								{errors.password && <p className='text-xs text-red-500'>{errors.password}</p>}
							</div>

							{isRecruiterRole && (
								<div className='space-y-2'>
									<Label htmlFor='company'>Company name</Label>
									<Input
										id='company'
										placeholder='Your company'
										value={companyName}
										onChange={(e) => setCompanyName(e.target.value)}
										onBlur={() => handleBlur('company')}
										className={\`h-11 \${errors.company ? 'border-red-500' : ''}\`}
									/>
									{errors.company && <p className='text-xs text-red-500'>{errors.company}</p>}
								</div>
							)}

							<Button
								type='submit'
								className='w-full h-11 bg-[#4F46E5] hover:bg-[#4338ca] text-white'
								disabled={loading}
							>
								{loading ? (
									<div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
								) : (
									<UserPlus className='h-4 w-4' />
								)}
								{loading ? 'Creating account...' : 'Sign up'}
							</Button>

							{/* Divider */}
							<div className='relative'>
								<div className='absolute inset-0 flex items-center'>
									<span className='w-full border-t' />
								</div>
								<div className='relative flex justify-center text-xs'>
									<span className='bg-background px-2 text-muted-foreground'>Or sign up with</span>
								</div>
							</div>

							{/* Social login */}
							<Button
								type='button'
								variant='outline'
								className='w-full h-11 gap-2'
								onClick={() => {
									trackEvent('signup_social_click', { provider: 'linkedin' })
									window.location.href = '/api/auth/linkedin/url'
								}}
							>
								<svg className='h-4 w-4' fill='#0A66C2' viewBox='0 0 24 24'>
									<path d='M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' />
								</svg>
								LinkedIn
							</Button>

							{/* Mobile footer link */}
							<p className='lg:hidden text-center text-sm text-muted-foreground'>
								Already have an account?{' '}
								<Link to='/login' className='font-medium text-primary hover:underline'>
									Sign in
								</Link>
							</p>
						</form>
					</div>
				</div>
			</div>
		</div>
	)
}
